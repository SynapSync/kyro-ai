import { applyPlan, printPlan } from '../fs';
import { readJsonSafely } from '../artifacts/json';
import { sprintJsonPath } from '../artifacts/paths';
import { asSprintFile, validateSprintFile } from '../artifacts/schema';
import { deriveActiveSprintStatus } from '../core/status';
import { KyroCoreError } from '../core/errors';
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

  const verify = readJsonSafely(sprintJsonPath(scope));
  if (verify.error || !verify.exists) throw new KyroCoreError('INVALID_JSON', `add-emergent wrote sprint.json but re-parse failed (${verify.error ?? 'missing'}).`, 'Restore from an archive snapshot.');
  const issues = validateSprintFile(verify.value, `${scope}/sprint.json`);
  if (issues.length > 0) {
    const detail = issues.map((issue) => `${issue.field} ${issue.message}`).join('; ');
    throw new KyroCoreError('INVALID_SPRINT_SHAPE', `add-emergent wrote sprint.json but it failed validation — ${detail}.`, 'Restore from an archive snapshot.');
  }
  console.log(`Emergent task ${task.id} added to sprint ${sprint.activeSprint!.n}: "${task.title}" (status pending).`);
}

export function buildAddEmergentPlan(scope: string, args: AddEmergentArgs): { sprint: SprintFile; plan: OperationPlan[] } {
  const read = readJsonSafely(sprintJsonPath(scope));
  if (!read.exists) throw new KyroCoreError('SCOPE_NOT_FOUND', `Scope "${scope}" has no sprint.json.`, 'Create the scope with /kyro:forge (INIT) or choose another scope.');
  if (read.error) throw new KyroCoreError('INVALID_JSON', `sprint.json for "${scope}" is invalid JSON (${read.error}).`, 'Fix invalid JSON or restore from an archive snapshot.');
  const issues = validateSprintFile(read.value, `${scope}/sprint.json`);
  if (issues.length > 0) {
    const detail = issues.map((issue) => `${issue.field} ${issue.message}`).join('; ');
    throw new KyroCoreError('INVALID_SPRINT_SHAPE', `Cannot add emergent task for ${scope}: sprint.json has shape drift — ${detail}.`, 'Fix sprint.json shape first.');
  }
  const sprint = asSprintFile(read.value);
  if (!sprint || !sprint.activeSprint) throw new KyroCoreError('NO_ACTIVE_SPRINT', `Scope "${scope}" has no active sprint.`, 'Emergent tasks attach to the active sprint — plan a sprint first (kyro plan --from ...).');

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
  return { ...sprint, activeSprint: nextActive };
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

function parseAddEmergentArgs(rawArgs: string[]): AddEmergentArgs {
  let title = '';
  let description = '';
  const acceptance: string[] = [];
  const files: string[] = [];
  let context = '';
  const dependsOn: string[] = [];
  let scope: string | null = null;
  let dryRun = false;
  let help = false;
  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    if (arg === '--help' || arg === '-h') help = true;
    else if (arg === '--dry-run') dryRun = true;
    else if (arg === '--kyro-scope') { scope = requireValue(rawArgs, i, arg); i += 1; }
    else if (arg.startsWith('--kyro-scope=')) scope = arg.slice('--kyro-scope='.length);
    else if (arg === '--title') { title = requireValue(rawArgs, i, arg); i += 1; }
    else if (arg.startsWith('--title=')) title = arg.slice('--title='.length);
    else if (arg === '--description') { description = requireValue(rawArgs, i, arg); i += 1; }
    else if (arg.startsWith('--description=')) description = arg.slice('--description='.length);
    else if (arg === '--acceptance') { acceptance.push(requireValue(rawArgs, i, arg)); i += 1; }
    else if (arg.startsWith('--acceptance=')) acceptance.push(arg.slice('--acceptance='.length));
    else if (arg === '--file') { files.push(requireValue(rawArgs, i, arg)); i += 1; }
    else if (arg.startsWith('--file=')) files.push(arg.slice('--file='.length));
    else if (arg === '--context') { context = requireValue(rawArgs, i, arg); i += 1; }
    else if (arg.startsWith('--context=')) context = arg.slice('--context='.length);
    else if (arg === '--depends-on') { dependsOn.push(requireValue(rawArgs, i, arg)); i += 1; }
    else if (arg.startsWith('--depends-on=')) dependsOn.push(arg.slice('--depends-on='.length));
    else throw new KyroCoreError('INVALID_INPUT', `Unknown add-emergent option: ${arg}`);
  }
  return { title, description, acceptance, files, context, dependsOn, scope, dryRun, help };
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) throw new KyroCoreError('INVALID_INPUT', `${flag} requires a value`);
  return value;
}

function printAddEmergentHelp(): void {
  console.log(`Usage: kyro add-emergent --title <text> --description <text> --acceptance <text> [--acceptance <text> ...] [--file <path> ...] [--context <text>] [--depends-on <id> ...] [--kyro-scope <scope>] [--dry-run]

Appends a new task to activeSprint.emergentTasks[] through the Kyro tool (no hand-edit of sprint.json), for required work discovered mid-sprint that blocks the sprint objective. The new task gets a fresh id (E1, E2, ...), status pending, evidence: null, verdict: null — record-evidence and review then operate on it like any other task. Requires an active sprint (NO_ACTIVE_SPRINT otherwise). Each --depends-on must reference an existing task id in the sprint (TASK_NOT_FOUND otherwise).`);
}
