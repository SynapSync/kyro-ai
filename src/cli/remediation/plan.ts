import { existsSync, readdirSync } from 'node:fs';
import { resolveManagedPath } from '../fs';
import { readJsonSafely } from '../artifacts/json';
import { archiveDir, scopeRoot, sprintJsonPath } from '../artifacts/paths';
import { validateSprintFile, type ValidationIssue } from '../artifacts/schema';
import { canonicalJson, checkpointCommitmentOfRecord, sha256 } from '../checkpoints/sprint-close';
import { findCanonicalizationForBytes } from '../checkpoints/canonicalize';
import { EFFECTIVE_CHECKPOINT_STATUS, effectiveCommitment, resolveEffectiveCheckpoint, resolveEffectiveCheckpointAtPath } from '../checkpoints/effective';
import { surveyScopeCheckpoints } from '../checkpoints/discovery';
import { replayScopeLifecycle } from '../checkpoints/lifecycle-state';
import { inspectScopeRetirement } from '../checkpoints/scope-retirement';
import { KyroCoreError } from '../core/errors';
import { assertSafeManagedPath } from '../pipeline/state-writer-lock';
import type { CheckResult, RemediationAnchor, ScopeVerification, SprintCloseCheckpointV1, SprintFile } from '../types';
import { canonicalRemediationState, debtCollectionDigest, observedValueDigest } from './canonical-state';
import { resolveCertificationForChainHead } from './certification-plan';
import {
  CANONICAL_DEBT_AFTER_KEYS,
  REMEDIATION_MANIFEST_KIND,
  COMPACT_REPLAY_WITNESS_KIND,
  COMPACT_REPLAY_WITNESS_SCHEMA_VERSION,
  SCOPE_REMEDIATION_KIND,
  SCOPE_REMEDIATION_SCHEMA_VERSION,
  SCOPE_REMEDIATION_V4_SCHEMA_VERSION,
  isScopeRemediationSchemaVersion,
  requiredRemediationRevision,
  validateRemediationManifest,
  validateScopeRemediation,
  verifyCanonicalizePreconditions,
  type CompactScopeRemediation,
  type RemediationManifestV1,
  type RemediationOperation,
  type ScopeRemediation,
} from './protocol';
import { REPLAY_WITNESS_VALIDATION_STATUS, validateReplayWitness } from './replay-witness';

/**
 * Pure remediation planner.
 *
 * Everything here is read-only: it loads a manifest and the target scope, proves that the historical
 * checkpoints are intact and still anchored, proves that every typed operation's precondition holds
 * against the *current* live state, then projects the corrected state and the record that would be
 * persisted. Nothing is written. `remediate apply` (T1.3) re-runs this planner under the state-writer
 * lock, so a defect caught here is a defect that never reaches the filesystem.
 */

export const REMEDIATION_TRANSACTION_STATUS = {
  /** No record and no anchor on disk — the plan has never been applied. */
  NOT_APPLIED: 'NOT_APPLIED',
  /** The immutable record exists but the live anchor does not: persistence was interrupted. */
  PREPARED: 'PREPARED',
  /** Record, anchor, commitment and live result digest all agree. */
  APPLIED: 'APPLIED',
  /** Record and anchor exist but disagree with each other or with live state. */
  DIVERGED: 'DIVERGED',
  /** The record is unreadable or fails the remediation contract. */
  CORRUPT: 'CORRUPT',
  /** The record declares a schema version this runtime cannot evaluate. */
  UNSUPPORTED_VERSION: 'UNSUPPORTED_VERSION',
} as const;
export type RemediationTransactionStatus =
  (typeof REMEDIATION_TRANSACTION_STATUS)[keyof typeof REMEDIATION_TRANSACTION_STATUS];

/** Only APPLIED is a remediation. PREPARED is an interrupted write, never a success. */
export function isAppliedRemediationStatus(status: RemediationTransactionStatus): boolean {
  return status === REMEDIATION_TRANSACTION_STATUS.APPLIED;
}

export interface RemediationChange {
  operationId: string;
  kind: RemediationOperation['kind'];
  target: string;
  from: unknown;
  to: unknown;
}

export interface RemediationPlan {
  scope: string;
  remediationId: string;
  /** Workspace-relative path the immutable record would occupy. Reported, never written here. */
  recordPath: string;
  sprintPath: string;
  record: CompactScopeRemediation;
  /** SHA-256 commitment that the live anchor would carry. */
  commitment: string;
  anchor: RemediationAnchor;
  /** The corrected live state, including the appended anchor. Held in memory only. */
  projectedSprint: SprintFile;
  changes: RemediationChange[];
  /** State of a previously started transaction for this same remediation id. */
  transactionStatus: RemediationTransactionStatus;
  transactionDetail: string;
}

export interface RemediationPlanOptions {
  scope: string;
  manifestPath: string;
  /** Injected so the planner stays deterministic and testable. */
  now: string;
  kyroVersion: string;
}

export function planRemediation(options: RemediationPlanOptions): RemediationPlan {
  const manifest = readManifest(options.manifestPath);
  if (manifest.scope !== options.scope) {
    throw new KyroCoreError(
      'INVALID_INPUT',
      `Manifest targets scope "${manifest.scope}" but the command targets "${options.scope}".`,
      'Run remediate against the scope the manifest was written for; a manifest is bound to one scope.',
    );
  }

  const state = readLiveState(options.scope);
  verifyLedgerCheckpoints(options.scope, state);

  const baseDigest = stateDigest(state);
  if (manifest.base.stateSha256 !== baseDigest) {
    throw new KyroCoreError(
      'STATE_DIVERGED',
      `Manifest base digest ${manifest.base.stateSha256} does not match the live state digest ${baseDigest}.`,
      'The scope changed after the manifest was written. Re-inspect the live state and regenerate the manifest; never re-point a manifest at a state it did not observe.',
    );
  }

  const anchors = readAnchors(options.scope, state);
  const head = anchors.length > 0 ? anchors[anchors.length - 1].commitment : null;
  if (manifest.base.remediationHead !== head) {
    throw new KyroCoreError(
      'STATE_DIVERGED',
      `Manifest declares remediation head ${manifest.base.remediationHead ?? '(none)'} but the chain head is ${head ?? '(none)'}.`,
      'Another remediation was applied first. Regenerate the manifest against the current chain head so the chain cannot fork.',
    );
  }

  const executed = executeOperations(state, manifest.operations);
  if ('failure' in executed) throw executed.failure;
  const { changes } = executed;

  const projectedSprint = executed.state as unknown as SprintFile;
  const remediationId = nextRemediationId(anchors);
  const recordPath = remediationRecordPath(options.scope, remediationId);

  // Resume determinism: an interrupted attempt already published a record. Reusing its createdAt is
  // what makes the retry produce the *same* commitment instead of a second, competing remediation.
  // If anything else about the plan differs, the commitments still diverge and the retry is refused.
  const prepared = readRemediationRecord(options.scope, remediationId);

  const record: CompactScopeRemediation = {
    // The batch, not the runtime, picks the revision: only a canonicalization raises it to v3.
    schemaVersion: requiredRemediationRevision(manifest.operations),
    kind: SCOPE_REMEDIATION_KIND,
    id: remediationId,
    scope: options.scope,
    createdAt: prepared?.createdAt ?? options.now,
    base: {
      stateSha256: baseDigest,
      remediationHead: head,
      checkpoints: collectCheckpointCommitments(state),
    },
    issues: manifest.issues,
    operations: manifest.operations,
    result: {
      stateSha256: stateDigest(projectedSprint as unknown as Record<string, unknown>),
      witness: {
        schemaVersion: COMPACT_REPLAY_WITNESS_SCHEMA_VERSION,
        kind: COMPACT_REPLAY_WITNESS_KIND,
      },
    },
    provenance: {
      reason: manifest.provenance.reason,
      actor: manifest.provenance.actor,
      kyroVersion: options.kyroVersion,
    },
  };

  const recordIssues = validateScopeRemediation(record, recordPath);
  if (recordIssues.length > 0) {
    throw new KyroCoreError(
      'INVALID_INPUT',
      `Projected remediation record is invalid — ${formatIssues(recordIssues)}.`,
      'This is a planner defect or a manifest Kyro cannot represent. Do not apply it.',
    );
  }

  const commitment = sha256(record);
  const anchor: RemediationAnchor = {
    id: remediationId,
    path: relativeRecordPath(remediationId),
    commitment,
  };
  const anchoredSprint = { ...projectedSprint, remediations: [...anchors, anchor] };

  // The corrected state must satisfy the current strict contract. A remediation that leaves the
  // scope invalid has not repaired anything, and applying it would only move the defect.
  const projectedIssues = validateSprintFile(anchoredSprint, sprintJsonPath(options.scope));
  if (projectedIssues.length > 0) {
    throw new KyroCoreError(
      'INVALID_SPRINT_SHAPE',
      `The remediated state would still be invalid — ${formatIssues(projectedIssues)}.`,
      'Extend the manifest so it corrects every defect, or fix the operation values. Kyro does not apply a partial repair.',
    );
  }

  const transaction = inspectRemediationTransaction(options.scope, remediationId, commitment, record.result.stateSha256);

  return {
    scope: options.scope,
    remediationId,
    recordPath,
    sprintPath: sprintJsonPath(options.scope),
    record,
    commitment,
    anchor,
    projectedSprint: anchoredSprint,
    changes,
    transactionStatus: transaction.status,
    transactionDetail: transaction.detail,
  };
}

