import { applyPlan, printPlan } from '../fs';
import { sprintJsonPath } from '../artifacts/paths';
import { DEBT_CLASSIFICATION, assessRawDebt } from '../artifacts/debt-contract';
import { loadScopeSprint, verifyWrittenSprint } from '../artifacts/load-sprint';
import { KyroCoreError } from '../core/errors';
import { dryRunFlag, helpFlag, option, parseFlags, takeUnlessDashed, type FlagSpec } from '../core/flags';
import { resolveScope } from '../core/scope-resolution';
import { emitToolCommandRun } from '../core/trace';
import type { Debt, OperationPlan, SprintFile } from '../types';
import { applyDebtChange, nextDebtId, type DebtChangeAction } from '../core/debt-transition';
import { sha256 } from '../core/digest';
import { withStateWriterLock } from '../pipeline/state-writer-lock';
import { readPackageVersion } from '../help';
import { debtEvolution, debtManifest, debtOperation } from '../remediation/debt';
import { planRemediation } from '../remediation/plan';
import { commitRemediationPlanUnlocked } from '../remediation/transaction';

const DEBT_PRIORITIES = ['critical', 'high', 'medium', 'low'] as const;
type DebtPriority = (typeof DEBT_PRIORITIES)[number];
// Ascending strength: escalate must move strictly rightward (low -> medium -> high -> critical).
const DEBT_PRIORITY_RANK: Record<DebtPriority, number> = { low: 0, medium: 1, high: 2, critical: 3 };

export function runDebtCommand(rawArgs: string[]): void {
  const [subcommand = '', ...rest] = rawArgs;
  if (subcommand === '' || subcommand === '--help' || subcommand === '-h' || subcommand === 'help') {
    printDebtHelp();
    return;
  }
  if (subcommand === 'add') {
    runAdd(rest);
    return;
  }
  if (subcommand === 'start') {
    runStart(rest);
    return;
  }
  if (subcommand === 'resolve') {
    runResolve(rest);
    return;
  }
  if (subcommand === 'defer') {
    runDefer(rest);
    return;
  }
  if (subcommand === 'escalate') {
    runEscalate(rest);
    return;
  }
  throw new KyroCoreError('UNKNOWN_SUBCOMMAND', `Unknown debt subcommand: ${subcommand}.`, 'Run kyro debt --help.');
}

// --- add ---

interface AddArgs {
  title: string;
  priority: DebtPriority | null;
  target: number | null;
  note: string | null;
  scope: string | null;
  dryRun: boolean;
  help: boolean;
}

function runAdd(rawArgs: string[]): void {
  const args = parseAddArgs(rawArgs);
  if (args.help) {
    printDebtHelp();
    return;
  }
  if (args.title.trim() === '') throw new KyroCoreError('INVALID_INPUT', 'Usage: kyro debt add --title <text> --priority <critical|high|medium|low> [--target <n>] [--note <text>]', '--title is required.');
  if (!args.priority) throw new KyroCoreError('INVALID_INPUT', '--priority is required and must be one of: critical, high, medium, low.', 'Pass --priority <critical|high|medium|low>.');

  const scope = resolveScope(args.scope);
  const sprint = readAndValidateSprint(scope);
  const nextId = nextDebtId(sprint.debt);
  const origin = sprint.activeSprint?.n ?? maxLedgerSprintNumber(sprint) ?? 1;
  const item: Debt = {
    id: nextId,
    title: args.title.trim(),
    origin,
    priority: args.priority,
    status: 'open',
    targetSprint: args.target,
    note: args.note ?? '',
  };
  const nextDebt = [...sprint.debt, item];
  const summary = `Debt ${item.id} added (priority ${item.priority}, status open).`;
  applyDebtMutation(scope, sprint, nextDebt, 'add', { id: item.id, priority: item.priority }, args.dryRun, summary);
}

