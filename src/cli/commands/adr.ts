import { applyPlan, printPlan } from '../fs';
import { sprintJsonPath } from '../artifacts/paths';
import { loadScopeSprint, verifyWrittenSprint } from '../artifacts/load-sprint';
import { KyroCoreError } from '../core/errors';
import { dryRunFlag, helpFlag, option, parseFlags, takeUnlessDashed, type FlagSpec } from '../core/flags';
import { resolveScope } from '../core/scope-resolution';
import { emitToolCommandRun } from '../core/trace';
import type { AdrRecord, AdrStatus, OperationPlan, SprintFile } from '../types';
import { ADR_STATUS } from '../types';

/**
 * Tool-owned ADR append so agents do not hand-edit free-form ADR objects (post-mortem #2 F3).
 *
 *   kyro adr add --title ... --context ... --decision ... --consequence ... --alternative ...
 */

export function runAdrCommand(rawArgs: string[]): void {
  const sub = rawArgs[0];
  if (sub === undefined || sub === '--help' || sub === '-h' || sub === 'help') {
    printAdrHelp();
    return;
  }
  if (sub === 'add') {
    runAdrAdd(rawArgs.slice(1));
    return;
  }
  throw new KyroCoreError('INVALID_INPUT', `Unknown adr subcommand "${sub}".`, 'Use: kyro adr add. Run kyro adr --help.');
}

function runAdrAdd(rawArgs: string[]): void {
  const args = parseAdrAddArgs(rawArgs);
  if (args.help) {
    printAdrHelp();
    return;
  }
  const scope = resolveScope(args.scope);
  const { plan, adr } = buildAdrAddPlan(scope, args);
  printPlan(`Add ${adr.id} to scope ${scope}`, plan);
  if (args.dryRun) {
    console.log('Dry run complete. No files changed.');
    return;
  }
  emitToolCommandRun(scope, 'cli', 'adr add', { id: adr.id });
  applyPlan(plan);
  revalidateWritten(scope);
  console.log(`ADR ${adr.id} added (${adr.status}): "${adr.title}".`);
}

export interface AdrAddArgs {
  id: string | null;
  title: string;
  status: AdrStatus;
  date: string | null;
  context: string;
  decision: string;
  consequences: string[];
  alternatives: string[];
  scope: string | null;
  dryRun: boolean;
  help: boolean;
}

export function buildAdrAddPlan(scope: string, args: AdrAddArgs): { sprint: SprintFile; plan: OperationPlan[]; adr: AdrRecord } {
  const sprint = loadValidSprint(scope);
  const title = args.title.trim();
  const context = args.context.trim();
  const decision = args.decision.trim();
  if (!title) throw new KyroCoreError('INVALID_INPUT', '--title is required.', 'Pass --title "Short decision title".');
  if (!context) throw new KyroCoreError('INVALID_INPUT', '--context is required.', 'Pass --context "Why this decision is needed".');
  if (!decision) throw new KyroCoreError('INVALID_INPUT', '--decision is required.', 'Pass --decision "What we decided".');
  if (args.consequences.length === 0) {
    throw new KyroCoreError('INVALID_INPUT', 'At least one --consequence is required.', 'Pass --consequence "Follow-on impact" (repeatable).');
  }
  if (args.alternatives.length === 0) {
    throw new KyroCoreError('INVALID_INPUT', 'At least one --alternative is required.', 'Pass --alternative "Option we rejected" (repeatable).');
  }

  const existing = sprint.adrs ?? [];
  const id = args.id?.trim() || nextAdrId(existing);
  if (!/^ADR-\d{4}$/.test(id)) {
    throw new KyroCoreError('INVALID_INPUT', `ADR id "${id}" must match ADR-0001 format.`, 'Pass --id ADR-0007 or omit for auto-id.');
  }
  if (existing.some((adr) => adr.id === id)) {
    throw new KyroCoreError('INVALID_INPUT', `ADR id "${id}" already exists.`, 'Choose a new id or omit --id for auto allocation.');
  }

  const date = args.date?.trim() || todayIsoDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new KyroCoreError('INVALID_INPUT', `date "${date}" must be YYYY-MM-DD.`, 'Pass --date 2026-07-22 or omit for today.');
  }

  const adr: AdrRecord = {
    id,
    title,
    status: args.status,
    date,
    context,
    decision,
    consequences: args.consequences.map((c) => c.trim()).filter(Boolean),
    alternatives: args.alternatives.map((a) => a.trim()).filter(Boolean),
  };
  if (adr.consequences.length === 0 || adr.alternatives.length === 0) {
    throw new KyroCoreError('INVALID_INPUT', 'consequences and alternatives must be non-empty after trim.', 'Pass non-empty --consequence and --alternative values.');
  }

  const next: SprintFile = {
    ...sprint,
    adrs: [...existing, adr],
  };
  const plan: OperationPlan[] = [{ action: 'write', path: sprintJsonPath(scope), content: `${JSON.stringify(next, null, 2)}\n` }];
  return { sprint: next, plan, adr };
}