export interface ExplanationRemediationOptions {
  scope: string;
  operations: RemediationOperation[];
  issues: CompactScopeRemediation['issues'];
  baseState: Record<string, unknown>;
  liveState: Record<string, unknown>;
  now: string;
  kyroVersion: string;
  reason: string;
  actor: string;
}

/** True only when the current chain head is the exact approved batch and still describes live. */
export function remediationBatchAlreadyApplied(
  scope: string,
  operations: RemediationOperation[],
  liveState: Record<string, unknown>,
): boolean {
  const anchors = readAnchors(scope, liveState);
  const head = anchors[anchors.length - 1];
  if (!head) return false;
  const record = readRemediationRecord(scope, head.id);
  if (!record || record.schemaVersion !== SCOPE_REMEDIATION_V4_SCHEMA_VERSION) return false;
  if (sha256(record) !== head.commitment) return false;
  if (canonicalJson(record.operations) !== canonicalJson(operations)) return false;
  if (record.result.stateSha256 !== stateDigest(liveState)) return false;
  const transaction = inspectRemediationTransaction(scope, head.id, head.commitment, record.result.stateSha256);
  return transaction.status === REMEDIATION_TRANSACTION_STATUS.APPLIED;
}

/**
 * Plan a remediations record that *explains* live state already observed after close.
 * Replay must reproduce the live business digest from the close after-image.
 */
export function planExplanationRemediation(options: ExplanationRemediationOptions): RemediationPlan {
  const executed = executeOperations(options.baseState, options.operations);
  if ('failure' in executed) throw executed.failure;
  const replayDigest = stateDigest(executed.state);
  const liveDigest = stateDigest(options.liveState);
  if (replayDigest !== liveDigest) {
    throw new KyroCoreError(
      'DIVERGED',
      `Replaying the approved live operations from the close checkpoint does not reproduce live ${options.scope}.`,
      'The live state changed. Re-run prepare.',
    );
  }

  const anchors = readAnchors(options.scope, options.liveState);
  const head = anchors.length > 0 ? anchors[anchors.length - 1].commitment : null;
  const remediationId = nextRemediationId(anchors);
  const recordPath = remediationRecordPath(options.scope, remediationId);
  const prepared = readRemediationRecord(options.scope, remediationId);
  const record: CompactScopeRemediation = {
    schemaVersion: requiredRemediationRevision(options.operations),
    kind: SCOPE_REMEDIATION_KIND,
    id: remediationId,
    scope: options.scope,
    createdAt: prepared?.createdAt ?? options.now,
    base: {
      stateSha256: stateDigest(options.baseState),
      remediationHead: head,
      checkpoints: collectCheckpointCommitments(options.baseState),
    },
    issues: options.issues,
    operations: options.operations,
    result: {
      stateSha256: liveDigest,
      witness: {
        schemaVersion: COMPACT_REPLAY_WITNESS_SCHEMA_VERSION,
        kind: COMPACT_REPLAY_WITNESS_KIND,
      },
    },
    provenance: {
      reason: options.reason,
      actor: options.actor,
      kyroVersion: options.kyroVersion,
    },
  };
  const recordIssues = validateScopeRemediation(record, recordPath);
  if (recordIssues.length > 0) {
    throw new KyroCoreError(
      'INVALID_INPUT',
      `Projected remediation record is invalid — ${formatIssues(recordIssues)}.`,
      'This is a planner defect. Do not apply it.',
    );
  }
  const commitment = sha256(record);
  const anchor: RemediationAnchor = {
    id: remediationId,
    path: relativeRecordPath(remediationId),
    commitment,
  };
  const liveSprint = options.liveState as unknown as SprintFile;
  const anchoredSprint = { ...liveSprint, remediations: [...anchors, anchor] };
  const projectedIssues = validateSprintFile(anchoredSprint, sprintJsonPath(options.scope));
  if (projectedIssues.length > 0) {
    throw new KyroCoreError(
      'INVALID_SPRINT_SHAPE',
      `Anchoring remediation ${remediationId} failed validation — ${formatIssues(projectedIssues)}.`,
    );
  }
  const transaction = inspectRemediationTransaction(options.scope, remediationId, commitment, record.result.stateSha256);
  return {
    scope: options.scope,
    remediationId,
    recordPath,
    sprintPath: sprintJsonPath(options.scope),
    record,
    commitment,
    anchor,
    projectedSprint: anchoredSprint,
    changes: executed.changes,
    transactionStatus: transaction.status,
    transactionDetail: transaction.detail,
  };
}

/**
 * Classify a remediation id's on-disk transaction. Used by preview, by apply's idempotency check and
 * by doctor. A PREPARED result means the record was persisted but the live anchor was not — the
 * caller must resume or discard deliberately, never treat it as a completed remediation.
 */
export function inspectRemediationTransaction(
  scope: string,
  remediationId: string,
  expectedCommitment: string | null,
  expectedResultDigest: string | null,
  /**
   * Whether this record is the chain head. Only the head's `result` describes the CURRENT live
   * state; an earlier record's result is an intermediate the later ones moved past, so comparing it
   * against live state would report every completed chain of two or more as diverged. Intermediate
   * results are proven instead by the replay in resolveRemediationRebase.
   */
  isChainHead = true,
): { status: RemediationTransactionStatus; detail: string } {
  const path = remediationRecordPath(scope, remediationId);
  const read = readJsonSafely(path);
  const state = readLiveStateOrNull(scope);
  const anchor = state ? readAnchors(scope, state).find((entry) => entry.id === remediationId) ?? null : null;

  if (!read.exists) {
    return anchor
      ? {
        status: REMEDIATION_TRANSACTION_STATUS.DIVERGED,
        detail: `live anchor ${remediationId} references a missing record (${path})`,
      }
      : { status: REMEDIATION_TRANSACTION_STATUS.NOT_APPLIED, detail: 'no record and no live anchor' };
  }
  if (read.error) {
    return { status: REMEDIATION_TRANSACTION_STATUS.CORRUPT, detail: `record is unreadable: ${read.error}` };
  }
  const declaredVersion = (read.value as { schemaVersion?: unknown } | null)?.schemaVersion;
  if (!isScopeRemediationSchemaVersion(declaredVersion)) {
    return {
      status: REMEDIATION_TRANSACTION_STATUS.UNSUPPORTED_VERSION,
      detail: `record declares schemaVersion=${String(declaredVersion ?? '(missing)')}`,
    };
  }
  const issues = validateScopeRemediation(read.value, path);
  if (issues.length > 0) {
    return { status: REMEDIATION_TRANSACTION_STATUS.CORRUPT, detail: formatIssues(issues) };
  }
  const record = read.value as ScopeRemediation;
  // A record is evidence about one scope and one remediation. Leaving those self-declared fields
  // unverified would let a record misreport its own provenance while still passing every digest.
  if (record.scope !== scope) {
    return { status: REMEDIATION_TRANSACTION_STATUS.CORRUPT, detail: `record declares scope "${record.scope}" but lives in "${scope}"` };
  }
  if (record.id !== remediationId) {
    return { status: REMEDIATION_TRANSACTION_STATUS.CORRUPT, detail: `record declares id "${record.id}" but is anchored as "${remediationId}"` };
  }
  const commitment = sha256(record);
  if (expectedCommitment !== null && commitment !== expectedCommitment) {
    return {
      status: REMEDIATION_TRANSACTION_STATUS.DIVERGED,
      detail: `record ${remediationId} exists with a different commitment than the planned one`,
    };
  }
  if (!anchor) {
    return {
      status: REMEDIATION_TRANSACTION_STATUS.PREPARED,
      detail: `record ${remediationId} is persisted but the live anchor is absent (persistence was interrupted)`,
    };
  }
  if (anchor.commitment !== commitment) {
    return {
      status: REMEDIATION_TRANSACTION_STATUS.DIVERGED,
      detail: `live anchor commitment ${anchor.commitment} does not match record commitment ${commitment}`,
    };
  }
  if (isChainHead) {
    const liveDigest = state ? stateDigest(state) : null;
    const expected = expectedResultDigest ?? record.result.stateSha256;
    if (liveDigest !== expected) {
      return {
        status: REMEDIATION_TRANSACTION_STATUS.DIVERGED,
        detail: `live state digest ${liveDigest ?? '(unreadable)'} does not match the record result digest ${expected}`,
      };
    }
  }
  return { status: REMEDIATION_TRANSACTION_STATUS.APPLIED, detail: `record and live anchor agree on ${commitment}` };
}

