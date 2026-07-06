import { applyPlan, printPlan } from '../fs';
import { readJsonSafely } from '../artifacts/json';
import { sprintJsonPath } from '../artifacts/paths';
import { asSprintFile, validateSprintFile } from '../artifacts/schema';
import { collectCheckerFindings } from '../core/analysis';
import { deriveActiveSprintStatus, derivePhaseStatus } from '../core/status';
import { KyroCoreError } from '../core/errors';
import { evaluateGuard } from '../core/policy';
import { resolveScope } from '../core/scope-resolution';
import { emitBlockedReason, emitGateApproved, emitToolCommandRun } from '../core/trace';
import { readProjectState } from '../state';
import type { AnalysisFinding, OperationPlan, SprintFile, Task, TaskVerdict, TaskVerdictFinding, TaskVerdictFindingSeverity, TaskVerdictResult, WaivedCriterion } from '../types';

export interface ReviewArgs {
  taskId: string;
  scope: string | null;
  verdict: TaskVerdictResult;
  checkedCriteria: string[];
  waivedCriteria: WaivedCriterion[];
  findings: TaskVerdictFinding[];
  by: string;
  yes: boolean;
  dryRun: boolean;
  help: boolean;
}

interface LocatedTask {
  task: Task;
  kind: 'phase' | 'emergent';
  phaseIndex?: number;
  taskIndex: number;
}

export function runReviewCommand(rawArgs: string[]): void {
  const args = parseReviewArgs(rawArgs);
  if (args.help) {
    printReviewHelp();
    return;
  }
  if (!args.taskId) throw new KyroCoreError('INVALID_INPUT', 'Usage: kyro review <task> [--verdict pass|fail] [--yes]', 'Pass the task id to review.');

  const scope = resolveScope(args.scope);
  const { sprint, plan, findings } = buildReviewPlan(scope, args);
  printPlan(`Review task ${args.taskId} (${args.verdict})`, plan);

  if (findings.length > 0 && args.verdict === 'pass') {
    for (const finding of findings) console.error(`[${finding.severity}] ${finding.id}: ${finding.detail}`);
    emitBlockedReason(scope, `checker refused pass for task ${args.taskId}`, checkerErrorCode(findings));
    throw new KyroCoreError(checkerErrorCode(findings), `Checker refused pass for task ${args.taskId}.`, 'Resolve the checker findings, then re-run kyro review.');
  }

  if (args.dryRun) {
    console.log('Dry run complete. No files changed.');
    return;
  }

  const guard = evaluateGuard('review_task', { surface: 'cli', scope, confirmed: args.yes });
  if (guard.kind === 'blocked') {
    emitBlockedReason(scope, guard.message, guard.code);
    throw new KyroCoreError(guard.code ?? 'POLICY_BLOCKED', guard.message, guard.remedy);
  }
  if (guard.kind === 'confirmation_required') {
    emitBlockedReason(scope, guard.message, guard.code);
    throw new KyroCoreError(guard.code ?? 'CONFIRMATION_REQUIRED', guard.message, guard.remedy);
  }

  emitToolCommandRun(scope, 'cli', 'review', { task: args.taskId, verdict: args.verdict });
  applyPlan(plan);

  const verify = readJsonSafely(sprintJsonPath(scope));
  if (verify.error || !verify.exists) throw new KyroCoreError('INVALID_JSON', `Review wrote sprint.json but re-parse failed (${verify.error ?? 'missing'}).`, 'Restore from an archive snapshot.');
  const issues = validateSprintFile(verify.value, `${scope}/sprint.json`);
  if (issues.length > 0) {
    const detail = issues.map((issue) => `${issue.field} ${issue.message}`).join('; ');
    throw new KyroCoreError('INVALID_SPRINT_SHAPE', `Review wrote sprint.json but it failed validation — ${detail}.`, 'Restore from an archive snapshot.');
  }

  if (args.verdict === 'pass') emitGateApproved(scope, 'checker', args.taskId);
  else emitBlockedReason(scope, `checker failed task ${args.taskId}`, 'CHECKER_FAILED');
  console.log(`Task ${args.taskId} reviewed as ${args.verdict}. Next action: ${sprint.handoff.nextAction}.`);
}

