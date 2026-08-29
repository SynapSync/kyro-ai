import { applyPlan, printPlan } from '../fs';
import { readJsonSafely } from '../artifacts/json';
import { sprintJsonPath } from '../artifacts/paths';
import { asSprintFile, validateSprintFile } from '../artifacts/schema';
import { collectCheckerFindings, countClarificationMarkers, normalizeCriterion } from '../core/analysis';
import { deriveActiveSprintStatus, derivePhaseStatus, nextExecutableTaskId } from '../core/status';
import { KyroCoreError } from '../core/errors';
import { setCliMachineResult } from '../core/cli-envelope';
import { evaluateGuard } from '../core/policy';
import { resolveScope } from '../core/scope-resolution';
import { emitBlockedReason, emitGateApproved, emitToolCommandRun } from '../core/trace';
import { readProjectState } from '../state';
import { sha256 } from '../checkpoints/sprint-close';
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
  requestDigest: string | null;
}

interface LocatedTask {
  task: Task;
  kind: 'phase' | 'emergent';
  phaseIndex?: number;
  taskIndex: number;
}

export interface ReviewPreparation {
  sprint: SprintFile;
  plan: OperationPlan[];
  findings: AnalysisFinding[];
  requestDigest: string;
  reviewedMaterialDigest: string;
  noop: boolean;
}

export interface ReviewTransactionResult {
  phase: 'preview' | 'applied' | 'noop';
  scope: string;
  taskId: string;
  verdict: TaskVerdictResult;
  requestDigest: string;
  reviewedMaterialDigest: string;
  resumed: boolean;
  affectedFiles: string[];
  requiresConfirmation: boolean;
  nextAction: string;
}

interface ReviewExecutionOptions {
  surface: 'cli' | 'mcp';
  apply: boolean;
  confirmed: boolean;
  onPrepared?: (preparation: ReviewPreparation) => void;
}

export function runReviewCommand(rawArgs: string[]): void {
  const args = parseReviewArgs(rawArgs);
  if (args.help) {
    printReviewHelp();
    return;
  }
  if (!args.taskId) throw new KyroCoreError('INVALID_INPUT', 'Usage: kyro review <task> [--verdict pass|fail] [--yes]', 'Pass the task id to review.');
  if (args.dryRun && args.yes) throw new KyroCoreError('INVALID_INPUT', '--dry-run and --yes are mutually exclusive.', 'Use --dry-run to preview, or --yes to confirm the write — not both.');

  const scope = resolveScope(args.scope);
  const result = executeReview(scope, args, {
    surface: 'cli',
    apply: !args.dryRun,
    confirmed: args.yes,
    onPrepared: ({ plan }) => printPlan(`Review task ${args.taskId} (${args.verdict})`, plan),
  });
  setCliMachineResult(result.phase, {
    outcome: result.phase,
    scope,
    digest: result.requestDigest,
    operationId: result.requestDigest,
    resumed: result.resumed,
    affectedFiles: result.affectedFiles,
    requiresConfirmation: result.requiresConfirmation,
    nextAction: result.nextAction,
    reviewedMaterialDigest: result.reviewedMaterialDigest,
  });
  if (result.phase === 'preview') {
    console.log(`Review request digest: ${result.requestDigest}`);
    console.log('Dry run complete. No files changed.');
  } else if (result.phase === 'noop') {
    console.log(`Task ${args.taskId} review already applied (noop). Next action: ${result.nextAction}.`);
  } else {
    console.log(`Task ${args.taskId} reviewed as ${args.verdict}. Next action: ${result.nextAction}.`);
  }
}

export function executeReview(scope: string, args: ReviewArgs, options: ReviewExecutionOptions): ReviewTransactionResult {
  const prepared = buildReviewPlan(scope, args);
  options.onPrepared?.(prepared);
  if (prepared.findings.length > 0 && args.verdict === 'pass') {
    for (const finding of prepared.findings) console.error(`[${finding.severity}] ${finding.id}: ${finding.detail}`);
    const code = checkerErrorCode(prepared.findings);
    emitBlockedReason(scope, `checker refused pass for task ${args.taskId}`, code);
    throw new KyroCoreError(code, `Checker refused pass for task ${args.taskId}.`, 'Resolve the checker findings, then re-run kyro review.');
  }
  if (prepared.noop) return reviewResult('noop', scope, args, prepared, false);

  const guard = evaluateGuard('review_task', { surface: options.surface, scope, confirmed: options.confirmed });
  if (guard.kind === 'blocked') {
    emitBlockedReason(scope, guard.message, guard.code);
    throw new KyroCoreError(guard.code ?? 'POLICY_BLOCKED', guard.message, guard.remedy);
  }
  if (!options.apply) return reviewResult('preview', scope, args, prepared, guard.kind === 'confirmation_required');
  if (guard.kind === 'confirmation_required') {
    emitBlockedReason(scope, guard.message, guard.code);
    throw new KyroCoreError(guard.code ?? 'CONFIRMATION_REQUIRED', guard.message, guard.remedy);
  }

  emitToolCommandRun(scope, options.surface, 'review', { task: args.taskId, verdict: args.verdict, requestDigest: prepared.requestDigest });
  applyPlan(prepared.plan);
  assertReviewWrite(scope);
  if (args.verdict === 'pass') emitGateApproved(scope, 'checker', args.taskId);
  else emitBlockedReason(scope, `checker failed task ${args.taskId}`, 'CHECKER_FAILED');
  return reviewResult('applied', scope, args, prepared, false);
}