/**
 * Whether a LATER sprint has started since the newest close checkpoint.
 *
 * Everything that compares live state against a frozen image — the checkpoint after-image, or a
 * remediation record's result digest — is only meaningful until that happens. Once sprint N+1 is
 * under way, its ordinary edits move live state off those images by design, and reading that as
 * tampering turns normal in-sprint work into a DIVERGED failure. Doctor's checkpoint lens already
 * drew this line; this helper exists so the remediation and verification lenses draw the same one.
 */
export function isSupersededByActiveSprint(scope: string, state?: Record<string, unknown> | null): boolean {
  const live = state ?? readLiveStateOrNull(scope);
  const checkpoint = latestValidCloseCheckpoint(scope);
  if (live === null || checkpoint === null) return false;
  const activeSprint = asRecord(live.activeSprint);
  const activeN = typeof activeSprint?.n === 'number' ? activeSprint.n : null;
  return activeN !== null && activeN > checkpoint.identity.sprintN;
}

/** Doctor lens over a scope's remediation chain. Read-only; never repairs. */
export function inspectRemediationChain(scope: string): CheckResult[] {
  const state = readLiveStateOrNull(scope);
  if (!state) return [];
  const anchors = readAnchorsSafely(scope, state);
  if (anchors === null) {
    return [{
      status: 'fail',
      name: `${scope}/remediations`,
      detail: 'remediations[] is present but is not a well-formed anchor array',
      remedy: 'Do not hand-edit remediations[]. Restore it from versioned storage; anchors are written only by kyro remediate.',
    }];
  }
  if (anchors.length === 0) return inspectUnanchoredRemediationRecords(scope, anchors);

  // Record integrity, commitments and continuity are always checked. Only the head-vs-live digest
  // comparison is suppressed while a later sprint is active, because that sprint legitimately owns
  // the drift.
  const superseded = isSupersededByActiveSprint(scope, state);

  const results: CheckResult[] = [];
  let expectedHead: string | null = null;
  let expectedBase: string | null = null;
  for (const anchor of anchors) {
    const name = `${scope}/remediation/${anchor.id}`;
    const isHead = anchor === anchors[anchors.length - 1];
    const transaction = inspectRemediationTransaction(scope, anchor.id, anchor.commitment, null, isHead && !superseded);
    const record = readRemediationRecord(scope, anchor.id);
    const brokenLink = chainContinuityIssue(record, expectedHead, expectedBase);
    if (brokenLink) {
      results.push({
        status: 'fail',
        name,
        detail: `${REMEDIATION_TRANSACTION_STATUS.DIVERGED}: ${brokenLink}`,
        remedy: 'The remediation chain is forked, reordered, or has a gap. Reconcile it explicitly; do not append another remediation on top.',
      });
      expectedHead = anchor.commitment;
      expectedBase = record?.result.stateSha256 ?? null;
      continue;
    }
    expectedHead = anchor.commitment;
    expectedBase = record?.result.stateSha256 ?? null;
    results.push(remediationResult(name, transaction.status, transaction.detail));
  }
  results.push(...inspectUnanchoredRemediationRecords(scope, anchors, expectedHead, expectedBase));
  return results;
}

/** What a remediation record that no live anchor references means for the scope. */
export interface UnanchoredRemediationFinding {
  id: string;
  status: RemediationTransactionStatus;
  detail: string;
  remedy: string;
}

/**
 * Records on disk that no live anchor references.
 *
 * The chain walk is driven by anchors, so a record whose anchor was never written is invisible to
 * it — and that is exactly the state an interrupted publish leaves behind, as well as the state a
 * planted record imitates. Both must be named, and differently: an interrupted publish continues the
 * chain and is resumable by re-running the same manifest, while a record that does not continue the
 * chain was not produced by this scope's transaction and must never be resumed into it.
 *
 * This is the SEMANTIC evaluation, deliberately separate from how doctor renders it. Doctor's chain
 * lens and the verification-state derivation both call this one function, because a reader that
 * detected a planted record and a reader that reported the scope healthy were describing the same
 * archive and could not both be right.
 */
export function evaluateUnanchoredRemediationRecords(
  scope: string,
  anchors: RemediationAnchor[],
  headCommitment: string | null = null,
  headResult: string | null = null,
): UnanchoredRemediationFinding[] {
  let directory: string;
  try {
    directory = assertSafeManagedPath(remediationsDir(scope));
  } catch {
    return [];
  }
  if (!existsSync(directory)) return [];

  const anchored = new Set(anchors.map((anchor) => anchor.id));
  const findings: UnanchoredRemediationFinding[] = [];
  for (const file of readdirSync(directory).sort()) {
    const match = /^remediation-(\d{3,})\.json$/.exec(file);
    if (!match) continue;
    const remediationId = `R-${match[1]}`;
    if (anchored.has(remediationId)) continue;

    const record = readRemediationRecord(scope, remediationId);
    if (!record) {
      findings.push({
        id: remediationId,
        status: REMEDIATION_TRANSACTION_STATUS.CORRUPT,
        detail: `unanchored record ${remediationId} is unreadable or fails the remediation contract`,
        remedy: 'No live anchor references this record and it cannot be validated. Remove it deliberately; never anchor a record Kyro cannot verify.',
      });
      continue;
    }
    const brokenLink = chainContinuityIssue(record, headCommitment, headResult);
    if (brokenLink !== null) {
      findings.push({
        id: remediationId,
        status: REMEDIATION_TRANSACTION_STATUS.DIVERGED,
        detail: `unanchored record ${remediationId} does not continue the live chain — ${brokenLink}`,
        remedy: 'A record no anchor references and that does not continue the chain was not produced by this scope\'s remediation. Treat it as planted: remove it deliberately rather than resuming it.',
      });
      continue;
    }
    findings.push({
      id: remediationId,
      status: REMEDIATION_TRANSACTION_STATUS.PREPARED,
      detail: `record ${remediationId} is persisted but no live anchor references it (persistence was interrupted)`,
      remedy: 'Re-run kyro remediate apply with the same manifest to finish the interrupted transaction, or remove the prepared record deliberately. It is not an applied remediation.',
    });
  }
  return findings;
}

/** Doctor rendering of the findings above. PREPARED is resumable, so it warns rather than fails. */
function inspectUnanchoredRemediationRecords(
  scope: string,
  anchors: RemediationAnchor[],
  headCommitment: string | null = null,
  headResult: string | null = null,
): CheckResult[] {
  return evaluateUnanchoredRemediationRecords(scope, anchors, headCommitment, headResult).map((finding) => ({
    status: finding.status === REMEDIATION_TRANSACTION_STATUS.PREPARED ? 'warn' as const : 'fail' as const,
    name: `${scope}/remediation/${finding.id}`,
    detail: `${finding.status}: ${finding.detail}`,
    remedy: finding.remedy,
  }));
}

