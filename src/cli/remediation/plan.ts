import { sprintJsonPath } from '../artifacts/paths';
import { validateSprintFile } from '../artifacts/schema';
import { canonicalJson, sha256 } from '../checkpoints/sprint-close';
import { KyroCoreError } from '../core/errors';
import type { RemediationAnchor, SprintFile } from '../types';
import {
  COMPACT_REPLAY_WITNESS_KIND,
  COMPACT_REPLAY_WITNESS_SCHEMA_VERSION,
  SCOPE_REMEDIATION_KIND,
  SCOPE_REMEDIATION_V4_SCHEMA_VERSION,
  requiredRemediationRevision,
  validateRemediationManifest,
  validateScopeRemediation,
  type CompactScopeRemediation,
  type RemediationManifestV1,
  type RemediationOperation,
} from './protocol';
import {
  type RemediationChange,
  type RemediationTransactionStatus,
  formatIssues,
  stateDigest,
  nextRemediationId,
  remediationRecordPath,
  relativeRecordPath,
  REMEDIATION_TRANSACTION_STATUS,
} from './plan-common';
import {
  readManifest,
  readLiveState,
  verifyLedgerCheckpoints,
  readAnchors,
  readRemediationRecord,
  collectCheckpointCommitments,
} from './plan-inputs';
import { executeOperations } from './plan-execute';
import { inspectRemediationTransaction } from './plan-transaction';
export { REMEDIATION_TRANSACTION_STATUS, isAppliedRemediationStatus, remediationsDir, remediationRecordPath, remediationRecordExists } from './plan-common';
export type { RemediationTransactionStatus, RemediationChange } from './plan-common';
export { verifyLedgerCheckpoints } from './plan-inputs';
export { executeRemediationOperations } from './plan-execute';
export { compareCheckpointRecency, listValidCloseCheckpoints, latestValidCloseCheckpoint, latestValidCloseCheckpointEntry } from './plan-checkpoints';
export type { ValidCloseCheckpoint } from './plan-checkpoints';
export { inspectRemediationTransaction, chainContinuityIssue, evaluateUnanchoredRemediationRecords } from './plan-transaction';
export type { UnanchoredRemediationFinding } from './plan-transaction';
export { businessStateDigest, usesBoundEvolution, resolveScopeEvolution, resolveRemediationRebase, resolveRemediationReplayState } from './plan-evolution';
export type { RemediationRebase, RemediationReplayState, ScopeEvolution } from './plan-evolution';
export { isSupersededByActiveSprint, inspectRemediationChain, deriveScopeVerificationState } from './plan-verification';

/**
 * Pure remediation planner.
 *
 * Everything here is read-only: it loads a manifest and the target scope, proves that the historical
 * checkpoints are intact and still anchored, proves that every typed operation's precondition holds
 * against the *current* live state, then projects the corrected state and the record that would be
 * persisted. Nothing is written. `remediate apply` (T1.3) re-runs this planner under the state-writer
 * lock, so a defect caught here is a defect that never reaches the filesystem.
 */


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
  manifestPath?: string;
  manifest?: RemediationManifestV1;
  /** Injected so the planner stays deterministic and testable. */
  now: string;
  kyroVersion: string;
}

export function planRemediation(options: RemediationPlanOptions): RemediationPlan {
  const manifest = options.manifest ?? readManifest(options.manifestPath!);
  const manifestIssues = validateRemediationManifest(manifest, '<manifest>');
  if (manifestIssues.length) throw new KyroCoreError('INVALID_INPUT', formatIssues(manifestIssues));
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