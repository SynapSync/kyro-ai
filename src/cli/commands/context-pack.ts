import { existsSync } from 'node:fs';
import { readJsonSafely } from '../artifacts/json';
import { scopeRoot, sprintJsonPath } from '../artifacts/paths';
import { asSprintFile } from '../artifacts/schema';
import { resolveBudgetRouting } from '../budget-manifest';
import { resolveManagedPath } from '../fs';
import { readProjectState } from '../state';
import { listScopeNames } from '../artifacts/scopes';
import type { ActiveSprint, CliOptions, ContextPackMode, ContextPackOutput, SprintFile, Task } from '../types';

export function contextPack(options: Pick<CliOptions, 'kyroScope' | 'task' | 'json'>): void {
  const scope = resolveScope(options.kyroScope);
  if (!scope) {
    throw new Error('No Kyro scope selected. Use --kyro-scope <scope> or set activeScope in kyro.json.');
  }
  if (!scopeExists(scope)) {
    throw new Error(`Scope not found: ${scope}. Run kyro scope list to see available scopes.`);
  }
  const pack = buildContextPack(scope, options.task);
  if (options.json) {
    console.log(JSON.stringify(pack, null, 2));
    return;
  }
  printContextPackText(pack);
}

export function buildContextPack(scope: string, taskOption: string | null = null): ContextPackOutput {
  const warnings: string[] = [];
  const read = readJsonSafely(sprintJsonPath(scope));
  if (!read.exists) {
    throw new Error(`Scope '${scope}' has no sprint.json. Run 'kyro migrate --kyro-scope ${scope}' to upgrade a v3 scope.`);
  }
  if (read.error) {
    throw new Error(`sprint.json for '${scope}' is invalid JSON: ${read.error}`);
  }
  const sprint = asSprintFile(read.value);
  if (!sprint) {
    throw new Error(`sprint.json for '${scope}' does not match the v4 schema. Run kyro doctor --artifacts --kyro-scope ${scope}.`);
  }

  const packMode: ContextPackMode = resolvePackMode(taskOption, sprint, warnings);
  const task = packMode === 'task' ? resolveTask(sprint, taskOption, warnings) : null;

  const budgetRouting = resolveBudgetRouting(packMode, sprint.handoff.nextAction);
  const openDebtCount = sprint.debt.filter((d) => d.status === 'open' || d.status === 'in_progress').length;
  const conventions = selectConventions(sprint, packMode, task);

  const packWithoutTokens: Omit<ContextPackOutput, 'estimatedTokens'> = {
    schemaVersion: 4,
    packMode,
    scope,
    status: sprint.status,
    objective: sprint.objective,
    nextAction: sprint.handoff.nextAction,
    nextTaskId: sprint.handoff.nextTaskId,
    activeSprintSlug: sprint.activeSprint?.slug ?? null,
    activeSprintObjective: sprint.activeSprint?.objective ?? null,
    openDebtCount,
    taskId: task?.id ?? null,
    taskTitle: task?.title ?? null,
    taskDescription: task?.description ?? null,
    taskFiles: task?.files_to_touch ?? [],
    taskContext: task?.context ?? null,
    taskAcceptanceCriteria: task?.acceptance_criteria ?? [],
    handoffNote: sprint.handoff.note || null,
    blockers: sprint.handoff.blockers ?? [],
    conventions,
    warnings,
    budgetClass: budgetRouting.budgetClass,
    reasoningTier: budgetRouting.reasoningTier as ContextPackOutput['reasoningTier'],
    maxContextTokens: budgetRouting.maxContextTokens,
    budgetGuidance: budgetRouting.budgetGuidance,
  };
  return { ...packWithoutTokens, estimatedTokens: estimatePackTokens(packWithoutTokens) };
}

function resolvePackMode(taskOption: string | null, sprint: SprintFile, warnings: string[]): ContextPackMode {
  if (taskOption === null) return 'scope';
  if (taskOption === '') {
    if (!sprint.activeSprint) throw new Error('No active sprint. Pass --task <id> explicitly or plan a sprint first.');
    if (!sprint.handoff.nextTaskId) throw new Error('No next task in handoff. Pass --task <id> explicitly.');
    warnings.push(`task id defaulted to handoff.nextTaskId: ${sprint.handoff.nextTaskId}`);
  }
  return 'task';
}

