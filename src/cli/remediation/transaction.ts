import { atomicReplace, publishExclusive, sha256 } from '../checkpoints/sprint-close';
import { readJsonSafely } from '../artifacts/json';
import { validateSprintFile, type ValidationIssue } from '../artifacts/schema';
import { KyroCoreError } from '../core/errors';
import { assertSafeManagedPath, withStateWriterLock } from '../pipeline/state-writer-lock';
import { canonicalRemediationState } from './canonical-state';
import { validateScopeRemediation, type ScopeRemediation } from './protocol';
import {
  REMEDIATION_TRANSACTION_STATUS,
  planRemediation,
  type RemediationPlan,
  type RemediationPlanOptions,
} from './plan';
import type { RemediationAnchor, SprintFile } from '../types';

/**
 * Durable remediation application.
 *
 * The shape mirrors applySprintCloseTransaction: safe managed paths, an exclusively published
 * immutable artifact, everything under the state-writer lock, compare-and-swap on live state, and a
 * read-back verification pass. The plan is rebuilt *inside* the lock so the digests a write is
 * authorized against are the ones observed while the writer is held — a plan computed outside the
 * lock is a preview, never a warrant to write.
 */

export interface RemediationApplyResult {
  scope: string;
  remediationId: string;
  recordPath: string;
  sprintPath: string;
  commitment: string;
  /** True when the record already existed from an interrupted attempt and this run finished it. */
  resumed: boolean;
  plan: RemediationPlan;
}

export function applyRemediationTransaction(options: RemediationPlanOptions): RemediationApplyResult {
  return withStateWriterLock(() => {
    const plan = planRemediation(options);
    assertSafeManagedPath(plan.recordPath);
    assertSafeManagedPath(plan.sprintPath);

    // planRemediation already refuses a stale base digest, so an already-applied manifest never
    // reaches this point: its base state no longer exists. What can reach it is an interrupted
    // attempt (PREPARED), which is resumed rather than duplicated.
    const resumed = plan.transactionStatus === REMEDIATION_TRANSACTION_STATUS.PREPARED;
    if (plan.transactionStatus !== REMEDIATION_TRANSACTION_STATUS.NOT_APPLIED && !resumed) {
      throw new KyroCoreError(
        'STATE_DIVERGED',
        `Remediation ${plan.remediationId} is ${plan.transactionStatus}: ${plan.transactionDetail}.`,
        'Reconcile the existing remediation record and live anchor before applying anything else. Kyro will not write over an ambiguous transaction.',
      );
    }

    if (!resumed) {
      publishExclusive(plan.recordPath, `${JSON.stringify(plan.record, null, 2)}\n`, `remediation record ${plan.remediationId}`);
    }
    verifyPublishedRecord(plan);
    compareAndSwapSprint(plan);
    verifyApplied(plan);

    return {
      scope: plan.scope,
      remediationId: plan.remediationId,
      recordPath: plan.recordPath,
      sprintPath: plan.sprintPath,
      commitment: plan.commitment,
      resumed,
      plan,
    };
  });
}

/** The immutable record must be on disk, parseable, contract-valid and commit to the planned digest. */
function verifyPublishedRecord(plan: RemediationPlan): void {
  const read = readJsonSafely(plan.recordPath);
  if (!read.exists || read.error) {
    throw diverged(plan.recordPath, `remediation record is missing or unreadable (${read.error ?? 'missing'})`);
  }
  const issues = validateScopeRemediation(read.value, plan.recordPath);
  if (issues.length > 0) throw diverged(plan.recordPath, `published record is invalid — ${formatIssues(issues)}`);
  const published = read.value as ScopeRemediation;
  if (sha256(published) !== plan.commitment) {
    throw diverged(plan.recordPath, 'published record does not match the planned commitment');
  }
}

/**
 * Swap the live scope from the base state to the remediated state, or accept a state that is already
 * the remediated one (a resumed attempt). Any third state is a divergence and stops the transaction.
 */
function compareAndSwapSprint(plan: RemediationPlan): void {
  const read = readJsonSafely(plan.sprintPath);
  if (read.error || !read.exists) throw diverged(plan.sprintPath, read.error ?? 'missing');
  const current = read.value as Record<string, unknown>;
  const currentDigest = stateDigest(current);
  const anchored = hasAnchor(current, plan.anchor);

  if (currentDigest === plan.record.result.stateSha256 && anchored) return;
  if (currentDigest !== plan.record.base.stateSha256) {
    throw diverged(plan.sprintPath, 'live state matches neither the remediation base nor its result');
  }
  atomicReplace(plan.sprintPath, `${JSON.stringify(plan.projectedSprint, null, 2)}\n`);
}

/** Post-write proof: the live file parses, satisfies the strict contract, and matches the record. */
function verifyApplied(plan: RemediationPlan): void {
  const read = readJsonSafely(plan.sprintPath);
  if (read.error || !read.exists) throw diverged(plan.sprintPath, `post-write verification failed (${read.error ?? 'missing'})`);
  const issues = validateSprintFile(read.value, plan.sprintPath);
  if (issues.length > 0) throw diverged(plan.sprintPath, `remediated state failed validation — ${formatIssues(issues)}`);
  const live = read.value as Record<string, unknown>;
  if (stateDigest(live) !== plan.record.result.stateSha256) {
    throw diverged(plan.sprintPath, 'post-write state digest does not match the remediation result digest');
  }
  if (!hasAnchor(live, plan.anchor)) {
    throw diverged(plan.sprintPath, `remediation anchor ${plan.remediationId} is missing from the remediated state`);
  }
}

function hasAnchor(state: Record<string, unknown>, anchor: RemediationAnchor): boolean {
  const anchors = state.remediations;
  if (!Array.isArray(anchors)) return false;
  return anchors.some((entry) => {
    const record = entry as Partial<RemediationAnchor> | null;
    return record?.id === anchor.id && record?.commitment === anchor.commitment && record?.path === anchor.path;
  });
}

function stateDigest(state: Record<string, unknown>): string {
  return sha256(canonicalRemediationState(state as unknown as SprintFile));
}

function diverged(path: string, detail: string): KyroCoreError {
  return new KyroCoreError(
    'STATE_DIVERGED',
    `${path}: ${detail}.`,
    'Do not retry blindly. Inspect the remediation record and the live anchor with kyro doctor --artifacts before any further write.',
  );
}

function formatIssues(issues: ValidationIssue[]): string {
  return issues.map((issue) => `${issue.path}:${issue.field} ${issue.message}`).join('; ');
}
