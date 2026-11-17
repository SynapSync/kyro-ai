import { applyPlan, printPlan } from '../fs';
import { sprintJsonPath } from '../artifacts/paths';
import { loadScopeSprint, verifyWrittenSprint } from '../artifacts/load-sprint';
import { deriveActiveSprintStatus, nextExecutableTaskId } from '../core/status';
import { KyroCoreError } from '../core/errors';
import { dryRunFlag, helpFlag, option, parseFlags, takeUnlessDashed, type FlagSpec } from '../core/flags';
import { resolveScope } from '../core/scope-resolution';
import { emitToolCommandRun } from '../core/trace';
import type { ActiveSprint, OperationPlan, SprintFile, Task } from '../types';

export interface AddEmergentArgs {
  title: string;
  description: string;
  acceptance: string[];
  files: string[];
  context: string;
  dependsOn: string[];
  scope: string | null;
  dryRun: boolean;
  help: boolean;
}

export function runAddEmergentCommand(rawArgs: string[]): void {
  const args = parseAddEmergentArgs(rawArgs);
  if (args.help) {
    printAddEmergentHelp();
    return;
  }
  if (args.title.trim() === '') throw new KyroCoreError('INVALID_INPUT', 'Usage: kyro add-emergent --title <text> --description <text> --acceptance <text> [--acceptance <text> ...]', '--title is required.');
  if (args.description.trim() === '') throw new KyroCoreError('INVALID_INPUT', '--description is required and must be non-empty.', 'Describe the emergent work.');
  if (args.acceptance.length === 0) throw new KyroCoreError('INVALID_INPUT', '--acceptance is required (repeatable) — an emergent task needs at least one acceptance criterion.', 'Pass --acceptance "<criterion>" at least once.');

  const scope = resolveScope(args.scope);
  const { sprint, plan } = buildAddEmergentPlan(scope, args);
  const task = sprint.activeSprint!.emergentTasks[sprint.activeSprint!.emergentTasks.length - 1];
  printPlan(`Add emergent task ${task.id} to scope ${scope}`, plan);

  if (args.dryRun) {
    console.log('Dry run complete. No files changed.');
    return;
  }

  emitToolCommandRun(scope, 'cli', 'add-emergent', { id: task.id });
  applyPlan(plan);

  verifyWrittenSprint(scope, 'add-emergent');
  console.log(`Emergent task ${task.id} added to sprint ${sprint.activeSprint!.n}: "${task.title}" (status pending).`);
}

export function buildAddEmergentPlan(scope: string, args: AddEmergentArgs): { sprint: SprintFile; plan: OperationPlan[] } {
  const sprint = loadScopeSprint(scope, { strict: true, action: 'add emergent task for' });
  if (!sprint.activeSprint) throw new KyroCoreError('NO_ACTIVE_SPRINT', `Scope "${scope}" has no active sprint.`, 'Emergent tasks attach to the active sprint — plan a sprint first (kyro plan --from ...).');

  const allIds = collectAllTaskIds(sprint.activeSprint);
  for (const dep of args.dependsOn) {
    if (!allIds.has(dep)) throw new KyroCoreError('TASK_NOT_FOUND', `--depends-on references unknown task "${dep}".`, 'List task ids with kyro context-pack --json.');
  }

  const id = nextEmergentId(sprint.activeSprint, allIds);
  const task: Task = {
    id,
    title: args.title.trim(),
    description: args.description.trim(),
    files_to_touch: args.files,
    context: args.context,
    acceptance_criteria: args.acceptance,
    depends_on: args.dependsOn,
    scenario_refs: [],
    status: 'pending',
    evidence: null,
    verdict: null,
  };

  const nextSprint = withAddedEmergentTask(sprint, task);
  const plan: OperationPlan[] = [{ action: 'write', path: sprintJsonPath(scope), content: `${JSON.stringify(nextSprint, null, 2)}\n` }];
  return { sprint: nextSprint, plan };
}

function withAddedEmergentTask(sprint: SprintFile, task: Task): SprintFile {
  const active = sprint.activeSprint!;
  const nextActive = JSON.parse(JSON.stringify(active)) as typeof active;
  nextActive.emergentTasks.push(task);
  nextActive.status = deriveActiveSprintStatus(nextActive);
  return {
    ...sprint,
    activeSprint: nextActive,
    handoff: {
      ...sprint.handoff,
      nextAction: 'execute_task',
      nextTaskId: nextExecutableTaskId({ ...sprint, activeSprint: nextActive }),
      note: `Emergent task ${task.id} was added and routed to execution.`,
      lastUpdated: new Date().toISOString(),
    },
  };
}

function collectAllTaskIds(active: ActiveSprint): Set<string> {
  const ids = new Set<string>();
  for (const phase of active.phases) {
    for (const task of phase.tasks) ids.add(task.id);
  }
  for (const task of active.emergentTasks) ids.add(task.id);
  return ids;
}

function nextEmergentId(active: ActiveSprint, allIds: Set<string>): string {
  let max = 0;
  for (const task of active.emergentTasks) {
    const match = /^E(\d+)$/.exec(task.id);
    if (match) {
      const n = Number.parseInt(match[1], 10);
      if (n > max) max = n;
    }
  }
  let candidate = max + 1;
  while (allIds.has(`E${candidate}`)) candidate += 1;
  return `E${candidate}`;
}

const emergentValue = takeUnlessDashed((flagName) => new KyroCoreError('INVALID_INPUT', `${flagName} requires a value`));
const emergentOption = (name: string, apply: (args: AddEmergentArgs, value: string) => void): FlagSpec<AddEmergentArgs> => option([name], emergentValue, apply, true);

const ADD_EMERGENT_FLAGS: readonly FlagSpec<AddEmergentArgs>[] = [
  helpFlag(),
  dryRunFlag(),
  emergentOption('--kyro-scope', (a, v) => { a.scope = v; }),
  emergentOption('--title', (a, v) => { a.title = v; }),
  emergentOption('--description', (a, v) => { a.description = v; }),
  emergentOption('--acceptance', (a, v) => { a.acceptance.push(v); }),
  emergentOption('--file', (a, v) => { a.files.push(v); }),
  emergentOption('--context', (a, v) => { a.context = v; }),
  emergentOption('--depends-on', (a, v) => { a.dependsOn.push(v); }),
];

function parseAddEmergentArgs(rawArgs: string[]): AddEmergentArgs {
  const args: AddEmergentArgs = { title: '', description: '', acceptance: [], files: [], context: '', dependsOn: [], scope: null, dryRun: false, help: false };
  return parseFlags(ADD_EMERGENT_FLAGS, rawArgs, args, (arg) => {
    throw new KyroCoreError('INVALID_INPUT', `Unknown add-emergent option: ${arg}`);
  });
}

function printAddEmergentHelp(): void {
  console.log(`Usage: kyro add-emergent --title <text> --description <text> --acceptance <text> [--acceptance <text> ...] [--file <path> ...] [--context <text>] [--depends-on <id> ...] [--kyro-scope <scope>] [--dry-run]

Appends a new task to activeSprint.emergentTasks[] through the Kyro tool (no hand-edit of sprint.json), for required work discovered mid-sprint that blocks the sprint objective. The new task gets a fresh id (E1, E2, ...), status pending, evidence: null, verdict: null — record-evidence and review then operate on it like any other task. Requires an active sprint (NO_ACTIVE_SPRINT otherwise). Each --depends-on must reference an existing task id in the sprint (TASK_NOT_FOUND otherwise).`);
}
