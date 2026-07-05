import { existsSync } from 'node:fs';
import { readJsonSafely } from '../artifacts/json';
import { scopeRoot, sprintJsonPath } from '../artifacts/paths';
import { asSprintFile } from '../artifacts/schema';
import { resolveRoute } from '../routing';
import { resolveManagedPath } from '../fs';
import { listScopeNames } from '../artifacts/scopes';
import { resolveScope as resolveKyroScope } from '../core/scope-resolution';
import { emitTraceEvent } from '../core/trace';
import { KyroCoreError } from '../core/errors';
import type { ActiveSprint, CliOptions, ContextPackMode, ContextPackOutput, PackVerbosity, SpecScenario, SprintFile, Task } from '../types';

export function contextPack(options: Pick<CliOptions, 'kyroScope' | 'task' | 'json' | 'verbosity'>): void {
  const scope = resolveKyroScope(options.kyroScope);
  if (!scopeExists(scope)) {
    throw new KyroCoreError('SCOPE_NOT_FOUND', `Scope not found: ${scope}.`, 'Run kyro scope list to see available scopes.');
  }
  const pack = buildContextPack(scope, options.task, options.verbosity);
  if (options.json) {
    console.log(JSON.stringify(pack, null, 2));
    return;
  }
  printContextPackText(pack);
}

export function buildContextPack(scope: string, taskOption: string | null = null, verbosity: PackVerbosity = 'detailed'): ContextPackOutput {
  const warnings: string[] = [];
  const read = readJsonSafely(sprintJsonPath(scope));
  if (!read.exists) {
    throw new KyroCoreError('SCOPE_NOT_FOUND', `Scope '${scope}' has no sprint.json.`, 'Run /kyro:forge (INIT) to create it.');
  }
  if (read.error) {
    throw new KyroCoreError('INVALID_JSON', `sprint.json for '${scope}' is invalid JSON: ${read.error}`, 'Fix invalid JSON or restore from an archive snapshot.');
  }
  const sprint = asSprintFile(read.value);
  if (!sprint) {
    throw new KyroCoreError('INVALID_SPRINT_SHAPE', `sprint.json for '${scope}' does not match the v4 schema.`, `Run kyro doctor --artifacts --kyro-scope ${scope}.`);
  }

  const packMode: ContextPackMode = resolvePackMode(taskOption, sprint, warnings);
  const task = packMode === 'task' ? resolveTask(sprint, taskOption, warnings) : null;

  const routing = resolveRoute(sprint.handoff.nextAction, packMode);
  emitTraceEvent({
    v: 1,
    ts: new Date().toISOString(),
    scope,
    type: 'route_selected',
    nextAction: sprint.handoff.nextAction,
    packMode,
    budgetClass: routing.budgetClass,
    reasoningTier: routing.reasoningTier,
  });
  const openDebtCount = sprint.debt.filter((d) => d.status === 'open' || d.status === 'in_progress').length;
  const concise = verbosity === 'concise';
  const conventions = selectConventions(sprint, packMode, task, concise);
  const taskScenarios = resolveTaskScenarios(sprint, task);

  // Concise trims long-form advisory prose (context, budget guidance) an agent does not need to
  // route/execute; the structured routing/task fields it acts on are always present. Detailed keeps
  // the full pack. Default is detailed so existing callers see no behavior change.
  const packWithoutTokens: Omit<ContextPackOutput, 'estimatedTokens'> = {
    schemaVersion: 4,
    packMode,
    verbosity,
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
    taskContext: concise ? null : (task?.context ?? null),
    taskAcceptanceCriteria: task?.acceptance_criteria ?? [],
    specRequirements: sprint.spec?.requirements ?? [],
    specNonGoals: sprint.spec?.nonGoals ?? [],
    specOpenQuestions: sprint.spec?.openQuestions ?? [],
    taskScenarios,
    handoffNote: sprint.handoff.note || null,
    blockers: sprint.handoff.blockers ?? [],
    conventions,
    warnings,
    routing: { modes: [...routing.modes] },
    budgetClass: routing.budgetClass,
    reasoningTier: routing.reasoningTier as ContextPackOutput['reasoningTier'],
    maxContextTokens: routing.maxContextTokens,
    budgetGuidance: concise ? '' : routing.budgetGuidance,
  };
  return { ...packWithoutTokens, estimatedTokens: estimatePackTokens(packWithoutTokens) };
}

