import { readJsonSafely } from '../artifacts/json';
import { sprintJsonPath } from '../artifacts/paths';
import { asSprintFile, asTaskVerdict } from '../artifacts/schema';
import { resolveScope as resolveKyroScope } from '../core/scope-resolution';
import { deriveActiveSprintStatus, derivePhaseStatus, deriveScopeStatus } from '../core/status';
import { KyroCoreError } from '../core/errors';
import { ADR_STATUS } from '../types';
import type { ActiveSprint, AdrRecord, AdrStatus, Debt, SprintFile, Task, TaskStatus } from '../types';

const STATUS_MODE = {
  BRIEF: 'brief',
  FULL: 'full',
  DEBT: 'debt',
} as const;

type StatusMode = (typeof STATUS_MODE)[keyof typeof STATUS_MODE];

const READ_ONLY_DEBT_COMMANDS = new Set(['debt-add', 'debt-resolve', 'debt-escalate']);
const DEBT_STATUS_ORDER = ['open', 'in_progress', 'deferred', 'resolved'] as const;
const DEBT_PRIORITY_ORDER = ['critical', 'high', 'medium', 'low'] as const;

interface StatusCommandOptions {
  mode: StatusMode;
  kyroScope: string | null;
  json: boolean;
  help: boolean;
}

interface TaskReference {
  id: string;
  title: string | null;
  status: TaskStatus | null;
  phaseId: string | null;
  phaseTitle: string | null;
}

interface ActiveSprintStatusSummary {
  n: number;
  slug: string;
  title: string;
  objective: string;
  status: string;
}

interface ReviewDebtItem {
  id: string;
  title: string;
  status: TaskStatus;
  phaseId: string | null;
  phaseTitle: string | null;
}

type AdrStatusCounts = Record<AdrStatus, number>;

interface AdrSummary {
  total: number;
  byStatus: AdrStatusCounts;
}

interface RecentAdr {
  id: string;
  title: string;
  status: AdrStatus;
  date: string;
}

interface BriefStatusReport {
  scope: string;
  status: string;
  objective: string;
  activeSprint: ActiveSprintStatusSummary | null;
  nextAction: string;
  nextTask: TaskReference | null;
  blockers: string[];
  openDebtCount: number;
  pendingReviewCount: number;
}

interface PhaseSummary {
  id: string;
  title: string;
  status: string;
  totalTasks: number;
  doneTasks: number;
  pendingTasks: number;
  inProgressTasks: number;
  blockedTasks: number;
}

interface TaskSummary {
  total: number;
  pending: number;
  inProgress: number;
  blocked: number;
  done: number;
}

interface FullStatusReport extends BriefStatusReport {
  phaseSummary: PhaseSummary[];
  taskSummary: TaskSummary;
  reviewDebt: ReviewDebtItem[];
  adrSummary: AdrSummary;
  recentAdrs: RecentAdr[];
}

interface DebtGroup<T extends string> {
  key: T;
  count: number;
  items: Debt[];
}

interface DebtStatusReport {
  scope: string;
  status: string;
  objective: string;
  byStatus: Array<DebtGroup<Debt['status']>>;
  byPriority: Array<DebtGroup<Debt['priority']>>;
}

export function runStatusCommand(args: string[]): void {
  const options = parseStatusArgs(args);
  if (options.help) {
    printStatusHelp();
    return;
  }

  const scope = resolveKyroScope(options.kyroScope);
  const sprint = readSprint(scope);

  if (options.mode === STATUS_MODE.DEBT) {
    const report = buildDebtStatusReport(scope, sprint);
    if (options.json) console.log(JSON.stringify(report, null, 2));
    else printDebtStatus(report);
    return;
  }

  if (options.mode === STATUS_MODE.FULL) {
    const report = buildFullStatusReport(scope, sprint);
    if (options.json) console.log(JSON.stringify(report, null, 2));
    else printFullStatus(report);
    return;
  }

  const report = buildBriefStatusReport(scope, sprint);
  if (options.json) console.log(JSON.stringify(report, null, 2));
  else printBriefStatus(report);
}

