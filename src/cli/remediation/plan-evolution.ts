import { readJsonSafely } from '../artifacts/json';
import { canonicalJson } from '../checkpoints/sprint-close';
import { resolveEffectiveCheckpoint } from '../checkpoints/effective';
import {
  SCOPE_LIFECYCLE_VERIFICATION_STATUS,
  verifyScopeLifecycleEvolution,
  completedSprintState,
  completedScopeEntry,
  reopenedSprintState,
  reopenedScopeEntry,
} from '../checkpoints/lifecycle-state';
import { readProjectState } from '../state';
import type { SprintFile, KyroScopeEntry, ScopeCompletion, ScopeReopenRecord } from '../types';
import { canonicalRemediationState } from './canonical-state';
import { SCOPE_REMEDIATION_SCHEMA_VERSION, type RemediationOperation, type ScopeRemediation } from './protocol';
import { REPLAY_WITNESS_VALIDATION_STATUS, validateReplayWitness } from './replay-witness';
import { asRecord, stateDigest, isAppliedRemediationStatus, nextRemediationId, REMEDIATION_TRANSACTION_STATUS } from './plan-common';
import {
  readRemediationRecord,
  readLiveState,
  verifyLedgerCheckpoints,
  readAnchorsSafely,
  collectCheckpointCommitments,
  readLiveStateOrNull,
} from './plan-inputs';
import { latestValidCloseCheckpoint } from './plan-checkpoints';
import { inspectRemediationTransaction, evaluateUnanchoredRemediationRecords } from './plan-transaction';
import { executeOperations } from './plan-execute';

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

export type ScopeEvolution =
  | { kind: 'broken'; detail: string }
  | { kind: 'verified'; state: SprintFile; entry: KyroScopeEntry; matchesLive: boolean; through: string | null };

export function usesBoundEvolution(scope: string, live: SprintFile): boolean {
  if (!live) return false;
  return Boolean(live.completion?.beforeStateDigest || live.completionHistory?.some((record) => record.beforeStateDigest)
    || live.remediations?.some((anchor) => (readRemediationRecord(scope, anchor.id)?.schemaVersion ?? 0) >= 5)
    || (live.remediations?.length && latestValidCloseCheckpoint(scope)?.intendedAfterClose.remediations?.length));
}

/**
 * Replay records at their own checkpoint boundary, then advance through ledger-ordered closes.
 * A validated close seals normal in-sprint work, not arbitrary replacement of prior history:
 * ledger entries, conventions and ADRs must survive unchanged, and debt IDs must still exist.
 * Only the final replayed after-image is compared with live state (except a later active sprint).
 */
export function resolveScopeEvolution(
  scope: string,
  image: SprintFile,
  imageEntry: KyroScopeEntry,
  live: SprintFile = readLiveState(scope) as unknown as SprintFile,
  liveEntry: KyroScopeEntry = readProjectState()!.scopes.find((item) => item.id === scope)!,
  allowPreparedDebtWrite = false,
): ScopeEvolution {
  return replayScopeEvolution(scope, image, imageEntry, live, liveEntry, allowPreparedDebtWrite, true);
}

