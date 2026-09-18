import type { ActiveSprint, Handoff, HandoffBlocker, Phase, SprintFile, Task, TaskBlockReason, TaskExecutionInfo, TaskExecutionState } from '../types';
import type { KyroScopeStatus } from '../artifacts/schema';
import { hasStaleReview } from './review-material';

/**
 * Pure lifecycle-status derivation. These functions compute the *truth* of a phase/sprint/scope from
 * the authoritative leaf — `task.status` — so display and analyze never depend on an authored status
 * field that the instruction layer forgot to update. No I/O, no mutation.
 */

export type DerivedPhaseStatus = 'pending' | 'active' | 'blocked' | 'done';
export type DerivedSprintStatus = 'planned' | 'executing' | 'complete';
export type { TaskBlockReason, TaskExecutionInfo, TaskExecutionState } from '../types';

/** All active task records in deterministic phase/emergent order. */
export function collectSprintTasks(active: ActiveSprint): Task[] {
  const out: Task[] = [];
  for (const phase of active.phases ?? []) for (const task of phase.tasks ?? []) out.push(task);
  for (const task of active.emergentTasks ?? []) out.push(task);
  return out;
}

/** Verified completion: done + fresh pass, and never a disposition. */
export function isTaskVerifiedComplete(task: Task): boolean {
  return task.status === 'done' && task.verdict?.result === 'pass' && task.disposition === undefined;
}

function isFreshlyVerified(sprint: SprintFile, task: Task): boolean {
  return isTaskVerifiedComplete(task) && !hasStaleReview(sprint, task);
}

/**
 * Computes dependency readiness without changing task records. Blockage propagates only as a derived
 * read-model; siblings remain ready and a newly resolved prerequisite immediately unblocks descendants.
 */
export function taskExecutionInfo(sprint: SprintFile): TaskExecutionInfo[] {
  const active = sprint.activeSprint;
  if (!active) return [];
  const tasks = collectSprintTasks(active);
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const memo = new Map<string, TaskExecutionInfo>();
  const visiting = new Set<string>();

  const classify = (task: Task): TaskExecutionInfo => {
    const cached = memo.get(task.id);
    if (cached) return cached;
    // Schema/analysis own cycle reporting. Treat a malformed cycle as waiting so routing never runs it.
    if (visiting.has(task.id)) return { taskId: task.id, state: 'waiting_on_dependency', blockedByTaskIds: [], blockReason: null };
    visiting.add(task.id);
    let info: TaskExecutionInfo;
    if (task.disposition) {
      info = { taskId: task.id, state: 'disposed', blockedByTaskIds: [], blockReason: null };
    } else if (task.status === 'blocked') {
      info = { taskId: task.id, state: 'blocked', blockedByTaskIds: [task.id], blockReason: 'self_blocked' };
    } else if (task.status === 'done') {
      info = isFreshlyVerified(sprint, task)
        ? { taskId: task.id, state: 'verified', blockedByTaskIds: [], blockReason: null }
        : { taskId: task.id, state: 'awaiting_review', blockedByTaskIds: [], blockReason: null };
    } else {
      const blockedBy = new Set<string>();
      let terminalDependency = false;
      let waiting = false;
      for (const dependencyId of task.depends_on ?? []) {
        const dependency = byId.get(dependencyId);
        if (!dependency) { waiting = true; continue; }
        const dependencyInfo = classify(dependency);
        if (dependencyInfo.state === 'disposed') {
          blockedBy.add(dependencyId);
          terminalDependency = true;
        } else if (dependencyInfo.state === 'blocked') {
          for (const id of dependencyInfo.blockedByTaskIds) blockedBy.add(id);
        } else if (dependencyInfo.state !== 'verified') {
          waiting = true;
        }
      }
      if (blockedBy.size > 0) {
        info = { taskId: task.id, state: 'blocked', blockedByTaskIds: [...blockedBy].sort(), blockReason: terminalDependency ? 'terminal_dependency' : 'blocked_dependency' };
      } else if (waiting) {
        info = { taskId: task.id, state: 'waiting_on_dependency', blockedByTaskIds: [], blockReason: null };
      } else {
        info = { taskId: task.id, state: 'ready', blockedByTaskIds: [], blockReason: null };
      }
    }
    visiting.delete(task.id);
    memo.set(task.id, info);
    return info;
  };

  return tasks.map(classify);
}