function parseStatusArgs(args: string[]): StatusCommandOptions {
  let mode: StatusMode = STATUS_MODE.BRIEF;
  let explicitMode = false;
  let kyroScope: string | null = null;
  let json = false;
  let help = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h' || arg === 'help') {
      help = true;
    } else if (arg === '--json') {
      json = true;
    } else if (arg === '--kyro-scope') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw invalidInput('--kyro-scope requires a value.', 'Use --kyro-scope <scope> or --kyro-scope=<scope>.');
      kyroScope = value;
      index += 1;
    } else if (arg.startsWith('--kyro-scope=')) {
      kyroScope = arg.slice('--kyro-scope='.length);
      if (!kyroScope) throw invalidInput('--kyro-scope requires a value.', 'Use --kyro-scope <scope> or --kyro-scope=<scope>.');
    } else if (arg === STATUS_MODE.BRIEF || arg === STATUS_MODE.FULL || arg === STATUS_MODE.DEBT) {
      if (explicitMode) throw invalidInput(`Multiple status modes provided: ${mode}, ${arg}.`, 'Use one of: kyro status brief, kyro status full, or kyro status debt.');
      mode = arg;
      explicitMode = true;
    } else if (READ_ONLY_DEBT_COMMANDS.has(arg)) {
      throw readOnlyDebtError(arg);
    } else if (arg.startsWith('--')) {
      throw invalidInput(`Unknown status option: ${arg}.`, 'Run kyro status --help.');
    } else {
      throw invalidInput(`Unknown status mode: ${arg}.`, 'Use one of: brief, full, or debt. Kyro CLI status is read-only; use Kyro workflow review/repair commands for state changes.');
    }
  }

  return { mode, kyroScope, json, help };
}

function readOnlyDebtError(command: string): KyroCoreError {
  return new KyroCoreError(
    'INVALID_INPUT',
    `kyro status ${command} is not supported.`,
    'kyro status is read-only. Use kyro debt add|start|resolve|defer|escalate to change debt, then kyro status debt to inspect it.',
  );
}

function invalidInput(message: string, remedy: string): KyroCoreError {
  return new KyroCoreError('INVALID_INPUT', message, remedy);
}

function readSprint(scope: string): SprintFile {
  const read = readJsonSafely(sprintJsonPath(scope));
  if (!read.exists) throw new KyroCoreError('SCOPE_NOT_FOUND', `Scope '${scope}' has no sprint.json.`, 'Run /kyro:forge (INIT) to create it.');
  if (read.error) throw new KyroCoreError('INVALID_JSON', `sprint.json for '${scope}' is invalid JSON: ${read.error}`, 'Fix invalid JSON or restore from an archive snapshot.');
  const sprint = asSprintFile(read.value);
  if (!sprint) throw new KyroCoreError('INVALID_SPRINT_SHAPE', `sprint.json for '${scope}' does not match the v4 schema.`, `Run kyro doctor --artifacts --kyro-scope ${scope}.`);
  return sprint;
}

function buildBriefStatusReport(scope: string, sprint: SprintFile): BriefStatusReport {
  const activeSprint = sprint.activeSprint;
  const reviewDebt = collectReviewDebt(activeSprint);
  return {
    scope,
    status: deriveScopeStatus(sprint, Boolean(activeSprint)),
    objective: sprint.objective,
    activeSprint: activeSprint ? {
      n: activeSprint.n,
      slug: activeSprint.slug,
      title: activeSprint.title,
      objective: activeSprint.objective,
      status: deriveActiveSprintStatus(activeSprint),
    } : null,
    nextAction: sprint.handoff.nextAction,
    nextTask: resolveNextTask(activeSprint, sprint.handoff.nextTaskId),
    blockers: sprint.handoff.blockers ?? [],
    openDebtCount: countOpenDebt(sprint.debt),
    pendingReviewCount: reviewDebt.length,
  };
}