function replayScopeEvolution(
  scope: string,
  image: SprintFile,
  imageEntry: KyroScopeEntry,
  live: SprintFile,
  liveEntry: KyroScopeEntry,
  allowPreparedDebtWrite: boolean,
  checkUnanchored: boolean,
): ScopeEvolution {
  const sealed = image.remediations ?? [];
  if (sealed.length) {
    const broken = (detail: string): ScopeEvolution => ({ kind: 'broken', detail });
    const first = readRemediationRecord(scope, sealed[0].id);
    const basePath = first?.base.checkpoints.at(-1)?.path;
    const start = image.ledger.findIndex((row) => row.checkpoint === basePath);
    if (!basePath || start < 0) return broken('sealed remediation has no bound checkpoint in the ledger');
    try {
      verifyLedgerCheckpoints(scope, image as unknown as Record<string, unknown>);
    } catch (error) {
      return broken(error instanceof Error ? error.message : String(error));
    }
    let previous: SprintFile | null = null;
    let previousEntry: KyroScopeEntry | null = null;
    for (const row of image.ledger.slice(start)) {
      const resolved = resolveEffectiveCheckpoint(scope, row);
      if (!resolved.checkpoint) return broken(`cannot resolve bound checkpoint ${row.checkpoint}`);
      const checkpoint = resolved.checkpoint;
      const physical = asRecord(readJsonSafely(resolved.path).value)?.intendedAfterClose as SprintFile | undefined;
      if (previous && previousEntry) {
        const replay = resolveScopeEvolutionFromImage(scope, previous, previousEntry, checkpoint.beforeClose, checkpoint.projectScopeBefore, false, false);
        if (replay.kind === 'broken') return replay;
        const historyIssue = preservedSprintHistoryIssue(replay.state, checkpoint.beforeClose);
        if (historyIssue) return broken(`${row.checkpoint}: ${historyIssue}`);
      } else if (checkpoint.intendedAfterClose.remediations?.length) {
        return broken('first remediation checkpoint already seals a remediation prefix');
      }
      previous = physical ?? checkpoint.intendedAfterClose;
      previousEntry = checkpoint.projectScopeAfter;
    }
    if (!previous || stateDigest(previous as unknown as Record<string, unknown>) !== stateDigest(image as unknown as Record<string, unknown>)
      || canonicalJson(previous.remediations ?? []) !== canonicalJson(sealed)) return broken('close boundary does not match the requested after-image');
  }
  return resolveScopeEvolutionFromImage(scope, image, imageEntry, live, liveEntry, allowPreparedDebtWrite, checkUnanchored);
}

function preservedSprintHistoryIssue(before: SprintFile, after: SprintFile): string | null {
  if (!before.ledger.every((row, index) => canonicalJson(row) === canonicalJson(after.ledger[index]))) return 'sprint close rewrites or removes prior ledger entries';
  for (const key of ['conventions', 'adrs'] as const) {
    if (!(before[key] ?? []).every((item) => (after[key] ?? []).some((candidate) => canonicalJson(candidate) === canonicalJson(item)))) return `sprint close rewrites or removes prior ${key}`;
  }
  // Public debt verbs only change lifecycle fields; identity/content and any other fields are
  // immutable. Escalation may raise priority, never lower it (reconcile requires typed replay).
  const mutableDebtKeys = new Set(['status', 'targetSprint', 'note', 'priority']);
  const immutableDebt = (item: object): string => canonicalJson(Object.fromEntries(Object.entries(item).filter(([key]) => !mutableDebtKeys.has(key))));
  const priorities = ['low', 'medium', 'high', 'critical'];
  for (const item of before.debt) {
    const candidate = after.debt.find((debt) => debt.id === item.id);
    if (!candidate) return 'sprint close removes prior debt';
    if (immutableDebt(item) !== immutableDebt(candidate)) return `sprint close rewrites prior debt ${item.id} content`;
    if (candidate.status !== item.status && !['open', 'in_progress', 'resolved', 'deferred'].includes(candidate.status)) return `sprint close rewrites prior debt ${item.id} status`;
    if (candidate.priority !== item.priority && (priorities.indexOf(item.priority) < 0
      || priorities.indexOf(candidate.priority) <= priorities.indexOf(item.priority))) return `sprint close rewrites prior debt ${item.id} priority (only escalation is allowed)`;
  }
  return null;
}

