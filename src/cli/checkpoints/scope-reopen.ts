import { readJsonSafely } from '../artifacts/json';
import { sprintJsonPath } from '../artifacts/paths';
import { asSprintFile } from '../artifacts/schema';
import { KyroCoreError } from '../core/errors';
import { readProjectState, updateProjectStateLayersUnlocked } from '../state';
import { withStateWriterLock } from '../pipeline/state-writer-lock';
import { reopenedScopeEntry, reopenedSprintState } from './lifecycle-state';
import type { KyroProjectState, KyroScopeEntry, ScopeCompletion, ScopeReopenRecord, SprintFile } from '../types';
import { atomicReplace, canonicalJson, sha256 } from './sprint-close';

export const SCOPE_REOPEN_KIND = 'scope-reopen' as const;
export const SCOPE_REOPEN_SCHEMA_VERSION = 1 as const;

export interface ScopeReopenRequest {
  scope: string;
  reason: string;
}

export type ScopeReopenState = 'fresh' | 'resumable' | 'already-applied';

export interface ScopeReopenPreparation {
  request: ScopeReopenRequest;
  requestDigest: string;
  currentStatus: string;
  /** The completion this reopen supersedes — live for a fresh reopen, historical for a resume. */
  supersededCompletion: ScopeCompletion;
  affectedFiles: string[];
  validations: string[];
  state: ScopeReopenState;
}

export interface ScopeReopenApplyResult {
  requestDigest: string;
  resumed: boolean;
  wrote: 'both' | 'registry-only' | 'none';
}

function normalizeReason(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === '') {
    throw new KyroCoreError('INVALID_INPUT', 'Reopening a scope requires a non-empty --reason.', 'State why the completed scope needs further work; the reason is recorded permanently.');
  }
  return trimmed;
}

/**
 * Bound to the exact completion being reversed, not just to the scope and reason. A scope that is
 * completed again later and reopened again with the identical reason yields a different digest, so
 * no reopen can ever be confused with an earlier one.
 */
function scopeReopenRequestDigest(scope: string, reason: string, completion: ScopeCompletion): string {
  return sha256({
    kind: SCOPE_REOPEN_KIND,
    schemaVersion: SCOPE_REOPEN_SCHEMA_VERSION,
    part: 'request',
    scope,
    reason,
    completion,
  });
}

function scopeRegistryEntryDigest(entry: KyroScopeEntry): string {
  return sha256({
    kind: SCOPE_REOPEN_KIND,
    schemaVersion: SCOPE_REOPEN_SCHEMA_VERSION,
    part: 'registryEntry',
    entry,
  });
}

function readValidSprint(scope: string): SprintFile {
  const read = readJsonSafely(sprintJsonPath(scope));
  if (read.error || !read.exists) {
    throw new KyroCoreError('INVALID_JSON', `sprint.json for "${scope}" is invalid JSON (${read.error ?? 'missing'}).`, 'Fix invalid JSON or restore from an archive snapshot.');
  }
  const sprint = asSprintFile(read.value);
  if (!sprint) throw new KyroCoreError('INVALID_SPRINT_SHAPE', `sprint.json for "${scope}" does not match the v4 schema.`, `Run kyro doctor --artifacts --kyro-scope ${scope}.`);
  return sprint;
}

function readRegisteredProject(scope: string): { project: KyroProjectState; entry: KyroScopeEntry } {
  const project = readProjectState();
  if (!project) throw new KyroCoreError('INVALID_INPUT', 'Kyro project state not found.', 'Run kyro install --init-workspace to create project state.');
  const entry = project.scopes.find((candidate) => candidate.id === scope);
  if (!entry) throw new KyroCoreError('SCOPE_NOT_FOUND', `Scope not found: ${scope}`, 'Run kyro scope list to see available scopes.');
  return { project, entry };
}

/** Retirement is terminal and human-gated; reopen is never a retirement reversal. */
function assertNotRetired(scope: string, sprint: SprintFile, entry: KyroScopeEntry): void {
  if (sprint.retirement || entry.status === 'retired') {
    throw new KyroCoreError('SCOPE_RETIRED', `Cannot reopen retired scope: ${scope}.`, 'Retirement is terminal by human approval. Plan the follow-on work in a new scope instead.');
  }
}

function lastReopen(records: ScopeReopenRecord[] | undefined): ScopeReopenRecord | null {
  if (!records || records.length === 0) return null;
  return records[records.length - 1] ?? null;
}