function buildFullStatusReport(scope: string, sprint: SprintFile): FullStatusReport {
  const brief = buildBriefStatusReport(scope, sprint);
  const activeSprint = sprint.activeSprint;
  return {
    ...brief,
    phaseSummary: activeSprint ? activeSprint.phases.map((phase) => {
      const counts = countTasksByStatus(phase.tasks);
      return {
        id: phase.id,
        title: phase.title,
        status: derivePhaseStatus(phase),
        totalTasks: phase.tasks.length,
        doneTasks: counts.done,
        pendingTasks: counts.pending,
        inProgressTasks: counts.inProgress,
        blockedTasks: counts.blocked,
      };
    }) : [],
    taskSummary: countTasksByStatus(collectSprintTasks(activeSprint)),
    reviewDebt: collectReviewDebt(activeSprint),
    adrSummary: summarizeAdrs(sprint.adrs ?? []),
    recentAdrs: recentAdrs(sprint.adrs ?? []),
  };
}

function buildDebtStatusReport(scope: string, sprint: SprintFile): DebtStatusReport {
  return {
    scope,
    status: deriveScopeStatus(sprint, Boolean(sprint.activeSprint)),
    objective: sprint.objective,
    byStatus: DEBT_STATUS_ORDER.map((status) => ({
      key: status,
      count: sprint.debt.filter((item) => item.status === status).length,
      items: sprint.debt.filter((item) => item.status === status),
    })),
    byPriority: DEBT_PRIORITY_ORDER.map((priority) => ({
      key: priority,
      count: sprint.debt.filter((item) => item.priority === priority).length,
      items: sprint.debt.filter((item) => item.priority === priority),
    })),
  };
}

function resolveNextTask(activeSprint: ActiveSprint | null, nextTaskId: string | null): TaskReference | null {
  if (!nextTaskId) return null;
  if (!activeSprint) return { id: nextTaskId, title: null, status: null, phaseId: null, phaseTitle: null };
  for (const phase of activeSprint.phases) {
    const task = phase.tasks.find((item) => item.id === nextTaskId);
    if (task) return { id: task.id, title: task.title, status: task.status, phaseId: phase.id, phaseTitle: phase.title };
  }
  const emergent = activeSprint.emergentTasks.find((item) => item.id === nextTaskId);
  if (emergent) return { id: emergent.id, title: emergent.title, status: emergent.status, phaseId: null, phaseTitle: 'Emergent tasks' };
  return { id: nextTaskId, title: null, status: null, phaseId: null, phaseTitle: null };
}

function collectReviewDebt(activeSprint: ActiveSprint | null): ReviewDebtItem[] {
  if (!activeSprint) return [];
  const items: ReviewDebtItem[] = [];
  for (const phase of activeSprint.phases) {
    for (const task of phase.tasks) {
      if (task.status === 'done' && asTaskVerdict(task.verdict)?.result !== 'pass') {
        items.push({ id: task.id, title: task.title, status: task.status, phaseId: phase.id, phaseTitle: phase.title });
      }
    }
  }
  for (const task of activeSprint.emergentTasks) {
    if (task.status === 'done' && asTaskVerdict(task.verdict)?.result !== 'pass') {
      items.push({ id: task.id, title: task.title, status: task.status, phaseId: null, phaseTitle: 'Emergent tasks' });
    }
  }
  return items;
}

function collectSprintTasks(activeSprint: ActiveSprint | null): Task[] {
  if (!activeSprint) return [];
  return activeSprint.phases.flatMap((phase) => phase.tasks).concat(activeSprint.emergentTasks);
}

function countTasksByStatus(tasks: Task[]): TaskSummary {
  return {
    total: tasks.length,
    pending: tasks.filter((task) => task.status === 'pending').length,
    inProgress: tasks.filter((task) => task.status === 'in_progress').length,
    blocked: tasks.filter((task) => task.status === 'blocked').length,
    done: tasks.filter((task) => task.status === 'done').length,
  };
}

function countOpenDebt(debt: Debt[]): number {
  return debt.filter((item) => item.status === 'open' || item.status === 'in_progress').length;
}

function summarizeAdrs(adrs: AdrRecord[]): AdrSummary {
  const byStatus: AdrStatusCounts = {
    [ADR_STATUS.PROPOSED]: 0,
    [ADR_STATUS.ACCEPTED]: 0,
    [ADR_STATUS.REJECTED]: 0,
    [ADR_STATUS.SUPERSEDED]: 0,
  };
  for (const adr of adrs) byStatus[adr.status] += 1;
  return { total: adrs.length, byStatus };
}

