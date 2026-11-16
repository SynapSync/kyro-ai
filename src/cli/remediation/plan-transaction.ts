import { existsSync, readdirSync } from 'node:fs';
import { readJsonSafely } from '../artifacts/json';
import { sha256 } from '../checkpoints/sprint-close';
import { assertSafeManagedPath } from '../pipeline/state-writer-lock';
import type { CheckResult, RemediationAnchor } from '../types';
import { isScopeRemediationSchemaVersion, validateScopeRemediation, type ScopeRemediation } from './protocol';
import {
  type RemediationTransactionStatus,
  remediationRecordPath,
  REMEDIATION_TRANSACTION_STATUS,
  formatIssues,
  stateDigest,
  remediationsDir,
  isAppliedRemediationStatus,
} from './plan-common';
import { readLiveStateOrNull, readAnchors, readRemediationRecord } from './plan-inputs';

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
export function inspectUnanchoredRemediationRecords(
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

export function remediationResult(name: string, status: RemediationTransactionStatus, detail: string): CheckResult {
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
