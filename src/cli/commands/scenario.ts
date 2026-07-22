import { applyPlan, printPlan } from '../fs';
import { readJsonSafely } from '../artifacts/json';
import { sprintJsonPath } from '../artifacts/paths';
import { asSprintFile, validateSprintFile } from '../artifacts/schema';
import { KyroCoreError } from '../core/errors';
import { resolveScope } from '../core/scope-resolution';
import { emitToolCommandRun } from '../core/trace';
import type { OperationPlan, SpecScenario, SprintFile, Task } from '../types';

/**
 * Tool-owned scenario graph mutations so agents never hand-edit sprint.json after plan
 * just to add S* rows or attach scenario_refs (post-mortem #2 F4).
 *
 *   kyro scenario add  --id S10 --requirement R9 --given ... --when ... --then ...
 *   kyro scenario link --task T2.6 --scenario S10
 */

export function runScenarioCommand(rawArgs: string[]): void {
  const sub = rawArgs[0];
  if (sub === undefined || sub === '--help' || sub === '-h' || sub === 'help') {
    printScenarioHelp();
    return;
  }
  if (sub === 'add') {
    runScenarioAdd(rawArgs.slice(1));
    return;
  }
  if (sub === 'link') {
    runScenarioLink(rawArgs.slice(1));
    return;
  }
  throw new KyroCoreError(
    'INVALID_INPUT',
    `Unknown scenario subcommand "${sub}".`,
    'Use: kyro scenario add | link. Run kyro scenario --help.',
  );
}

function runScenarioAdd(rawArgs: string[]): void {
  const args = parseScenarioAddArgs(rawArgs);
  if (args.help) {
    printScenarioHelp();
    return;
  }
  const scope = resolveScope(args.scope);
  const { sprint, plan, scenario } = buildScenarioAddPlan(scope, args);
  printPlan(`Add scenario ${scenario.id} to scope ${scope}`, plan);
  if (args.dryRun) {
    console.log('Dry run complete. No files changed.');
    return;
  }
  emitToolCommandRun(scope, 'cli', 'scenario add', { id: scenario.id });
  applyPlan(plan);
  revalidateWritten(scope, 'scenario add');
  console.log(`Scenario ${scenario.id} added (requirement ${scenario.requirement}). Spec now has ${sprint.spec?.scenarios.length ?? 0} scenario(s).`);
}

function runScenarioLink(rawArgs: string[]): void {
  const args = parseScenarioLinkArgs(rawArgs);
  if (args.help) {
    printScenarioHelp();
    return;
  }
  const scope = resolveScope(args.scope);
  const { plan, taskId, scenarioId } = buildScenarioLinkPlan(scope, args);
  printPlan(`Link task ${taskId} → scenario ${scenarioId} on scope ${scope}`, plan);
  if (args.dryRun) {
    console.log('Dry run complete. No files changed.');
    return;
  }
  emitToolCommandRun(scope, 'cli', 'scenario link', { task: taskId, scenario: scenarioId });
  applyPlan(plan);
  revalidateWritten(scope, 'scenario link');
  console.log(`Task ${taskId} now references scenario ${scenarioId}.`);
}

export interface ScenarioAddArgs {
  id: string;
  requirement: string;
  given: string;
  when: string;
  then: string;
  scope: string | null;
  dryRun: boolean;
  help: boolean;
}

export interface ScenarioLinkArgs {
  taskId: string;
  scenarioId: string;
  scope: string | null;
  dryRun: boolean;
  help: boolean;
}