export function buildReviewPlan(scope: string, args: ReviewArgs): { sprint: SprintFile; plan: OperationPlan[]; findings: AnalysisFinding[] } {
  const read = readJsonSafely(sprintJsonPath(scope));
  if (!read.exists) throw new KyroCoreError('SCOPE_NOT_FOUND', `Scope "${scope}" has no sprint.json.`, 'Create the scope with /kyro:forge (INIT) or choose another scope.');
  if (read.error) throw new KyroCoreError('INVALID_JSON', `sprint.json for "${scope}" is invalid JSON (${read.error}).`, 'Fix invalid JSON or restore from an archive snapshot.');
  const issues = validateSprintFile(read.value, `${scope}/sprint.json`);
  if (issues.length > 0) {
    const detail = issues.map((issue) => `${issue.field} ${issue.message}`).join('; ');
    throw new KyroCoreError('INVALID_SPRINT_SHAPE', `Cannot review ${scope}: sprint.json has shape drift — ${detail}.`, 'Fix sprint.json shape before reviewing.');
  }
  const sprint = asSprintFile(read.value);
  if (!sprint || !sprint.activeSprint) throw new KyroCoreError('NO_ACTIVE_SPRINT', `Scope "${scope}" has no active sprint to review.`);
  const located = locateTask(sprint, args.taskId);
  if (!located) throw new KyroCoreError('TASK_NOT_FOUND', `Task not found: ${args.taskId}`, 'Run kyro context-pack --json to inspect the active sprint tasks.');

  const reviewedAt = new Date().toISOString();
  const waivedSet = new Set(args.waivedCriteria.map((w) => w.criterion));
  const autoChecked = [...(located.task.acceptance_criteria ?? [])].filter((c) => !waivedSet.has(c));
  const verdict: TaskVerdict = {
    result: args.verdict,
    checked_criteria: args.checkedCriteria.length > 0 ? args.checkedCriteria : args.verdict === 'pass' ? autoChecked : [],
    ...(args.waivedCriteria.length > 0 ? { waived_criteria: args.waivedCriteria } : {}),
    findings: args.findings,
    by: args.by,
    reviewedAt,
  };
  const nextSprint = withReviewedTask(sprint, located, verdict, reviewedAt);
  const principles = readProjectState()?.principles ?? [];
  // The review GATE only blocks on the task under review. collectCheckerFindings is global (every
  // done task without a verdict, etc.); if we blocked a pass on all of them, accumulated review debt
  // could never be paid one task at a time — reviewing T1 would be blocked by unreviewed T2, T3, …
  // analyze keeps the global view (and close-sprint blocks on it); review is per-task recovery.
  const findings = scopeFindingsToTask(collectCheckerFindings(nextSprint, principles), args.taskId)
    .filter((finding) => finding.severity === 'CRITICAL' || finding.severity === 'HIGH');
  const plan = [{ action: 'write' as const, path: sprintJsonPath(scope), content: `${JSON.stringify(nextSprint, null, 2)}\n` }];
  return { sprint: nextSprint, plan, findings };
}