function resolvePackMode(taskOption: string | null, sprint: SprintFile, warnings: string[]): ContextPackMode {
  if (taskOption === null) return 'scope';
  if (taskOption === '') {
    if (!sprint.activeSprint) throw new KyroCoreError('NO_ACTIVE_SPRINT', 'No active sprint.', 'Pass --task <id> explicitly or plan a sprint first.');
    if (!sprint.handoff.nextTaskId) throw new KyroCoreError('INVALID_INPUT', 'No next task in handoff.', 'Pass --task <id> explicitly.');
    warnings.push(`task id defaulted to handoff.nextTaskId: ${sprint.handoff.nextTaskId}`);
  }
  return 'task';
}

function resolveTask(sprint: SprintFile, taskOption: string | null, warnings: string[]): Task | null {
  const taskId = taskOption === '' || taskOption === null ? sprint.handoff.nextTaskId : taskOption;
  if (!taskId) throw new KyroCoreError('INVALID_INPUT', 'Task id is required for task packs.', 'Use --task <id>.');
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

function selectConventions(sprint: SprintFile, packMode: ContextPackMode, task: Task | null, concise: boolean): ContextPackOutput['conventions'] {
  // Task packs (and any concise pack) return only testing/architecture/process-tagged conventions;
  // detailed scope packs return all of them.
  const relevant = packMode === 'task' || concise
    ? sprint.conventions.filter((c) => c.tags.some((t) => ['testing', 'architecture', 'process'].includes(t)))
    : sprint.conventions;
  void task;
  return relevant.map((c) => ({ id: c.id, rule: c.rule, tags: c.tags }));
}

function resolveTaskScenarios(sprint: SprintFile, task: Task | null): SpecScenario[] {
  if (!task || !sprint.spec) return [];
  const scenarioById = new Map(sprint.spec.scenarios.map((scenario) => [scenario.id, scenario]));
  return (task.scenario_refs ?? []).map((id) => scenarioById.get(id)).filter((scenario): scenario is SpecScenario => Boolean(scenario));
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
    ...pack.specRequirements.map((requirement) => `${requirement.id} ${requirement.statement} ${requirement.rationale ?? ''}`),
    ...pack.specNonGoals, ...pack.specOpenQuestions,
    ...pack.taskScenarios.map((scenario) => `${scenario.id} ${scenario.given} ${scenario.when} ${scenario.then}`),
    ...pack.blockers, ...pack.conventions.map((c) => c.rule),
  ].filter(Boolean).join(' ');
  return Math.ceil(text.length / 4);
}

function printContextPackText(pack: ContextPackOutput): void {
  console.log(`Scope: ${pack.scope} (${pack.status})`);
  console.log(`Objective: ${pack.objective ?? '—'}`);
  console.log(`Next action: ${pack.nextAction ?? '—'}  Next task: ${pack.nextTaskId ?? '—'}`);
  if (pack.activeSprintSlug) console.log(`Active sprint: ${pack.activeSprintSlug} — ${pack.activeSprintObjective ?? ''}`);
  if (pack.specRequirements.length) console.log(`Requirements: ${pack.specRequirements.map((r) => `${r.id}: ${r.statement}`).join(' | ')}`);
  if (pack.specNonGoals.length) console.log(`Non-goals: ${pack.specNonGoals.join(' | ')}`);
  if (pack.specOpenQuestions.length) console.log(`Open questions: ${pack.specOpenQuestions.join(' | ')}`);
  console.log(`Open debt: ${pack.openDebtCount}`);
  if (pack.packMode === 'task' && pack.taskId) {
    console.log(`\nTask ${pack.taskId}: ${pack.taskTitle ?? ''}`);
    if (pack.taskDescription) console.log(`  ${pack.taskDescription}`);
    if (pack.taskFiles.length) console.log(`  Files: ${pack.taskFiles.join(', ')}`);
    if (pack.taskAcceptanceCriteria.length) console.log(`  Acceptance: ${pack.taskAcceptanceCriteria.join('; ')}`);
    if (pack.taskScenarios.length) console.log(`  Scenarios: ${pack.taskScenarios.map((s) => `${s.id}: Given ${s.given}; When ${s.when}; Then ${s.then}`).join(' | ')}`);
  }
  if (pack.handoffNote) console.log(`\nResume note: ${pack.handoffNote}`);
  if (pack.conventions.length) console.log(`Conventions: ${pack.conventions.map((c) => c.rule).join(' | ')}`);
  console.log(`\nBudget: ${pack.budgetClass} (${pack.reasoningTier}, ~${pack.estimatedTokens}/${pack.maxContextTokens} tokens)`);
  for (const w of pack.warnings) console.log(`! ${w}`);
}
