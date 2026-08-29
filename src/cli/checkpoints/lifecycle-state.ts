import { deriveScopeStatus } from '../core/status';
import { canonicalJson, sha256 } from './sprint-close';
import type { KyroScopeEntry, ScopeCompletion, ScopeReopenRecord, SprintFile } from '../types';

/**
 * The exact after-states that `kyro scope complete` and `kyro scope reopen` write.
 *
 * These builders are the single source of truth for both the writers and the checkpoint verifier.
 * A close checkpoint commits to the live state as it stood at close; an explicit completion or
 * reopen legitimately moves live state off that image. Doctor therefore does not trust the presence
 * of a lifecycle record — it *replays* the recorded transitions from the checkpoint's after-image
 * through these same functions and requires the result to reproduce the live state exactly. Any edit
 * a lifecycle transition could not have produced still reads as divergence.
 */

export const SCOPE_COMPLETION_KIND = 'scope-completion' as const;
export const SCOPE_COMPLETION_SCHEMA_VERSION = 1 as const;
export const SCOPE_REOPEN_KIND = 'scope-reopen' as const;
export const SCOPE_REOPEN_SCHEMA_VERSION = 1 as const;

/**
 * Request and registry digests live here, beside the builders, because the verifier needs the exact
 * same derivation the writers use. A digest recomputed by a second implementation would only prove
 * that two copies of the formula agree.
 */
export function scopeCompletionRequestDigest(scope: string, normalizedSummary: string | null): string {
  return sha256({
    kind: SCOPE_COMPLETION_KIND,
    schemaVersion: SCOPE_COMPLETION_SCHEMA_VERSION,
    part: 'request',
    scope,
    summary: normalizedSummary,
  });
}

export function scopeReopenRequestDigest(scope: string, reason: string, completion: ScopeCompletion): string {
  return sha256({
    kind: SCOPE_REOPEN_KIND,
    schemaVersion: SCOPE_REOPEN_SCHEMA_VERSION,
    part: 'request',
    scope,
    reason,
    completion,
  });
}

export function completionRegistryEntryDigest(entry: KyroScopeEntry): string {
  return sha256({
    kind: SCOPE_COMPLETION_KIND,
    schemaVersion: SCOPE_COMPLETION_SCHEMA_VERSION,
    part: 'registryEntry',
    entry,
  });
}

export function reopenRegistryEntryDigest(entry: KyroScopeEntry): string {
  return sha256({
    kind: SCOPE_REOPEN_KIND,
    schemaVersion: SCOPE_REOPEN_SCHEMA_VERSION,
    part: 'registryEntry',
    entry,
  });
}

export function completedSprintState(sprint: SprintFile, completion: ScopeCompletion): SprintFile {
  return {
    ...sprint,
    status: 'completed',
    completion,
    handoff: {
      ...sprint.handoff,
      nextAction: 'done',
      nextTaskId: null,
      blockers: [],
      note: completion.summary ? `Scope explicitly completed: ${completion.summary}` : 'Scope explicitly completed.',
      lastUpdated: completion.completedAt.slice(0, 10),
    },
  };
}

export function completedScopeEntry(entry: KyroScopeEntry, completion: ScopeCompletion): KyroScopeEntry {
  return { ...entry, status: 'completed', completion };
}

/** Reopen clears the live completion and preserves it in append-only history — it never erases it. */
export function reopenedSprintState(
  sprint: SprintFile,
  record: ScopeReopenRecord,
  completionHistory: ScopeReopenRecord[] = [...(sprint.completionHistory ?? []), record],
): SprintFile {
  const { completion: _superseded, ...rest } = sprint;
  return {
    ...rest,
    status: 'planning',
    completionHistory,
    handoff: {
      ...sprint.handoff,
      nextAction: 'plan_sprint',
      nextTaskId: null,
      blockers: [],
      note: `Scope reopened for further work: ${record.reason}`,
      lastUpdated: record.reopenedAt.slice(0, 10),
    },
  };
}

export function reopenedScopeEntry(
  entry: KyroScopeEntry,
  record: ScopeReopenRecord,
  sprint: SprintFile,
  completionHistory: ScopeReopenRecord[] = [...(entry.completionHistory ?? []), record],
): KyroScopeEntry {
  const { completion: _superseded, ...rest } = entry;
  return {
    ...rest,
    status: deriveScopeStatus(sprint, Boolean(sprint.activeSprint)),
    completionHistory,
  };
}

