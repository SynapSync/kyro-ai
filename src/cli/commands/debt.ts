import { applyPlan, printPlan } from '../fs';
import { readJsonSafely } from '../artifacts/json';
import { sprintJsonPath } from '../artifacts/paths';
import { DEBT_CLASSIFICATION, assessRawDebt } from '../artifacts/debt-contract';
import { asSprintFile, validateSprintFile } from '../artifacts/schema';
import { KyroCoreError } from '../core/errors';
import { resolveScope } from '../core/scope-resolution';
import { emitToolCommandRun } from '../core/trace';
import type { Debt, OperationPlan, SprintFile } from '../types';

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

function parseAddArgs(rawArgs: string[]): AddArgs {
  let title = '';
  let priority: DebtPriority | null = null;
  let target: number | null = null;
  let note: string | null = null;
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
    else if (arg === '--priority') { priority = parsePriority(requireValue(rawArgs, i, arg)); i += 1; }
    else if (arg.startsWith('--priority=')) priority = parsePriority(arg.slice('--priority='.length));
    else if (arg === '--target') { target = requireNumber(rawArgs, i, arg); i += 1; }
    else if (arg.startsWith('--target=')) target = parseNumber(arg.slice('--target='.length), arg);
    else if (arg === '--note') { note = requireValue(rawArgs, i, arg); i += 1; }
    else if (arg.startsWith('--note=')) note = arg.slice('--note='.length);
    else throw new KyroCoreError('INVALID_INPUT', `Unknown debt add option: ${arg}`);
  }
  return { title, priority, target, note, scope, dryRun, help };
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

function parseResolveArgs(rawArgs: string[]): ResolveArgs {
  let id = '';
  let note: string | null = null;
  let scope: string | null = null;
  let dryRun = false;
  let help = false;
  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    if (arg === '--help' || arg === '-h') help = true;
    else if (arg === '--dry-run') dryRun = true;
    else if (arg === '--kyro-scope') { scope = requireValue(rawArgs, i, arg); i += 1; }
    else if (arg.startsWith('--kyro-scope=')) scope = arg.slice('--kyro-scope='.length);
    else if (arg === '--note') { note = requireValue(rawArgs, i, arg); i += 1; }
    else if (arg.startsWith('--note=')) note = arg.slice('--note='.length);
    else if (!arg.startsWith('--') && !id) id = arg;
    else throw new KyroCoreError('INVALID_INPUT', `Unknown debt resolve option: ${arg}`);
  }
  if (!id) throw new KyroCoreError('INVALID_INPUT', 'Usage: kyro debt resolve <id> [--note <text>]', 'Pass the debt id to resolve.');
  return { id, note, scope, dryRun, help };
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

function parseDeferArgs(rawArgs: string[]): DeferArgs {
  let id = '';
  let target: number | null = null;
  let note: string | null = null;
  let scope: string | null = null;
  let dryRun = false;
  let help = false;
  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    if (arg === '--help' || arg === '-h') help = true;
    else if (arg === '--dry-run') dryRun = true;
    else if (arg === '--kyro-scope') { scope = requireValue(rawArgs, i, arg); i += 1; }
    else if (arg.startsWith('--kyro-scope=')) scope = arg.slice('--kyro-scope='.length);
    else if (arg === '--target') { target = requireNumber(rawArgs, i, arg); i += 1; }
    else if (arg.startsWith('--target=')) target = parseNumber(arg.slice('--target='.length), arg);
    else if (arg === '--note') { note = requireValue(rawArgs, i, arg); i += 1; }
    else if (arg.startsWith('--note=')) note = arg.slice('--note='.length);
    else if (!arg.startsWith('--') && !id) id = arg;
    else throw new KyroCoreError('INVALID_INPUT', `Unknown debt defer option: ${arg}`);
  }
  if (!id) throw new KyroCoreError('INVALID_INPUT', 'Usage: kyro debt defer <id> --target <n> --note <text>', 'Pass the debt id to defer.');
  return { id, target, note, scope, dryRun, help };
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

