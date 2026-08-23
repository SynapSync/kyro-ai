import type { ActiveSprint, Phase, SprintFile, Task } from '../types';
import type { KyroScopeStatus } from '../artifacts/schema';

/**
 * Pure lifecycle-status derivation. These functions compute the *truth* of a phase/sprint/scope from
 * the authoritative leaf — `task.status` — so display and analyze never depend on an authored status
 * field that the instruction layer forgot to update. No I/O, no mutation.
 */

export type DerivedPhaseStatus = 'pending' | 'active' | 'blocked' | 'done';
export type DerivedSprintStatus = 'planned' | 'executing' | 'complete';

/**
 * Precedence: no tasks → pending; any blocked → blocked; all done → done;
 * any in_progress or a mix of done/pending → active; otherwise (all pending) → pending.
 */
export function derivePhaseStatus(phase: Phase): DerivedPhaseStatus {
  const tasks = phase.tasks ?? [];
  if (tasks.length === 0) return 'pending';
  if (tasks.some((t) => t.status === 'blocked')) return 'blocked';
  if (tasks.every((t) => t.status === 'done')) return 'done';
  if (tasks.some((t) => t.status === 'in_progress' || t.status === 'done')) return 'active';
  return 'pending';
}

/** From all tasks in the sprint (phases + emergent): none → planned; all done → complete; else executing. */
export function deriveActiveSprintStatus(active: ActiveSprint): DerivedSprintStatus {
  const tasks = collectSprintTasks(active);
  if (tasks.length === 0) return 'planned';
  if (tasks.every((t) => t.status === 'done')) return 'complete';
  if (tasks.some((t) => t.status === 'done' || t.status === 'in_progress' || t.status === 'blocked')) return 'executing';
  return 'planned';
}

/**
 * With an active sprint: any blocked task OR non-empty handoff.blockers → blocked; else active.
 * Without one: `handoff.nextAction === 'done'` (historical completion or retirement companion)
 * → completed; else planning. Roadmap exhaustion is not completion.
 */
export function deriveScopeStatus(sprint: SprintFile, hasActiveSprint: boolean): KyroScopeStatus {
  if (sprint.retirement) return 'retired';
  if (hasActiveSprint && sprint.activeSprint) {
    const tasks = collectSprintTasks(sprint.activeSprint);
    const blocked = tasks.some((t) => t.status === 'blocked') || (sprint.handoff.blockers ?? []).length > 0;
    return blocked ? 'blocked' : 'active';
  }
  if (sprint.handoff?.nextAction === 'done') return 'completed';
  return 'planning';
}

/**
 * Map a stored phase.status onto the derived vocabulary so vocabulary drift is not read as real drift.
 * The codebase has historically written "executing" (and modes may write "in_progress"/"complete"); a
 * phase marked "executing" with mixed tasks is coherent with the derived "active". Only a genuine
 * mismatch (e.g. all tasks done but the phase is "executing" → "active" ≠ "done") remains flagged.
 */
export function normalizeStoredPhaseStatus(stored: string): DerivedPhaseStatus | string {
  switch (stored) {
    case 'executing':
    case 'in_progress':
      return 'active';
    case 'complete':
    case 'completed':
      return 'done';
    default:
      return stored;
  }
}

export function collectSprintTasks(active: ActiveSprint): Task[] {
  const out: Task[] = [];
  for (const phase of active.phases ?? []) for (const task of phase.tasks ?? []) out.push(task);
  for (const task of active.emergentTasks ?? []) out.push(task);
  return out;
}

/** Verified completion: done + pass, and never a disposition. */
export function isTaskVerifiedComplete(task: Task): boolean {
  return task.status === 'done' && task.verdict?.result === 'pass' && task.disposition === undefined;
}

/** Unfinished tasks that still lack a typed disposition — close must refuse these. */
export function undisposedCloseTasks(active: ActiveSprint): Task[] {
  return collectSprintTasks(active).filter((task) => !isTaskVerifiedComplete(task) && !task.disposition);
}

export function disposedCloseTasks(active: ActiveSprint): Task[] {
  return collectSprintTasks(active).filter((task) => Boolean(task.disposition));
}

/** Sprint-level close class. Callers still refuse undisposed tasks before persisting. */
export function deriveSprintCloseOutcomeClass(active: ActiveSprint): 'completed' | 'partial' {
  const tasks = collectSprintTasks(active);
  if (tasks.length === 0 || tasks.every((task) => isTaskVerifiedComplete(task))) return 'completed';
  return 'partial';
}

/**
 * Pure "next executable task" selector, shared by every routing writer so record-evidence and review
 * cannot drift apart. Returns the first task — in phase order then emergent order — that is pending
 * or in_progress and has no disposition. A disposed task is not executable regardless of its kind,
 * and a blocked task is neither pending nor in_progress, so it stays excluded as before. Returns
 * null when no executable task remains; closing semantics belong to the caller (never inferred here).
 */
export function nextExecutableTaskId(active: ActiveSprint, skipId?: string): string | null {
  const tasks = collectSprintTasks(active);
  const next = tasks.find((task) => (
    (skipId === undefined || task.id !== skipId)
    && !task.disposition
    && (task.status === 'pending' || task.status === 'in_progress')
  ));
  return next?.id ?? null;
}
