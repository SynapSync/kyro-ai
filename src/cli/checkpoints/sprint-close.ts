import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { resolveManagedPath } from '../fs';
import { readJsonSafely } from '../artifacts/json';
import { projectStatePath, sprintJsonPath } from '../artifacts/paths';
import { asProjectState, validateProjectStateShape, validateSprintFile } from '../artifacts/schema';
import { KyroCoreError, describeWriteFailure } from '../core/errors';
import {
  SPRINT_CLOSE_CHECKPOINT_KIND,
  SPRINT_CLOSE_CHECKPOINT_SCHEMA_VERSION,
  type ActiveSprint,
  type KyroProjectState,
  type KyroScopeEntry,
  type SprintCloseCheckpointV1,
  type SprintCloseInputs,
  type SprintFile,
} from '../types';
import type { LedgerEntry } from '../types';
import { assertSafeManagedPath, assertSafePathSegment, assertStateWriterLeaseHealthy, ensureDurableDirectory, fsyncParentDirectory, withStateWriterLock } from '../pipeline/state-writer-lock';

export interface SprintCloseCheckpointMaterials {
  scope: string;
  active: ActiveSprint;
  createdAt: string;
  close: SprintCloseInputs;
  legacySnapshotPath: string;
  narrativePath: string;
  beforeClose: SprintFile;
  intendedAfterClose: SprintFile;
  projectScopeBefore: KyroScopeEntry;
  projectScopeAfter: KyroScopeEntry;
  legacySnapshotContent: string;
  narrativeContent: string;
}

export interface SprintCloseTransaction {
  checkpointPath: string;
  checkpoint: SprintCloseCheckpointV1;
  checkpointContent: string;
  legacySnapshotContent: string;
  narrativeContent: string;
}