function resolveTask(sprint: SprintFile, taskOption: string | null, warnings: string[]): Task | null {
  const taskId = taskOption === '' || taskOption === null ? sprint.handoff.nextTaskId : taskOption;
  if (!taskId) throw new Error('Task id is required for task packs. Use --task <id>.');
  const task = findTask(sprint.activeSprint, taskId);
  if (!task) {
    warnings.push(`task ${taskId} not found in activeSprint; returning scope-level context`);
    return null;
  }
  return task;
}

function findTask(activeSprint: ActiveSprint | null, taskId: string): Task | null {
  if (!activeSprint) return null;
  for (const phase of activeSprint.phases) {
    const found = phase.tasks.find((t) => t.id === taskId);
    if (found) return found;
  }
  return activeSprint.emergentTasks.find((t) => t.id === taskId) ?? null;
}

function selectConventions(sprint: SprintFile, packMode: ContextPackMode, task: Task | null): ContextPackOutput['conventions'] {
  // Scope packs return all conventions; task packs return testing/architecture/process-tagged ones.
  const relevant = packMode === 'task'
    ? sprint.conventions.filter((c) => c.tags.some((t) => ['testing', 'architecture', 'process'].includes(t)))
    : sprint.conventions;
  void task;
  return relevant.map((c) => ({ id: c.id, rule: c.rule, tags: c.tags }));
}

function resolveScope(kyroScope: string | null): string | null {
  if (kyroScope) return kyroScope;
  return readProjectState()?.activeScope ?? null;
}

function scopeExists(scope: string): boolean {
  if (listScopeNames().includes(scope)) return true;
  return existsSync(resolveManagedPath(scopeRoot(scope)));
}

function estimatePackTokens(pack: Omit<ContextPackOutput, 'estimatedTokens'>): number {
  const text = [
    pack.scope, pack.status, pack.objective, pack.nextAction, pack.nextTaskId,
    pack.activeSprintSlug, pack.activeSprintObjective, pack.taskTitle, pack.taskDescription,
    pack.taskContext, pack.handoffNote, ...pack.taskFiles, ...pack.taskAcceptanceCriteria,
    ...pack.blockers, ...pack.conventions.map((c) => c.rule),
  ].filter(Boolean).join(' ');
  return Math.ceil(text.length / 4);
}

function printContextPackText(pack: ContextPackOutput): void {
  console.log(`Scope: ${pack.scope} (${pack.status})`);
  console.log(`Objective: ${pack.objective ?? '—'}`);
  console.log(`Next action: ${pack.nextAction ?? '—'}  Next task: ${pack.nextTaskId ?? '—'}`);
  if (pack.activeSprintSlug) console.log(`Active sprint: ${pack.activeSprintSlug} — ${pack.activeSprintObjective ?? ''}`);
  console.log(`Open debt: ${pack.openDebtCount}`);
  if (pack.packMode === 'task' && pack.taskId) {
    console.log(`\nTask ${pack.taskId}: ${pack.taskTitle ?? ''}`);
    if (pack.taskDescription) console.log(`  ${pack.taskDescription}`);
    if (pack.taskFiles.length) console.log(`  Files: ${pack.taskFiles.join(', ')}`);
    if (pack.taskAcceptanceCriteria.length) console.log(`  Acceptance: ${pack.taskAcceptanceCriteria.join('; ')}`);
  }
  if (pack.handoffNote) console.log(`\nResume note: ${pack.handoffNote}`);
  if (pack.conventions.length) console.log(`Conventions: ${pack.conventions.map((c) => c.rule).join(' | ')}`);
  console.log(`\nBudget: ${pack.budgetClass} (${pack.reasoningTier}, ~${pack.estimatedTokens}/${pack.maxContextTokens} tokens)`);
  for (const w of pack.warnings) console.log(`! ${w}`);
}
