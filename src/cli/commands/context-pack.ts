import { existsSync } from 'node:fs';
import { readJsonSafely } from '../artifacts/json';
import { scopeRoot, sprintJsonPath } from '../artifacts/paths';
import { asSprintFile, asTaskVerdict } from '../artifacts/schema';
import { resolveRoute } from '../routing';
import { resolveManagedPath } from '../fs';
import { listScopeNames } from '../artifacts/scopes';
import { resolveScope as resolveKyroScope } from '../core/scope-resolution';
import { deriveScopeStatus } from '../core/status';
import { emitTraceEvent } from '../core/trace';
import { KyroCoreError } from '../core/errors';
import { collectCheckerFindings } from '../core/analysis';
import { getPersistedKyroInvocation } from '../invocation';
import { scopeFindingsToTask } from './review';
import { detectProjectStateBootstrapNeed, readProjectState } from '../state';
import { unregisteredScopeFolders } from '../core/scopes';
import type {
  ActiveSprint,
  AdrRecord,
  CliOptions,
  ContextPackCliRecipe,
  ContextPackMode,
  ContextPackOutput,
  NextTaskReview,
  PackVerbosity,
  SpecScenario,
  SprintFile,
  Task,
} from '../types';
import { resolveDelegationEnabled } from '../state';

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
  const projectState = readProjectState();
  const conventions = selectConventions(sprint, projectState?.conventions ?? [], packMode, task, concise);
  const adrs = selectAdrs(sprint, concise);
  const taskScenarios = resolveTaskScenarios(sprint, task);
  const { reviewPending, nextTaskReview } = resolveReviewDebt(sprint, task);
  // D7a: never create project state from context-pack; surface install remedy when layers missing.
  const bootstrapRemedy = detectProjectStateBootstrapNeed(unregisteredScopeFolders(projectState));
  if (bootstrapRemedy) warnings.push(bootstrapRemedy);
  const delegationEnabled = resolveDelegationEnabled();

  // Concise trims long-form advisory prose (context, budget guidance) an agent does not need to
  // route/execute; the structured routing/task fields it acts on are always present. Detailed keeps
  // the full pack. Default is detailed so existing callers see no behavior change.
  const packWithoutTokens: Omit<ContextPackOutput, 'estimatedTokens'> = {
    schemaVersion: 4,
    packMode,
    verbosity,
    scope,
    status: deriveScopeStatus(sprint, Boolean(sprint.activeSprint)),
    objective: sprint.objective,
    retirement: sprint.retirement ?? null,
    completion: sprint.completion ?? null,
    reopenHistory: (sprint.completionHistory ?? []).map((record) => ({
      reopenedAt: record.reopenedAt,
      completedAt: record.completion.completedAt,
      reason: record.reason,
    })),
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
    reviewPending,
    nextTaskReview,
    conventions,
    adrs,
    cliRecipes: buildCliRecipes(scope, sprint, task),
    warnings,
    routing: { modes: [...routing.modes] },
    budgetClass: routing.budgetClass,
    reasoningTier: routing.reasoningTier as ContextPackOutput['reasoningTier'],
    maxContextTokens: routing.maxContextTokens,
    budgetGuidance: concise ? '' : routing.budgetGuidance,
    delegationEnabled,
  };
  return { ...packWithoutTokens, estimatedTokens: estimatePackTokens(packWithoutTokens) };
}

/**
 * Copy-paste CLI recipes for the current handoff using the canonical agent entrypoint
 * (post-mortem #2 F1 / R6). Keeps progressive disclosure thin: recipes live on the pack,
 * not in re-inflated skill stubs.
 */