function recentAdrs(adrs: AdrRecord[]): RecentAdr[] {
  return [...adrs]
    .sort((left, right) => right.date.localeCompare(left.date) || right.id.localeCompare(left.id))
    .slice(0, 5)
    .map((adr) => ({ id: adr.id, title: adr.title, status: adr.status, date: adr.date }));
}

function printBriefStatus(report: BriefStatusReport): void {
  console.log(`Scope: ${report.scope} (${report.status})`);
  console.log(`Objective: ${report.objective}`);
  console.log(`Active sprint: ${formatActiveSprint(report.activeSprint)}`);
  console.log(`Next action: ${report.nextAction}`);
  console.log(`Next task: ${formatTaskReference(report.nextTask)}`);
  console.log(`Open debt: ${report.openDebtCount}`);
  console.log(`Pending review: ${report.pendingReviewCount}`);
  if (report.blockers.length > 0) console.log(`Blockers: ${report.blockers.join(' | ')}`);
}

function printFullStatus(report: FullStatusReport): void {
  printBriefStatus(report);
  if (report.phaseSummary.length > 0) {
    console.log('\nPhases:');
    for (const phase of report.phaseSummary) {
      console.log(`- ${phase.id}: ${phase.title} (${phase.status}) — ${phase.doneTasks}/${phase.totalTasks} done, ${phase.blockedTasks} blocked`);
    }
  }
  console.log(`\nTasks: pending=${report.taskSummary.pending}, in_progress=${report.taskSummary.inProgress}, blocked=${report.taskSummary.blocked}, done=${report.taskSummary.done}`);
  if (report.reviewDebt.length > 0) {
    console.log('Review debt:');
    for (const item of report.reviewDebt) console.log(`- ${item.id}: ${item.title} (${item.phaseTitle ?? 'unknown phase'})`);
  }
  console.log(`\nADRs: total=${report.adrSummary.total}, proposed=${report.adrSummary.byStatus.proposed}, accepted=${report.adrSummary.byStatus.accepted}, rejected=${report.adrSummary.byStatus.rejected}, superseded=${report.adrSummary.byStatus.superseded}`);
  if (report.recentAdrs.length > 0) {
    console.log('Recent ADRs:');
    for (const adr of report.recentAdrs) console.log(`- ${adr.id}: ${adr.title} (${adr.status}, ${adr.date})`);
  }
}

function printDebtStatus(report: DebtStatusReport): void {
  console.log(`Scope: ${report.scope} (${report.status})`);
  console.log(`Objective: ${report.objective}`);
  console.log('\nDebt by status:');
  for (const group of report.byStatus) {
    console.log(`- ${group.key}: ${group.count}`);
    for (const item of group.items) console.log(`  - ${formatDebt(item)}`);
  }
  console.log('\nDebt by priority:');
  for (const group of report.byPriority) console.log(`- ${group.key}: ${group.count}`);
}

function formatActiveSprint(activeSprint: ActiveSprintStatusSummary | null): string {
  if (!activeSprint) return 'none';
  return `${activeSprint.n} — ${activeSprint.slug} (${activeSprint.status})`;
}

function formatTaskReference(task: TaskReference | null): string {
  if (!task) return 'none';
  const title = task.title ? ` — ${task.title}` : '';
  const status = task.status ? ` (${task.status})` : '';
  return `${task.id}${title}${status}`;
}

function formatDebt(debt: Debt): string {
  const target = debt.targetSprint === null ? 'unscheduled' : `sprint ${debt.targetSprint}`;
  return `${debt.id}: ${debt.title} [${debt.priority}, ${target}]`;
}

function printStatusHelp(): void {
  console.log(`Usage:
  kyro status [brief|full|debt] [--kyro-scope <scope>] [--json]

Modes:
  brief   Read-only summary of scope, active sprint, next action, debt, and review debt (default)
  full    Brief report plus phase/task summary, review debt, and ADR summary
  debt    Debt grouped by status and priority

Notes:
  kyro status is read-only. Mutating debt commands such as debt-add, debt-resolve, and debt-escalate are intentionally unsupported.
`);
}
