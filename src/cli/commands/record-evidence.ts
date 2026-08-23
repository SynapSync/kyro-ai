import { applyPlan, printPlan } from '../fs';
import { readJsonSafely } from '../artifacts/json';
import { sprintJsonPath } from '../artifacts/paths';
import { asSprintFile, validateSprintFile } from '../artifacts/schema';
import { deriveActiveSprintStatus, derivePhaseStatus } from '../core/status';
import { KyroCoreError } from '../core/errors';
import { countClarificationMarkers } from '../core/analysis';
import { resolveScope } from '../core/scope-resolution';
import { emitToolCommandRun } from '../core/trace';
import {
  TASK_DISPOSITION_KIND,
  TASK_DISPOSITION_TARGET_KIND,
  type OperationPlan,
  type SprintFile,
  type Task,
  type TaskDisposition,
  type TaskDispositionKind,
  type TaskDispositionTarget,
  type TaskEvidence,
} from '../types';

type RecordedStatus = 'done' | 'blocked';

export interface RecordEvidenceArgs {
  taskId: string;
  scope: string | null;
  summary: string;
  validation: string[];
  files: string[];
  notes: string | null;
  by: string;
  status: RecordedStatus;
  statusExplicit: boolean;
  dispositionKind: TaskDispositionKind | null;
  reason: string | null;
  targetRaw: string | null;
  dryRun: boolean;
  help: boolean;
}

interface LocatedTask {
  task: Task;
  kind: 'phase' | 'emergent';
  phaseIndex?: number;
  taskIndex: number;
}

export function runRecordEvidenceCommand(rawArgs: string[]): void {
  const args = parseRecordEvidenceArgs(rawArgs);
  if (args.help) {
    printRecordEvidenceHelp();
    return;
  }
  if (!args.taskId) throw new KyroCoreError('INVALID_INPUT', 'Usage: kyro record-evidence <task> --summary <text> --validation <text> [--file <path>]', 'Pass the executed task id.');
  if (args.summary.trim() === '') throw new KyroCoreError('INVALID_INPUT', '--summary is required and must be non-empty.', 'Describe what the task did.');
  if (args.validation.length === 0) throw new KyroCoreError('INVALID_INPUT', '--validation is required (repeatable).', 'Record the check(s) that prove the task, e.g. --validation "npm test -- demo".');

  const scope = resolveScope(args.scope);
  const { sprint, plan } = buildRecordEvidencePlan(scope, args);
  const label = args.dispositionKind ? `disposition ${args.dispositionKind}` : args.status;
  printPlan(`Record evidence for task ${args.taskId} (${label})`, plan);

  if (args.dryRun) {
    console.log('Dry run complete. No files changed.');
    return;
  }

  emitToolCommandRun(scope, 'cli', 'record-evidence', {
    task: args.taskId,
    status: args.status,
    ...(args.dispositionKind ? { disposition: args.dispositionKind } : {}),
  });
  applyPlan(plan);

  const verify = readJsonSafely(sprintJsonPath(scope));
  if (verify.error || !verify.exists) throw new KyroCoreError('INVALID_JSON', `record-evidence wrote sprint.json but re-parse failed (${verify.error ?? 'missing'}).`, 'Restore from an archive snapshot.');
  const issues = validateSprintFile(verify.value, `${scope}/sprint.json`);
  if (issues.length > 0) {
    const detail = issues.map((issue) => `${issue.field} ${issue.message}`).join('; ');
    throw new KyroCoreError('INVALID_SPRINT_SHAPE', `record-evidence wrote sprint.json but it failed validation — ${detail}.`, 'Restore from an archive snapshot.');
  }
  const located = locateTask(sprint, args.taskId);
  const recordedStatus = located?.task.status ?? args.status;
  console.log(`Evidence recorded for task ${args.taskId} (${args.dispositionKind ? `disposition ${args.dispositionKind}` : recordedStatus}). Next action: ${sprint.handoff.nextAction}.`);
}