export function buildCliRecipes(scope: string, sprint: SprintFile, task: Task | null): ContextPackCliRecipe[] {
  const cli = getPersistedKyroInvocation();
  const scopeFlag = `--kyro-scope ${shellQuote(scope)}`;
  const recipes: ContextPackCliRecipe[] = [
    {
      id: 'status',
      purpose: 'Read routing signal (scope progress + nextAction)',
      command: `${cli} status ${scopeFlag}`,
    },
    {
      id: 'doctor-artifacts',
      purpose: 'Pre-flight integrity before writes',
      command: `${cli} doctor --artifacts ${scopeFlag}`,
    },
  ];

  const nextAction = sprint.handoff.nextAction;
  const taskId = task?.id ?? sprint.handoff.nextTaskId;

  switch (nextAction) {
    case 'execute_task':
      recipes.push({
        id: 'context-pack-task',
        purpose: 'Load lean task pack for the next execute_task',
        command: taskId
          ? `${cli} context-pack ${scopeFlag} --task ${shellQuote(taskId)} --json`
          : `${cli} context-pack ${scopeFlag} --json`,
      });
      recipes.push({
        id: 'record-evidence',
        purpose: 'Tool-owned maker evidence write after implementation (fill flags)',
        command: taskId
          ? `${cli} record-evidence ${shellQuote(taskId)} ${scopeFlag} --summary "..." --validation "..." --file <path>`
          : `${cli} record-evidence <taskId> ${scopeFlag} --summary "..." --validation "..."`,
      });
      break;
    case 'review_task':
      recipes.push({
        id: 'review',
        purpose: 'Tool-owned checker verdict for the task pending review',
        command: taskId
          ? `${cli} review ${shellQuote(taskId)} ${scopeFlag} --verdict pass --yes`
          : `${cli} review <taskId> ${scopeFlag} --verdict pass --yes`,
      });
      break;
    case 'close_sprint':
      recipes.push({
        id: 'close-sprint',
        purpose: 'Lossless close of the active sprint',
        command: `${cli} close-sprint ${scopeFlag} --outcome shipped --yes`,
      });
      break;
    case 'plan_sprint':
      recipes.push({
        id: 'plan-from',
        purpose: 'Materialize next sprint from a lean plan file',
        command: `${cli} plan --from <lean-sprint.json> ${scopeFlag}`,
      });
      break;
    case 'clarify':
      recipes.push({
        id: 'analyze',
        purpose: 'Surface remaining clarification/spec findings',
        command: `${cli} analyze ${scopeFlag}`,
      });
      break;
    case 'done':
      recipes.push({
        id: 'status-done',
        purpose: 'Confirm scope is terminal (no further forge modes)',
        command: `${cli} status ${scopeFlag}`,
      });
      break;
    default:
      recipes.push({
        id: 'analyze',
        purpose: 'Semantic cross-check of the scope',
        command: `${cli} analyze ${scopeFlag}`,
      });
  }

  return recipes;
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:@-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
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

function selectConventions(
  sprint: SprintFile,
  globalConventions: SprintFile['conventions'],
  packMode: ContextPackMode,
  task: Task | null,
  concise: boolean,
): ContextPackOutput['conventions'] {
  // Task packs (and any concise pack) return only testing/architecture/process-tagged conventions;
  // detailed scope packs return all of them.
  // Scope-local entries win when a global rule has the same id or normalized text.
  const seenIds = new Set<string>();
  const seenRules = new Set<string>();
  const merged = [...sprint.conventions, ...globalConventions].filter((convention) => {
    const normalizedRule = convention.rule.trim().replace(/\s+/g, ' ').toLowerCase();
    if (seenIds.has(convention.id) || seenRules.has(normalizedRule)) return false;
    seenIds.add(convention.id);
    seenRules.add(normalizedRule);
    return true;
  });
  const relevant = packMode === 'task' || concise
    ? merged.filter((c) => c.tags.some((t) => ['testing', 'architecture', 'process'].includes(t)))
    : merged;
  void task;
  return relevant.map((c) => ({ id: c.id, rule: c.rule, tags: c.tags }));
}

function selectAdrs(sprint: SprintFile, concise: boolean): ContextPackOutput['adrs'] {
  const records = sortAdrsByRecency(sprint.adrs ?? []);
  const selected = concise ? records.slice(0, 5) : records;
  return selected.map((adr) => ({
    id: adr.id,
    title: adr.title,
    status: adr.status,
    date: adr.date,
    context: adr.context,
    decision: adr.decision,
    consequences: adr.consequences,
    alternatives: adr.alternatives,
    links: adr.links,
  }));
}

function sortAdrsByRecency(adrs: AdrRecord[]): AdrRecord[] {
  return [...adrs].sort((left, right) => right.date.localeCompare(left.date) || right.id.localeCompare(left.id));
}

/**
 * Surface maker/checker debt on the read path the agent hits every turn: which done tasks still lack a
 * pass verdict, and — for a task pack — the checker findings scoped to that task. This is the same data
 * the checker already computes; exposing it here stops the agent from discovering N CRITICALs only at
 * close. Present in concise and detailed (it is routing-critical, not prose).
 */
function resolveReviewDebt(sprint: SprintFile, task: Task | null): { reviewPending: string[]; nextTaskReview: NextTaskReview | null } {
  const active = sprint.activeSprint;
  if (!active) return { reviewPending: [], nextTaskReview: null };
  const allTasks = active.phases.flatMap((phase) => phase.tasks).concat(active.emergentTasks);
  const hasPass = (t: Task): boolean => asTaskVerdict(t.verdict)?.result === 'pass';
  const reviewPending = allTasks.filter((t) => t.status === 'done' && !hasPass(t)).map((t) => t.id);

  if (!task) return { reviewPending, nextTaskReview: null };
  const principles = readProjectState()?.principles ?? [];
  const checkerFindings = scopeFindingsToTask(collectCheckerFindings(sprint, principles), task.id).map((f) => `[${f.severity}] ${f.detail}`);
  return {
    reviewPending,
    nextTaskReview: { taskId: task.id, status: task.status, hasPassVerdict: hasPass(task), checkerFindings },
  };
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
    ...pack.adrs.map((adr) => `${adr.id} ${adr.title} ${adr.status} ${adr.context} ${adr.decision} ${adr.consequences.join(' ')} ${adr.alternatives.join(' ')}`),
    ...pack.cliRecipes.map((recipe) => `${recipe.id} ${recipe.purpose} ${recipe.command}`),
  ].filter(Boolean).join(' ');
  return Math.ceil(text.length / 4);
}