export function buildScenarioAddPlan(
  scope: string,
  args: ScenarioAddArgs,
): { sprint: SprintFile; plan: OperationPlan[]; scenario: SpecScenario } {
  const sprint = loadValidSprint(scope);
  const id = args.id.trim();
  const requirement = args.requirement.trim();
  const given = args.given.trim();
  const when = args.when.trim();
  const then = args.then.trim();
  if (!id) throw new KyroCoreError('INVALID_INPUT', '--id is required and must be non-empty.', 'Pass --id S10 (or similar).');
  if (!requirement) throw new KyroCoreError('INVALID_INPUT', '--requirement is required.', 'Pass --requirement R1.');
  if (!given || !when || !then) {
    throw new KyroCoreError('INVALID_INPUT', '--given, --when, and --then are all required.', 'Pass Given/When/Then text for the scenario.');
  }
  if (!/^[A-Za-z][A-Za-z0-9_.-]*$/.test(id)) {
    throw new KyroCoreError('INVALID_INPUT', `Scenario id "${id}" is not a valid id.`, 'Use an id like S10 (letters, digits, _ . -).');
  }

  const spec = sprint.spec ?? { requirements: [], scenarios: [], nonGoals: [], openQuestions: [] };
  if (spec.scenarios.some((scenario) => scenario.id === id)) {
    throw new KyroCoreError('INVALID_INPUT', `Scenario id "${id}" already exists.`, 'Choose a new id or link the existing scenario with kyro scenario link.');
  }
  if (!spec.requirements.some((req) => req.id === requirement)) {
    throw new KyroCoreError(
      'INVALID_INPUT',
      `Requirement "${requirement}" does not exist in spec.requirements.`,
      'Add the requirement via plan --from (init) or pick an existing requirement id.',
    );
  }

  const scenario: SpecScenario = { id, requirement, given, when, then };
  const next: SprintFile = {
    ...sprint,
    spec: {
      ...spec,
      scenarios: [...spec.scenarios, scenario],
    },
  };
  const plan: OperationPlan[] = [{ action: 'write', path: sprintJsonPath(scope), content: `${JSON.stringify(next, null, 2)}\n` }];
  return { sprint: next, plan, scenario };
}

export function buildScenarioLinkPlan(
  scope: string,
  args: ScenarioLinkArgs,
): { sprint: SprintFile; plan: OperationPlan[]; taskId: string; scenarioId: string } {
  const sprint = loadValidSprint(scope);
  const taskId = args.taskId.trim();
  const scenarioId = args.scenarioId.trim();
  if (!taskId) throw new KyroCoreError('INVALID_INPUT', '--task is required.', 'Pass --task T1.1.');
  if (!scenarioId) throw new KyroCoreError('INVALID_INPUT', '--scenario is required.', 'Pass --scenario S1.');

  if (!sprint.activeSprint) {
    throw new KyroCoreError('NO_ACTIVE_SPRINT', `Scope "${scope}" has no active sprint.`, 'Plan a sprint first (kyro plan --from ...).');
  }

  const scenarioIds = new Set((sprint.spec?.scenarios ?? []).map((scenario) => scenario.id));
  if (!scenarioIds.has(scenarioId)) {
    throw new KyroCoreError(
      'INVALID_INPUT',
      `Scenario "${scenarioId}" does not exist in spec.scenarios.`,
      'Add it with kyro scenario add, or fix the id.',
    );
  }

  const located = findTask(sprint, taskId);
  if (!located) {
    throw new KyroCoreError('TASK_NOT_FOUND', `Task "${taskId}" not found in the active sprint.`, 'List tasks with kyro context-pack --json.');
  }

  const existing = located.task.scenario_refs ?? [];
  if (existing.includes(scenarioId)) {
    throw new KyroCoreError('INVALID_INPUT', `Task ${taskId} already references scenario ${scenarioId}.`, 'No write needed.');
  }

  const nextTask: Task = {
    ...located.task,
    scenario_refs: [...existing, scenarioId],
  };
  const next = replaceTask(sprint, taskId, nextTask);
  const plan: OperationPlan[] = [{ action: 'write', path: sprintJsonPath(scope), content: `${JSON.stringify(next, null, 2)}\n` }];
  return { sprint: next, plan, taskId, scenarioId };
}

function loadValidSprint(scope: string): SprintFile {
  const read = readJsonSafely(sprintJsonPath(scope));
  if (!read.exists) {
    throw new KyroCoreError('SCOPE_NOT_FOUND', `Scope "${scope}" has no sprint.json.`, 'Create the scope with kyro plan --from (init).');
  }
  if (read.error) {
    throw new KyroCoreError('INVALID_JSON', `sprint.json for "${scope}" is invalid JSON (${read.error}).`, 'Restore from an archive snapshot.');
  }
  const issues = validateSprintFile(read.value, `${scope}/sprint.json`);
  if (issues.length > 0) {
    const detail = issues.map((issue) => `${issue.field} ${issue.message}`).join('; ');
    throw new KyroCoreError('INVALID_SPRINT_SHAPE', `Cannot mutate scenarios for ${scope}: ${detail}`, 'Fix sprint.json shape first (kyro doctor --artifacts).');
  }
  const sprint = asSprintFile(read.value);
  if (!sprint) {
    throw new KyroCoreError('INVALID_SPRINT_SHAPE', `sprint.json for "${scope}" is not a valid v4 file.`, 'Run kyro doctor --artifacts.');
  }
  return sprint;
}

