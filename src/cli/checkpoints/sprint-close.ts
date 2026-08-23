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
import { PROJECT_STATE_PATH, KYRO_STATE_PATH } from '../constants';
import { KyroCoreError, describeWriteFailure } from '../core/errors';
import { assertNotRetiredSprintOverwrite } from '../core/retirement-guard';
import { deriveScopeStatus } from '../core/status';
import {
  hasLayeredProjectStateOnDisk,
  hasMonolitoProjectStateOnDisk,
  readProjectState,
  updateProjectStateLayersUnlocked,
} from '../state';
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

/**
 * Path reported/written for the project-scope CAS during sprint close.
 * Layers prefer shared project.json; monolito dual-read keeps kyro.json until migrated.
 */
export function projectScopeWritePath(): string {
  if (hasLayeredProjectStateOnDisk()) return PROJECT_STATE_PATH;
  if (hasMonolitoProjectStateOnDisk()) return KYRO_STATE_PATH;
  return PROJECT_STATE_PATH;
}

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
  return checkpointCommitmentOfRecord(checkpoint);
}

/**
 * Commitment for a checkpoint that has been parsed but not schema-validated.
 *
 * A checkpoint is historical evidence: it is proven by its recorded commitment, not by the schema
 * Kyro happens to enforce today. A scope closed before a contract was tightened embeds a state that
 * the current strict validator rejects — remediation exists precisely for that case, so it must be
 * able to verify the checkpoint is untampered without first demanding it pass the new rules.
 */
export function checkpointCommitmentOfRecord(value: unknown): string {
  const payload = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
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
  return deriveSprintCloseTransitionWithPolicy(
    beforeClose,
    projectScopeBefore,
    close,
    createdAt,
    legacySnapshotPath,
    narrativePath,
    checkpointPath,
    'open-scope',
  );
}

/**
 * Pre-T1.4 writer: exhausting the original roadmap minted `nextAction: done` and scope `completed`.
 * Kept only so immutable historical checkpoints still match their authorized transition.
 */
function deriveHistoricalRoadmapExhaustionCloseTransition(
  beforeClose: SprintFile,
  projectScopeBefore: KyroScopeEntry,
  close: SprintCloseInputs,
  createdAt: string,
  legacySnapshotPath: string,
  narrativePath: string,
  checkpointPath: string,
): { intendedAfterClose: SprintFile; projectScopeAfter: KyroScopeEntry } {
  return deriveSprintCloseTransitionWithPolicy(
    beforeClose,
    projectScopeBefore,
    close,
    createdAt,
    legacySnapshotPath,
    narrativePath,
    checkpointPath,
    'legacy-roadmap-exhaustion',
  );
}

function deriveSprintCloseTransitionWithPolicy(
  beforeClose: SprintFile,
  projectScopeBefore: KyroScopeEntry,
  close: SprintCloseInputs,
  createdAt: string,
  legacySnapshotPath: string,
  narrativePath: string,
  checkpointPath: string,
  policy: 'open-scope' | 'legacy-roadmap-exhaustion',
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
  const nextAction = policy === 'legacy-roadmap-exhaustion'
    ? (remaining > 0 ? 'plan_sprint' : 'done')
    : 'plan_sprint';
  const intendedAfterClose: SprintFile = {
    ...beforeClose,
    status: policy === 'legacy-roadmap-exhaustion'
      ? (remaining === 0 ? 'completed' : beforeClose.status)
      : beforeClose.status,
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
      nextAction,
      nextTaskId: null,
      note: close.note ?? (
        policy === 'legacy-roadmap-exhaustion'
          ? `Sprint ${active.n} (${active.slug}) closed as ${close.outcome}. ${remaining > 0 ? `${remaining} sprint(s) remain.` : 'No sprints remain — scope objective met.'}`
          : `Sprint ${active.n} (${active.slug}) closed as ${close.outcome}. Scope remains open for planning.`
      ),
      lastUpdated: closedAt,
    },
  };
  if (policy === 'open-scope') {
    intendedAfterClose.status = deriveScopeStatus(intendedAfterClose, false);
  }
  const projectScopeAfter: KyroScopeEntry = {
    ...projectScopeBefore,
    status: deriveScopeStatus(intendedAfterClose, false),
  };
  return { intendedAfterClose, projectScopeAfter };
}

