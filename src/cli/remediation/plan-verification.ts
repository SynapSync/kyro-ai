import { readJsonSafely } from '../artifacts/json';
import { SCOPE_LIFECYCLE_VERIFICATION_STATUS, verifyScopeLifecycleEvolution } from '../checkpoints/lifecycle-state';
import { inspectScopeRetirement } from '../checkpoints/scope-retirement';
import { readProjectState } from '../state';
import type { CheckResult, ScopeVerification, SprintCloseCheckpointV1, SprintFile } from '../types';
import { resolveCertificationForChainHead } from './certification-plan';
import { readLiveStateOrNull, readAnchorsSafely, readRemediationRecord } from './plan-inputs';
import { latestValidCloseCheckpoint, latestValidCloseCheckpointEntry, listValidCloseCheckpoints } from './plan-checkpoints';
import { asRecord, REMEDIATION_TRANSACTION_STATUS } from './plan-common';
import {
  inspectUnanchoredRemediationRecords,
  inspectRemediationTransaction,
  remediationResult,
  chainContinuityIssue,
  evaluateUnanchoredRemediationRecords,
} from './plan-transaction';
import { usesBoundEvolution, resolveScopeEvolution, businessStateDigest, resolveRemediationRebase } from './plan-evolution';

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
  if (usesBoundEvolution(scope, state as unknown as SprintFile)) {
    const latest = latestValidCloseCheckpointEntry(scope);
    const checks = anchors.map((anchor) => {
      const transaction = inspectRemediationTransaction(scope, anchor.id, anchor.commitment, null, false);
      return remediationResult(`${scope}/remediation/${anchor.id}`, transaction.status, transaction.detail);
    });
    if (latest) {
      const physical = asRecord(readJsonSafely(latest.path).value)?.intendedAfterClose;
      const evolution = resolveScopeEvolution(scope, (physical ?? latest.checkpoint.intendedAfterClose) as SprintFile, latest.checkpoint.projectScopeAfter);
      if (evolution.kind === 'broken' || (!evolution.matchesLive && !isSupersededByActiveSprint(scope, state))) checks.push(remediationResult(`${scope}/remediations`, REMEDIATION_TRANSACTION_STATUS.DIVERGED, evolution.kind === 'broken' ? evolution.detail : 'unexplained post-close state'));
    } else {
      checks.push(...inspectUnanchoredRemediationRecords(scope, anchors));
    }
    return checks;
  }

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
  if (usesBoundEvolution(scope, live as unknown as SprintFile)) {
    const latest = latestValidCloseCheckpointEntry(scope)!;
    const physical = asRecord(readJsonSafely(latest.path).value)?.intendedAfterClose;
    const evolution = resolveScopeEvolution(scope, (physical ?? checkpoint.intendedAfterClose) as SprintFile, checkpoint.projectScopeAfter);
    if (evolution.kind === 'broken' || (!evolution.matchesLive && !isSupersededByActiveSprint(scope, live))) return { state: 'diverged', detail: evolution.kind === 'broken' ? evolution.detail : 'live state differs from the replayed evolution' };
    if (evolution.through) {
      const certification = resolveCertificationForHead(scope);
      return certification.kind === 'valid'
        ? { state: 'recertified', detail: `valid certification for chain head ${evolution.through}` }
        : { state: 'remediated', detail: `debt/remediation and lifecycle evolution replayed through ${evolution.through}; actor identity unverified` };
    }
    return { state: 'historical', detail: 'structurally replayed lifecycle evolution; actor identity unverified' };
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
  const physicalCheckpoint = physicalRead.exists && !physicalRead.error
    ? (physicalRead.value as { intendedAfterClose?: unknown; projectScopeAfter?: SprintCloseCheckpointV1['projectScopeAfter'] })
    : null;
  const physicalAfter = physicalCheckpoint?.intendedAfterClose ?? null;
  const liveEntry = readProjectState()?.scopes.find((entry) => entry.id === scope);
  // An explicit `scope complete` / `scope reopen` legitimately moves live state off the close
  // after-image. Like a remediation chain, the transition is replayed rather than trusted: the
  // recorded lifecycle records are re-applied to the after-image and only an exact reproduction of
  // the live business state is accepted, so drift a lifecycle transition could not produce still
  // reads as divergence.
  const acceptedAfterDigests = new Set<string>();
  // Tracked separately from the sealed after-image digests: reaching the after-image *because a
  // lifecycle transition was replayed* is a different fact than live state never having moved, and
  // reporting both as "matches the checkpoint after-image" contradicts Doctor, which labels the
  // replayed case as structural lifecycle evolution with unverified actor identity.
  const lifecycleAfterDigests = new Set<string>();
  const lifecycleCandidates = [
    { image: checkpoint.intendedAfterClose, entry: checkpoint.projectScopeAfter },
    { image: physicalAfter, entry: physicalCheckpoint?.projectScopeAfter },
  ];
  for (const candidate of lifecycleCandidates) {
    const image = candidate.image;
    if (image === null || image === undefined) continue;
    const digest = businessStateDigest(image);
    if (digest) acceptedAfterDigests.add(digest);
    const verification = verifyScopeLifecycleEvolution(image, candidate.entry, live, liveEntry);
    if (verification.status === SCOPE_LIFECYCLE_VERIFICATION_STATUS.LIFECYCLE_REPLAYED) {
      const replayedDigest = businessStateDigest(verification.sprint);
      if (replayedDigest) {
        acceptedAfterDigests.add(replayedDigest);
        lifecycleAfterDigests.add(replayedDigest);
      }
    }
  }
  const atAfterImage = liveBusiness !== null && acceptedAfterDigests.has(liveBusiness);
  // Only lifecycle when replay is the *reason* the states agree. An untouched after-image that also
  // happens to be replay-reachable stays historical.
  const atAfterImageViaLifecycle = liveBusiness !== null
    && lifecycleAfterDigests.has(liveBusiness)
    && !isSealedAfterImageDigest(liveBusiness, checkpoint.intendedAfterClose, physicalAfter);

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
    return atAfterImageViaLifecycle
      ? { state: 'historical', detail: 'live business state is structurally replayed from the checkpoint by explicit lifecycle transitions; actor identity unverified' }
      : { state: 'historical', detail: 'live business state matches the checkpoint after-image' };
  }
  return { state: 'diverged', detail: 'live state differs from the checkpoint after-image with no remediation chain to explain it' };
}

/** True when the digest is one of the sealed after-images themselves, replay aside. */
function isSealedAfterImageDigest(digest: string, intendedAfter: unknown, physicalAfter: unknown): boolean {
  for (const image of [intendedAfter, physicalAfter]) {
    if (image === null || image === undefined) continue;
    if (businessStateDigest(image) === digest) return true;
  }
  return false;
}
