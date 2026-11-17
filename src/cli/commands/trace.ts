import { existsSync, rmSync } from 'node:fs';
import { assertStateWriterLeaseHealthy } from '../pipeline/state-writer-lock';
import { legacyTraceEventsPath, traceEventsPath } from '../artifacts/paths';
import { resolveManagedPath } from '../fs';
import { KyroCoreError } from '../core/errors';
import { flag, helpFlag, option, parseFlags, takeNonEmpty, takeNonEmptyUnlessDashed, type FlagSpec } from '../core/flags';
import { resolveScope } from '../core/scope-resolution';
import { isTraceEventType, readTrace } from '../core/trace';
import type { TraceEventType } from '../types';

interface TraceCommandArgs {
  scope: string | null;
  json: boolean;
  tail?: number;
  type?: TraceEventType;
  clearScope: string | null;
  help: boolean;
}

export function runTraceCommand(rawArgs: string[]): void {
  const args = parseTraceArgs(rawArgs);
  if (args.help) {
    printTraceHelp();
    return;
  }
  if (args.clearScope) {
    clearTrace(args.clearScope);
    return;
  }
  const scope = resolveScope(args.scope);
  const result = readTrace(scope, { tail: args.tail, type: args.type });
  if (args.json) {
    for (const event of result.events) console.log(JSON.stringify(event));
    if (result.skipped > 0) process.stderr.write(`Skipped ${result.skipped} corrupt trace line(s).\n`);
    return;
  }
  printTrace(scope, result.events, result.skipped);
}

const traceValue = (flagName: string) => takeNonEmpty(() => new KyroCoreError('INVALID_INPUT', `${flagName} requires a value`));

const TRACE_FLAGS: readonly FlagSpec<TraceCommandArgs>[] = [
  helpFlag(),
  flag(['--json'], (a: TraceCommandArgs) => { a.json = true; }),
  option(['--kyro-scope'], traceValue('--kyro-scope'), (a, v) => { a.scope = v; }, true),
  option(['--tail'], traceValue('--tail'), (a, v) => { a.tail = parseTail(v); }, true),
  option(['--type'], traceValue('--type'), (a, v) => { a.type = parseType(v); }, true),
  option(['--clear'], takeNonEmptyUnlessDashed(() => new KyroCoreError('INVALID_INPUT', '--clear requires an explicit scope')), (a, v) => { a.clearScope = v; }),
];

function parseTraceArgs(rawArgs: string[]): TraceCommandArgs {
  const args: TraceCommandArgs = { scope: null, json: false, clearScope: null, help: false };
  return parseFlags(TRACE_FLAGS, rawArgs, args, (arg, state) => {
    if (!arg.startsWith('--') && state.scope === null) state.scope = arg;
    else throw new KyroCoreError('INVALID_INPUT', `Unknown trace option: ${arg}`);
  });
}

function parseTail(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new KyroCoreError('INVALID_INPUT','--tail must be a non-negative integer');
  return parsed;
}

function parseType(value: string): TraceEventType {
  if (!isTraceEventType(value)) throw new KyroCoreError('INVALID_INPUT', `Unknown trace type: ${value}`);
  return value;
}

function clearTrace(scope: string): void {
  const path = resolveManagedPath(traceEventsPath(scope));
  const legacyPath = resolveManagedPath(legacyTraceEventsPath(scope));
  const hadCurrent = existsSync(path);
  const hadLegacy = existsSync(legacyPath);
  if (!hadCurrent && !hadLegacy) {
    console.log(`Trace already empty for scope ${scope}: ${traceEventsPath(scope)}`);
    return;
  }
  assertStateWriterLeaseHealthy();
  if (hadCurrent) rmSync(path, { force: true });
  if (hadLegacy) rmSync(legacyPath, { force: true });
  console.log(`Trace cleared for scope ${scope}: ${traceEventsPath(scope)}${hadLegacy ? ` (and legacy ${legacyTraceEventsPath(scope)})` : ''}`);
}

function printTrace(scope: string, events: Array<{ ts: string; type: string }>, skipped: number): void {
  console.log(`Trace: ${scope}`);
  if (events.length === 0) console.log('No trace events.');
  for (const event of events) console.log(`${event.ts}  ${event.type}`);
  if (skipped > 0) console.log(`Skipped corrupt lines: ${skipped}`);
}

function printTraceHelp(): void {
  console.log(`Usage: kyro trace [scope|--kyro-scope <scope>] [--json] [--tail N] [--type <event>] [--clear <scope>]\n\nTrace is append-only audit data. It is never used for routing or decisions.`);
}