function parseEscalateArgs(rawArgs: string[]): EscalateArgs {
  let id = '';
  let priority: DebtPriority | null = null;
  let scope: string | null = null;
  let dryRun = false;
  let help = false;
  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    if (arg === '--help' || arg === '-h') help = true;
    else if (arg === '--dry-run') dryRun = true;
    else if (arg === '--kyro-scope') { scope = requireValue(rawArgs, i, arg); i += 1; }
    else if (arg.startsWith('--kyro-scope=')) scope = arg.slice('--kyro-scope='.length);
    else if (arg === '--priority') { priority = parsePriority(requireValue(rawArgs, i, arg)); i += 1; }
    else if (arg.startsWith('--priority=')) priority = parsePriority(arg.slice('--priority='.length));
    else if (!arg.startsWith('--') && !id) id = arg;
    else throw new KyroCoreError('INVALID_INPUT', `Unknown debt escalate option: ${arg}`);
  }
  if (!id) throw new KyroCoreError('INVALID_INPUT', 'Usage: kyro debt escalate <id> --priority <critical|high|medium|low>', 'Pass the debt id to escalate.');
  return { id, priority, scope, dryRun, help };
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
  const read = readJsonSafely(sprintJsonPath(scope));
  if (!read.exists) throw new KyroCoreError('SCOPE_NOT_FOUND', `Scope "${scope}" has no sprint.json.`, 'Create the scope with /kyro:forge (INIT) or choose another scope.');
  if (read.error) throw new KyroCoreError('INVALID_JSON', `sprint.json for "${scope}" is invalid JSON (${read.error}).`, 'Fix invalid JSON or restore from an archive snapshot.');
  const issues = validateSprintFile(read.value, `${scope}/sprint.json`);
  if (issues.length > 0) {
    const detail = issues.map((issue) => `${issue.field} ${issue.message}`).join('; ');
    throw new KyroCoreError(
      'INVALID_SPRINT_SHAPE',
      `Cannot mutate debt for ${scope}: sprint.json has shape drift — ${detail}.${describeDebtDrift(read.value)}`,
      'Fix sprint.json shape first. The compatibility reading above is a diagnostic, not an authorization to write legacy debt back.',
    );
  }
  const sprint = asSprintFile(read.value);
  if (!sprint) throw new KyroCoreError('INVALID_SPRINT_SHAPE', `sprint.json for "${scope}" does not match the v4 schema.`, `Run kyro doctor --artifacts --kyro-scope ${scope}.`);
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
  // Deep-clone-then-mutate mirrors record-evidence/review: the plan carries the whole file (sprint.json
  // has one artifact, not per-field patches), but only debt[] differs from the source.
  const nextSprint: SprintFile = { ...(JSON.parse(JSON.stringify(sprint)) as SprintFile), debt: nextDebt };
  const plan: OperationPlan[] = [{ action: 'write', path: sprintJsonPath(scope), content: `${JSON.stringify(nextSprint, null, 2)}\n` }];
  printPlan(`Debt ${op} for scope ${scope}`, plan);

  if (dryRun) {
    console.log('Dry run complete. No files changed.');
    return;
  }

  emitToolCommandRun(scope, 'cli', 'debt', { op, ...traceArgs });
  applyPlan(plan);

  const verify = readJsonSafely(sprintJsonPath(scope));
  if (verify.error || !verify.exists) throw new KyroCoreError('INVALID_JSON', `debt ${op} wrote sprint.json but re-parse failed (${verify.error ?? 'missing'}).`, 'Restore from an archive snapshot.');
  const issues = validateSprintFile(verify.value, `${scope}/sprint.json`);
  if (issues.length > 0) {
    const detail = issues.map((issue) => `${issue.field} ${issue.message}`).join('; ');
    throw new KyroCoreError('INVALID_SPRINT_SHAPE', `debt ${op} wrote sprint.json but it failed validation — ${detail}.`, 'Restore from an archive snapshot.');
  }
  console.log(successMessage);
}

// --- helpers ---

function nextDebtId(debt: Debt[]): string {
  let max = 0;
  for (const item of debt) {
    const match = /^debt-(\d+)$/.exec(item.id);
    if (match) {
      const n = Number.parseInt(match[1], 10);
      if (n > max) max = n;
    }
  }
  return `debt-${max + 1}`;
}

function maxLedgerSprintNumber(sprint: SprintFile): number | null {
  if (sprint.ledger.length === 0) return null;
  return sprint.ledger.reduce((max, entry) => (entry.n > max ? entry.n : max), sprint.ledger[0].n);
}

function parseTargetIdArgs(rawArgs: string[], subcommand: string): TargetIdArgs {
  let id = '';
  let scope: string | null = null;
  let dryRun = false;
  let help = false;
  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    if (arg === '--help' || arg === '-h') help = true;
    else if (arg === '--dry-run') dryRun = true;
    else if (arg === '--kyro-scope') { scope = requireValue(rawArgs, i, arg); i += 1; }
    else if (arg.startsWith('--kyro-scope=')) scope = arg.slice('--kyro-scope='.length);
    else if (!arg.startsWith('--') && !id) id = arg;
    else throw new KyroCoreError('INVALID_INPUT', `Unknown debt ${subcommand} option: ${arg}`);
  }
  if (!id) throw new KyroCoreError('INVALID_INPUT', `Usage: kyro debt ${subcommand} <id>`, 'Pass the debt id.');
  return { id, scope, dryRun, help };
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

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) throw new KyroCoreError('INVALID_INPUT', `${flag} requires a value`);
  return value;
}

function requireNumber(args: string[], index: number, flag: string): number {
  return parseNumber(requireValue(args, index, flag), flag);
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
