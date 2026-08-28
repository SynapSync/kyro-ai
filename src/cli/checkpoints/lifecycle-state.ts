import { deriveScopeStatus } from '../core/status';
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
export function reopenedSprintState(sprint: SprintFile, record: ScopeReopenRecord): SprintFile {
  const { completion: _superseded, ...rest } = sprint;
  return {
    ...rest,
    status: 'planning',
    completionHistory: [...(sprint.completionHistory ?? []), record],
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

export function reopenedScopeEntry(entry: KyroScopeEntry, record: ScopeReopenRecord, sprint: SprintFile): KyroScopeEntry {
  const { completion: _superseded, ...rest } = entry;
  return {
    ...rest,
    status: deriveScopeStatus(sprint, Boolean(sprint.activeSprint)),
    completionHistory: [...(entry.completionHistory ?? []), record],
  };
}

/**
 * Rebuild the state a close checkpoint's after-image would reach by replaying exactly the lifecycle
 * transitions the live records claim: every superseded completion with the reopen that ended it, in
 * recorded order, then a live completion if the scope is completed again.
 *
 * Returns `null` when the live state claims no lifecycle transitions — there is then nothing to
 * replay and the caller's ordinary comparison stands.
 */
export function replayScopeLifecycle(afterImage: unknown, live: unknown): { sprint: SprintFile; entryOf: (entry: KyroScopeEntry) => KyroScopeEntry } | null {
  const image = afterImage as SprintFile | null | undefined;
  const liveSprint = live as SprintFile | null | undefined;
  if (!image || !liveSprint) return null;
  const history = liveSprint.completionHistory ?? [];
  const liveCompletion = liveSprint.completion;
  if (history.length === 0 && !liveCompletion) return null;

  let sprint = image;
  const entrySteps: Array<(entry: KyroScopeEntry) => KyroScopeEntry> = [];
  for (const record of history) {
    sprint = completedSprintState(sprint, record.completion);
    entrySteps.push((entry) => completedScopeEntry(entry, record.completion));
    sprint = reopenedSprintState(sprint, record);
    const reopenedSprintAfter = sprint;
    entrySteps.push((entry) => reopenedScopeEntry(entry, record, reopenedSprintAfter));
  }
  if (liveCompletion) {
    sprint = completedSprintState(sprint, liveCompletion);
    entrySteps.push((entry) => completedScopeEntry(entry, liveCompletion));
  }
  return {
    sprint,
    entryOf: (entry) => entrySteps.reduce((current, step) => step(current), entry),
  };
}