export function buildReviewPlan(scope: string, args: ReviewArgs): ReviewPreparation {
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
  if (located.task.disposition) {
    throw new KyroCoreError(
      'DISPOSED_TASK_NOT_REVIEWABLE',
      `Task ${located.task.id} has a ${located.task.disposition.kind} disposition and cannot take a checker review.`,
      'A disposition is terminal for execution: record-evidence removed it from the executable routes and no implicit review path can reopen it. For replacement work in the active sprint, use kyro add-emergent; a true re-open requires a future explicit operation.',
    );
  }
  const clarificationMarkers = countClarificationMarkers(sprint);
  if (clarificationMarkers > 0) {
    throw new KyroCoreError(
      'CLARIFICATION_REQUIRED',
      `Cannot review: sprint.json has ${clarificationMarkers} unresolved [NEEDS CLARIFICATION] marker(s).`,
      'Resolve them in the clarify mode before reviewing — do not guess.',
    );
  }

  const acceptanceCriteria = located.task.acceptance_criteria ?? [];
  const acceptanceNormalized = new Set(acceptanceCriteria.map(normalizeCriterion));
  const assertKnownCriterion = (supplied: string): void => {
    if (acceptanceNormalized.has(normalizeCriterion(supplied))) return;
    throw new KyroCoreError('INVALID_INPUT',
      `--checked-criterion/--waive-criterion "${supplied}" matches no acceptance criterion for task ${located.task.id}.`,
      `Expected one of:\n${acceptanceCriteria.map((c) => `  - "${c}"`).join('\n')}`);
  };
  if (args.checkedCriteria.length > 0) args.checkedCriteria.forEach(assertKnownCriterion);
  if (args.waivedCriteria.length > 0) args.waivedCriteria.forEach((w) => assertKnownCriterion(w.criterion));

  const waivedSet = new Set(args.waivedCriteria.map((w) => normalizeCriterion(w.criterion)));
  const autoChecked = [...acceptanceCriteria].filter((c) => !waivedSet.has(normalizeCriterion(c)));
  const checkedCriteria = args.checkedCriteria.length > 0 ? args.checkedCriteria : args.verdict === 'pass' ? autoChecked : [];
  const reviewedMaterialDigest = buildReviewedMaterialDigest(scope, sprint, located.task);
  const requestDigest = buildReviewRequestDigest(scope, sprint, located.task, args, checkedCriteria, reviewedMaterialDigest);
  const currentVerdict = located.task.verdict;
  if (args.requestDigest && currentVerdict?.requestDigest === args.requestDigest) {
    return {
      sprint,
      plan: [],
      findings: [],
      requestDigest: args.requestDigest,
      reviewedMaterialDigest: currentVerdict.reviewedMaterialDigest ?? reviewedMaterialDigest,
      noop: true,
    };
  }
  if (args.requestDigest && args.requestDigest !== requestDigest) {
    throw new KyroCoreError(
      'REVIEW_REQUEST_DIVERGED',
      `Review request ${args.requestDigest} no longer matches task ${located.task.id} (current ${requestDigest}).`,
      `Re-run kyro review ${located.task.id} --kyro-scope ${scope} --dry-run --json and apply the new digest.`,
    );
  }
  if (currentVerdict?.requestDigest === requestDigest) {
    return { sprint, plan: [], findings: [], requestDigest, reviewedMaterialDigest, noop: true };
  }

  const reviewedAt = nextReviewedAt(currentVerdict?.reviewedAt);
  const verdict: TaskVerdict = {
    result: args.verdict,
    checked_criteria: checkedCriteria,
    ...(args.waivedCriteria.length > 0 ? { waived_criteria: args.waivedCriteria } : {}),
    findings: args.findings,
    by: args.by,
    reviewedAt,
    requestDigest,
    reviewedMaterialDigest,
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
  return { sprint: nextSprint, plan, findings, requestDigest, reviewedMaterialDigest, noop: false };
}

function nextReviewedAt(previous: string | undefined): string {
  const previousMillis = previous ? Date.parse(previous) : Number.NaN;
  const millis = Number.isFinite(previousMillis) ? Math.max(Date.now(), previousMillis + 1) : Date.now();
  return new Date(millis).toISOString();
}

function reviewResult(
  phase: ReviewTransactionResult['phase'],
  scope: string,
  args: ReviewArgs,
  prepared: ReviewPreparation,
  requiresConfirmation: boolean,
): ReviewTransactionResult {
  return {
    phase,
    scope,
    taskId: args.taskId,
    verdict: args.verdict,
    requestDigest: prepared.requestDigest,
    reviewedMaterialDigest: prepared.reviewedMaterialDigest,
    resumed: phase === 'noop',
    affectedFiles: phase === 'applied' ? [sprintJsonPath(scope)] : [],
    requiresConfirmation,
    nextAction: prepared.sprint.handoff.nextAction,
  };
}

function assertReviewWrite(scope: string): void {
  const verify = readJsonSafely(sprintJsonPath(scope));
  if (verify.error || !verify.exists) throw new KyroCoreError('INVALID_JSON', `Review wrote sprint.json but re-parse failed (${verify.error ?? 'missing'}).`, 'Restore from an archive snapshot.');
  const issues = validateSprintFile(verify.value, `${scope}/sprint.json`);
  if (issues.length === 0) return;
  const detail = issues.map((issue) => `${issue.field} ${issue.message}`).join('; ');
  throw new KyroCoreError('INVALID_SPRINT_SHAPE', `Review wrote sprint.json but it failed validation — ${detail}.`, 'Restore from an archive snapshot.');
}

function buildReviewedMaterialDigest(scope: string, sprint: SprintFile, task: Task): string {
  const active = sprint.activeSprint!;
  return sha256({
    schemaVersion: 1,
    scope,
    sprint: { n: active.n, slug: active.slug },
    task: {
      id: task.id,
      title: task.title,
      description: task.description,
      filesToTouch: task.files_to_touch,
      context: task.context,
      acceptanceCriteria: task.acceptance_criteria,
      dependsOn: task.depends_on,
      scenarioRefs: task.scenario_refs ?? [],
      status: task.status,
      evidence: task.evidence,
      disposition: task.disposition ?? null,
    },
  });
}

function buildReviewRequestDigest(
  scope: string,
  sprint: SprintFile,
  task: Task,
  args: ReviewArgs,
  checkedCriteria: string[],
  reviewedMaterialDigest: string,
): string {
  const active = sprint.activeSprint!;
  return sha256({
    schemaVersion: 1,
    scope,
    sprint: { n: active.n, slug: active.slug },
    task: task.id,
    evidence: task.evidence,
    criteria: {
      acceptance: task.acceptance_criteria,
      checked: [...checkedCriteria].sort((left, right) => normalizeCriterion(left).localeCompare(normalizeCriterion(right))),
      waived: [...args.waivedCriteria].sort((left, right) => normalizeCriterion(left.criterion).localeCompare(normalizeCriterion(right.criterion))),
    },
    findings: [...args.findings].sort((left, right) => `${left.severity}:${left.detail}`.localeCompare(`${right.severity}:${right.detail}`)),
    actor: args.by,
    verdict: args.verdict,
    reviewedMaterialDigest,
  });
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
  const nextExecutable = nextExecutableTaskId(nextActive);
  const allDonePass = tasks.length > 0 && tasks.every((item) => item.status === 'done' && item.verdict?.result === 'pass');
  return {
    ...sprint,
    activeSprint: nextActive,
    handoff: {
      ...sprint.handoff,
      nextAction: verdict.result === 'fail' ? 'execute_task' : allDonePass ? 'close_sprint' : 'execute_task',
      nextTaskId: verdict.result === 'fail' ? task.id : nextExecutable,
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
  let requestDigest: string | null = null;
  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    if (arg === '--help' || arg === '-h') help = true;
    else if (arg === '--yes' || arg === '-y' || arg === '--confirm') yes = true;
    else if (arg === '--dry-run') dryRun = true;
    else if (arg === '--digest') { requestDigest = parseRequestDigest(requireValue(rawArgs, i, arg)); i += 1; }
    else if (arg.startsWith('--digest=')) requestDigest = parseRequestDigest(arg.slice('--digest='.length));
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
  return { taskId, scope, verdict, checkedCriteria, waivedCriteria, findings, by, yes, dryRun, help, requestDigest };
}

function parseRequestDigest(value: string): string {
  if (/^[a-f0-9]{64}$/.test(value)) return value;
  throw new KyroCoreError('INVALID_INPUT', '--digest must be a lowercase sha256 digest');
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
