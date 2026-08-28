import { readJsonSafely } from '../artifacts/json';
import { sprintJsonPath } from '../artifacts/paths';
import { asSprintFile } from '../artifacts/schema';
import { KyroCoreError } from '../core/errors';
import { readProjectState, updateProjectStateLayersUnlocked } from '../state';
import { withStateWriterLock } from '../pipeline/state-writer-lock';
import { completedScopeEntry, completedSprintState } from './lifecycle-state';
import type { KyroProjectState, KyroScopeEntry, ScopeCompletion, SprintFile } from '../types';
import { atomicReplace, canonicalJson, sha256 } from './sprint-close';

export const SCOPE_COMPLETION_KIND = 'scope-completion' as const;
export const SCOPE_COMPLETION_SCHEMA_VERSION = 1 as const;

export interface ScopeCompletionRequest {
  scope: string;
  summary: string | null;
}

export type ScopeCompletionState = 'fresh' | 'resumable' | 'already-applied';

export interface ScopeCompletionPreparation {
  request: ScopeCompletionRequest;
  normalizedSummary: string | null;
  requestDigest: string;
  currentStatus: string;
  affectedFiles: string[];
  validations: string[];
  state: ScopeCompletionState;
}

export interface ScopeCompletionApplyResult {
  requestDigest: string;
  resumed: boolean;
  wrote: 'both' | 'registry-only' | 'none';
}

/**
 * Preconditions for a *fresh* completion (no active sprint, no open/in-progress debt, no pending
 * review, no blocking findings, no artifact divergence). Injected rather than imported directly so
 * this module — which owns the locked transaction — does not depend on `commands/artifact-doctor`,
 * preserving the existing one-directional `commands/` → `checkpoints/` layering.
 */
export type ScopeCompletionHealthCheck = (scope: string) => void;