export function buildRecordEvidencePlan(scope: string, args: RecordEvidenceArgs): { sprint: SprintFile; plan: OperationPlan[] } {
  const read = readJsonSafely(sprintJsonPath(scope));
  if (!read.exists) throw new KyroCoreError('SCOPE_NOT_FOUND', `Scope "${scope}" has no sprint.json.`, 'Create the scope with /kyro:forge (INIT) or choose another scope.');
  if (read.error) throw new KyroCoreError('INVALID_JSON', `sprint.json for "${scope}" is invalid JSON (${read.error}).`, 'Fix invalid JSON or restore from an archive snapshot.');
  const issues = validateSprintFile(read.value, `${scope}/sprint.json`);
  if (issues.length > 0) {
    const detail = issues.map((issue) => `${issue.field} ${issue.message}`).join('; ');
    throw new KyroCoreError('INVALID_SPRINT_SHAPE', `Cannot record evidence for ${scope}: sprint.json has shape drift — ${detail}.`, 'Fix sprint.json shape first.');
  }
  const sprint = asSprintFile(read.value);
  if (!sprint || !sprint.activeSprint) throw new KyroCoreError('NO_ACTIVE_SPRINT', `Scope "${scope}" has no active sprint.`);
  const located = locateTask(sprint, args.taskId);
  if (!located) throw new KyroCoreError('TASK_NOT_FOUND', `Task not found: ${args.taskId}`, 'Run kyro context-pack --json to inspect the active sprint tasks.');
  const markers = countClarificationMarkers(sprint);
  if (markers > 0) {
    throw new KyroCoreError(
      'CLARIFICATION_REQUIRED',
      `Cannot record evidence: sprint.json has ${markers} unresolved [NEEDS CLARIFICATION] marker(s).`,
      'Resolve them in the clarify mode (set handoff.nextAction to "clarify", answer each marker, remove it) before executing — do not guess.',
    );
  }

  const recordedAt = new Date().toISOString();
  const evidence: TaskEvidence = {
    summary: args.summary.trim(),
    validation: args.validation.length === 1 ? args.validation[0] : args.validation,
    files_changed: args.files,
    ...(args.notes && args.notes.trim() !== '' ? { notes: args.notes.trim() } : {}),
    by: args.by,
    recordedAt,
  };
  const disposition = args.dispositionKind
    ? buildDisposition(sprint, located, args, recordedAt)
    : undefined;
  const status = resolveRecordedStatus(located, args, disposition);
  const nextSprint = withRecordedEvidence(sprint, located, evidence, status, recordedAt, disposition);
  const plan: OperationPlan[] = [{ action: 'write', path: sprintJsonPath(scope), content: `${JSON.stringify(nextSprint, null, 2)}\n` }];
  return { sprint: nextSprint, plan };
}

function buildDisposition(
  sprint: SprintFile,
  located: LocatedTask,
  args: RecordEvidenceArgs,
  recordedAt: string,
): TaskDisposition {
  const kind = args.dispositionKind!;
  if (!args.reason || args.reason.trim() === '') {
    throw new KyroCoreError('INVALID_INPUT', '--reason is required and must be non-empty when --disposition is set.', 'Explain why the work is deferred, blocked, superseded, or cancelled.');
  }
  if (args.statusExplicit && args.status === 'done') {
    throw new KyroCoreError('INVALID_INPUT', '--status done cannot be combined with --disposition.', 'A disposition is not verified completion. Omit --status, or use --status blocked.');
  }
  if (located.task.status === 'done') {
    throw new KyroCoreError('INVALID_INPUT', `Task ${located.task.id} is already done and cannot take a disposition.`, 'Dispositions explain unfinished work. A completed task stays done+reviewed.');
  }
  if (located.task.verdict?.result === 'pass') {
    throw new KyroCoreError('INVALID_INPUT', `Task ${located.task.id} already has a pass verdict and cannot take a disposition.`, 'A pass is verified completion. Do not dispose a passed task.');
  }
  const target = args.targetRaw === null ? undefined : parseDispositionTarget(args.targetRaw);
  assertDispositionTarget(sprint, located.task.id, kind, target);
  return {
    kind,
    reason: args.reason.trim(),
    by: args.by,
    recordedAt,
    ...(target ? { target } : {}),
  };
}