export const SCOPE_LIFECYCLE_VERIFICATION_STATUS = {
  CHECKPOINT_EXACT: 'checkpoint_exact',
  LIFECYCLE_REPLAYED: 'lifecycle_replayed',
  DIVERGED: 'diverged',
  UNSUPPORTED: 'unsupported',
} as const;
export type ScopeLifecycleVerificationStatus = (typeof SCOPE_LIFECYCLE_VERIFICATION_STATUS)[keyof typeof SCOPE_LIFECYCLE_VERIFICATION_STATUS];

export const SCOPE_LIFECYCLE_VERIFICATION_REASON = {
  CHECKPOINT_EXACT: 'checkpoint_exact',
  LIFECYCLE_REPLAYED: 'lifecycle_replayed',
  INVALID_INPUT: 'invalid_input',
  SCOPE_MISMATCH: 'scope_mismatch',
  HISTORY_PREFIX_MISMATCH: 'history_prefix_mismatch',
  NOTHING_TO_REPLAY: 'nothing_to_replay',
  COMPLETION_BINDING_MISMATCH: 'completion_binding_mismatch',
  REOPEN_BINDING_MISMATCH: 'reopen_binding_mismatch',
  ENTRY_BEFORE_BINDING_MISMATCH: 'entry_before_binding_mismatch',
  ILLEGAL_TRANSITION: 'illegal_transition',
  SPRINT_AFTER_MISMATCH: 'sprint_after_mismatch',
  REGISTRY_AFTER_MISMATCH: 'registry_after_mismatch',
} as const;
export type ScopeLifecycleVerificationReason = (typeof SCOPE_LIFECYCLE_VERIFICATION_REASON)[keyof typeof SCOPE_LIFECYCLE_VERIFICATION_REASON];

export const SCOPE_LIFECYCLE_ACTOR_ASSURANCE = {
  NOT_APPLICABLE: 'not_applicable',
  UNVERIFIED: 'unverified',
} as const;
export type ScopeLifecycleActorAssurance = (typeof SCOPE_LIFECYCLE_ACTOR_ASSURANCE)[keyof typeof SCOPE_LIFECYCLE_ACTOR_ASSURANCE];

/**
 * One atomic verdict over both durable lifecycle layers. Public hashes bind the claimed transition
 * to its content and prior registry state, but cannot authenticate which process or actor wrote it.
 */
export interface ScopeLifecycleVerification {
  status: ScopeLifecycleVerificationStatus;
  reason: ScopeLifecycleVerificationReason;
  sprint: SprintFile | null;
  entry: KyroScopeEntry | null;
  appliedOperations: number;
  actorAssurance: ScopeLifecycleActorAssurance;
}

/**
 * Rebuild the state a close checkpoint's after-image would reach by replaying exactly the lifecycle
 * transitions the live records claim *after* that image was sealed.
 *
 * Two properties make this a structural verification rather than a restatement of the records:
 *
 * 1. **Prefix exactness.** The checkpoint's own `completionHistory` is already materialized in its
 *    after-image, so only the suffix the live state adds may be replayed. Re-applying the sealed
 *    prefix would double every earlier completion/reopen and turn a lawful multi-cycle scope
 *    (complete → reopen → plan → close → complete) into a false `DIVERGED`. A live history that is
 *    not an exact extension of the sealed prefix is truncation or rewriting, and replaying it is
 *    refused outright.
 * 2. **Bound suffix.** Every replayed record must carry the public digests the writer normally
 *    records, and each must re-derive from the record's own content and prior registry state. Missing,
 *    stale, or misbound records fail closed. Because these values are public and deterministic, this
 *    proves consistency rather than writer or actor identity. Records already sealed in the immutable
 *    after-image are historical evidence and are not re-verified here.
 *
 * Sprint and registry are projected in lockstep and receive one verdict. Callers must not accept a
 * sprint-only replay and independently guess whether the registry transition was lawful.
 */