function withReviewedTask(sprint: SprintFile, located: LocatedTask, verdict: TaskVerdict, reviewedAt: string): SprintFile {
  const active = sprint.activeSprint!;
  const nextActive = JSON.parse(JSON.stringify(active)) as typeof active;
  const task = located.kind === 'phase'
    ? nextActive.phases[located.phaseIndex!].tasks[located.taskIndex]
    : nextActive.emergentTasks[located.taskIndex];
  task.verdict = verdict;
  if (verdict.result === 'fail') task.status = 'pending';

  // Keep phase.status coherent at the gate that moves task state, so it never becomes an orphan field
  // that says "pending" while its tasks are done. Emergent tasks have no phase to update.
  if (located.kind === 'phase') {
    const phase = nextActive.phases[located.phaseIndex!];
    phase.status = derivePhaseStatus(phase);
  }
  nextActive.status = deriveActiveSprintStatus(nextActive);

  const tasks = nextActive.phases.flatMap((phase) => phase.tasks).concat(nextActive.emergentTasks);
  const nextPending = tasks.find((item) => item.status === 'pending' || item.status === 'in_progress');
  const allDonePass = tasks.length > 0 && tasks.every((item) => item.status === 'done' && item.verdict?.result === 'pass');
  return {
    ...sprint,
    activeSprint: nextActive,
    handoff: {
      ...sprint.handoff,
      nextAction: verdict.result === 'fail' ? 'execute_task' : allDonePass ? 'close_sprint' : 'execute_task',
      nextTaskId: verdict.result === 'fail' ? task.id : nextPending?.id ?? null,
      note: verdict.result === 'pass' ? `Task ${task.id} passed checker review.` : `Task ${task.id} failed checker review and returned to execution.`,
      lastUpdated: reviewedAt,
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

function parseReviewArgs(rawArgs: string[]): ReviewArgs {
  let taskId = '';
  let scope: string | null = null;
  let verdict: TaskVerdictResult = 'pass';
  const checkedCriteria: string[] = [];
  const waivedCriteria: WaivedCriterion[] = [];
  const findings: TaskVerdictFinding[] = [];
  let by = process.env.KYRO_ACTOR ?? 'checker';
  let yes = false;
  let dryRun = false;
  let help = false;
  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    if (arg === '--help' || arg === '-h') help = true;
    else if (arg === '--yes' || arg === '-y' || arg === '--confirm') yes = true;
    else if (arg === '--dry-run') dryRun = true;
    else if (arg === '--kyro-scope') { scope = requireValue(rawArgs, i, arg); i += 1; }
    else if (arg.startsWith('--kyro-scope=')) scope = arg.slice('--kyro-scope='.length);
    else if (arg === '--verdict') { verdict = parseVerdict(requireValue(rawArgs, i, arg)); i += 1; }
    else if (arg.startsWith('--verdict=')) verdict = parseVerdict(arg.slice('--verdict='.length));
    else if (arg === '--checked-criterion') { checkedCriteria.push(requireValue(rawArgs, i, arg)); i += 1; }
    else if (arg.startsWith('--checked-criterion=')) checkedCriteria.push(arg.slice('--checked-criterion='.length));
    else if (arg === '--waive-criterion') { waivedCriteria.push(parseWaiver(requireValue(rawArgs, i, arg))); i += 1; }
    else if (arg.startsWith('--waive-criterion=')) waivedCriteria.push(parseWaiver(arg.slice('--waive-criterion='.length)));
    else if (arg === '--finding') { findings.push(parseFinding(requireValue(rawArgs, i, arg))); i += 1; }
    else if (arg.startsWith('--finding=')) findings.push(parseFinding(arg.slice('--finding='.length)));
    else if (arg === '--by') { by = requireValue(rawArgs, i, arg); i += 1; }
    else if (arg.startsWith('--by=')) by = arg.slice('--by='.length);
    else if (!arg.startsWith('--') && !taskId) taskId = arg;
    else throw new KyroCoreError('INVALID_INPUT', `Unknown review option: ${arg}`);
  }
  return { taskId, scope, verdict, checkedCriteria, waivedCriteria, findings, by, yes, dryRun, help };
}

export function parseWaiver(value: string): WaivedCriterion {
  const sep = value.indexOf('::');
  if (sep === -1) throw new KyroCoreError('INVALID_INPUT', '--waive-criterion must use "criterion::reason"');
  const criterion = value.slice(0, sep).trim();
  const reason = value.slice(sep + 2).trim();
  if (criterion === '' || reason === '') throw new KyroCoreError('INVALID_INPUT', '--waive-criterion must use "criterion::reason" with both non-empty');
  return { criterion, reason };
}

export function parseVerdict(value: string): TaskVerdictResult {
  if (value === 'pass' || value === 'fail') return value;
  throw new KyroCoreError('INVALID_INPUT', '--verdict must be pass or fail');
}

export function parseFinding(value: string): TaskVerdictFinding {
  const [severity, ...detailParts] = value.split(':');
  const detail = detailParts.join(':').trim();
  if (!isFindingSeverity(severity) || detail === '') throw new KyroCoreError('INVALID_INPUT', '--finding must use severity:detail, e.g. warning:Needs docs');
  return { severity, detail };
}

function isFindingSeverity(value: string): value is TaskVerdictFindingSeverity {
  return value === 'critical' || value === 'warning' || value === 'suggestion';
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new KyroCoreError('INVALID_INPUT', `${flag} requires a value`);
  return value;
}

/**
 * Keep only checker findings that reference the task under review. Every collectCheckerFindings entry
 * is per-task and its `detail` starts with `task <id> ` (the trailing space prevents T1.1 matching
 * T1.10). This is what makes accumulated review debt recoverable one task at a time.
 */
export function scopeFindingsToTask(findings: AnalysisFinding[], taskId: string): AnalysisFinding[] {
  return findings.filter((finding) => finding.detail.includes(`task ${taskId} `));
}

export function checkerErrorCode(findings: AnalysisFinding[]): 'CHECKER_FAILED' | 'SELF_REVIEW_BLOCKED' {
  return findings.some((finding) => finding.detail.includes('self-reviewed')) ? 'SELF_REVIEW_BLOCKED' : 'CHECKER_FAILED';
}

function printReviewHelp(): void {
  console.log(`Usage: kyro review <task> [--kyro-scope <scope>] [--verdict pass|fail] [--checked-criterion <text>] [--waive-criterion "<criterion>::<reason>"] [--finding severity:detail] [--by <actor>] [--dry-run] [--yes|--confirm]

Checks deterministic maker/checker coherence, then writes the task verdict through the Kyro tool.`);
}