function stampCloseLedgerCommitment(
  derived: { intendedAfterClose: SprintFile },
  typed: SprintCloseCheckpointV1,
): void {
  const last = derived.intendedAfterClose.ledger[derived.intendedAfterClose.ledger.length - 1];
  if (last) last.checkpointSha256 = checkpointCommitment({ ...typed, intendedAfterClose: derived.intendedAfterClose });
}

/** Current writer, then the pre-T1.4 roadmap-exhaustion writer — never rewrite historical bytes. */
function authorizeCloseTransition(
  typed: SprintCloseCheckpointV1,
  path: string,
): { intendedAfterClose: SprintFile; projectScopeAfter: KyroScopeEntry } | null {
  const args = [
    typed.beforeClose,
    typed.projectScopeBefore,
    typed.close,
    typed.createdAt,
    typed.paths.legacySnapshot,
    typed.paths.narrative,
    path,
  ] as const;
  const current = deriveSprintCloseTransition(...args);
  stampCloseLedgerCommitment(current, typed);
  if (canonicalJson(current.intendedAfterClose) === canonicalJson(typed.intendedAfterClose)) return current;
  const historical = deriveHistoricalRoadmapExhaustionCloseTransition(...args);
  stampCloseLedgerCommitment(historical, typed);
  if (canonicalJson(historical.intendedAfterClose) === canonicalJson(typed.intendedAfterClose)) return historical;
  return null;
}

/**
 * Historical intermediate checkpoint v1 residual shape (4.19.0–4.43.0): remaining sprints kept
 * `projectScopeAfter.status = 'active'` by copying the before entry. New writes emit `planning`.
 * Read-time validate/doctor accept this residual only when the stored after entry is the exact
 * copy of an active before entry that historical v1 writers emitted. There is no writer-version
 * field on the checkpoint — match the complete observable write shape instead.
 */
export function isLegacyIntermediateActiveScopeAfter(checkpoint: SprintCloseCheckpointV1): boolean {
  if (checkpoint.schemaVersion !== SPRINT_CLOSE_CHECKPOINT_SCHEMA_VERSION) return false;
  if (checkpoint.intendedAfterClose.activeSprint !== null) return false;
  const roadmapSprints = checkpoint.intendedAfterClose.roadmap?.sprints ?? [];
  // True intermediate: at least one non-closed sprint remains. Empty roadmap is not this residual.
  if (!roadmapSprints.some((sprint) => sprint.state !== 'closed')) return false;
  if (checkpoint.projectScopeBefore.status !== 'active') return false;
  if (checkpoint.projectScopeAfter.status !== 'active') return false;
  // Historical v1 returned `{ ...projectScopeBefore }`; tolerate no other stored transition.
  if (canonicalJson(checkpoint.projectScopeBefore) !== canonicalJson(checkpoint.projectScopeAfter)) return false;
  try {
    const derived = deriveSprintCloseTransition(
      checkpoint.beforeClose,
      checkpoint.projectScopeBefore,
      checkpoint.close,
      checkpoint.createdAt,
      checkpoint.paths.legacySnapshot,
      checkpoint.paths.narrative,
      // Path is only used for ledger relative paths in derivation; identity paths already validated.
      `.agents/kyro/scopes/${checkpoint.identity.scope}/archive/sprint-${String(checkpoint.identity.sprintN).padStart(3, '0')}-${checkpoint.identity.sprintSlug}.checkpoint.json`,
    );
    if (derived.projectScopeAfter.status !== 'planning') return false;
    const normalizedLegacy: KyroScopeEntry = { ...checkpoint.projectScopeAfter, status: 'planning' };
    return canonicalJson(derived.projectScopeAfter) === canonicalJson(normalizedLegacy);
  } catch {
    return false;
  }
}