export function verifyScopeLifecycleEvolution(
  afterImage: unknown,
  afterEntry: KyroScopeEntry | null | undefined,
  live: unknown,
  liveEntry: KyroScopeEntry | null | undefined,
): ScopeLifecycleVerification {
  const image = afterImage as SprintFile | null | undefined;
  const liveSprint = live as SprintFile | null | undefined;
  if (!image || !afterEntry || !liveSprint || !liveEntry) {
    return lifecycleFailure(SCOPE_LIFECYCLE_VERIFICATION_STATUS.UNSUPPORTED, SCOPE_LIFECYCLE_VERIFICATION_REASON.INVALID_INPUT);
  }
  const scope = liveSprint.scope;
  if (
    typeof scope !== 'string'
    || scope === ''
    || image.scope !== scope
    || afterEntry.id !== scope
    || liveEntry.id !== scope
  ) {
    return lifecycleFailure(SCOPE_LIFECYCLE_VERIFICATION_STATUS.DIVERGED, SCOPE_LIFECYCLE_VERIFICATION_REASON.SCOPE_MISMATCH);
  }

  if (canonicalJson(image) === canonicalJson(liveSprint) && canonicalJson(afterEntry) === canonicalJson(liveEntry)) {
    return {
      status: SCOPE_LIFECYCLE_VERIFICATION_STATUS.CHECKPOINT_EXACT,
      reason: SCOPE_LIFECYCLE_VERIFICATION_REASON.CHECKPOINT_EXACT,
      sprint: image,
      entry: afterEntry,
      appliedOperations: 0,
      actorAssurance: SCOPE_LIFECYCLE_ACTOR_ASSURANCE.NOT_APPLICABLE,
    };
  }

  const sealedHistory = image.completionHistory ?? [];
  const liveHistory = liveSprint.completionHistory ?? [];
  const prefix = exactPrefixSuffix(sealedHistory, liveHistory);
  if (prefix === null) {
    return lifecycleFailure(SCOPE_LIFECYCLE_VERIFICATION_STATUS.DIVERGED, SCOPE_LIFECYCLE_VERIFICATION_REASON.HISTORY_PREFIX_MISMATCH);
  }
  const pendingHistory = prefix;

  // A live completion already present in the sealed image is not a post-checkpoint transition.
  const liveCompletion = liveSprint.completion;
  const completionIsSealed = liveCompletion !== undefined
    && image.completion !== undefined
    && canonicalJson(image.completion) === canonicalJson(liveCompletion);
  const pendingCompletion = completionIsSealed ? undefined : liveCompletion;
  if (pendingHistory.length === 0 && pendingCompletion === undefined) {
    return lifecycleFailure(SCOPE_LIFECYCLE_VERIFICATION_STATUS.DIVERGED, SCOPE_LIFECYCLE_VERIFICATION_REASON.NOTHING_TO_REPLAY);
  }

  const replay: LifecycleReplayState = {
    scope,
    sprint: image,
    entry: afterEntry,
    sprintHistory: [...sealedHistory],
    entryHistory: [...(afterEntry.completionHistory ?? [])],
    appliedOperations: 0,
  };
  for (const record of pendingHistory) {
    const completion = replay.sprint.completion === undefined ? applyLifecycleEvent(replay, { kind: 'complete', completion: record.completion }) : null;
    if (completion) return lifecycleFailure(SCOPE_LIFECYCLE_VERIFICATION_STATUS.DIVERGED, completion);
    const reopen = applyLifecycleEvent(replay, { kind: 'reopen', record });
    if (reopen) return lifecycleFailure(SCOPE_LIFECYCLE_VERIFICATION_STATUS.DIVERGED, reopen);
  }
  if (pendingCompletion !== undefined) {
    const completion = applyLifecycleEvent(replay, { kind: 'complete', completion: pendingCompletion });
    if (completion) return lifecycleFailure(SCOPE_LIFECYCLE_VERIFICATION_STATUS.DIVERGED, completion);
  }

  if (canonicalJson(replay.sprint) !== canonicalJson(liveSprint)) {
    return lifecycleFailure(SCOPE_LIFECYCLE_VERIFICATION_STATUS.DIVERGED, SCOPE_LIFECYCLE_VERIFICATION_REASON.SPRINT_AFTER_MISMATCH);
  }
  if (canonicalJson(replay.entry) !== canonicalJson(liveEntry)) {
    return lifecycleFailure(SCOPE_LIFECYCLE_VERIFICATION_STATUS.DIVERGED, SCOPE_LIFECYCLE_VERIFICATION_REASON.REGISTRY_AFTER_MISMATCH);
  }
  return {
    status: SCOPE_LIFECYCLE_VERIFICATION_STATUS.LIFECYCLE_REPLAYED,
    reason: SCOPE_LIFECYCLE_VERIFICATION_REASON.LIFECYCLE_REPLAYED,
    sprint: replay.sprint,
    entry: replay.entry,
    appliedOperations: replay.appliedOperations,
    actorAssurance: SCOPE_LIFECYCLE_ACTOR_ASSURANCE.UNVERIFIED,
  };
}

function lifecycleFailure(
  status: typeof SCOPE_LIFECYCLE_VERIFICATION_STATUS.DIVERGED | typeof SCOPE_LIFECYCLE_VERIFICATION_STATUS.UNSUPPORTED,
  reason: ScopeLifecycleVerificationReason,
): ScopeLifecycleVerification {
  return {
    status,
    reason,
    sprint: null,
    entry: null,
    appliedOperations: 0,
    actorAssurance: SCOPE_LIFECYCLE_ACTOR_ASSURANCE.UNVERIFIED,
  };
}