/**
 * Continuity is checked on BOTH links. The commitment chain proves ordering; the state chain proves
 * each record starts where the previous one ended. Without the second, an intermediate record could
 * carry a result digest describing a state nothing ever produced and still be reported APPLIED here,
 * because only the head is compared against live state.
 *
 * Shared by doctor's per-record inspection and the scope verification derivation so the two surfaces
 * cannot disagree about a forked, reordered, or gapped chain (T2.1 finding 3).
 */
export function chainContinuityIssue(record: ScopeRemediation | null, expectedHead: string | null, expectedBase: string | null): string | null {
  if (!record) return null;
  if (record.base.remediationHead !== expectedHead) {
    return `record head ${record.base.remediationHead ?? '(none)'} does not continue the chain (expected ${expectedHead ?? '(none)'})`;
  }
  if (expectedBase !== null && record.base.stateSha256 !== expectedBase) {
    return `record base ${record.base.stateSha256} is not the previous record's result ${expectedBase}`;
  }
  return null;
}

/**
 * Business-state digest of any parsed scope state: the remediations anchor is excluded.
 *
 * Comparing this against a checkpoint's images trusts nothing about the chain's contents — it only
 * removes the anchor key itself from the comparison, so merely recording a remediation cannot make
 * an otherwise-identical state look like drift.
 */
export function businessStateDigest(value: unknown): string | null {
  const record = asRecord(value);
  return record ? stateDigest(record) : null;
}

export type RemediationRebase =
  /** No remediation chain: the closed-state comparison stands on its own. */
  | { kind: 'none' }
  /** Live state is the closed state plus an audited, fully applied chain. */
  | { kind: 'remediated'; through: string }
  /** A chain exists but does not explain the live state; the caller must keep reporting divergence. */
  | { kind: 'broken' };

export type RemediationReplayState =
  | { kind: 'none'; state: Record<string, unknown>; headCommitment: null; through: null }
  | { kind: 'remediated'; state: Record<string, unknown>; headCommitment: string; through: string }
  | { kind: 'broken'; detail: string };

/**
 * Explain a live state that matches neither side of a close checkpoint.
 *
 * A remediated scope is *supposed* to differ from its checkpoint — that is the whole point of an
 * append-only correction. But "there is a remediation chain" must never be enough to bless drift,
 * or the check that detects a post-close edit becomes the mechanism that certifies one.
 *
 * The chain is replayed: for the first record, replay from checkpoint and verify the result.
 * Compact v2 records advance that state directly through their typed operations; historic v1
 * records retain their versioned snapshot witness only when a later link needs that exact image.
 * The first record is allowed to have begun from a different base (e.g., a corruption).
 * The full chain is proven correct if the final result matches the live state.
 */
export function resolveRemediationRebase(scope: string, closedState: unknown): RemediationRebase {
  const live = readLiveStateOrNull(scope);
  if (!live) return { kind: 'none' };
  const replay = resolveRemediationReplayState(scope, closedState);
  if (replay.kind === 'broken') return { kind: 'broken' };
  if (replay.kind === 'none') return { kind: 'none' };
  if (stateDigest(replay.state) !== stateDigest(live)) return { kind: 'broken' };
  return { kind: 'remediated', through: replay.through };
}

/**
 * Replay the anchored remediation chain without requiring its head to equal current live state.
 * Integrity prepare uses this state as the baseline for a later, legitimate post-close delta.
 */
export function resolveRemediationReplayState(scope: string, closedState: unknown): RemediationReplayState {
  const live = readLiveStateOrNull(scope);
  if (!live) return { kind: 'broken', detail: 'live scope state is missing or unreadable' };
  const anchors = readAnchorsSafely(scope, live);
  if (anchors === null) return { kind: 'broken', detail: 'remediations[] is malformed' };

  const closed = asRecord(closedState);
  if (!closed) return { kind: 'broken', detail: 'closed state is not an object' };
  const initial = canonicalRemediationState(closed as unknown as SprintFile);
  if (anchors.length === 0) return { kind: 'none', state: initial, headCommitment: null, through: null };
  const ledger = ledgerCommitmentMap(closed);

  let replayed = initial;
  let expectedHead: string | null = null;

  for (let i = 0; i < anchors.length; i += 1) {
    const anchor = anchors[i];
    const isFirst = expectedHead === null;
    const isLast = i === anchors.length - 1;
    const transaction = inspectRemediationTransaction(scope, anchor.id, anchor.commitment, null, false);
    if (!isAppliedRemediationStatus(transaction.status)) return { kind: 'broken', detail: `${anchor.id}: ${transaction.detail}` };
    const record = readRemediationRecord(scope, anchor.id);
    if (!record) return { kind: 'broken', detail: `${anchor.id}: record is unreadable or invalid` };
    if (record.base.remediationHead !== expectedHead) return { kind: 'broken', detail: `${anchor.id}: remediation head does not continue the chain` };
    for (const checkpoint of record.base.checkpoints) {
      if (ledger.get(checkpoint.path) !== checkpoint.commitment) return { kind: 'broken', detail: `${anchor.id}: checkpoint commitment does not match the closed state` };
    }
    // If the first record has a base that differs from the checkpoint (corrected a corruption),
    // replay its operations without verifying preconditions (the true base is unknown, so
    // precondition checks would fail). Verify the result against snapshot: if the operations
    // were forged, they won't produce the declared result.
    if (isFirst && record.base.stateSha256 !== stateDigest(replayed)) {
      const next = replayOperations(replayed, record.operations, true);
      if (!next || record.result.stateSha256 !== stateDigest(next)) return { kind: 'broken', detail: `${anchor.id}: replay does not reproduce its result digest` };
      const advanced = advanceReplayState(record, next, isLast);
      if (!advanced) return { kind: 'broken', detail: `${anchor.id}: replay witness is invalid` };
      replayed = advanced;
    } else {
      // Normal replay: verify continuity for non-first records and execute operations with preconditions.
      if (!isFirst && record.base.stateSha256 !== stateDigest(replayed)) return { kind: 'broken', detail: `${anchor.id}: base digest does not equal the previous result` };
      const next = replayOperations(replayed, record.operations, false);
      if (!next || record.result.stateSha256 !== stateDigest(next)) return { kind: 'broken', detail: `${anchor.id}: replay does not reproduce its result digest` };
      const advanced = advanceReplayState(record, next, isLast);
      if (!advanced) return { kind: 'broken', detail: `${anchor.id}: replay witness is invalid` };
      replayed = advanced;
    }
    expectedHead = anchor.commitment;
  }

  return {
    kind: 'remediated',
    state: replayed,
    headCommitment: anchors[anchors.length - 1].commitment,
    through: anchors[anchors.length - 1].id,
  };
}

// --- scope verification state (T2.1) ------------------------------------------------------------

/** A valid close checkpoint located by the shared scan, newest first. */
export interface ValidCloseCheckpoint {
  path: string;
  checkpoint: SprintCloseCheckpointV1;
}

/**
 * Newest close wins: sprintN desc, then createdAt desc, then checkpointId desc. The single shared
 * recency definition used by doctor and by the scope verification derivation.
 */
export function compareCheckpointRecency(left: SprintCloseCheckpointV1, right: SprintCloseCheckpointV1): number {
  return left.identity.sprintN - right.identity.sprintN
    || left.createdAt.localeCompare(right.createdAt)
    || left.checkpointId.localeCompare(right.checkpointId);
}

/** Every valid close checkpoint for a scope, newest first. One shared scan for doctor and status. */
export function listValidCloseCheckpoints(scope: string): ValidCloseCheckpoint[] {
  const entries: ValidCloseCheckpoint[] = [];
  for (const file of surveyScopeCheckpoints(scope).safeFiles) {
    const path = `${archiveDir(scope)}/${file}`;
    const resolved = resolveEffectiveCheckpointAtPath(scope, path);
    if (resolved.status !== EFFECTIVE_CHECKPOINT_STATUS.VALID && resolved.status !== EFFECTIVE_CHECKPOINT_STATUS.CANONICALIZED) continue;
    if (!resolved.checkpoint || resolved.checkpoint.identity.scope !== scope) continue;
    entries.push({ path, checkpoint: resolved.checkpoint });
  }
  entries.sort((left, right) => compareCheckpointRecency(right.checkpoint, left.checkpoint));
  return entries;
}