/** Flags every debt subcommand accepts. */
interface DebtCommon { scope: string | null; dryRun: boolean; help: boolean }

const debtValue = takeUnlessDashed((flagName) => new KyroCoreError('INVALID_INPUT', `${flagName} requires a value`));
const debtOption = <S extends DebtCommon>(name: string, apply: (args: S, value: string, token: string) => void): FlagSpec<S> => option([name], debtValue, apply, true);

function debtCommonFlags<S extends DebtCommon>(): FlagSpec<S>[] {
  return [helpFlag<S>(), dryRunFlag<S>(), debtOption<S>('--kyro-scope', (a, v) => { a.scope = v; })];
}

/** Reads `<id>` as the first non-flag token; anything else is an unknown option of the subcommand. */
function debtIdFallback<S extends DebtCommon & { id: string }>(subcommand: string): (arg: string, state: S) => void {
  return (arg, state) => {
    if (!arg.startsWith('--') && !state.id) state.id = arg;
    else throw new KyroCoreError('INVALID_INPUT', `Unknown debt ${subcommand} option: ${arg}`);
  };
}

const ADD_FLAGS: readonly FlagSpec<AddArgs>[] = [
  ...debtCommonFlags<AddArgs>(),
  debtOption('--title', (a, v) => { a.title = v; }),
  debtOption('--priority', (a, v) => { a.priority = parsePriority(v); }),
  debtOption('--target', (a, v, token) => { a.target = parseNumber(v, token); }),
  debtOption('--note', (a, v) => { a.note = v; }),
];

function parseAddArgs(rawArgs: string[]): AddArgs {
  const args: AddArgs = { title: '', priority: null, target: null, note: null, scope: null, dryRun: false, help: false };
  return parseFlags(ADD_FLAGS, rawArgs, args, (arg) => {
    throw new KyroCoreError('INVALID_INPUT', `Unknown debt add option: ${arg}`);
  });
}

// --- start ---

interface TargetIdArgs {
  id: string;
  scope: string | null;
  dryRun: boolean;
  help: boolean;
}

function runStart(rawArgs: string[]): void {
  const args = parseTargetIdArgs(rawArgs, 'start');
  if (args.help) {
    printDebtHelp();
    return;
  }
  const scope = resolveScope(args.scope);
  const sprint = readAndValidateSprint(scope);
  const item = findDebt(sprint.debt, args.id);
  if (item.status === 'resolved') throw new KyroCoreError('INVALID_INPUT', `Debt ${item.id} is resolved; it cannot be restarted.`, 'Resolved debt is closed. Add a new debt item if the problem has recurred.');
  const nextDebt = sprint.debt.map((d) => (d.id === item.id ? { ...d, status: 'in_progress' as const } : d));
  applyDebtMutation(scope, sprint, nextDebt, 'start', { id: item.id }, args.dryRun, `Debt ${item.id} → in_progress.`);
}

// --- resolve ---

interface ResolveArgs {
  id: string;
  note: string | null;
  scope: string | null;
  dryRun: boolean;
  help: boolean;
}

function runResolve(rawArgs: string[]): void {
  const args = parseResolveArgs(rawArgs);
  if (args.help) {
    printDebtHelp();
    return;
  }
  const scope = resolveScope(args.scope);
  const sprint = readAndValidateSprint(scope);
  const item = findDebt(sprint.debt, args.id);
  const nextDebt = sprint.debt.map((d) => (d.id === item.id
    ? { ...d, status: 'resolved' as const, ...(args.note !== null ? { note: args.note } : {}) }
    : d));
  applyDebtMutation(scope, sprint, nextDebt, 'resolve', { id: item.id }, args.dryRun, `Debt ${item.id} → resolved.`);
}

const RESOLVE_FLAGS: readonly FlagSpec<ResolveArgs>[] = [
  ...debtCommonFlags<ResolveArgs>(),
  debtOption('--note', (a, v) => { a.note = v; }),
];