type LifecycleEvent =
  | { kind: 'complete'; completion: ScopeCompletion }
  | { kind: 'reopen'; record: ScopeReopenRecord };

interface LifecycleReplayState {
  scope: string;
  sprint: SprintFile;
  entry: KyroScopeEntry;
  sprintHistory: ScopeReopenRecord[];
  entryHistory: ScopeReopenRecord[];
  appliedOperations: number;
}

type LifecycleTransition = (state: LifecycleReplayState, event: LifecycleEvent) => ScopeLifecycleVerificationReason | null;

const LIFECYCLE_TRANSITIONS: Record<LifecycleEvent['kind'], LifecycleTransition> = {
  complete(state, event) {
    if (event.kind !== 'complete') return SCOPE_LIFECYCLE_VERIFICATION_REASON.ILLEGAL_TRANSITION;
    if (state.sprint.completion !== undefined) return SCOPE_LIFECYCLE_VERIFICATION_REASON.ILLEGAL_TRANSITION;
    if (!hasValidCompletionBinding(state.scope, event.completion)) return SCOPE_LIFECYCLE_VERIFICATION_REASON.COMPLETION_BINDING_MISMATCH;
    if (completionRegistryEntryDigest(state.entry) !== event.completion.beforeEntryDigest) return SCOPE_LIFECYCLE_VERIFICATION_REASON.ENTRY_BEFORE_BINDING_MISMATCH;
    state.sprint = completedSprintState(state.sprint, event.completion);
    state.entry = completedScopeEntry(state.entry, event.completion);
    state.appliedOperations += 1;
    return null;
  },
  reopen(state, event) {
    if (event.kind !== 'reopen') return SCOPE_LIFECYCLE_VERIFICATION_REASON.ILLEGAL_TRANSITION;
    if (!hasValidReopenBinding(state.scope, event.record)) return SCOPE_LIFECYCLE_VERIFICATION_REASON.REOPEN_BINDING_MISMATCH;
    if (
      state.sprint.completion === undefined
      || state.entry.completion === undefined
      || canonicalJson(state.sprint.completion) !== canonicalJson(event.record.completion)
      || canonicalJson(state.entry.completion) !== canonicalJson(event.record.completion)
    ) return SCOPE_LIFECYCLE_VERIFICATION_REASON.ILLEGAL_TRANSITION;
    if (reopenRegistryEntryDigest(state.entry) !== event.record.beforeEntryDigest) return SCOPE_LIFECYCLE_VERIFICATION_REASON.ENTRY_BEFORE_BINDING_MISMATCH;
    state.sprintHistory.push(event.record);
    state.entryHistory.push(event.record);
    state.sprint = reopenedSprintState(state.sprint, event.record, state.sprintHistory);
    state.entry = reopenedScopeEntry(state.entry, event.record, state.sprint, state.entryHistory);
    state.appliedOperations += 1;
    return null;
  },
};

function applyLifecycleEvent(state: LifecycleReplayState, event: LifecycleEvent): ScopeLifecycleVerificationReason | null {
  return LIFECYCLE_TRANSITIONS[event.kind](state, event);
}

/** Canonicalize the compared records once, then return only the unsealed suffix. */
function exactPrefixSuffix(sealed: ScopeReopenRecord[], live: ScopeReopenRecord[]): ScopeReopenRecord[] | null {
  if (sealed.length > live.length) return null;
  const sealedCanonical = sealed.map(canonicalJson);
  const liveCanonical = live.map(canonicalJson);
  for (let index = 0; index < sealedCanonical.length; index += 1) {
    if (sealedCanonical[index] !== liveCanonical[index]) return null;
  }
  return live.slice(sealed.length);
}

/**
 * A completion suffix must carry the public bindings the current writer records: the request digest
 * re-derives from its scope and summary, and a paired registry digest is available for replay.
 */
function hasValidCompletionBinding(scope: string, completion: ScopeCompletion): boolean {
  if (!completion.requestDigest || !completion.beforeEntryDigest) return false;
  const summary = completion.summary ?? null;
  return completion.requestDigest === scopeCompletionRequestDigest(scope, summary);
}

/** A reopen binding covers the scope, reason, and exact superseded completion. */
function hasValidReopenBinding(scope: string, record: ScopeReopenRecord): boolean {
  if (!record.requestDigest || !record.beforeEntryDigest) return false;
  if (!record.completion || typeof record.reason !== 'string' || record.reason === '') return false;
  return record.requestDigest === scopeReopenRequestDigest(scope, record.reason, record.completion);
}