/**
 * Resolve which lifecycle transition this request describes without writing. A fresh reopen reads
 * the live `completion`; a resume (sprint written, registry not yet) has no live completion left in
 * sprint.json, so the superseded completion is read back from the history entry this request wrote.
 */
function resolveReopenTransition(
  request: ScopeReopenRequest,
  reason: string,
  sprint: SprintFile,
  entry: KyroScopeEntry,
): { requestDigest: string; supersededCompletion: ScopeCompletion; state: ScopeReopenState } {
  if (sprint.completion) {
    const requestDigest = scopeReopenRequestDigest(request.scope, reason, sprint.completion);
    return { requestDigest, supersededCompletion: sprint.completion, state: 'fresh' };
  }
  const record = lastReopen(sprint.completionHistory);
  if (!record) {
    throw new KyroCoreError(
      'SCOPE_ALREADY_OPEN',
      `Scope "${request.scope}" is not completed, so there is nothing to reopen.`,
      'Run kyro status to see the current lifecycle state; an open scope can plan its next sprint directly.',
    );
  }
  const requestDigest = scopeReopenRequestDigest(request.scope, reason, record.completion);
  if (record.requestDigest !== requestDigest) {
    throw new KyroCoreError(
      'SCOPE_ALREADY_OPEN',
      `Scope "${request.scope}" is already open; its most recent completion was reopened on ${record.reopenedAt}.`,
      'Inspect the recorded reopen history with kyro scope inspect; an open scope can plan its next sprint directly.',
    );
  }
  const entryRecord = lastReopen(entry.completionHistory);
  const state: ScopeReopenState = entryRecord?.requestDigest === requestDigest && entry.completion === undefined
    ? 'already-applied'
    : 'resumable';
  return { requestDigest, supersededCompletion: record.completion, state };
}

/**
 * Unlocked, best-effort, fresh-read preview. Never authoritative — `applyScopeReopen` re-derives
 * everything under the lock. Digest-aware so an interrupted apply is reported as resumable instead
 * of being rejected as an already-open scope.
 */
export function buildScopeReopenPreparation(request: ScopeReopenRequest): ScopeReopenPreparation {
  const reason = normalizeReason(request.reason);
  const sprint = readValidSprint(request.scope);
  const { entry } = readRegisteredProject(request.scope);
  assertNotRetired(request.scope, sprint, entry);
  if (sprint.activeSprint !== null) {
    throw new KyroCoreError('SCOPE_ALREADY_OPEN', `Scope "${request.scope}" has an active sprint and is already open.`, 'Continue the active sprint with /kyro:forge, or close it before deciding the scope lifecycle.');
  }
  const { requestDigest, supersededCompletion, state } = resolveReopenTransition(request, reason, sprint, entry);

  return {
    request: { scope: request.scope, reason },
    requestDigest,
    currentStatus: entry.status,
    supersededCompletion,
    affectedFiles: [sprintJsonPath(request.scope), '.agents/kyro/project.json'],
    validations: [
      'scope exists, is registered, is not retired, and carries an explicit completion',
      'the superseded completion is preserved in append-only completionHistory',
      'apply is a single locked transaction bound to this request digest',
      'archive/ is never read for mutation, rewritten, or removed',
    ],
    state,
  };
}