function parseResolveArgs(rawArgs: string[]): ResolveArgs {
  const args: ResolveArgs = { id: '', note: null, scope: null, dryRun: false, help: false };
  parseFlags(RESOLVE_FLAGS, rawArgs, args, debtIdFallback('resolve'));
  if (!args.id) throw new KyroCoreError('INVALID_INPUT', 'Usage: kyro debt resolve <id> [--note <text>]', 'Pass the debt id to resolve.');
  return args;
}

// --- defer ---

interface DeferArgs {
  id: string;
  target: number | null;
  note: string | null;
  scope: string | null;
  dryRun: boolean;
  help: boolean;
}

function runDefer(rawArgs: string[]): void {
  const args = parseDeferArgs(rawArgs);
  if (args.help) {
    printDebtHelp();
    return;
  }
  if (args.target === null) throw new KyroCoreError('INVALID_INPUT', '--target is required when deferring debt.', 'Pass --target <sprint-number>.');
  if (args.note === null || args.note.trim() === '') throw new KyroCoreError('INVALID_INPUT', '--note is required when deferring debt (a concrete reason, not a placeholder).', 'Pass --note "<why this is deferred>".');

  const scope = resolveScope(args.scope);
  const sprint = readAndValidateSprint(scope);
  const item = findDebt(sprint.debt, args.id);
  const target = args.target;
  const note = args.note;
  const nextDebt = sprint.debt.map((d) => (d.id === item.id ? { ...d, status: 'deferred' as const, targetSprint: target, note } : d));
  applyDebtMutation(scope, sprint, nextDebt, 'defer', { id: item.id, target }, args.dryRun, `Debt ${item.id} → deferred (target sprint ${target}).`);
}

const DEFER_FLAGS: readonly FlagSpec<DeferArgs>[] = [
  ...debtCommonFlags<DeferArgs>(),
  debtOption('--target', (a, v, token) => { a.target = parseNumber(v, token); }),
  debtOption('--note', (a, v) => { a.note = v; }),
];

function parseDeferArgs(rawArgs: string[]): DeferArgs {
  const args: DeferArgs = { id: '', target: null, note: null, scope: null, dryRun: false, help: false };
  parseFlags(DEFER_FLAGS, rawArgs, args, debtIdFallback('defer'));
  if (!args.id) throw new KyroCoreError('INVALID_INPUT', 'Usage: kyro debt defer <id> --target <n> --note <text>', 'Pass the debt id to defer.');
  return args;
}

// --- escalate ---

interface EscalateArgs {
  id: string;
  priority: DebtPriority | null;
  scope: string | null;
  dryRun: boolean;
  help: boolean;
}

function runEscalate(rawArgs: string[]): void {
  const args = parseEscalateArgs(rawArgs);
  if (args.help) {
    printDebtHelp();
    return;
  }
  if (!args.priority) throw new KyroCoreError('INVALID_INPUT', '--priority is required and must be one of: critical, high, medium, low.', 'Pass --priority <critical|high|medium|low>.');

  const scope = resolveScope(args.scope);
  const sprint = readAndValidateSprint(scope);
  const item = findDebt(sprint.debt, args.id);
  const currentPriority = item.priority as DebtPriority;
  if (DEBT_PRIORITY_RANK[args.priority] <= DEBT_PRIORITY_RANK[currentPriority]) {
    throw new KyroCoreError('INVALID_INPUT', `escalate must raise priority; ${item.id} is already ${currentPriority}, cannot escalate to ${args.priority}.`, 'Use a lower-priority workflow (currently unsupported by kyro debt) to lower priority — escalate only raises it.');
  }
  const nextPriority = args.priority;
  const nextDebt = sprint.debt.map((d) => (d.id === item.id ? { ...d, priority: nextPriority } : d));
  applyDebtMutation(scope, sprint, nextDebt, 'escalate', { id: item.id, priority: nextPriority }, args.dryRun, `Debt ${item.id} → priority ${nextPriority}.`);
}