/** The most recent valid close checkpoint for a scope, or null when none exists. */
export function latestValidCloseCheckpoint(scope: string): SprintCloseCheckpointV1 | null {
  return listValidCloseCheckpoints(scope)[0]?.checkpoint ?? null;
}

export function latestValidCloseCheckpointEntry(scope: string): ValidCloseCheckpoint | null {
  return listValidCloseCheckpoints(scope)[0] ?? null;
}

/**
 * Whether a valid certification exists for the CURRENT chain head.
 *
 * Delegates to the certification reader, which requires the C-NNN record behind the anchor to be
 * readable, contract-valid, commitment-matching, bound to this head and to the live business
 * digest, with a passing verdict and non-empty evidence. An anchor on its own certifies nothing
 * (ADR-0001).
 */
function resolveCertificationForHead(scope: string): { kind: 'none' } | { kind: 'valid'; through: string } {
  return resolveCertificationForChainHead(scope);
}

/**
 * Derive a scope's single named verification state. Doctor and status both call THIS function and
 * report the same state and the same detail string — a second derivation is the defect this task
 * exists to remove (ADR-0002).
 *
 * Precedence is fail-closed: diverged > unsupported > remediated > recertified > historical.
 * - Unreadable or contract-invalid records behind a well-formed anchor are diverged.
 * - An unknown schemaVersion with otherwise intact digests is unsupported.
 * - A present, healthy chain is a recorded correction: per S5 the scope is remediated, never
 *   historical, even when the correction net-restored the checkpoint after-image (T2.1 finding 2).
 * - Live state equal to the checkpoint after-image is historical only when no chain exists.
 * - Real drift is remediated only when the replayed chain reproduces the live state exactly; drift
 *   that does not replay is diverged.
 *
 * The chain is walked with the SAME per-record transaction statuses and continuity links doctor
 * uses (inspectRemediationChain / chainContinuityIssue), so the two surfaces cannot disagree about
 * a forked, reordered, or gapped chain (T2.1 finding 3).
 */
export function deriveScopeVerificationState(scope: string): ScopeVerification | null {
  const live = readLiveStateOrNull(scope);
  const checkpoint = latestValidCloseCheckpoint(scope);
  if (live === null || checkpoint === null) return null;

  // Retirement is an authorized terminal transition beyond the last close checkpoint. Its own
  // immutable transaction binds that checkpoint-clean before-state to the live retired state, so
  // the ordinary remediation lens must not misclassify the intentional terminal delta as drift.
  if (live.retirement) {
    const retirement = inspectScopeRetirement(scope)[0];
    if (retirement?.status === 'pass') {
      return { state: 'historical', detail: 'retired terminal state matches its immutable retirement checkpoint' };
    }
    return {
      state: 'diverged',
      detail: retirement?.detail ?? 'retirement metadata exists without an immutable retirement checkpoint',
    };
  }

  const anchors = readAnchorsSafely(scope, live);
  if (anchors === null) {
    return { state: 'diverged', detail: 'remediations[] is present but is not a well-formed anchor array' };
  }

  // Must be known before the chain walk: the head's result digest is compared against live state
  // inside it, and that comparison is exactly what a later active sprint invalidates.
  const supersededByActiveSprint = isSupersededByActiveSprint(scope, live);

  // Chain health first: walk every anchor exactly as doctor does — per-record transaction status
  // AND both continuity links. A broken chain beats any reassuring position; diverged > unsupported.
  let unsupportedDetail: string | null = null;
  let expectedHead: string | null = null;
  let expectedBase: string | null = null;
  for (let index = 0; index < anchors.length; index += 1) {
    const anchor = anchors[index];
    const isHead = index === anchors.length - 1;
    const transaction = inspectRemediationTransaction(scope, anchor.id, anchor.commitment, null, isHead && !supersededByActiveSprint);
    if (transaction.status === REMEDIATION_TRANSACTION_STATUS.CORRUPT
      || transaction.status === REMEDIATION_TRANSACTION_STATUS.DIVERGED) {
      return { state: 'diverged', detail: transaction.detail };
    }
    if (transaction.status === REMEDIATION_TRANSACTION_STATUS.UNSUPPORTED_VERSION) {
      unsupportedDetail = transaction.detail;
    }
    const record = readRemediationRecord(scope, anchor.id);
    const brokenLink = chainContinuityIssue(record, expectedHead, expectedBase);
    if (brokenLink !== null) {
      return { state: 'diverged', detail: brokenLink };
    }
    expectedHead = anchor.commitment;
    expectedBase = record?.result.stateSha256 ?? null;
  }

  // A record no anchor references is part of this scope's evidence whether or not the anchor list
  // mentions it. Doctor's chain lens already refused to ignore one; this derivation must refuse too,
  // or the same command reports a planted record as DIVERGED and the scope as `remediated` in one
  // breath, and `status` — which sees only this function — reports nothing wrong at all.
  //
  // Fail-closed inside the existing vocabulary rather than adding a sixth state: a new member would
  // change the contract Lens reads (R7) while Lens is still Sprint 4's to update. An interrupted
  // publish is diverged here too, and says so in its detail: it is not tampering, but it is an
  // unresolved transaction that can still move live state, so no reader may call the scope cleanly
  // remediated or recertified while it exists.
  const unanchored = evaluateUnanchoredRemediationRecords(scope, anchors, expectedHead, expectedBase);
  if (unanchored.length > 0) {
    const finding = unanchored[0];
    return { state: 'diverged', detail: `${finding.status}: ${finding.detail}` };
  }

  if (unsupportedDetail !== null) {
    return { state: 'unsupported', detail: unsupportedDetail };
  }

  // Position only means something while the checkpoint's after-image is still the expected live
  // state. Once a LATER sprint is under way, every edit it makes moves live state off that image
  // legitimately, and reading that as tampering would report normal in-sprint work as diverged.
  // Doctor's checkpoint lens already draws this line (supersededByActiveSprint); the verification
  // lens must draw the same one, or the two contradict each other on the same scope.
  if (supersededByActiveSprint) {
    // The chain was still walked above, so a corrupt or forged record has already been reported.
    // What cannot be judged here is drift, so nothing is claimed about it.
    if (anchors.length === 0) return null;
    const headId = anchors[anchors.length - 1].id;
    return {
      state: 'remediated',
      detail: `valid remediation chain through ${headId}; live drift is not evaluated while a later sprint is active`,
    };
  }

  const liveBusiness = businessStateDigest(live);
  const physicalRead = readJsonSafely(listValidCloseCheckpoints(scope)[0]?.path ?? '');
  const physicalAfter = physicalRead.exists && !physicalRead.error
    ? (physicalRead.value as { intendedAfterClose?: unknown }).intendedAfterClose
    : null;
  // An explicit `scope complete` / `scope reopen` legitimately moves live state off the close
  // after-image. Like a remediation chain, the transition is replayed rather than trusted: the
  // recorded lifecycle records are re-applied to the after-image and only an exact reproduction of
  // the live business state is accepted, so drift a lifecycle transition could not produce still
  // reads as divergence.
  const acceptedAfterDigests = new Set<string>();
  for (const image of [checkpoint.intendedAfterClose, physicalAfter]) {
    if (image === null || image === undefined) continue;
    const digest = businessStateDigest(image);
    if (digest) acceptedAfterDigests.add(digest);
    const replayed = replayScopeLifecycle(image, live)?.sprint;
    const replayedDigest = replayed ? businessStateDigest(replayed) : null;
    if (replayedDigest) acceptedAfterDigests.add(replayedDigest);
  }
  const atAfterImage = liveBusiness !== null && acceptedAfterDigests.has(liveBusiness);

  // A present chain must be replayed even when it net-restored the after-image. The head digest
  // only binds the claimed result to live state; without replaying operations, a re-anchored record
  // could alter its operation payload while retaining that digest and be reported as remediated.
  if (anchors.length > 0) {
    const rebaseClosed = physicalAfter ?? checkpoint.intendedAfterClose;
    const rebase = resolveRemediationRebase(scope, rebaseClosed);
    if (rebase.kind === 'remediated') {
      const certification = resolveCertificationForHead(scope);
      if (certification.kind === 'valid') {
        return { state: 'recertified', detail: `valid certification for chain head ${rebase.through}` };
      }
      return atAfterImage
        ? { state: 'remediated', detail: `live business state matches the checkpoint after-image after replay through ${rebase.through}` }
        : { state: 'remediated', detail: `drift explained by the replayed chain through ${rebase.through}` };
    }
    return { state: 'diverged', detail: atAfterImage
      ? 'live business state matches the checkpoint after-image but the remediation chain does not replay'
      : 'live drift is not explained by any replayed remediation chain' };
  }

  // No chain at all: historical only when the live state is exactly the checkpoint after-image.
  if (atAfterImage) {
    return { state: 'historical', detail: 'live business state matches the checkpoint after-image' };
  }
  return { state: 'diverged', detail: 'live state differs from the checkpoint after-image with no remediation chain to explain it' };
}

