import { applyPlan, printPlan } from '../fs';
import { readJsonSafely } from '../artifacts/json';
import { sprintJsonPath } from '../artifacts/paths';
import { asSprintFile, validateSprintFile } from '../artifacts/schema';
import { deriveActiveSprintStatus, derivePhaseStatus } from '../core/status';
import { KyroCoreError } from '../core/errors';
import { countClarificationMarkers } from '../core/analysis';
import { resolveScope } from '../core/scope-resolution';
import { emitToolCommandRun } from '../core/trace';
import type { OperationPlan, SprintFile, Task, TaskEvidence } from '../types';

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
  printPlan(`Record evidence for task ${args.taskId} (${args.status})`, plan);

  if (args.dryRun) {
    console.log('Dry run complete. No files changed.');
    return;
  }

  emitToolCommandRun(scope, 'cli', 'record-evidence', { task: args.taskId, status: args.status });
  applyPlan(plan);

  const verify = readJsonSafely(sprintJsonPath(scope));
  if (verify.error || !verify.exists) throw new KyroCoreError('INVALID_JSON', `record-evidence wrote sprint.json but re-parse failed (${verify.error ?? 'missing'}).`, 'Restore from an archive snapshot.');
  const issues = validateSprintFile(verify.value, `${scope}/sprint.json`);
  if (issues.length > 0) {
    const detail = issues.map((issue) => `${issue.field} ${issue.message}`).join('; ');
    throw new KyroCoreError('INVALID_SPRINT_SHAPE', `record-evidence wrote sprint.json but it failed validation — ${detail}.`, 'Restore from an archive snapshot.');
  }
  console.log(`Evidence recorded for task ${args.taskId} (${args.status}). Next action: ${sprint.handoff.nextAction}.`);
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
  const nextSprint = withRecordedEvidence(sprint, located, evidence, args.status, recordedAt);
  const plan: OperationPlan[] = [{ action: 'write', path: sprintJsonPath(scope), content: `${JSON.stringify(nextSprint, null, 2)}\n` }];
  return { sprint: nextSprint, plan };
}

function withRecordedEvidence(sprint: SprintFile, located: LocatedTask, evidence: TaskEvidence, status: RecordedStatus, recordedAt: string): SprintFile {
  const active = sprint.activeSprint!;
  const nextActive = JSON.parse(JSON.stringify(active)) as typeof active;
  const task = located.kind === 'phase'
    ? nextActive.phases[located.phaseIndex!].tasks[located.taskIndex]
    : nextActive.emergentTasks[located.taskIndex];
  task.evidence = evidence;
  task.status = status;
  // The maker records evidence; the checker verdict is written later by `kyro review`. Recording
  // evidence never touches task.verdict.

  // Keep phase.status and sprint.status coherent, exactly as the review gate does.
  if (located.kind === 'phase') {
    const phase = nextActive.phases[located.phaseIndex!];
    phase.status = derivePhaseStatus(phase);
  }
  nextActive.status = deriveActiveSprintStatus(nextActive);

  return {
    ...sprint,
    activeSprint: nextActive,
    handoff: {
      ...sprint.handoff,
      nextAction: 'review_task',
      nextTaskId: task.id,
      note: `Task ${task.id} executed and marked ${status}; evidence recorded. Ready for checker review.`,
      lastUpdated: recordedAt,
    },
  };
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
    else if (arg === '--status') { status = parseStatus(requireValue(rawArgs, i, arg)); i += 1; }
    else if (arg.startsWith('--status=')) status = parseStatus(arg.slice('--status='.length));
    else if (!arg.startsWith('--') && !taskId) taskId = arg;
    else throw new KyroCoreError('INVALID_INPUT', `Unknown record-evidence option: ${arg}`);
  }
  return { taskId, scope, summary, validation, files, notes, by, status, dryRun, help };
}

function parseStatus(value: string): RecordedStatus {
  if (value === 'done' || value === 'blocked') return value;
  throw new KyroCoreError('INVALID_INPUT', '--status must be done or blocked');
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) throw new KyroCoreError('INVALID_INPUT', `${flag} requires a value`);
  return value;
}

function printRecordEvidenceHelp(): void {
  console.log(`Usage: kyro record-evidence <task> [--kyro-scope <scope>] --summary <text> --validation <text> [--validation <text> ...] [--file <path> ...] [--notes <text>] [--by <actor>] [--status done|blocked] [--dry-run]

Writes task.evidence and sets task.status through the Kyro tool (no hand-edit of sprint.json), then routes the handoff to review_task. The checker verdict stays owned by kyro review.`);
}