const ESCALATE_FLAGS: readonly FlagSpec<EscalateArgs>[] = [
  ...debtCommonFlags<EscalateArgs>(),
  debtOption('--priority', (a, v) => { a.priority = parsePriority(v); }),
];

function parseEscalateArgs(rawArgs: string[]): EscalateArgs {
  const args: EscalateArgs = { id: '', priority: null, scope: null, dryRun: false, help: false };
  parseFlags(ESCALATE_FLAGS, rawArgs, args, debtIdFallback('escalate'));
  if (!args.id) throw new KyroCoreError('INVALID_INPUT', 'Usage: kyro debt escalate <id> --priority <critical|high|medium|low>', 'Pass the debt id to escalate.');
  return args;
}

// --- shared: read/validate/apply ---

/**
 * Read-only compatibility reading, used purely to tell the operator *what* the live debt is when a
 * mutation is refused. It never authorizes a write: the command still aborts before touching disk.
 */
function describeDebtDrift(value: unknown): string {
  const debt = isRecord(value) ? value.debt : undefined;
  if (!Array.isArray(debt)) return '';
  const notes: string[] = [];
  debt.forEach((entry, index) => {
    const assessment = assessRawDebt(entry);
    if (assessment.classification === DEBT_CLASSIFICATION.CANONICAL) return;
    const id = isRecord(entry) && typeof entry.id === 'string' ? entry.id : `debt[${index}]`;
    const blocking = assessment.diagnostics.filter((d) => d.severity === 'blocking').map((d) => d.field);
    notes.push(`${id} is ${assessment.classification}${blocking.length > 0 ? ` (${blocking.join(', ')})` : ''}`);
  });
  return notes.length > 0 ? ` Debt compatibility: ${notes.join('; ')}.` : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readAndValidateSprint(scope: string): SprintFile {
  const sprint = loadScopeSprint(scope, {
    strict: true,
    action: 'mutate debt for',
    remedy: { INVALID_SPRINT_SHAPE: 'Fix sprint.json shape first. The compatibility reading above is a diagnostic, not an authorization to write legacy debt back.' },
    shapeDetail: describeDebtDrift,
  });
  if (sprint.completion || sprint.status === 'completed') throw new KyroCoreError('SCOPE_COMPLETED', 'Reopen the scope before changing debt.', `Run kyro scope reopen --kyro-scope ${scope} --reason "<why further work is needed>" --yes.`);
  if (sprint.retirement || sprint.status === 'retired') throw new KyroCoreError('SCOPE_RETIRED', 'Retired scopes cannot change debt.');
  return sprint;
}

function findDebt(debt: Debt[], id: string): Debt {
  const found = debt.find((item) => item.id === id);
  if (!found) throw new KyroCoreError('DEBT_NOT_FOUND', `Debt not found: ${id}`, 'Run kyro status debt to list known debt ids.');
  return found;
}

function applyDebtMutation(
  scope: string,
  sprint: SprintFile,
  nextDebt: Debt[],
  op: string,
  traceArgs: Record<string, string | number | boolean>,
  dryRun: boolean,
  successMessage: string,
): void {
  return withStateWriterLock(() => {
    const current = readAndValidateSprint(scope);
    if (sha256(current) !== sha256(sprint)) throw new KyroCoreError('STATE_DIVERGED', 'Debt changed while the command was being prepared. Retry against fresh state.');
    const after = nextDebt.find((item) => item.id === traceArgs.id)!;
    const shared = applyDebtChange(sprint, op as DebtChangeAction, after);
    if (sha256(shared) !== sha256(nextDebt)) throw new KyroCoreError('INVALID_INPUT', 'Debt mutation does not match the shared transition contract.');
    const reason = after.note.trim() || `Debt ${op}: ${after.id}`;
    const evolution = !sprint.activeSprint ? debtEvolution(scope, sprint, true) : null;
    if (evolution && (evolution.kind === 'broken' || !evolution.matchesLive)) throw new KyroCoreError('DIVERGED', evolution.kind === 'broken' ? evolution.detail : 'Unrecorded post-close evolution remains.', `Preview kyro scope complete --kyro-scope ${scope} --reconcile-debt --reason "<reason>" --dry-run.`);
    if (evolution) {
      const remediation = planRemediation({ scope, manifest: debtManifest(scope, sprint, debtOperation(sprint, op as DebtChangeAction, after, reason)), now: new Date().toISOString(), kyroVersion: readPackageVersion() });
      printPlan(`Debt ${op} for scope ${scope}`, [{ action: 'write', path: remediation.recordPath }, { action: 'write', path: remediation.sprintPath }]);
      if (dryRun) { console.log('Dry run complete. No files changed.'); return; }
      commitRemediationPlanUnlocked(remediation);
      emitToolCommandRun(scope, 'cli', 'debt', { op, ...traceArgs });
      console.log(successMessage);
      return;
    }
    // Before a close checkpoint, only the CLI-owned live debt collection changes.
    const nextSprint: SprintFile = { ...(JSON.parse(JSON.stringify(sprint)) as SprintFile), debt: nextDebt };
    const plan: OperationPlan[] = [{ action: 'write', path: sprintJsonPath(scope), content: `${JSON.stringify(nextSprint, null, 2)}\n` }];
    printPlan(`Debt ${op} for scope ${scope}`, plan);

    if (dryRun) {
      console.log('Dry run complete. No files changed.');
      return;
    }

    emitToolCommandRun(scope, 'cli', 'debt', { op, ...traceArgs });
    applyPlan(plan);

    verifyWrittenSprint(scope, `debt ${op}`);
    console.log(successMessage);
  });
}

// --- helpers ---

function maxLedgerSprintNumber(sprint: SprintFile): number | null {
  if (sprint.ledger.length === 0) return null;
  return sprint.ledger.reduce((max, entry) => (entry.n > max ? entry.n : max), sprint.ledger[0].n);
}

function parseTargetIdArgs(rawArgs: string[], subcommand: string): TargetIdArgs {
  const args: TargetIdArgs = { id: '', scope: null, dryRun: false, help: false };
  parseFlags(debtCommonFlags<TargetIdArgs>(), rawArgs, args, debtIdFallback(subcommand));
  if (!args.id) throw new KyroCoreError('INVALID_INPUT', `Usage: kyro debt ${subcommand} <id>`, 'Pass the debt id.');
  return args;
}

function parsePriority(value: string): DebtPriority {
  if ((DEBT_PRIORITIES as readonly string[]).includes(value)) return value as DebtPriority;
  throw new KyroCoreError('INVALID_INPUT', '--priority must be one of: critical, high, medium, low.');
}

function parseNumber(value: string, flag: string): number {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new KyroCoreError('INVALID_INPUT', `${flag} must be a number.`);
  return n;
}

function printDebtHelp(): void {
  console.log(`Usage:
  kyro debt add --title <text> --priority <critical|high|medium|low> [--target <n>] [--note <text>] [--kyro-scope <scope>] [--dry-run]
  kyro debt start <id> [--kyro-scope <scope>] [--dry-run]
  kyro debt resolve <id> [--note <text>] [--kyro-scope <scope>] [--dry-run]
  kyro debt defer <id> --target <n> --note <text> [--kyro-scope <scope>] [--dry-run]
  kyro debt escalate <id> --priority <critical|high|medium|low> [--kyro-scope <scope>] [--dry-run]

Tool-owned mutation of sprint.json.debt[] (no hand-edit). Debt is never deleted — only its status,
priority, target sprint, or note change. escalate only raises priority (low < medium < high < critical);
defer requires both --target and --note (a concrete reason).`);
}