/**
 * Re-execute a record's typed operations against a reconstructed state, through the same executor
 * the planner uses. Returns null the moment anything fails to hold, so a record can never be
 * believed about a transformation it could not have performed.
 *
 * For E1: when replaying the first record (whose true base is unknown), skipPreconditions allows
 * the operations to be applied without verifying preconditions. The resulting state is always
 * checked against the record's digest; v1 additionally verifies its snapshot witness when needed.
 */
function replayOperations(state: Record<string, unknown>, operations: RemediationOperation[], skipPreconditions = false): Record<string, unknown> | null {
  const executed = executeOperations(state, operations, skipPreconditions);
  return 'failure' in executed ? null : executed.state;
}

/**
 * Advance one verified record. Every compact revision (v2, v3) intentionally stores no state image:
 * its closed witness says the already-typed operations are the replay proof, so `next` is the only
 * admissible successor. Only v1 retains a versioned snapshot witness, for compatibility with
 * immutable historical records that were written before the compact witness existed.
 */
function advanceReplayState(record: ScopeRemediation, next: Record<string, unknown>, isLast: boolean): Record<string, unknown> | null {
  if (isLast || record.schemaVersion !== SCOPE_REMEDIATION_SCHEMA_VERSION) return next;
  const witness = validateReplayWitness({
    recordSchemaVersion: record.schemaVersion,
    snapshot: record.result.snapshot,
    expectedStateSha256: record.result.stateSha256,
  });
  if (witness.status !== REPLAY_WITNESS_VALIDATION_STATUS.VALID) return null;
  return witness.witness.snapshot as unknown as Record<string, unknown>;
}

function ledgerCommitmentMap(state: Record<string, unknown>): Map<string, string> {
  const map = new Map<string, string>();
  const ledger = state.ledger;
  if (!Array.isArray(ledger)) return map;
  for (const raw of ledger) {
    const entry = asRecord(raw);
    if (typeof entry?.checkpoint === 'string' && typeof entry.checkpointSha256 === 'string') {
      map.set(entry.checkpoint, entry.checkpointSha256);
    }
  }
  return map;
}

function remediationResult(name: string, status: RemediationTransactionStatus, detail: string): CheckResult {
  const message = `${status}: ${detail}`;
  if (isAppliedRemediationStatus(status)) return { status: 'pass', name, detail: message };
  if (status === REMEDIATION_TRANSACTION_STATUS.PREPARED) {
    return {
      status: 'warn',
      name,
      detail: message,
      remedy: 'Re-run kyro remediate apply with the same manifest to finish the interrupted transaction, or remove the prepared record deliberately. It is not an applied remediation.',
    };
  }
  if (status === REMEDIATION_TRANSACTION_STATUS.UNSUPPORTED_VERSION) {
    return { status: 'fail', name, detail: message, remedy: 'Upgrade Kyro before reading or extending this remediation chain.' };
  }
  return {
    status: 'fail',
    name,
    detail: message,
    remedy: 'Do not overwrite live state. Reconcile the remediation record and the live anchor explicitly before any further remediation.',
  };
}

// --- inputs -----------------------------------------------------------------------------------

function readManifest(path: string): RemediationManifestV1 {
  const read = readJsonSafely(path);
  if (!read.exists) {
    throw new KyroCoreError('INVALID_INPUT', `Remediation manifest ${path} not found.`, `Write a ${REMEDIATION_MANIFEST_KIND} manifest and pass it with --manifest.`);
  }
  if (read.error) {
    throw new KyroCoreError('INVALID_JSON', `Remediation manifest ${path} is invalid JSON (${read.error}).`, 'Fix the manifest JSON and re-run the preview.');
  }
  const issues = validateRemediationManifest(read.value, path);
  if (issues.length > 0) {
    throw new KyroCoreError(
      'INVALID_INPUT',
      `Remediation manifest ${path} is invalid — ${formatIssues(issues)}.`,
      'Every operation must be an explicitly typed member of the v1 registry. Generic patch payloads and unknown fields are rejected by design.',
    );
  }
  return read.value as RemediationManifestV1;
}

/**
 * The live state is read raw, without the strict SprintFile validator.
 *
 * A scope needing remediation is by definition one whose persisted state no longer satisfies the
 * current contract — validating here would refuse to load exactly the files this feature exists to
 * repair. The corrected projection *is* validated strictly before any plan is returned.
 */
function readLiveState(scope: string): Record<string, unknown> {
  const path = sprintJsonPath(scope);
  const read = readJsonSafely(path);
  if (!read.exists) {
    throw new KyroCoreError('SCOPE_NOT_FOUND', `${path} not found.`, 'Remediation targets an existing closed scope; check --kyro-scope.');
  }
  if (read.error) {
    throw new KyroCoreError('INVALID_JSON', `${path} is invalid JSON (${read.error}).`, 'Remediation corrects typed values, not broken JSON. Restore the file from versioned storage first.');
  }
  const state = asRecord(read.value);
  if (!state || !Array.isArray(state.debt) || !Array.isArray(state.ledger)) {
    throw new KyroCoreError('INVALID_SPRINT_SHAPE', `${path} is too damaged to remediate (debt[] and ledger[] must be arrays).`, 'Remediation is a narrow typed correction, not a structural rebuild. Restore the file from versioned storage.');
  }
  return state;
}

function readLiveStateOrNull(scope: string): Record<string, unknown> | null {
  const read = readJsonSafely(sprintJsonPath(scope));
  if (!read.exists || read.error) return null;
  return asRecord(read.value);
}

/**
 * Every closed sprint must still present an intact, anchored checkpoint before its live state may be
 * corrected. Verification is commitment-based on purpose: the checkpoint proves the original close,
 * and re-validating it against today's stricter schema would reject the very history being protected.
 */
function verifyLedgerCheckpoints(scope: string, state: Record<string, unknown>): void {
  const ledger = (state.ledger as unknown[]).map(asRecord);
  if (ledger.length === 0) {
    throw new KyroCoreError('INVALID_INPUT', `Scope ${scope} has no closed sprint in its ledger.`, 'Remediation corrects the live state of a closed scope. Use the normal sprint flow for work that is still open.');
  }
  ledger.forEach((entry, index) => {
    const label = `ledger[${index}]`;
    if (!entry || typeof entry.checkpoint !== 'string') {
      throw new KyroCoreError('CHECKPOINT_CONFLICT', `${label} has no checkpoint reference.`, 'A sprint closed without a checkpoint cannot be protected during remediation. Do not manufacture one.');
    }
    if (typeof entry.checkpointSha256 !== 'string') {
      throw new KyroCoreError('CHECKPOINT_CONFLICT', `${label} checkpoint ${entry.checkpoint} is unanchored (no checkpointSha256).`, 'Without a live commitment, archive tampering cannot be ruled out. Remediation refuses to proceed on unanchored history.');
    }
    const resolved = resolveEffectiveCheckpoint(scope, {
      n: typeof entry.n === 'number' ? entry.n : undefined,
      slug: typeof entry.slug === 'string' ? entry.slug : undefined,
      checkpoint: entry.checkpoint,
      checkpointSha256: typeof entry.checkpointSha256 === 'string' ? entry.checkpointSha256 : undefined,
    });
    if (resolved.status === EFFECTIVE_CHECKPOINT_STATUS.CORRUPT || resolved.status === EFFECTIVE_CHECKPOINT_STATUS.UNSUPPORTED) {
      throw new KyroCoreError('CHECKPOINT_CORRUPT', `${label} checkpoint ${entry.checkpoint} is ${resolved.status}: ${resolved.detail}.`, 'Restore the immutable checkpoint or apply a valid canonicalization overlay before remediating.');
    }
    if (resolved.status === EFFECTIVE_CHECKPOINT_STATUS.DIVERGED || !resolved.checkpoint) {
      throw new KyroCoreError('CHECKPOINT_CONFLICT', `${label} checkpoint ${entry.checkpoint} is ${resolved.status}: ${resolved.detail}.`, 'Treat the archive or overlay as tampered. Restore trusted bytes before remediating.');
    }
    const liveSha = entry.checkpointSha256;
    if (resolved.status === EFFECTIVE_CHECKPOINT_STATUS.VALID) {
      const commitment = checkpointCommitmentOfRecord(resolved.checkpoint);
      if (commitment !== liveSha) {
        throw new KyroCoreError('CHECKPOINT_CONFLICT', `${label} checkpoint ${entry.checkpoint} does not match its ledger commitment.`, 'Treat the archive as tampered. Restore the checkpoint bytes from trusted versioned storage before remediating.');
      }
    } else {
      const overlay = resolved;
      const physical = readJsonSafely(`${scopeRoot(scope)}/${entry.checkpoint}`);
      const observed = typeof physical.value === 'object' && physical.value !== null
        ? ((physical.value as { intendedAfterClose?: { ledger?: Array<{ checkpointSha256?: string }> } }).intendedAfterClose?.ledger ?? []).slice(-1)[0]?.checkpointSha256
        : undefined;
      const canonical = checkpointCommitmentOfRecord(resolved.checkpoint);
      if (liveSha !== observed && liveSha !== canonical) {
        throw new KyroCoreError(
          'CHECKPOINT_CONFLICT',
          `${label} checkpoint ${entry.checkpoint} ledger commitment matches neither the original overlay binding nor the canonical commitment.`,
          'Re-run repair integrity prepare so the ledger can be reanchored to the effective checkpoint.',
        );
      }
      void overlay;
    }
  });
}