/** Normalized live after-image for historical intermediate residual `active` → canonical `planning`. */
export function legacyNormalizedProjectScopeAfter(checkpoint: SprintCloseCheckpointV1): KyroScopeEntry | null {
  if (!isLegacyIntermediateActiveScopeAfter(checkpoint)) return null;
  return { ...checkpoint.projectScopeAfter, status: 'planning' };
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

/**
 * Integrity issues only (structural, commitment, digests, paths, transitions).
 * A checkpoint with a valid commitment and no integrity issues is historical evidence,
 * even if its schema is stale.
 */
export function checkpointIntegrityIssues(value: unknown, path: string): string[] {
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
  // Schema validation is NOT checked for integrity — a legacy checkpoint with stale schema
  // remains valid evidence if its commitment matches the ledger anchor.
  const digestCheckScope = (scope: unknown, scopePath: string): string[] => {
    const result: string[] = [];
    validateScopeEntry(scope, scopePath, result);
    return result;
  };
  issues.push(...digestCheckScope(checkpoint.projectScopeBefore, `${path}:projectScopeBefore`));
  issues.push(...digestCheckScope(checkpoint.projectScopeAfter, `${path}:projectScopeAfter`));
  const digests = asRecord(checkpoint.digests);
  const digestKeys = ['beforeClose', 'intendedAfterClose', 'projectScopeBefore', 'projectScopeAfter', 'legacySnapshot', 'narrative'] as const;
  if (!digests) issues.push(`${path}:digests must be an object`);
  else for (const key of digestKeys) if (typeof digests[key] !== 'string' || !/^[a-f0-9]{64}$/.test(digests[key] as string)) issues.push(`${path}:digests.${key} must be a SHA-256 hex digest`);

  // Digest verification (integrity): beforeClose and intendedAfterClose objects are compared by hash,
  // not parsed against schema, so digests can be verified even if the embedded schema is stale.
  if (digests) {
    if (digests.beforeClose !== sha256(checkpoint.beforeClose)) issues.push(`${path}:digests.beforeClose mismatch`);
    if (digests.intendedAfterClose !== sha256(checkpoint.intendedAfterClose)) issues.push(`${path}:digests.intendedAfterClose mismatch`);
    if (digests.projectScopeBefore !== sha256(checkpoint.projectScopeBefore)) issues.push(`${path}:digests.projectScopeBefore mismatch`);
    if (digests.projectScopeAfter !== sha256(checkpoint.projectScopeAfter)) issues.push(`${path}:digests.projectScopeAfter mismatch`);
    const before = asRecord(checkpoint.beforeClose);
    const active = before?.activeSprint;
    if (active && digests.legacySnapshot !== sha256(`${JSON.stringify(active, null, 2)}\n`)) issues.push(`${path}:digests.legacySnapshot does not match beforeClose.activeSprint`);
  }

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
      const authorized = authorizeCloseTransition(typed, path);
      if (!authorized) {
        issues.push(`${path}:intendedAfterClose is not the authorized transition derived from beforeClose and frozen inputs`);
      } else {
        const scopeAfterMismatch = canonicalJson(authorized.projectScopeAfter) !== canonicalJson(typed.projectScopeAfter);
        // Accept historical intermediate v1 residual active without rewriting the immutable checkpoint.
        if (scopeAfterMismatch && !isLegacyIntermediateActiveScopeAfter(typed)) {
          issues.push(`${path}:projectScopeAfter is not the authorized transition`);
        }
      }
    } catch (error) {
      issues.push(`${path}:semantic transition invalid (${error instanceof Error ? error.message : String(error)})`);
    }
  }
  return issues;
}

/**
 * Schema issues only (embedded beforeClose and intendedAfterClose images fail current validator).
 * Returns the specific stale fields that fail the current schema.
 */
export function checkpointSchemaIssues(value: unknown, path: string): string[] {
  const checkpoint = asRecord(value);
  if (!checkpoint) return [];
  const issues: string[] = [];
  issues.push(...validateSprintFile(checkpoint.beforeClose, `${path}:beforeClose`).map(formatValidationIssue));
  issues.push(...validateSprintFile(checkpoint.intendedAfterClose, `${path}:intendedAfterClose`).map(formatValidationIssue));
  return issues;
}