/** First dependency-satisfied task in stable phase/emergent order. */
export function nextExecutableTaskId(sprint: SprintFile, skipId?: string): string | null {
  const states = new Map(taskExecutionInfo(sprint).map((info) => [info.taskId, info]));
  const next = sprint.activeSprint && collectSprintTasks(sprint.activeSprint).find((task) => (
    task.id !== skipId && states.get(task.id)?.state === 'ready'
  ));
  return next?.id ?? null;
}

export function reviewPendingTaskIds(sprint: SprintFile): string[] {
  return taskExecutionInfo(sprint).filter((info) => info.state === 'awaiting_review').map((info) => info.taskId);
}

/** One routing truth for writers and read models: an active sprint with no ready/review task is not executable. */
export function deriveLiveWorkHandoff(
  sprint: SprintFile,
  scope: string,
  recomputeExecutionRoute = false,
): Pick<Handoff, 'nextAction' | 'nextTaskId' | 'blockers'> {
  // Lifecycle transitions are authored state. Only an execute_task handoff is a
  // claim about current task readiness and therefore needs live correction.
  // Writers opt in after a task disposition/block changes execution truth.
  if (!recomputeExecutionRoute && sprint.handoff.nextAction !== 'execute_task') {
    return { nextAction: sprint.handoff.nextAction, nextTaskId: sprint.handoff.nextTaskId ?? null, blockers: sprint.handoff.blockers ?? [] };
  }

  const nextTaskId = nextExecutableTaskId(sprint);
  if (nextTaskId) return { nextAction: 'execute_task', nextTaskId, blockers: [] };
  const review = reviewPendingTaskIds(sprint)[0] ?? null;
  if (review) return { nextAction: 'review_task', nextTaskId: review, blockers: [] };

  // A fully verified sprint is no longer live work. Its completion lifecycle
  // must route through QA or close rather than advertising dead execution.
  const execution = taskExecutionInfo(sprint);
  if (execution.length > 0 && execution.every((info) => info.state === 'verified')) {
    return { nextAction: 'qa_or_close', nextTaskId: null, blockers: [] };
  }

  const blocker: HandoffBlocker = {
    code: 'no_ready_work', object: 'active_sprint',
    reason: 'No dependency-ready task remains in the active sprint.',
    remedyCommand: `node dist/cli.js plan --update-active --kyro-scope ${scope} --from <approved-input.json> --dry-run --json`,
  };
  return { nextAction: 'await_scope_completion', nextTaskId: null, blockers: [blocker] };
}

/**
 * With execution state supplied, a phase is active whenever it has a ready task or pending review;
 * otherwise a true dependency/self block is surfaced. The fallback preserves legacy call sites.
 */
export function derivePhaseStatus(phase: Phase, execution?: ReadonlyMap<string, TaskExecutionInfo>): DerivedPhaseStatus {
  const tasks = phase.tasks ?? [];
  if (tasks.length === 0) return 'pending';
  if (execution) {
    const states = tasks.map((task) => execution.get(task.id)?.state);
    if (states.every((state) => state === 'verified')) return 'done';
    if (states.some((state) => state === 'ready' || state === 'awaiting_review')) return 'active';
    if (states.some((state) => state === 'blocked' || state === 'waiting_on_dependency' || state === 'disposed')) return 'blocked';
    return 'pending';
  }
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
 * A scope is active whenever work can be executed or reviewed. It is blocked only when unfinished,
 * undisposed work remains but every route is blocked/waiting. Explicit handoff blockers remain a
 * human-authored scope-wide stop signal.
 */
export function deriveScopeStatus(sprint: SprintFile, hasActiveSprint: boolean): KyroScopeStatus {
  if (sprint.retirement) return 'retired';
  if (hasActiveSprint && sprint.activeSprint) {
    if ((sprint.handoff.blockers ?? []).length > 0) return 'blocked';
    const execution = taskExecutionInfo(sprint);
    if (execution.some((info) => info.state === 'ready' || info.state === 'awaiting_review')) return 'active';
    if (execution.some((info) => info.state === 'blocked' || info.state === 'waiting_on_dependency')) return 'blocked';
    return 'active';
  }
  if (sprint.completion || sprint.handoff?.nextAction === 'done') return 'completed';
  return 'planning';
}

/** Map stored status vocabulary onto the derived vocabulary for legacy coherence checks. */
export function normalizeStoredPhaseStatus(stored: string): DerivedPhaseStatus | string {
  switch (stored) {
    case 'executing':
    case 'in_progress': return 'active';
    case 'complete':
    case 'completed': return 'done';
    default: return stored;
  }
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
