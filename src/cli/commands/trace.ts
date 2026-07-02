import { existsSync, rmSync } from 'node:fs';
import { traceEventsPath } from '../artifacts/paths';
import { resolveManagedPath } from '../fs';
import { KyroCoreError } from '../core/errors';
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

function parseTraceArgs(rawArgs: string[]): TraceCommandArgs {
  const args: TraceCommandArgs = { scope: null, json: false, clearScope: null, help: false };
  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--json') args.json = true;
    else if (arg === '--kyro-scope') {
      const value = rawArgs[i + 1];
      if (!value) throw new Error('--kyro-scope requires a value');
      args.scope = value;
      i += 1;
    } else if (arg.startsWith('--kyro-scope=')) args.scope = arg.slice('--kyro-scope='.length);
    else if (arg === '--tail') {
      const value = rawArgs[i + 1];
      if (!value) throw new Error('--tail requires a value');
      args.tail = parseTail(value);
      i += 1;
    } else if (arg.startsWith('--tail=')) args.tail = parseTail(arg.slice('--tail='.length));
    else if (arg === '--type') {
      const value = rawArgs[i + 1];
      if (!value) throw new Error('--type requires a value');
      args.type = parseType(value);
      i += 1;
    } else if (arg.startsWith('--type=')) args.type = parseType(arg.slice('--type='.length));
    else if (arg === '--clear') {
      const value = rawArgs[i + 1];
      if (!value || value.startsWith('--')) throw new Error('--clear requires an explicit scope');
      args.clearScope = value;
      i += 1;
    } else if (!arg.startsWith('--') && args.scope === null) args.scope = arg;
    else throw new Error(`Unknown trace option: ${arg}`);
  }
  return args;
}

function parseTail(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error('--tail must be a non-negative integer');
  return parsed;
}

function parseType(value: string): TraceEventType {
  if (!isTraceEventType(value)) throw new KyroCoreError('INVALID_INPUT', `Unknown trace type: ${value}`);
  return value;
}

function clearTrace(scope: string): void {
  const path = resolveManagedPath(traceEventsPath(scope));
  if (existsSync(path)) {
    rmSync(path, { force: true });
    console.log(`Trace cleared for scope ${scope}: ${traceEventsPath(scope)}`);
    return;
  }
  console.log(`Trace already empty for scope ${scope}: ${traceEventsPath(scope)}`);
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