function resolveRecordedStatus(
  located: LocatedTask,
  args: RecordEvidenceArgs,
  disposition: TaskDisposition | undefined,
): Task['status'] {
  if (!disposition) return args.status;
  if (disposition.kind === TASK_DISPOSITION_KIND.BLOCKED) return 'blocked';
  if (args.statusExplicit && args.status === 'blocked') return 'blocked';
  return located.task.status === 'done' ? 'pending' : located.task.status;
}

function assertDispositionTarget(
  sprint: SprintFile,
  taskId: string,
  kind: TaskDispositionKind,
  target: TaskDispositionTarget | undefined,
): void {
  if (kind === TASK_DISPOSITION_KIND.DEFERRED) {
    if (!target) throw new KyroCoreError('INVALID_INPUT', '--target is required for deferred dispositions.', 'Pass --target debt:<id> or --target sprint:<n>.');
    if (target.kind !== TASK_DISPOSITION_TARGET_KIND.DEBT && target.kind !== TASK_DISPOSITION_TARGET_KIND.SPRINT) {
      throw new KyroCoreError('INVALID_INPUT', 'deferred --target kind must be debt or sprint.', 'Pass --target debt:<id> or --target sprint:<n>.');
    }
  }
  if (kind === TASK_DISPOSITION_KIND.SUPERSEDED) {
    if (!target) throw new KyroCoreError('INVALID_INPUT', '--target is required for superseded dispositions.', 'Pass --target task:<id> of the replacement task in this sprint.');
    if (target.kind !== TASK_DISPOSITION_TARGET_KIND.TASK) {
      throw new KyroCoreError('INVALID_INPUT', 'superseded --target kind must be task.', 'Pass --target task:<id>.');
    }
  }
  if (!target) return;
  if (target.kind === TASK_DISPOSITION_TARGET_KIND.DEBT && !sprint.debt.some((item) => item.id === target.id)) {
    throw new KyroCoreError('DEBT_NOT_FOUND', `Debt not found: ${target.id}`, 'Add the debt with kyro debt add first, then record the deferred disposition.');
  }
  if (target.kind === TASK_DISPOSITION_TARGET_KIND.TASK) {
    if (target.id === taskId) {
      throw new KyroCoreError('INVALID_INPUT', 'A superseded disposition cannot target the same task.', 'Pass --target task:<id> of a different task in this sprint.');
    }
    if (!locateTask(sprint, target.id)) {
      throw new KyroCoreError('TASK_NOT_FOUND', `Task not found: ${target.id}`, 'Superseded targets must be a task id already in the active sprint.');
    }
  }
  if (target.kind === TASK_DISPOSITION_TARGET_KIND.SPRINT && !/^[1-9]\d*$/.test(target.id)) {
    throw new KyroCoreError('INVALID_INPUT', '--target sprint id must be a positive integer.', 'Pass --target sprint:<n> where n >= 1.');
  }
}

function parseDispositionTarget(raw: string): TaskDispositionTarget {
  const separator = raw.indexOf(':');
  if (separator <= 0 || separator === raw.length - 1) {
    throw new KyroCoreError('INVALID_INPUT', '--target must be debt:<id>, task:<id>, or sprint:<n>.', 'Example: --target debt:debt-1');
  }
  const kind = raw.slice(0, separator);
  const id = raw.slice(separator + 1).trim();
  if (id === '') {
    throw new KyroCoreError('INVALID_INPUT', '--target must be debt:<id>, task:<id>, or sprint:<n>.', 'Example: --target debt:debt-1');
  }
  if (kind === TASK_DISPOSITION_TARGET_KIND.DEBT || kind === TASK_DISPOSITION_TARGET_KIND.TASK || kind === TASK_DISPOSITION_TARGET_KIND.SPRINT) {
    return { kind, id };
  }
  throw new KyroCoreError('INVALID_INPUT', `--target kind must be one of: ${TASK_DISPOSITION_TARGET_KIND_VALUES_HELP}.`, 'Example: --target debt:debt-1');
}