function normalizeCompletionSummary(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

function scopeCompletionRequestDigest(scope: string, normalizedSummary: string | null): string {
  return sha256({
    kind: SCOPE_COMPLETION_KIND,
    schemaVersion: SCOPE_COMPLETION_SCHEMA_VERSION,
    part: 'request',
    scope,
    summary: normalizedSummary,
  });
}

function scopeRegistryEntryDigest(entry: KyroScopeEntry): string {
  return sha256({
    kind: SCOPE_COMPLETION_KIND,
    schemaVersion: SCOPE_COMPLETION_SCHEMA_VERSION,
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

function assertNotRetired(scope: string, sprint: SprintFile, entry: KyroScopeEntry): void {
  if (sprint.retirement || entry.status === 'retired') {
    throw new KyroCoreError('SCOPE_RETIRED', `Cannot complete retired scope: ${scope}.`, 'Retirement is a separate terminal state; use kyro scope inspect to review it.');
  }
}

/**
 * Unlocked, best-effort, fresh-read preview. Never authoritative — `applyScopeCompletion` re-derives
 * everything from scratch under the lock. Digest-aware so a legitimate resume ("this is our own
 * request, already partially applied") is reported as resumable rather than rejected as a conflict.
 */
export function buildScopeCompletionPreparation(
  request: ScopeCompletionRequest,
  assertHealthy: ScopeCompletionHealthCheck,
): ScopeCompletionPreparation {
  const normalizedSummary = normalizeCompletionSummary(request.summary);
  const requestDigest = scopeCompletionRequestDigest(request.scope, normalizedSummary);
  const sprint = readValidSprint(request.scope);
  const { entry } = readRegisteredProject(request.scope);
  assertNotRetired(request.scope, sprint, entry);

  let state: ScopeCompletionState = 'fresh';
  if (sprint.completion !== undefined) {
    if (sprint.completion.requestDigest !== requestDigest) {
      throw new KyroCoreError('COMPLETION_CONFLICT', `Scope "${request.scope}" is already completed.`, 'Use kyro status to inspect the existing completion record.');
    }
    state = entry.completion?.requestDigest === requestDigest ? 'already-applied' : 'resumable';
  } else if (entry.completion !== undefined) {
    // Registry claims completion the sprint never recorded — impossible via this module's own write
    // order (sprint is always written before the registry); let the locked apply fail this closed.
    state = 'fresh';
  } else {
    assertHealthy(request.scope);
  }

  return {
    request,
    normalizedSummary,
    requestDigest,
    currentStatus: entry.status,
    affectedFiles: [sprintJsonPath(request.scope), '.agents/kyro/project.json'],
    validations: [
      'scope exists, is registered, and is not retired',
      'no active sprint, open debt, pending review, or blocking findings (fresh completions only)',
      'apply is a single locked transaction bound to this request digest',
      'a matching prior attempt resumes instead of re-writing sprint.json',
    ],
    state,
  };
}

/** The sole write authority for scope completion. Locked, re-validated, idempotent, recoverable. */
export function applyScopeCompletion(
  request: ScopeCompletionRequest,
  assertHealthy: ScopeCompletionHealthCheck,
): ScopeCompletionApplyResult {
  const normalizedSummary = normalizeCompletionSummary(request.summary);
  const requestDigest = scopeCompletionRequestDigest(request.scope, normalizedSummary);

  return withStateWriterLock(() => {
    const sprint = readValidSprint(request.scope);
    const { project, entry } = readRegisteredProject(request.scope);
    assertNotRetired(request.scope, sprint, entry);

    const sprintMatches = sprint.completion?.requestDigest === requestDigest;
    const entryMatches = entry.completion?.requestDigest === requestDigest;

    if (sprintMatches && entryMatches) {
      assertExactlyApplied(request.scope, sprint, entry, requestDigest);
      return { requestDigest, resumed: true, wrote: 'none' };
    }

    if (sprintMatches && !entryMatches) {
      if (entry.completion !== undefined) {
        throw new KyroCoreError('COMPLETION_CONFLICT', `Scope "${request.scope}" registry entry already carries a different completion than sprint.json authorizes.`, 'Inspect status or doctor for the conflicting completion records.');
      }
      const beforeEntryDigest = sprint.completion!.beforeEntryDigest;
      assertAuthorizedSprintAfterState(request.scope, sprint, requestDigest);
      if (!beforeEntryDigest || scopeRegistryEntryDigest(entry) !== beforeEntryDigest) {
        throw diverged('the project registry entry differs from the state recorded when sprint.json was completed; cannot resume safely');
      }
      const nextEntry: KyroScopeEntry = completedScopeEntry(entry, sprint.completion!);
      updateProjectStateLayersUnlocked({ scopes: project.scopes.map((candidate) => candidate.id === request.scope ? nextEntry : candidate) });
      failAfter('registry');
      verifyApplied(request.scope, requestDigest);
      return { requestDigest, resumed: true, wrote: 'registry-only' };
    }

    if (sprint.completion !== undefined) {
      throw new KyroCoreError('COMPLETION_CONFLICT', `Scope "${request.scope}" is already completed.`, 'Use kyro status to inspect the existing completion record.');
    }

    if (entry.completion !== undefined) {
      throw diverged('the project registry already carries completion metadata that sprint.json does not — unexpected write ordering');
    }

    // Fresh scenario: re-run real preconditions now, under the lock, against state read this instant.
    assertHealthy(request.scope);

    const beforeEntryDigest = scopeRegistryEntryDigest(entry);
    const completedAt = new Date().toISOString();
    const completion: ScopeCompletion = {
      completedAt,
      by: process.env.KYRO_ACTOR ?? 'maker',
      ...(normalizedSummary ? { summary: normalizedSummary } : {}),
      requestDigest,
      beforeEntryDigest,
    };
    const nextSprint: SprintFile = completedSprintState(sprint, completion);
    atomicReplace(sprintJsonPath(request.scope), `${JSON.stringify(nextSprint, null, 2)}\n`);
    failAfter('sprint');
    const nextEntry: KyroScopeEntry = completedScopeEntry(entry, completion);
    updateProjectStateLayersUnlocked({ scopes: project.scopes.map((candidate) => candidate.id === request.scope ? nextEntry : candidate) });
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
 * A request digest identifies intent, not the entire committed transition.  A no-op is legal only
 * when both durable records also contain the exact terminal shape this writer owns; otherwise an
 * interrupted or externally edited state must never be mistaken for success.
 */
function assertExactlyApplied(scope: string, sprint: SprintFile, entry: KyroScopeEntry, requestDigest: string): void {
  assertAuthorizedSprintAfterState(scope, sprint, requestDigest);
  if (entry.status !== 'completed' || entry.completion?.requestDigest !== requestDigest) {
    throw diverged('the project registry entry does not contain the authorized completed after-state');
  }
  if (canonicalJson(sprint.completion) !== canonicalJson(entry.completion)) {
    throw diverged('sprint and registry completion records diverge');
  }
}

function assertAuthorizedSprintAfterState(scope: string, sprint: SprintFile, requestDigest: string): void {
  if (
    sprint.status !== 'completed'
    || sprint.activeSprint !== null
    || sprint.retirement !== undefined
    || sprint.completion?.requestDigest !== requestDigest
    || !sprint.completion.beforeEntryDigest
    || sprint.handoff.nextAction !== 'done'
    || sprint.handoff.nextTaskId !== null
  ) {
    throw diverged(`sprint.json for "${scope}" does not contain the authorized completed after-state`);
  }
}

function failAfter(boundary: 'sprint' | 'registry'): void {
  if (process.env.KYRO_TEST_COMPLETE_FAIL_AFTER === boundary) {
    throw new KyroCoreError('INTERNAL', `Injected completion failure after ${boundary}.`, 'Retry the identical command; the completion is resumable.');
  }
}

function diverged(detail: string): KyroCoreError {
  return new KyroCoreError('DIVERGED', `Scope completion diverged: ${detail}.`, 'No files were overwritten. Inspect the live state and retry the identical command, or reconcile explicitly.');
}
