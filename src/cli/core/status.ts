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
 * Without one: all roadmap sprints closed → completed; else planning.
 */
export function deriveScopeStatus(sprint: SprintFile, hasActiveSprint: boolean): KyroScopeStatus {
  if (hasActiveSprint && sprint.activeSprint) {
    const tasks = collectSprintTasks(sprint.activeSprint);
    const blocked = tasks.some((t) => t.status === 'blocked') || (sprint.handoff.blockers ?? []).length > 0;
    return blocked ? 'blocked' : 'active';
  }
  const roadmapSprints = sprint.roadmap?.sprints ?? [];
  if (roadmapSprints.length > 0 && roadmapSprints.every((s) => s.state === 'closed')) return 'completed';
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

function collectSprintTasks(active: ActiveSprint): Task[] {
  const out: Task[] = [];
  for (const phase of active.phases ?? []) for (const task of phase.tasks ?? []) out.push(task);
  for (const task of active.emergentTasks ?? []) out.push(task);
  return out;
}