const TASK_DISPOSITION_TARGET_KIND_VALUES_HELP = Object.values(TASK_DISPOSITION_TARGET_KIND).join(', ');

function withRecordedEvidence(
  sprint: SprintFile,
  located: LocatedTask,
  evidence: TaskEvidence,
  status: Task['status'],
  recordedAt: string,
  disposition: TaskDisposition | undefined,
): SprintFile {
  const active = sprint.activeSprint!;
  const nextActive = JSON.parse(JSON.stringify(active)) as typeof active;
  const task = located.kind === 'phase'
    ? nextActive.phases[located.phaseIndex!].tasks[located.taskIndex]
    : nextActive.emergentTasks[located.taskIndex];
  task.evidence = evidence;
  task.status = status;
  if (disposition) {
    task.disposition = disposition;
  } else {
    delete task.disposition;
  }
  // The maker records evidence; the checker verdict is written later by `kyro review`. Recording
  // evidence never touches task.verdict.

  // Keep phase.status and sprint.status coherent, exactly as the review gate does.
  if (located.kind === 'phase') {
    const phase = nextActive.phases[located.phaseIndex!];
    phase.status = derivePhaseStatus(phase);
  }
  nextActive.status = deriveActiveSprintStatus(nextActive);

  const nextTaskId = disposition
    ? nextExecutableTaskId(nextActive, task.id)
    : task.id;
  const nextAction = disposition ? 'execute_task' : 'review_task';
  const note = disposition
    ? `Task ${task.id} disposed as ${disposition.kind}; evidence recorded. Scope remains open.`
    : `Task ${task.id} executed and marked ${status}; evidence recorded. Ready for checker review.`;

  return {
    ...sprint,
    activeSprint: nextActive,
    handoff: {
      ...sprint.handoff,
      nextAction,
      nextTaskId,
      note,
      lastUpdated: recordedAt,
    },
  };
}

function nextExecutableTaskId(active: NonNullable<SprintFile['activeSprint']>, skipId: string): string | null {
  const tasks = active.phases.flatMap((phase) => phase.tasks).concat(active.emergentTasks);
  const next = tasks.find((task) => (
    task.id !== skipId
    && !task.disposition
    && (task.status === 'pending' || task.status === 'in_progress')
  ));
  return next?.id ?? null;
}

function locateTask(sprint: SprintFile, taskId: string): LocatedTask | null {
  const active = sprint.activeSprint;
  if (!active) return null;
  for (const [phaseIndex, phase] of active.phases.entries()) {
    for (const [taskIndex, task] of phase.tasks.entries()) {
      if (task.id === taskId) return { task, kind: 'phase', phaseIndex, taskIndex };
    }
  }
  for (const [taskIndex, task] of active.emergentTasks.entries()) {
    if (task.id === taskId) return { task, kind: 'emergent', taskIndex };
  }
  return null;
}