/** One digest-directed replay within a close boundary; historical prefixes use this same engine. */
function resolveScopeEvolutionFromImage(
  scope: string,
  image: SprintFile,
  imageEntry: KyroScopeEntry,
  live: SprintFile,
  liveEntry: KyroScopeEntry,
  allowPreparedDebtWrite = false,
  checkUnanchored = true,
): ScopeEvolution {
  const broken = (detail: string): ScopeEvolution => ({ kind: 'broken', detail });
  if (!liveEntry || image.scope !== scope || live.scope !== scope || imageEntry.id !== scope || liveEntry.id !== scope) return broken('scope evolution identity mismatch');
  const anchors = readAnchorsSafely(scope, live as unknown as Record<string, unknown>);
  if (!anchors) return broken('remediations[] is malformed');
  const sealed = image.remediations ?? [];
  const sealedHistory = image.completionHistory ?? [];
  const history = live.completionHistory ?? [];
  const prefix = <T>(before: T[], after: T[]): boolean => before.length <= after.length && before.every((item, index) => canonicalJson(item) === canonicalJson(after[index]));
  if (!prefix(sealed, anchors) || !prefix(sealedHistory, history)) return broken('sealed history was truncated or rewritten');
  const records: ScopeRemediation[] = [];
  let head: string | null = null;
  for (const anchor of anchors) {
    const check = inspectRemediationTransaction(scope, anchor.id, anchor.commitment, null, false);
    if (!isAppliedRemediationStatus(check.status)) return broken(`${anchor.id}: ${check.detail}`);
    const record = readRemediationRecord(scope, anchor.id);
    if (!record || record.base.remediationHead !== head) return broken(`${anchor.id}: remediation commitment chain is broken`);
    head = anchor.commitment;
    records.push(record);
  }
  const events: Array<{ completion: ScopeCompletion } | { reopen: ScopeReopenRecord }> = [];
  let previousCompletion = image.completion;
  for (const record of history.slice(sealedHistory.length)) {
    if (!previousCompletion) events.push({ completion: record.completion });
    else if (canonicalJson(previousCompletion) !== canonicalJson(record.completion)) return broken('reopen does not preserve the previous completion');
    events.push({ reopen: record });
    previousCompletion = undefined;
  }
  if (live.completion && canonicalJson(previousCompletion) !== canonicalJson(live.completion)) events.push({ completion: live.completion });
  let state = structuredClone(image);
  let entry = structuredClone(imageEntry);
  let ri = sealed.length;
  let ei = 0;
  const ledger = ledgerCommitmentMap(image as unknown as Record<string, unknown>);
  while (ri < records.length || ei < events.length) {
    const record = records[ri];
    if (record && record.base.stateSha256 === stateDigest(state as unknown as Record<string, unknown>)) {
      if (record.schemaVersion >= 5 && canonicalJson(record.base.checkpoints) !== canonicalJson(collectCheckpointCommitments(state as unknown as Record<string, unknown>))) return broken(`${record.id}: v5 checkpoint preconditions are missing or changed`);
      for (const commitment of record.base.checkpoints) if (ledger.get(commitment.path) !== commitment.commitment) return broken(`${record.id}: checkpoint commitment mismatch`);
      const next = replayOperations(state as unknown as Record<string, unknown>, record.operations);
      if (!next || stateDigest(next) !== record.result.stateSha256) return broken(`${record.id}: replay does not reproduce its result digest`);
      const advanced = advanceReplayState(record, next, ri === records.length - 1);
      if (!advanced) return broken(`${record.id}: replay witness is invalid`);
      state = { ...advanced, remediations: anchors.slice(0, ri + 1) } as unknown as SprintFile;
      ri += 1;
      continue;
    }
    const event = events[ei];
    if (event) {
      const binding = 'completion' in event ? event.completion.beforeStateDigest : event.reopen.beforeStateDigest;
      if (binding && binding !== stateDigest(state as unknown as Record<string, unknown>)) return broken('lifecycle before-state binding mismatch');
      const next = 'completion' in event ? completedSprintState(state, event.completion) : reopenedSprintState(state, event.reopen);
      const nextEntry = 'completion' in event ? completedScopeEntry(entry, event.completion) : reopenedScopeEntry(entry, event.reopen, next);
      const verification = verifyScopeLifecycleEvolution(state, entry, next, nextEntry);
      if (verification.status !== SCOPE_LIFECYCLE_VERIFICATION_STATUS.LIFECYCLE_REPLAYED) return broken(`lifecycle transition invalid: ${verification.reason}`);
      state = next;
      entry = nextEntry;
      ei += 1;
      continue;
    }
    // Preserve only the historical first-link compatibility allowance. New v5 records never skip preconditions.
    if (record && ri === 0 && record.schemaVersion < 5) {
      for (const commitment of record.base.checkpoints) if (ledger.get(commitment.path) !== commitment.commitment) return broken(`${record.id}: checkpoint commitment mismatch`);
      const next = replayOperations(state as unknown as Record<string, unknown>, record.operations, true);
      if (!next || stateDigest(next) !== record.result.stateSha256) return broken(`${record.id}: historical replay result mismatch`);
      const advanced = advanceReplayState(record, next, ri === records.length - 1);
      if (!advanced) return broken(`${record.id}: replay witness is invalid`);
      state = { ...advanced, remediations: anchors.slice(0, ri + 1) } as unknown as SprintFile;
      ri += 1;
      continue;
    }
    return broken(`${record?.id ?? 'evolution'}: before-state does not match the replayed state`);
  }
  const unanchored = checkUnanchored ? evaluateUnanchoredRemediationRecords(scope, anchors, head, stateDigest(state as unknown as Record<string, unknown>)) : [];
  for (const finding of unanchored) {
    // Writers may re-derive exactly one interrupted next record. The transaction still verifies
    // its entire commitment against that re-derived plan before anchoring anything.
    const candidate = readRemediationRecord(scope, finding.id);
    if (!allowPreparedDebtWrite || finding.id !== nextRemediationId(anchors) || finding.status !== REMEDIATION_TRANSACTION_STATUS.PREPARED || candidate?.schemaVersion !== 5 || candidate.operations.some((operation) => operation.kind !== 'debt.change')) return broken(`${finding.status}: ${finding.detail}`);
  }
  return { kind: 'verified', state, entry, matchesLive: stateDigest(state as unknown as Record<string, unknown>) === stateDigest(live as unknown as Record<string, unknown>) && canonicalJson(entry) === canonicalJson(liveEntry), through: anchors.at(-1)?.id ?? null };
}

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
  if (usesBoundEvolution(scope, live as unknown as SprintFile)) {
    const latest = latestValidCloseCheckpoint(scope);
    if (!latest) return { kind: 'broken', detail: 'no valid close checkpoint for scope evolution' };
    // Replay only anchored records here. An integrity warrant may be resuming a separately
    // published next record; Doctor still diagnoses that unanchored transaction independently.
    const evolution = replayScopeEvolution(scope, closed as unknown as SprintFile, latest.projectScopeAfter,
      live as unknown as SprintFile, readProjectState()!.scopes.find((entry) => entry.id === scope)!, false, false);
    if (evolution.kind === 'broken') return evolution;
    return { kind: 'remediated', state: canonicalRemediationState(evolution.state), headCommitment: anchors.at(-1)!.commitment, through: anchors.at(-1)!.id };
  }
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
    if (isFirst && record.schemaVersion < 5 && record.base.stateSha256 !== stateDigest(replayed)) {
      const next = replayOperations(replayed, record.operations, true);
      if (!next || record.result.stateSha256 !== stateDigest(next)) return { kind: 'broken', detail: `${anchor.id}: replay does not reproduce its result digest` };
      const advanced = advanceReplayState(record, next, isLast);
      if (!advanced) return { kind: 'broken', detail: `${anchor.id}: replay witness is invalid` };
      replayed = advanced;
    } else {
      // Normal replay: verify continuity for non-first records and execute operations with preconditions.
      if ((!isFirst || record.schemaVersion >= 5) && record.base.stateSha256 !== stateDigest(replayed)) return { kind: 'broken', detail: `${anchor.id}: base digest does not equal the previous result` };
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