function collectCheckpointCommitments(state: Record<string, unknown>): Array<{ path: string; commitment: string }> {
  return (state.ledger as unknown[])
    .map(asRecord)
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .map((entry) => ({ path: String(entry.checkpoint), commitment: String(entry.checkpointSha256) }));
}

function readAnchors(scope: string, state: Record<string, unknown>): RemediationAnchor[] {
  const anchors = readAnchorsSafely(scope, state);
  if (anchors === null) {
    throw new KyroCoreError('INVALID_SPRINT_SHAPE', `${sprintJsonPath(scope)}.remediations[] is malformed.`, 'Do not hand-edit remediations[]. Restore it from versioned storage.');
  }
  return anchors;
}

function readAnchorsSafely(scope: string, state: Record<string, unknown>): RemediationAnchor[] | null {
  if (!('remediations' in state)) return [];
  const anchored = { ...state, remediations: state.remediations };
  // Reuse the SprintFile gate so the anchor contract has exactly one definition. Only anchor issues
  // matter here — the rest of a scope awaiting remediation is expected to be invalid.
  const issues = validateSprintFile(anchored, sprintJsonPath(scope)).filter((issue) => issue.field.startsWith('remediations'));
  if (issues.length > 0) return null;
  const anchors = state.remediations as RemediationAnchor[];
  // The record is located by id, so an unconstrained `path` would be decoration that doctor and the
  // reader could disagree about — Lens resolves the record through this field. Bind them: the id and
  // the path must name the same file, and the id must be a real remediation id.
  for (const anchor of anchors) {
    if (!REMEDIATION_ID_PATTERN.test(anchor.id)) return null;
    if (anchor.path !== relativeRecordPath(anchor.id)) return null;
  }
  return anchors;
}

function readRemediationRecord(scope: string, remediationId: string): ScopeRemediation | null {
  const path = remediationRecordPath(scope, remediationId);
  const read = readJsonSafely(path);
  if (!read.exists || read.error) return null;
  if (validateScopeRemediation(read.value, path).length > 0) return null;
  const record = read.value as ScopeRemediation;
  return record.scope === scope && record.id === remediationId ? record : null;
}

// --- projection -------------------------------------------------------------------------------

/**
 * Apply a batch's operations IN ORDER, evaluating each precondition against the state as it stands
 * at that point in the batch.
 *
 * Planning and replay share this one implementation on purpose. When they were separate, the planner
 * checked every precondition against the original state while the replay checked them sequentially,
 * so a batch touching the same field twice was accepted at apply time and then failed its own
 * verification — an honestly applied remediation that doctor reported as tampering. One executor
 * makes that class of disagreement impossible by construction.
 */
export function executeRemediationOperations(
  state: Record<string, unknown>,
  operations: RemediationOperation[],
  skipPreconditions = false,
): { state: Record<string, unknown>; changes: RemediationChange[] } | { failure: KyroCoreError } {
  return executeOperations(state, operations, skipPreconditions);
}