function parseRecordEvidenceArgs(rawArgs: string[]): RecordEvidenceArgs {
  let taskId = '';
  let scope: string | null = null;
  let summary = '';
  const validation: string[] = [];
  const files: string[] = [];
  let notes: string | null = null;
  let by = process.env.KYRO_ACTOR ?? 'maker';
  let status: RecordedStatus = 'done';
  let statusExplicit = false;
  let dispositionKind: TaskDispositionKind | null = null;
  let reason: string | null = null;
  let targetRaw: string | null = null;
  let dryRun = false;
  let help = false;
  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    if (arg === '--help' || arg === '-h') help = true;
    else if (arg === '--dry-run') dryRun = true;
    else if (arg === '--kyro-scope') { scope = requireValue(rawArgs, i, arg); i += 1; }
    else if (arg.startsWith('--kyro-scope=')) scope = arg.slice('--kyro-scope='.length);
    else if (arg === '--summary') { summary = requireValue(rawArgs, i, arg); i += 1; }
    else if (arg.startsWith('--summary=')) summary = arg.slice('--summary='.length);
    else if (arg === '--validation') { validation.push(requireValue(rawArgs, i, arg)); i += 1; }
    else if (arg.startsWith('--validation=')) validation.push(arg.slice('--validation='.length));
    else if (arg === '--file') { files.push(requireValue(rawArgs, i, arg)); i += 1; }
    else if (arg.startsWith('--file=')) files.push(arg.slice('--file='.length));
    else if (arg === '--notes') { notes = requireValue(rawArgs, i, arg); i += 1; }
    else if (arg.startsWith('--notes=')) notes = arg.slice('--notes='.length);
    else if (arg === '--by') { by = requireValue(rawArgs, i, arg); i += 1; }
    else if (arg.startsWith('--by=')) by = arg.slice('--by='.length);
    else if (arg === '--status') { status = parseStatus(requireValue(rawArgs, i, arg)); statusExplicit = true; i += 1; }
    else if (arg.startsWith('--status=')) { status = parseStatus(arg.slice('--status='.length)); statusExplicit = true; }
    else if (arg === '--disposition') { dispositionKind = parseDispositionKind(requireValue(rawArgs, i, arg)); i += 1; }
    else if (arg.startsWith('--disposition=')) dispositionKind = parseDispositionKind(arg.slice('--disposition='.length));
    else if (arg === '--reason') { reason = requireValue(rawArgs, i, arg); i += 1; }
    else if (arg.startsWith('--reason=')) reason = arg.slice('--reason='.length);
    else if (arg === '--target') { targetRaw = requireValue(rawArgs, i, arg); i += 1; }
    else if (arg.startsWith('--target=')) targetRaw = arg.slice('--target='.length);
    else if (!arg.startsWith('--') && !taskId) taskId = arg;
    else throw new KyroCoreError('INVALID_INPUT', `Unknown record-evidence option: ${arg}`);
  }
  return { taskId, scope, summary, validation, files, notes, by, status, statusExplicit, dispositionKind, reason, targetRaw, dryRun, help };
}

function parseStatus(value: string): RecordedStatus {
  if (value === 'done' || value === 'blocked') return value;
  throw new KyroCoreError('INVALID_INPUT', '--status must be done or blocked');
}

function parseDispositionKind(value: string): TaskDispositionKind {
  const allowed = Object.values(TASK_DISPOSITION_KIND);
  if ((allowed as string[]).includes(value)) return value as TaskDispositionKind;
  throw new KyroCoreError('INVALID_INPUT', `--disposition must be one of: ${allowed.join(', ')}`);
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) throw new KyroCoreError('INVALID_INPUT', `${flag} requires a value`);
  return value;
}

function printRecordEvidenceHelp(): void {
  console.log(`Usage: kyro record-evidence <task> [--kyro-scope <scope>] --summary <text> --validation <text> [--validation <text> ...] [--file <path> ...] [--notes <text>] [--by <actor>] [--status done|blocked] [--disposition deferred|blocked|superseded|cancelled --reason <text> [--target debt:<id>|task:<id>|sprint:<n>]] [--dry-run]

Writes task.evidence and sets task.status through the Kyro tool (no hand-edit of sprint.json).
Without --disposition, status is done (default) or blocked and the handoff routes to review_task.
With --disposition, unfinished work is recorded as deferred, blocked, superseded, or cancelled
(never done/pass), and the handoff stays on execute_task. The checker verdict stays owned by kyro review.`);
}