function nextAdrId(existing: AdrRecord[]): string {
  let max = 0;
  for (const adr of existing) {
    const match = /^ADR-(\d{4})$/.exec(adr.id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `ADR-${String(max + 1).padStart(4, '0')}`;
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function loadValidSprint(scope: string): SprintFile {
  return loadScopeSprint(scope, { strict: true, action: 'add ADR for' });
}

function revalidateWritten(scope: string): void {
  verifyWrittenSprint(scope, 'adr add');
}

const adrValue = takeUnlessDashed((flagName) => new KyroCoreError('INVALID_INPUT', `${flagName} requires a value.`, `Pass ${flagName} <value>.`));
const adrOption = (name: string, apply: (args: AdrAddArgs, value: string) => void): FlagSpec<AdrAddArgs> => option([name], adrValue, apply);

const ADR_ADD_FLAGS: readonly FlagSpec<AdrAddArgs>[] = [
  helpFlag(),
  dryRunFlag(),
  adrOption('--id', (a, v) => { a.id = v; }),
  adrOption('--title', (a, v) => { a.title = v; }),
  adrOption('--status', (a, v) => {
    if (!Object.values(ADR_STATUS).includes(v as AdrStatus)) {
      throw new KyroCoreError('INVALID_INPUT', `Invalid --status "${v}".`, `Use one of: ${Object.values(ADR_STATUS).join(', ')}.`);
    }
    a.status = v as AdrStatus;
  }),
  adrOption('--date', (a, v) => { a.date = v; }),
  adrOption('--context', (a, v) => { a.context = v; }),
  adrOption('--decision', (a, v) => { a.decision = v; }),
  adrOption('--consequence', (a, v) => { a.consequences.push(v); }),
  adrOption('--alternative', (a, v) => { a.alternatives.push(v); }),
  adrOption('--kyro-scope', (a, v) => { a.scope = v; }),
];

function parseAdrAddArgs(args: string[]): AdrAddArgs {
  const out: AdrAddArgs = {
    id: null,
    title: '',
    status: ADR_STATUS.ACCEPTED,
    date: null,
    context: '',
    decision: '',
    consequences: [],
    alternatives: [],
    scope: null,
    dryRun: false,
    help: false,
  };
  return parseFlags(ADR_ADD_FLAGS, args, out, (arg) => {
    throw new KyroCoreError('INVALID_INPUT', `Unknown flag for adr add: ${arg}`, 'Run kyro adr --help.');
  });
}

function printAdrHelp(): void {
  console.log(`Usage:
  kyro adr add --title <text> --context <text> --decision <text> --consequence <text> [--consequence <text> ...] --alternative <text> [--alternative <text> ...] [--id ADR-0001] [--status accepted|proposed|rejected|superseded] [--date YYYY-MM-DD] [--kyro-scope <scope>] [--dry-run]

Tool-owned ADR append (full v4 AdrRecord). Prefer this over hand-editing sprint.adrs[].

Examples:
  kyro adr add --title "Use ledger for historical scenario coverage" \\
    --context "Analyze was noisy after close" \\
    --decision "Count closed-sprint scenario_refs from ledger archives" \\
    --consequence "Historical S* no longer MEDIUM" \\
    --alternative "Delete old scenarios" \\
    --kyro-scope harness-agent-ops
`);
}