/** The sole write authority for scope reopen. Locked, re-validated, idempotent, recoverable. */
export function applyScopeReopen(request: ScopeReopenRequest): ScopeReopenApplyResult {
  const reason = normalizeReason(request.reason);

  return withStateWriterLock(() => {
    const sprint = readValidSprint(request.scope);
    const { project, entry } = readRegisteredProject(request.scope);
    assertNotRetired(request.scope, sprint, entry);
    if (sprint.activeSprint !== null) {
      throw new KyroCoreError('SCOPE_ALREADY_OPEN', `Scope "${request.scope}" has an active sprint and is already open.`, 'Continue the active sprint with /kyro:forge, or close it before deciding the scope lifecycle.');
    }
    const { requestDigest, supersededCompletion, state } = resolveReopenTransition(request, reason, sprint, entry);

    if (state === 'already-applied') {
      assertExactlyApplied(request.scope, sprint, entry, requestDigest);
      return { requestDigest, resumed: true, wrote: 'none' };
    }

    if (state === 'resumable') {
      const record = lastReopen(sprint.completionHistory)!;
      assertAuthorizedSprintAfterState(request.scope, sprint, requestDigest);
      if (entry.completion === undefined && lastReopen(entry.completionHistory)?.requestDigest !== requestDigest) {
        throw new KyroCoreError('REOPEN_CONFLICT', `Scope "${request.scope}" registry entry is already open but carries no matching reopen record.`, 'Inspect the registry and sprint lifecycle records with kyro scope inspect before retrying.');
      }
      if (!record.beforeEntryDigest || scopeRegistryEntryDigest(entry) !== record.beforeEntryDigest) {
        throw diverged('the project registry entry differs from the state recorded when sprint.json was reopened; cannot resume safely');
      }
      updateProjectStateLayersUnlocked({ scopes: project.scopes.map((candidate) => candidate.id === request.scope ? reopenedScopeEntry(entry, record, sprint) : candidate) });
      failAfter('registry');
      verifyApplied(request.scope, requestDigest);
      return { requestDigest, resumed: true, wrote: 'registry-only' };
    }

    if (entry.completion === undefined || canonicalJson(entry.completion) !== canonicalJson(supersededCompletion)) {
      throw new KyroCoreError(
        'REOPEN_CONFLICT',
        `Scope "${request.scope}" registry entry does not carry the same completion that sprint.json records.`,
        'Reconcile the completion records (kyro doctor --artifacts) before reopening the scope.',
      );
    }

    const beforeEntryDigest = scopeRegistryEntryDigest(entry);
    const reopenedAt = new Date().toISOString();
    const record: ScopeReopenRecord = {
      reopenedAt,
      by: process.env.KYRO_ACTOR ?? 'maker',
      reason,
      completion: supersededCompletion,
      requestDigest,
      beforeEntryDigest,
    };
    const nextSprint = reopenedSprintState(sprint, record);
    atomicReplace(sprintJsonPath(request.scope), `${JSON.stringify(nextSprint, null, 2)}\n`);
    failAfter('sprint');
    updateProjectStateLayersUnlocked({ scopes: project.scopes.map((candidate) => candidate.id === request.scope ? reopenedScopeEntry(entry, record, nextSprint) : candidate) });
    failAfter('registry');
    verifyApplied(request.scope, requestDigest);
    return { requestDigest, resumed: false, wrote: 'both' };
  });
}

function verifyApplied(scope: string, requestDigest: string): void {
  const sprint = readValidSprint(scope);
  const { entry } = readRegisteredProject(scope);
  assertExactlyApplied(scope, sprint, entry, requestDigest);
}

/**
 * A request digest identifies intent, not the entire committed transition. A no-op is legal only
 * when both durable records also contain the exact terminal shape this writer owns; otherwise an
 * interrupted or externally edited state must never be mistaken for success.
 */
function assertExactlyApplied(scope: string, sprint: SprintFile, entry: KyroScopeEntry, requestDigest: string): void {
  assertAuthorizedSprintAfterState(scope, sprint, requestDigest);
  const entryRecord = lastReopen(entry.completionHistory);
  if (entry.completion !== undefined || entryRecord?.requestDigest !== requestDigest) {
    throw diverged('the project registry entry does not contain the authorized reopened after-state');
  }
  if (canonicalJson(entryRecord) !== canonicalJson(lastReopen(sprint.completionHistory))) {
    throw diverged('sprint and registry reopen records diverge');
  }
  if (entry.status === 'completed' || entry.status === 'retired') {
    throw diverged(`the project registry still reports the scope as ${entry.status}`);
  }
}

function assertAuthorizedSprintAfterState(scope: string, sprint: SprintFile, requestDigest: string): void {
  const record = lastReopen(sprint.completionHistory);
  if (
    sprint.completion !== undefined
    || sprint.retirement !== undefined
    || sprint.status !== 'planning'
    || record?.requestDigest !== requestDigest
    || !record.beforeEntryDigest
    || sprint.handoff.nextAction !== 'plan_sprint'
    || sprint.handoff.nextTaskId !== null
  ) {
    throw diverged(`sprint.json for "${scope}" does not contain the authorized reopened after-state`);
  }
}

function failAfter(boundary: 'sprint' | 'registry'): void {
  if (process.env.KYRO_TEST_REOPEN_FAIL_AFTER === boundary) {
    throw new KyroCoreError('INTERNAL', `Injected reopen failure after ${boundary}.`, 'Retry the identical command; the reopen is resumable.');
  }
}

function diverged(detail: string): KyroCoreError {
  return new KyroCoreError('DIVERGED', `Scope reopen diverged: ${detail}.`, 'No files were overwritten. Inspect the live state and retry the identical command, or reconcile explicitly.');
}