export interface SprintCloseApplyResult {
  checkpointPath: string;
  checkpointId: string;
  resumed: boolean;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

export function sha256(value: unknown): string {
  const input = typeof value === 'string' ? value : canonicalJson(value);
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Commitment anchored outside the archive in ledger[].checkpointSha256.
 * The commitment excludes self-derived digests and its own ledger field, avoiding a hash cycle
 * while still protecting the complete before/after images, identity, close inputs and paths.
 */
export function checkpointCommitment(checkpoint: SprintCloseCheckpointV1): string {
  const payload = JSON.parse(JSON.stringify(checkpoint)) as Record<string, unknown>;
  delete payload.digests;
  const after = asRecord(payload.intendedAfterClose);
  const ledger = Array.isArray(after?.ledger) ? after.ledger : [];
  const last = asRecord(ledger[ledger.length - 1]);
  if (last) delete last.checkpointSha256;
  return sha256(payload);
}

export function buildSprintCloseCheckpoint(
  checkpointPath: string,
  materials: SprintCloseCheckpointMaterials,
): SprintCloseTransaction {
  const checkpoint: SprintCloseCheckpointV1 = {
    schemaVersion: SPRINT_CLOSE_CHECKPOINT_SCHEMA_VERSION,
    kind: SPRINT_CLOSE_CHECKPOINT_KIND,
    checkpointId: sha256(`${materials.scope}\0${materials.active.n}\0${materials.active.slug}`),
    createdAt: materials.createdAt,
    identity: {
      scope: materials.scope,
      sprintN: materials.active.n,
      sprintSlug: materials.active.slug,
    },
    close: materials.close,
    paths: {
      legacySnapshot: materials.legacySnapshotPath,
      narrative: materials.narrativePath,
    },
    beforeClose: materials.beforeClose,
    intendedAfterClose: materials.intendedAfterClose,
    projectScopeBefore: materials.projectScopeBefore,
    projectScopeAfter: materials.projectScopeAfter,
    digests: {
      beforeClose: sha256(materials.beforeClose),
      intendedAfterClose: sha256(materials.intendedAfterClose),
      projectScopeBefore: sha256(materials.projectScopeBefore),
      projectScopeAfter: sha256(materials.projectScopeAfter),
      legacySnapshot: sha256(materials.legacySnapshotContent),
      narrative: sha256(materials.narrativeContent),
    },
  };
  const lastLedger = checkpoint.intendedAfterClose.ledger[checkpoint.intendedAfterClose.ledger.length - 1];
  if (!lastLedger) throw new KyroCoreError('CHECKPOINT_CORRUPT', 'Cannot build a close checkpoint without its intended ledger entry.');
  lastLedger.checkpointSha256 = checkpointCommitment(checkpoint);
  checkpoint.digests.intendedAfterClose = sha256(checkpoint.intendedAfterClose);
  return {
    checkpointPath,
    checkpoint,
    checkpointContent: `${JSON.stringify(checkpoint, null, 2)}\n`,
    legacySnapshotContent: materials.legacySnapshotContent,
    narrativeContent: materials.narrativeContent,
  };
}

export function deriveSprintCloseTransition(
  beforeClose: SprintFile,
  projectScopeBefore: KyroScopeEntry,
  close: SprintCloseInputs,
  createdAt: string,
  legacySnapshotPath: string,
  narrativePath: string,
  checkpointPath: string,
): { intendedAfterClose: SprintFile; projectScopeAfter: KyroScopeEntry } {
  const active = beforeClose.activeSprint;
  if (!active) throw new KyroCoreError('CHECKPOINT_CORRUPT', 'beforeClose.activeSprint must exist to derive a close transition.');
  const closedAt = createdAt.slice(0, 10);
  const toArchiveRelative = (value: string): string => value.replace(/^.*\/archive\//, 'archive/');
  const ledgerEntry: LedgerEntry = {
    n: active.n,
    slug: active.slug,
    outcome: close.outcome,
    closedAt,
    archive: toArchiveRelative(narrativePath),
    snapshot: toArchiveRelative(legacySnapshotPath),
    checkpoint: toArchiveRelative(checkpointPath),
    ...(close.recommendations.length > 0 ? { recommendations: [...close.recommendations] } : {}),
  };
  const roadmapSprints = beforeClose.roadmap.sprints.map((sprint) => sprint.n === active.n ? { ...sprint, state: 'closed' } : sprint);
  const remaining = roadmapSprints.filter((sprint) => sprint.state !== 'closed').length;
  const intendedAfterClose: SprintFile = {
    ...beforeClose,
    status: remaining === 0 ? 'completed' : beforeClose.status,
    ledger: [...beforeClose.ledger, ledgerEntry],
    previousSprint: {
      n: active.n,
      slug: active.slug,
      outcome: close.outcome,
      summary: close.summary ?? active.objective,
    },
    activeSprint: null,
    roadmap: { ...beforeClose.roadmap, sprints: roadmapSprints },
    handoff: {
      ...beforeClose.handoff,
      nextAction: remaining > 0 ? 'plan_sprint' : 'wrap_up',
      nextTaskId: null,
      note: close.note ?? `Sprint ${active.n} (${active.slug}) closed as ${close.outcome}. ${remaining > 0 ? `${remaining} sprint(s) remain.` : 'No sprints remain — scope objective met.'}`,
      lastUpdated: closedAt,
    },
  };
  return {
    intendedAfterClose,
    projectScopeAfter: remaining === 0 ? { ...projectScopeBefore, status: 'completed' } : { ...projectScopeBefore },
  };
}

export function readSprintCloseCheckpoint(path: string): SprintCloseCheckpointV1 | null {
  assertSafeManagedPath(path);
  const read = readJsonSafely(path);
  if (!read.exists) return null;
  if (read.error) {
    throw new KyroCoreError('CHECKPOINT_CORRUPT', `Checkpoint ${path} is invalid JSON (${read.error}).`, 'Do not overwrite it. Restore the immutable checkpoint from versioned storage or inspect it manually.');
  }
  const record = asRecord(read.value);
  if (!record || record.schemaVersion !== SPRINT_CLOSE_CHECKPOINT_SCHEMA_VERSION) {
    throw new KyroCoreError('CHECKPOINT_UNSUPPORTED_VERSION', `Checkpoint ${path} uses unsupported schemaVersion ${String(record?.schemaVersion ?? '(missing)')}.`, 'Upgrade Kyro to a version that supports this checkpoint before resuming the close.');
  }
  const issues = validateSprintCloseCheckpoint(read.value, path);
  if (issues.length > 0) {
    throw new KyroCoreError('CHECKPOINT_CORRUPT', `Checkpoint ${path} failed validation — ${issues.join('; ')}.`, 'Do not overwrite it. Restore the checkpoint or resolve the corruption manually.');
  }
  return read.value as SprintCloseCheckpointV1;
}

export function validateSprintCloseCheckpoint(value: unknown, path: string): string[] {
  const issues: string[] = [];
  const checkpoint = asRecord(value);
  if (!checkpoint) return [`${path}:<root> must be an object`];
  if (checkpoint.schemaVersion !== SPRINT_CLOSE_CHECKPOINT_SCHEMA_VERSION) issues.push(`${path}:schemaVersion must be 1`);
  if (checkpoint.kind !== SPRINT_CLOSE_CHECKPOINT_KIND) issues.push(`${path}:kind must be ${SPRINT_CLOSE_CHECKPOINT_KIND}`);
  for (const key of ['checkpointId', 'createdAt'] as const) {
    if (typeof checkpoint[key] !== 'string' || checkpoint[key].length === 0) issues.push(`${path}:${key} must be a non-empty string`);
  }
  if (typeof checkpoint.createdAt === 'string' && Number.isNaN(Date.parse(checkpoint.createdAt))) issues.push(`${path}:createdAt must be an ISO-compatible timestamp`);
  const identity = asRecord(checkpoint.identity);
  if (!identity || typeof identity.scope !== 'string' || typeof identity.sprintN !== 'number' || typeof identity.sprintSlug !== 'string') {
    issues.push(`${path}:identity must contain scope, sprintN, sprintSlug`);
  }
  const close = asRecord(checkpoint.close);
  if (!close || typeof close.outcome !== 'string' || !isNullableString(close.note) || !isNullableString(close.summary)
    || !isStringArray(close.recommendations) || !isStringArray(close.learnings)) {
    issues.push(`${path}:close has invalid frozen inputs`);
  }
  const paths = asRecord(checkpoint.paths);
  if (!paths || typeof paths.legacySnapshot !== 'string' || typeof paths.narrative !== 'string') {
    issues.push(`${path}:paths must contain legacySnapshot and narrative`);
  }
  issues.push(...validateSprintFile(checkpoint.beforeClose, `${path}:beforeClose`).map(formatValidationIssue));
  issues.push(...validateSprintFile(checkpoint.intendedAfterClose, `${path}:intendedAfterClose`).map(formatValidationIssue));
  validateScopeEntry(checkpoint.projectScopeBefore, `${path}:projectScopeBefore`, issues);
  validateScopeEntry(checkpoint.projectScopeAfter, `${path}:projectScopeAfter`, issues);
  const digests = asRecord(checkpoint.digests);
  const digestKeys = ['beforeClose', 'intendedAfterClose', 'projectScopeBefore', 'projectScopeAfter', 'legacySnapshot', 'narrative'] as const;
  if (!digests) issues.push(`${path}:digests must be an object`);
  else for (const key of digestKeys) if (typeof digests[key] !== 'string' || !/^[a-f0-9]{64}$/.test(digests[key] as string)) issues.push(`${path}:digests.${key} must be a SHA-256 hex digest`);

  if (identity) {
    if (typeof identity.scope === 'string') assertSafePathSegmentForValidation(identity.scope, `${path}:identity.scope`, issues);
    if (typeof identity.sprintSlug === 'string') assertSafePathSegmentForValidation(identity.sprintSlug, `${path}:identity.sprintSlug`, issues);
    const before = asRecord(checkpoint.beforeClose);
    const active = asRecord(before?.activeSprint);
    const after = asRecord(checkpoint.intendedAfterClose);
    if (before?.scope !== identity.scope || active?.n !== identity.sprintN || active?.slug !== identity.sprintSlug) {
      issues.push(`${path}:identity does not match beforeClose.activeSprint`);
    }
    if (after?.scope !== identity.scope || after?.activeSprint !== null) issues.push(`${path}:intendedAfterClose must match scope and clear activeSprint`);
    if (checkpoint.checkpointId !== sha256(`${identity.scope}\0${identity.sprintN}\0${identity.sprintSlug}`)) issues.push(`${path}:checkpointId is not deterministic for identity`);
    const base = `sprint-${String(identity.sprintN).padStart(3, '0')}-${identity.sprintSlug}`;
    const archiveRoot = `.agents/kyro/scopes/${identity.scope}/archive/${base}`;
    if (paths && paths.legacySnapshot !== `${archiveRoot}.json`) issues.push(`${path}:paths.legacySnapshot does not match identity`);
    if (paths && paths.narrative !== `${archiveRoot}.md`) issues.push(`${path}:paths.narrative does not match identity`);
    if (path !== `${archiveRoot}.checkpoint.json`) issues.push(`${path}:checkpoint path does not match identity`);
    const scopeBefore = asRecord(checkpoint.projectScopeBefore);
    const scopeAfter = asRecord(checkpoint.projectScopeAfter);
    if (scopeBefore?.id !== identity.scope || scopeAfter?.id !== identity.scope) issues.push(`${path}:project scope entries do not match identity`);
  }
  if (digests) {
    if (digests.beforeClose !== sha256(checkpoint.beforeClose)) issues.push(`${path}:digests.beforeClose mismatch`);
    if (digests.intendedAfterClose !== sha256(checkpoint.intendedAfterClose)) issues.push(`${path}:digests.intendedAfterClose mismatch`);
    if (digests.projectScopeBefore !== sha256(checkpoint.projectScopeBefore)) issues.push(`${path}:digests.projectScopeBefore mismatch`);
    if (digests.projectScopeAfter !== sha256(checkpoint.projectScopeAfter)) issues.push(`${path}:digests.projectScopeAfter mismatch`);
    const before = asRecord(checkpoint.beforeClose);
    const active = before?.activeSprint;
    if (active && digests.legacySnapshot !== sha256(`${JSON.stringify(active, null, 2)}\n`)) issues.push(`${path}:digests.legacySnapshot does not match beforeClose.activeSprint`);
  }
  const after = asRecord(checkpoint.intendedAfterClose);
  const ledger = Array.isArray(after?.ledger) ? after.ledger : [];
  const lastLedger = asRecord(ledger[ledger.length - 1]);
  if (paths && typeof paths.legacySnapshot === 'string' && typeof paths.narrative === 'string'
    && (lastLedger?.snapshot !== paths.legacySnapshot.replace(/^.*\/archive\//, 'archive/')
    || lastLedger?.archive !== paths.narrative.replace(/^.*\/archive\//, 'archive/')
    || lastLedger?.checkpoint !== path.replace(/^.*\/archive\//, 'archive/'))) {
    issues.push(`${path}:intendedAfterClose ledger paths do not match checkpoint paths`);
  }
  if (lastLedger && (typeof lastLedger.checkpointSha256 !== 'string' || lastLedger.checkpointSha256 !== checkpointCommitment(value as SprintCloseCheckpointV1))) {
    issues.push(`${path}:intendedAfterClose ledger checkpointSha256 does not match checkpoint commitment`);
  }
  if (issues.length === 0) {
    const typed = value as SprintCloseCheckpointV1;
    try {
      const derived = deriveSprintCloseTransition(typed.beforeClose, typed.projectScopeBefore, typed.close, typed.createdAt, typed.paths.legacySnapshot, typed.paths.narrative, path);
      const derivedLast = derived.intendedAfterClose.ledger[derived.intendedAfterClose.ledger.length - 1];
      if (derivedLast) derivedLast.checkpointSha256 = checkpointCommitment({ ...typed, intendedAfterClose: derived.intendedAfterClose });
      if (canonicalJson(derived.intendedAfterClose) !== canonicalJson(typed.intendedAfterClose)) issues.push(`${path}:intendedAfterClose is not the authorized transition derived from beforeClose and frozen inputs`);
      if (canonicalJson(derived.projectScopeAfter) !== canonicalJson(typed.projectScopeAfter)) issues.push(`${path}:projectScopeAfter is not the authorized transition`);
    } catch (error) {
      issues.push(`${path}:semantic transition invalid (${error instanceof Error ? error.message : String(error)})`);
    }
  }
  return issues;
}

export function applySprintCloseTransaction(transaction: SprintCloseTransaction): SprintCloseApplyResult {
  for (const path of [transaction.checkpointPath, transaction.checkpoint.paths.legacySnapshot, transaction.checkpoint.paths.narrative, sprintJsonPath(transaction.checkpoint.identity.scope), projectStatePath()]) {
    assertSafeManagedPath(path);
  }
  return withStateWriterLock(() => {
    const existing = readSprintCloseCheckpoint(transaction.checkpointPath);
    if (existing && canonicalJson(existing) !== canonicalJson(transaction.checkpoint)) {
      throw new KyroCoreError('CHECKPOINT_CONFLICT', `Checkpoint conflict at ${transaction.checkpointPath}; immutable content differs from this close request.`, 'Use the original close inputs recorded in the checkpoint or inspect the conflicting transaction.');
    }
    const resumed = existing !== null;
    if (!existing) publishExclusive(transaction.checkpointPath, transaction.checkpointContent, 'checkpoint');
    failAfter('checkpoint');
    const checkpoint = readSprintCloseCheckpoint(transaction.checkpointPath);
    if (!checkpoint || canonicalJson(checkpoint) !== canonicalJson(transaction.checkpoint)) {
      throw new KyroCoreError('CHECKPOINT_CONFLICT', `Published checkpoint ${transaction.checkpointPath} changed unexpectedly.`, 'Stop and inspect the immutable checkpoint before retrying.');
    }
    pauseCloseForTest();
    publishOrVerify(checkpoint.paths.legacySnapshot, transaction.legacySnapshotContent, checkpoint.digests.legacySnapshot, 'legacy snapshot');
    failAfter('snapshot');
    publishOrVerify(checkpoint.paths.narrative, transaction.narrativeContent, checkpoint.digests.narrative, 'narrative');
    failAfter('narrative');
    compareAndSwapSprint(checkpoint);
    failAfter('sprint');
    compareAndSwapProjectScope(checkpoint);
    failAfter('project');
    verifyApplied(checkpoint);
    return { checkpointPath: transaction.checkpointPath, checkpointId: checkpoint.checkpointId, resumed };
  });
}

function compareAndSwapSprint(checkpoint: SprintCloseCheckpointV1): void {
  const path = sprintJsonPath(checkpoint.identity.scope);
  const read = readJsonSafely(path);
  if (read.error) throw diverged(path, read.error);
  if (!read.exists) {
    atomicReplace(path, `${JSON.stringify(checkpoint.intendedAfterClose, null, 2)}\n`);
    return;
  }
  const currentDigest = sha256(read.value);
  if (currentDigest === checkpoint.digests.intendedAfterClose) return;
  if (currentDigest !== checkpoint.digests.beforeClose) throw diverged(path, 'content matches neither checkpoint state');
  atomicReplace(path, `${JSON.stringify(checkpoint.intendedAfterClose, null, 2)}\n`);
}

function compareAndSwapProjectScope(checkpoint: SprintCloseCheckpointV1): void {
  const path = projectStatePath();
  const read = readJsonSafely(path);
  if (read.error || !read.exists) throw diverged(path, read.error ?? 'missing');
  const issues = validateProjectStateShape(read.value, path);
  const state = asProjectState(read.value);
  if (issues.length > 0 || !state) throw diverged(path, issues.map(formatValidationIssue).join('; ') || 'invalid project state');
  const entry = state.scopes.find((scope) => scope.id === checkpoint.identity.scope);
  if (!entry) {
    const restored: KyroProjectState = { ...state, scopes: [...state.scopes, checkpoint.projectScopeAfter] };
    atomicReplace(path, `${JSON.stringify(restored, null, 2)}\n`);
    return;
  }
  const currentDigest = sha256(entry);
  if (currentDigest === checkpoint.digests.projectScopeAfter) return;
  if (currentDigest !== checkpoint.digests.projectScopeBefore) throw diverged(path, 'scope entry matches neither checkpoint state');
  const updated: KyroProjectState = {
    ...state,
    scopes: state.scopes.map((scope) => scope.id === checkpoint.identity.scope ? checkpoint.projectScopeAfter : scope),
  };
  atomicReplace(path, `${JSON.stringify(updated, null, 2)}\n`);
}

function verifyApplied(checkpoint: SprintCloseCheckpointV1): void {
  const sprint = readJsonSafely(sprintJsonPath(checkpoint.identity.scope));
  if (sprint.error || !sprint.exists || sha256(sprint.value) !== checkpoint.digests.intendedAfterClose) throw diverged(sprint.path, 'post-write verification failed');
  const state = readJsonSafely(projectStatePath());
  const project = asProjectState(state.value);
  const scopeEntry = project?.scopes.find((entry) => entry.id === checkpoint.identity.scope);
  if (state.error || !scopeEntry || sha256(scopeEntry) !== checkpoint.digests.projectScopeAfter) throw diverged(state.path, 'project scope post-write verification failed');
  verifyArtifact(checkpoint.paths.legacySnapshot, checkpoint.digests.legacySnapshot, 'legacy snapshot');
  verifyArtifact(checkpoint.paths.narrative, checkpoint.digests.narrative, 'narrative');
}

function publishOrVerify(path: string, content: string, digest: string, label: string): void {
  if (!existsSync(resolveManagedPath(path))) {
    publishExclusive(path, content, label);
  }
  verifyArtifact(path, digest, label);
}

function verifyArtifact(path: string, digest: string, label: string): void {
  let content: string;
  try { content = readFileSync(resolveManagedPath(path), 'utf8'); }
  catch { throw new KyroCoreError('CHECKPOINT_CONFLICT', `${label} is missing or unreadable at ${path}.`, 'Retry the close to resume publication from the immutable checkpoint.'); }
  if (sha256(content) !== digest) throw new KyroCoreError('CHECKPOINT_CONFLICT', `${label} content conflicts with checkpoint at ${path}.`, 'Do not overwrite audit artifacts. Inspect and resolve the conflict manually.');
}

function publishExclusive(path: string, content: string, label: string): void {
  const target = assertSafeManagedPath(path);
  const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`;
  let failure: unknown = null;
  try {
    assertStateWriterLeaseHealthy();
    ensureDurableDirectory(dirname(target));
    assertStateWriterLeaseHealthy();
    writeSynced(temporary, content, true);
    assertStateWriterLeaseHealthy();
    linkSync(temporary, target);
    fsyncParentDirectory(target);
  } catch (error) {
    failure = (error as NodeJS.ErrnoException).code === 'EEXIST'
      ? new KyroCoreError('CHECKPOINT_CONFLICT', `Refusing to overwrite existing ${label} at ${path}.`, 'Retry only if the existing artifact belongs to the same checkpoint.')
      : error;
  }
  cleanupTemporary(temporary, failure);
  if (failure) throw describeWriteFailure(failure) ?? failure;
}

function atomicReplace(path: string, content: string): void {
  const target = assertSafeManagedPath(path);
  const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`;
  let failure: unknown = null;
  try {
    assertStateWriterLeaseHealthy();
    ensureDurableDirectory(dirname(target));
    assertStateWriterLeaseHealthy();
    writeSynced(temporary, content, true);
    assertStateWriterLeaseHealthy();
    renameSync(temporary, target);
    fsyncParentDirectory(target);
  } catch (error) {
    failure = error;
  }
  cleanupTemporary(temporary, failure);
  if (failure) throw describeWriteFailure(failure) ?? failure;
}

function cleanupTemporary(path: string, primaryFailure: unknown): void {
  try {
    assertStateWriterLeaseHealthy();
    unlinkSync(path);
    fsyncParentDirectory(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    if (primaryFailure) {
      const writeFailure = describeWriteFailure(primaryFailure);
      if (writeFailure) throw writeFailure;
      throw new AggregateError([primaryFailure, error], 'Durable file operation failed and temporary cleanup also failed');
    }
    throw error;
  }
}

function writeSynced(path: string, content: string, exclusive: boolean): void {
  assertStateWriterLeaseHealthy();
  const fd = openSync(path, exclusive ? 'wx' : 'w');
  try {
    writeFileSync(fd, content, 'utf8');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function failAfter(boundary: string): void {
  if (process.env.KYRO_TEST_CLOSE_FAIL_AFTER === boundary) throw new KyroCoreError('INTERNAL', `Injected close failure after ${boundary}.`, 'Retry the same close command; the checkpoint is resumable.');
}

function pauseCloseForTest(): void {
  const milliseconds = Number.parseInt(process.env.KYRO_TEST_CLOSE_LOCK_PAUSE_MS ?? '', 10);
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return;
  const signal = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(signal, 0, 0, milliseconds);
}

function diverged(path: string, detail: string): KyroCoreError {
  return new KyroCoreError('STATE_DIVERGED', `Live state diverged at ${path}: ${detail}.`, 'Do not overwrite live work. Inspect the checkpoint before/after states and reconcile explicitly.');
}

function validateScopeEntry(value: unknown, path: string, issues: string[]): void {
  const entry = asRecord(value);
  if (!entry || typeof entry.id !== 'string' || typeof entry.title !== 'string'
    || !['planning', 'active', 'blocked', 'completed'].includes(String(entry.status))) issues.push(`${path} must be a KyroScopeEntry`);
}

function assertSafePathSegmentForValidation(value: string, path: string, issues: string[]): void {
  try { assertSafePathSegment(value, path); }
  catch (error) { issues.push(error instanceof Error ? error.message : String(error)); }
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  const record = asRecord(value);
  if (!record) return value;
  return Object.fromEntries(Object.keys(record).sort().map((key) => [key, sortJson(record[key])]));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function isNullableString(value: unknown): boolean { return value === null || typeof value === 'string'; }
function isStringArray(value: unknown): boolean { return Array.isArray(value) && value.every((item) => typeof item === 'string'); }
function formatValidationIssue(issue: { path: string; field: string; message: string }): string { return `${issue.path}:${issue.field} ${issue.message}`; }
