/**
 * Durable certification application (T2.4).
 *
 * Mirrors applyRemediationTransaction exactly: safe managed paths, an exclusively published
 * immutable artifact, everything under the state-writer lock, compare-and-swap on live state, and a
 * read-back verification pass. The plan is rebuilt INSIDE the lock, so the digests the write is
 * authorized against are the ones observed while the writer is held — a plan computed outside the
 * lock is a preview, never a warrant to write.
 */

import { atomicReplace, publishExclusive } from '../checkpoints/sprint-close';
import { readJsonSafely } from '../artifacts/json';
import { validateSprintFile, type ValidationIssue } from '../artifacts/schema';
import { KyroCoreError } from '../core/errors';
import { assertSafeManagedPath, withStateWriterLock } from '../pipeline/state-writer-lock';
import { certificationCommitment, validateScopeRecertification } from './certification';
import {
  CERTIFICATION_TRANSACTION_STATUS,
  planCertification,
  type CertificationPlan,
  type CertificationPlanOptions,
} from './certification-plan';
import type { CertificationAnchor, ScopeRecertificationV1 } from '../types';

export interface CertificationApplyResult {
  scope: string;
  certificationId: string;
  recordPath: string;
  sprintPath: string;
  commitment: string;
  /** True when the record already existed from an interrupted attempt and this run finished it. */
  resumed: boolean;
  plan: CertificationPlan;
}

export function applyCertificationTransaction(options: CertificationPlanOptions): CertificationApplyResult {
  return withStateWriterLock(() => {
    const plan = planCertification(options);
    assertSafeManagedPath(plan.recordPath);
    assertSafeManagedPath(plan.sprintPath);

    // An already-applied certificate never reaches here: its id is taken, so the planner allocates
    // the next one. What can reach it is an interrupted attempt (PREPARED), which is resumed rather
    // than duplicated — the reused createdAt makes the retry reproduce the same commitment.
    const resumed = plan.transactionStatus === CERTIFICATION_TRANSACTION_STATUS.PREPARED;
    if (plan.transactionStatus !== CERTIFICATION_TRANSACTION_STATUS.NOT_APPLIED && !resumed) {
      throw new KyroCoreError(
        'STATE_DIVERGED',
        `Certification ${plan.certificationId} is ${plan.transactionStatus}: ${plan.transactionDetail}.`,
        'Reconcile the existing certification record and live anchor before writing anything else. Kyro will not write over an ambiguous transaction.',
      );
    }

    if (!resumed) {
      publishExclusive(plan.recordPath, `${JSON.stringify(plan.record, null, 2)}\n`, `certification record ${plan.certificationId}`);
    }
    verifyPublishedRecord(plan);
    compareAndSwapSprint(plan);
    verifyApplied(plan);

    return {
      scope: plan.scope,
      certificationId: plan.certificationId,
      recordPath: plan.recordPath,
      sprintPath: plan.sprintPath,
      commitment: plan.commitment,
      resumed,
      plan,
    };
  });
}

/** The immutable record must be on disk, parseable, contract-valid and commit to the planned digest. */
function verifyPublishedRecord(plan: CertificationPlan): void {
  const read = readJsonSafely(plan.recordPath);
  if (!read.exists || read.error) {
    throw diverged(plan.recordPath, `certification record is missing or unreadable (${read.error ?? 'missing'})`);
  }
  const issues = validateScopeRecertification(read.value, plan.recordPath);
  if (issues.length > 0) throw diverged(plan.recordPath, `published record is invalid — ${issues.join('; ')}`);
  const published = read.value as ScopeRecertificationV1;
  if (certificationCommitment(published) !== plan.commitment) {
    throw diverged(plan.recordPath, 'published record does not match the planned commitment');
  }
}

/**
 * Append the certification anchor, or accept a state that already carries it (a resumed attempt).
 * Certification never changes business state, so the only legal edit is the anchor itself.
 */
function compareAndSwapSprint(plan: CertificationPlan): void {
  const read = readJsonSafely(plan.sprintPath);
  if (read.error || !read.exists) throw diverged(plan.sprintPath, read.error ?? 'missing');
  const current = read.value as Record<string, unknown>;
  if (hasAnchor(current, plan.anchor)) return;
  atomicReplace(plan.sprintPath, `${JSON.stringify(plan.projectedSprint, null, 2)}\n`);
}

/** Post-write proof: the live file parses, satisfies the strict contract, and carries the anchor. */
function verifyApplied(plan: CertificationPlan): void {
  const read = readJsonSafely(plan.sprintPath);
  if (read.error || !read.exists) throw diverged(plan.sprintPath, `post-write verification failed (${read.error ?? 'missing'})`);
  const issues = validateSprintFile(read.value, plan.sprintPath);
  if (issues.length > 0) throw diverged(plan.sprintPath, `certified state failed validation — ${formatIssues(issues)}`);
  const live = read.value as Record<string, unknown>;
  if (!hasAnchor(live, plan.anchor)) {
    throw diverged(plan.sprintPath, `certification anchor ${plan.certificationId} is missing from the certified state`);
  }
}

function hasAnchor(state: Record<string, unknown>, anchor: CertificationAnchor): boolean {
  const anchors = state.certifications;
  if (!Array.isArray(anchors)) return false;
  return anchors.some((entry) => {
    const record = entry as Partial<CertificationAnchor> | null;
    return record?.id === anchor.id && record?.commitment === anchor.commitment && record?.path === anchor.path;
  });
}

function diverged(path: string, detail: string): KyroCoreError {
  return new KyroCoreError(
    'STATE_DIVERGED',
    `${path}: ${detail}.`,
    'Do not retry blindly. Inspect the certification record and the live anchor with kyro doctor --artifacts before any further write.',
  );
}

function formatIssues(issues: ValidationIssue[]): string {
  return issues.map((issue) => `${issue.path}:${issue.field} ${issue.message}`).join('; ');
}