function executeOperations(
  state: Record<string, unknown>,
  operations: RemediationOperation[],
  skipPreconditions = false,
): { state: Record<string, unknown>; changes: RemediationChange[] } | { failure: KyroCoreError } {
  const next = JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
  if (!Array.isArray(next.debt)) {
    return { failure: new KyroCoreError('INVALID_SPRINT_SHAPE', 'Cannot apply remediation operations: debt[] is not an array.') };
  }
  // Read live from `next.debt` inside each operation rather than from a snapshot taken before the
  // loop: a canonicalization REPLACES an element, so a pre-computed view would leave a later
  // operation in the same batch reasoning about a record that no longer exists.
  const collection = next.debt as unknown[];
  const changes: RemediationChange[] = [];

  for (const operation of operations) {
    switch (operation.kind) {
      case 'debt.origin.set': {
        const target = collection.map(asRecord).find((entry) => entry?.id === operation.debtId) ?? null;
        if (!target) {
          return {
            failure: new KyroCoreError(
              'DEBT_NOT_FOUND',
              `Operation ${operation.id} targets debt "${operation.debtId}", which does not exist in the live state.`,
              'Remediation never creates records. Correct the debt id in the manifest.',
            ),
          };
        }
        if (!skipPreconditions) {
          const observed = observedValueDigest(target.origin);
          if (observed !== operation.expectedOriginSha256) {
            return {
              failure: new KyroCoreError(
                'STATE_DIVERGED',
                `Operation ${operation.id} expected debt "${operation.debtId}" origin digest ${operation.expectedOriginSha256} but the live value digests to ${observed}.`,
                'The value changed since the manifest was written, or an earlier operation in this batch already changed it. Re-inspect the live value and regenerate the manifest.',
              ),
            };
          }
        }
        changes.push({
          operationId: operation.id,
          kind: operation.kind,
          target: `debt[${operation.debtId}].origin`,
          from: target.origin,
          to: operation.origin,
        });
        target.origin = operation.origin;
        break;
      }
      case 'debt.canonicalize': {
        const index = collection.findIndex((entry) => asRecord(entry)?.id === operation.debtId);
        if (index === -1) {
          return {
            failure: new KyroCoreError(
              'DEBT_NOT_FOUND',
              `Operation ${operation.id} targets debt "${operation.debtId}", which does not exist in the live state.`,
              'Remediation never creates records. Correct the debt id in the manifest.',
            ),
          };
        }
        if (!skipPreconditions) {
          // The whole collection is the precondition, not just the target record: if any other debt
          // was added, removed, reordered or edited since preparation, the operator authorized an
          // after-image for a collection that no longer exists.
          const issues = verifyCanonicalizePreconditions(
            operation,
            collection,
            debtCollectionDigest,
            '<live state>',
            `operation ${operation.id}`,
          );
          if (issues.length > 0) {
            return {
              failure: new KyroCoreError(
                'STATE_DIVERGED',
                `Operation ${operation.id} no longer describes the live debt — ${formatIssues(issues)}.`,
                'The debt collection changed since the manifest was written, or an earlier operation in this batch already changed it. Re-run kyro remediate canonicalize-prepare and regenerate the manifest.',
              ),
            };
          }
        }
        const before = collection[index];
        // Rebuilt key by key in canonical order rather than spread: the after-image is the whole
        // point of the operation, so the record that lands on disk carries exactly the seven keys
        // and nothing a validated payload happened to also hold.
        const after: Record<string, unknown> = {};
        for (const key of CANONICAL_DEBT_AFTER_KEYS) after[key] = operation.after[key];
        collection[index] = after;
        changes.push({
          operationId: operation.id,
          kind: operation.kind,
          target: `debt[${operation.debtId}]`,
          from: before,
          to: after,
        });
        break;
      }
      case 'convention.append': {
        if (!Array.isArray(next.conventions)) {
          return { failure: new KyroCoreError('INVALID_SPRINT_SHAPE', 'Cannot apply convention.append: conventions[] is not an array.') };
        }
        const conventions = next.conventions as unknown[];
        if (!skipPreconditions) {
          const observed = observedValueDigest(conventions);
          if (observed !== operation.expectedConventionCollectionSha256) {
            return {
              failure: new KyroCoreError(
                'STATE_DIVERGED',
                `Operation ${operation.id} expected conventions[] digest ${operation.expectedConventionCollectionSha256} but the live collection digests to ${observed}.`,
                'The convention collection changed since the plan was written. Re-run repair integrity prepare.',
              ),
            };
          }
        }
        const duplicate = conventions.map(asRecord).find((entry) => entry?.id === operation.after.id);
        if (duplicate) {
          if (canonicalJson(duplicate) !== canonicalJson(operation.after)) {
            return {
              failure: new KyroCoreError(
                'INVALID_INPUT',
                `Operation ${operation.id} conflicts with existing convention "${operation.after.id}".`,
                'Convention ids must be unique. Do not reuse an id with a different rule.',
              ),
            };
          }
          break;
        }
        const after = {
          id: operation.after.id,
          rule: operation.after.rule,
          tags: [...operation.after.tags],
          addedSprint: operation.after.addedSprint,
        };
        conventions.push(after);
        changes.push({
          operationId: operation.id,
          kind: operation.kind,
          target: `conventions[${operation.after.id}]`,
          from: null,
          to: after,
        });
        break;
      }
      case 'adr.append': {
        if (!Array.isArray(next.adrs)) next.adrs = [];
        const adrs = next.adrs as unknown[];
        if (!skipPreconditions) {
          const observed = observedValueDigest(adrs);
          if (observed !== operation.expectedAdrCollectionSha256) {
            return {
              failure: new KyroCoreError(
                'STATE_DIVERGED',
                `Operation ${operation.id} expected adrs[] digest ${operation.expectedAdrCollectionSha256} but the live collection digests to ${observed}.`,
                'The ADR collection changed since the plan was written. Re-run repair integrity prepare.',
              ),
            };
          }
        }
        const duplicate = adrs.map(asRecord).find((entry) => entry?.id === operation.after.id);
        if (duplicate) {
          if (canonicalJson(duplicate) !== canonicalJson(operation.after)) {
            return {
              failure: new KyroCoreError(
                'INVALID_INPUT',
                `Operation ${operation.id} conflicts with existing ADR "${operation.after.id}".`,
              ),
            };
          }
          break;
        }
        adrs.push(JSON.parse(JSON.stringify(operation.after)));
        changes.push({
          operationId: operation.id,
          kind: operation.kind,
          target: `adrs[${operation.after.id}]`,
          from: null,
          to: operation.after,
        });
        break;
      }
      case 'ledger.checkpoint.reanchor': {
        if (!Array.isArray(next.ledger)) {
          return { failure: new KyroCoreError('INVALID_SPRINT_SHAPE', 'Cannot apply ledger.checkpoint.reanchor: ledger[] is not an array.') };
        }
        const ledger = next.ledger as unknown[];
        const index = ledger.findIndex((entry) => {
          const record = asRecord(entry);
          return record?.n === operation.sprintN && record?.slug === operation.sprintSlug;
        });
        if (index === -1) {
          return {
            failure: new KyroCoreError(
              'INVALID_INPUT',
              `Operation ${operation.id} targets ledger sprint ${operation.sprintN} (${operation.sprintSlug}), which does not exist.`,
            ),
          };
        }
        const target = asRecord(ledger[index]);
        if (!target) {
          return { failure: new KyroCoreError('INVALID_SPRINT_SHAPE', `ledger[${index}] is not an object.`) };
        }
        const current = typeof target.checkpointSha256 === 'string' ? target.checkpointSha256 : '';
        if (!skipPreconditions && current !== operation.expectedOldSha256) {
          return {
            failure: new KyroCoreError(
              'STATE_DIVERGED',
              `Operation ${operation.id} expected ledger checkpointSha256 ${operation.expectedOldSha256} but the live value is ${current || '(missing)'}.`,
              'The ledger commitment changed since the plan was written. Re-run repair integrity prepare.',
            ),
          };
        }
        if (!skipPreconditions && !reanchorTargetAllowed(next, operation, target)) {
          return {
            failure: new KyroCoreError(
              'CHECKPOINT_CONFLICT',
              `Operation ${operation.id} reanchor target ${operation.afterSha256} is not the effective checkpoint commitment.`,
              'Reanchor only to the effective or originally observed ledger commitment. Doctor would reject any other destination.',
            ),
          };
        }
        const keys = Object.keys(target);
        const allowed = new Set(['n', 'slug', 'outcome', 'closedAt', 'archive', 'snapshot', 'checkpoint', 'checkpointSha256', 'recommendations']);
        for (const key of keys) {
          if (!allowed.has(key)) {
            return { failure: new KyroCoreError('INVALID_INPUT', `Operation ${operation.id} refuses to touch unexpected ledger key ${key}.`) };
          }
        }
        changes.push({
          operationId: operation.id,
          kind: operation.kind,
          target: `ledger[${operation.sprintN}].checkpointSha256`,
          from: current,
          to: operation.afterSha256,
        });
        target.checkpointSha256 = operation.afterSha256;
        break;
      }
      default: {
        const exhaustive: never = operation;
        return { failure: new KyroCoreError('INVALID_INPUT', `Unsupported remediation operation ${JSON.stringify(exhaustive)}.`, 'Only registry operations can be planned.') };
      }
    }
  }

  // The anchor is never part of the corrected business state; it is appended by the caller.
  delete next.remediations;
  return { state: next, changes };
}

// --- helpers ----------------------------------------------------------------------------------

/**
 * Business-state digest. Accepts the raw record because the pre-remediation state does not satisfy
 * the SprintFile contract yet; the projection excludes remediations[] either way.
 */
function stateDigest(state: Record<string, unknown>): string {
  return sha256(canonicalRemediationState(state as unknown as SprintFile));
}

export function remediationsDir(scope: string): string {
  return `${archiveDir(scope)}/remediations`;
}

export function remediationRecordPath(scope: string, remediationId: string): string {
  return `${scopeRoot(scope)}/${relativeRecordPath(remediationId)}`;
}

function relativeRecordPath(remediationId: string): string {
  return `archive/remediations/remediation-${remediationId.replace(/^R-/, '')}.json`;
}

const REMEDIATION_ID_PATTERN = /^R-\d{3,}$/;

/** Ids are sequential and gap-free so the chain order is readable without parsing every record. */
function nextRemediationId(anchors: RemediationAnchor[]): string {
  return `R-${String(anchors.length + 1).padStart(3, '0')}`;
}

export function remediationRecordExists(scope: string, remediationId: string): boolean {
  return existsSync(resolveManagedPath(remediationRecordPath(scope, remediationId)));
}

function formatIssues(issues: ValidationIssue[]): string {
  return issues.map((issue) => `${issue.path}:${issue.field} ${issue.message}`).join('; ');
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function reanchorTargetAllowed(
  state: Record<string, unknown>,
  operation: Extract<RemediationOperation, { kind: 'ledger.checkpoint.reanchor' }>,
  target: Record<string, unknown>,
): boolean {
  const scope = typeof state.scope === 'string' ? state.scope : '';
  const checkpointPath = typeof target.checkpoint === 'string' ? target.checkpoint : '';
  if (!scope || !checkpointPath) return false;
  const resolved = resolveEffectiveCheckpoint(scope, {
    n: operation.sprintN,
    slug: operation.sprintSlug,
    checkpoint: checkpointPath,
    checkpointSha256: operation.afterSha256,
  });
  const allowed = new Set<string>();
  const effective = effectiveCommitment(resolved);
  if (effective) allowed.add(effective);
  if (resolved.originalSha256) {
    const overlay = findCanonicalizationForBytes(scope, `${scopeRoot(scope)}/${checkpointPath}`, resolved.originalSha256);
    if (overlay) allowed.add(overlay.observedLedgerCommitment);
  }
  return allowed.has(operation.afterSha256);
}