/**
 * Full validation (integrity + schema). Used by readSprintCloseCheckpoint (close-sprint writer)
 * to ensure new checkpoints meet all requirements. Historical checkpoints use checkpointIntegrityIssues
 * to separate evidence validity (commitment) from schema currency.
 */
export function validateSprintCloseCheckpoint(value: unknown, path: string): string[] {
  const integrityIssues = checkpointIntegrityIssues(value, path);
  if (integrityIssues.length > 0) return integrityIssues;
  return checkpointSchemaIssues(value, path);
}

/**
 * A checkpoint is historical evidence if its commitment is valid (passes integrity checks)
 * even if the embedded schema is stale. Doctor reports it as historical with the specific
 * stale field named.
 */
export function isHistoricalCheckpoint(checkpoint: SprintCloseCheckpointV1, path: string): boolean {
  const integrityIssues = checkpointIntegrityIssues(checkpoint, path);
  if (integrityIssues.length > 0) return false;
  const schemaIssues = checkpointSchemaIssues(checkpoint, path);
  return schemaIssues.length > 0;
}

export function applySprintCloseTransaction(transaction: SprintCloseTransaction): SprintCloseApplyResult {
  for (const path of [transaction.checkpointPath, transaction.checkpoint.paths.legacySnapshot, transaction.checkpoint.paths.narrative, sprintJsonPath(transaction.checkpoint.identity.scope), projectScopeWritePath()]) {
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

/**
 * CAS the affected KyroScopeEntry into project state.
 *
 * - Layered workspaces write shared `project.json` via updateProjectStateLayers (never monolito).
 * - Monolito-only workspaces keep the legacy atomicReplace on `kyro.json` so dual-read fixtures
 *   and unknown top-level extensions remain stable until migration.
 * - Missing live entry is restored from checkpoint.projectScopeAfter.
 */
function compareAndSwapProjectScope(checkpoint: SprintCloseCheckpointV1): void {
  if (hasLayeredProjectStateOnDisk() || !hasMonolitoProjectStateOnDisk()) {
    compareAndSwapProjectScopeLayers(checkpoint);
    return;
  }
  compareAndSwapProjectScopeMonolito(checkpoint);
}

function compareAndSwapProjectScopeLayers(checkpoint: SprintCloseCheckpointV1): void {
  const path = PROJECT_STATE_PATH;
  const state = readProjectState();
  if (!state) throw diverged(path, 'missing');
  const entry = state.scopes.find((scope) => scope.id === checkpoint.identity.scope);
  if (!entry) {
    updateProjectStateLayersUnlocked({
      scopes: [...state.scopes, checkpoint.projectScopeAfter],
    });
    return;
  }
  const currentDigest = sha256(entry);
  if (currentDigest === checkpoint.digests.projectScopeAfter) return;
  if (currentDigest !== checkpoint.digests.projectScopeBefore) throw diverged(path, 'scope entry matches neither checkpoint state');
  updateProjectStateLayersUnlocked({
    scopes: state.scopes.map((scope) => (
      scope.id === checkpoint.identity.scope ? checkpoint.projectScopeAfter : scope
    )),
  });
}

function compareAndSwapProjectScopeMonolito(checkpoint: SprintCloseCheckpointV1): void {
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
  const project = readProjectState();
  const scopeEntry = project?.scopes.find((entry) => entry.id === checkpoint.identity.scope);
  const projectPath = projectScopeWritePath();
  if (!project || !scopeEntry || sha256(scopeEntry) !== checkpoint.digests.projectScopeAfter) {
    throw diverged(projectPath, 'project scope post-write verification failed');
  }
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

/**
 * Create a file that must not already exist, durably. Exported so other immutable-artifact writers
 * (remediation records) inherit the same fsync + link + parent-fsync discipline rather than copying it.
 */
export function publishExclusive(path: string, content: string, label: string): void {
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

/** Durable rename-based replacement of a managed file. Exported for the same reason as publishExclusive. */
export function atomicReplace(path: string, content: string): void {
  const target = assertSafeManagedPath(path);
  assertNotRetiredSprintOverwrite(target);
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
    || !['planning', 'active', 'blocked', 'completed', 'retired'].includes(String(entry.status))) issues.push(`${path} must be a KyroScopeEntry`);
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