function printContextPackText(pack: ContextPackOutput): void {
  console.log(`Scope: ${pack.scope} (${pack.status})`);
  console.log(`Objective: ${pack.objective ?? '—'}`);
  console.log(`Next action: ${pack.nextAction ?? '—'}  Next task: ${pack.nextTaskId ?? '—'}`);
  console.log(`Delegation: ${pack.delegationEnabled ? 'enabled' : 'disabled'}`);
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
  if (pack.reviewPending.length) console.log(`Awaiting review: ${pack.reviewPending.join(', ')} (${pack.reviewPending.length})`);
  if (pack.nextTaskReview && pack.nextTaskReview.checkerFindings.length) {
    console.log(`Checker (${pack.nextTaskReview.taskId}): ${pack.nextTaskReview.checkerFindings.join(' | ')}`);
  }
  if (pack.handoffNote) console.log(`\nResume note: ${pack.handoffNote}`);
  if (pack.conventions.length) console.log(`Conventions: ${pack.conventions.map((c) => c.rule).join(' | ')}`);
  if (pack.adrs.length) console.log(`ADRs: ${pack.adrs.map((adr) => `${adr.id} ${adr.title} (${adr.status})`).join(' | ')}`);
  if (pack.cliRecipes.length) {
    console.log('\nCLI recipes:');
    for (const recipe of pack.cliRecipes) {
      console.log(`- ${recipe.id}: ${recipe.command}`);
    }
  }
  console.log(`\nBudget: ${pack.budgetClass} (${pack.reasoningTier}, ~${pack.estimatedTokens}/${pack.maxContextTokens} tokens)`);
  for (const w of pack.warnings) console.log(`! ${w}`);
}