function revalidateWritten(scope: string, verb: string): void {
  const verify = readJsonSafely(sprintJsonPath(scope));
  if (verify.error || !verify.exists) {
    throw new KyroCoreError('INVALID_JSON', `${verb} wrote sprint.json but re-parse failed (${verify.error ?? 'missing'}).`, 'Restore from an archive snapshot.');
  }
  const issues = validateSprintFile(verify.value, `${scope}/sprint.json`);
  if (issues.length > 0) {
    const detail = issues.map((issue) => `${issue.field} ${issue.message}`).join('; ');
    throw new KyroCoreError('INVALID_SPRINT_SHAPE', `${verb} wrote sprint.json but it failed validation — ${detail}.`, 'Restore from an archive snapshot.');
  }
}

function findTask(sprint: SprintFile, taskId: string): { task: Task } | null {
  const active = sprint.activeSprint;
  if (!active) return null;
  for (const phase of active.phases ?? []) {
    for (const task of phase.tasks ?? []) {
      if (task.id === taskId) return { task };
    }
  }
  for (const task of active.emergentTasks ?? []) {
    if (task.id === taskId) return { task };
  }
  return null;
}

function replaceTask(sprint: SprintFile, taskId: string, nextTask: Task): SprintFile {
  const active = sprint.activeSprint!;
  const phases = active.phases.map((phase) => ({
    ...phase,
    tasks: phase.tasks.map((task) => (task.id === taskId ? nextTask : task)),
  }));
  const emergentTasks = (active.emergentTasks ?? []).map((task) => (task.id === taskId ? nextTask : task));
  return {
    ...sprint,
    activeSprint: {
      ...active,
      phases,
      emergentTasks,
    },
  };
}

function parseScenarioAddArgs(args: string[]): ScenarioAddArgs {
  const out: ScenarioAddArgs = {
    id: '',
    requirement: '',
    given: '',
    when: '',
    then: '',
    scope: null,
    dryRun: false,
    help: false,
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') out.help = true;
    else if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--id') out.id = requireValue(args, i++, '--id');
    else if (arg === '--requirement') out.requirement = requireValue(args, i++, '--requirement');
    else if (arg === '--given') out.given = requireValue(args, i++, '--given');
    else if (arg === '--when') out.when = requireValue(args, i++, '--when');
    else if (arg === '--then') out.then = requireValue(args, i++, '--then');
    else if (arg === '--kyro-scope') out.scope = requireValue(args, i++, '--kyro-scope');
    else throw new KyroCoreError('INVALID_INPUT', `Unknown flag for scenario add: ${arg}`, 'Run kyro scenario --help.');
  }
  return out;
}

function parseScenarioLinkArgs(args: string[]): ScenarioLinkArgs {
  const out: ScenarioLinkArgs = {
    taskId: '',
    scenarioId: '',
    scope: null,
    dryRun: false,
    help: false,
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') out.help = true;
    else if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--task') out.taskId = requireValue(args, i++, '--task');
    else if (arg === '--scenario') out.scenarioId = requireValue(args, i++, '--scenario');
    else if (arg === '--kyro-scope') out.scope = requireValue(args, i++, '--kyro-scope');
    else throw new KyroCoreError('INVALID_INPUT', `Unknown flag for scenario link: ${arg}`, 'Run kyro scenario --help.');
  }
  return out;
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new KyroCoreError('INVALID_INPUT', `${flag} requires a value.`, `Pass ${flag} <value>.`);
  }
  return value;
}

function printScenarioHelp(): void {
  console.log(`Usage:
  kyro scenario add --id <S#> --requirement <R#> --given <text> --when <text> --then <text> [--kyro-scope <scope>] [--dry-run]
  kyro scenario link --task <T#> --scenario <S#> [--kyro-scope <scope>] [--dry-run]

Tool-owned scenario graph writes (no hand-edit of sprint.json):
  add   Append a Given/When/Then scenario to spec.scenarios (requirement must already exist).
  link  Append a scenario id to an active-sprint task's scenario_refs.

Examples:
  kyro scenario add --id S10 --requirement R9 --given "A closed sprint" --when "analyze runs" --then "no MEDIUM noise" --kyro-scope club-configuration
  kyro scenario link --task T2.6 --scenario S10 --kyro-scope club-configuration
`);
}
