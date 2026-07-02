import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { resolveManagedPath } from '../fs';
import { traceDir, traceEventsPath } from '../artifacts/paths';
import type { TraceEvent, TraceEventType } from '../types';

export const TRACE_EVENT_TYPES = [
  'route_selected',
  'tool_command_run',
  'validation_result',
  'gate_approved',
  'retry_count',
  'blocked_reason',
  'close_snapshot',
] as const satisfies readonly TraceEventType[];

export interface TraceReadOptions {
  tail?: number;
  type?: TraceEventType;
}

export interface TraceReadResult {
  events: TraceEvent[];
  skipped: number;
}

export function emitTraceEvent(event: TraceEvent): void {
  if (traceDisabled()) return;
  try {
    const safe = sanitizeTraceEvent(event);
    mkdirSync(resolveManagedPath(traceDir(safe.scope)), { recursive: true });
    appendFileSync(resolveManagedPath(traceEventsPath(safe.scope)), `${JSON.stringify(safe)}\n`, 'utf-8');
  } catch (error: unknown) {
    if (process.env.KYRO_TRACE_DEBUG === '1' || process.env.KYRO_TRACE_DEBUG === 'true') {
      process.stderr.write(`kyro trace disabled for this event: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }
}

export function readTrace(scope: string, options: TraceReadOptions = {}): TraceReadResult {
  const path = resolveManagedPath(traceEventsPath(scope));
  if (!existsSync(path)) return { events: [], skipped: 0 };
  const text = readFileSync(path, 'utf-8');
  const events: TraceEvent[] = [];
  let skipped = 0;
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (isTraceEvent(parsed) && (!options.type || parsed.type === options.type)) events.push(parsed);
      else skipped += 1;
    } catch {
      skipped += 1;
    }
  }
  const tail = normalizeTail(options.tail);
  return { events: tail === null ? events : events.slice(-tail), skipped };
}

export function traceSnapshotId(snapshotPath: string): string {
  return basename(snapshotPath);
}

export function emitToolCommandRun(scope: string, surface: 'cli' | 'mcp', command: string, args?: Record<string, unknown>): void {
  emitTraceEvent({
    v: 1,
    ts: now(),
    scope,
    type: 'tool_command_run',
    surface,
    command,
    ...(args ? { args: sanitizeArgs(args) } : {}),
  });
}

export function emitGateApproved(scope: string, gate: string, taskId?: string): void {
  emitTraceEvent({ v: 1, ts: now(), scope, type: 'gate_approved', gate, ...(taskId ? { taskId } : {}) });
}

export function emitRetryCount(scope: string, round: number, limit: number, blocked: boolean): void {
  emitTraceEvent({ v: 1, ts: now(), scope, type: 'retry_count', round, limit, blocked });
}

export function emitBlockedReason(scope: string, reason: string, code?: string): void {
  emitTraceEvent({ v: 1, ts: now(), scope, type: 'blocked_reason', reason, ...(code ? { code } : {}) });
}

export function isTraceEventType(value: string): value is TraceEventType {
  return (TRACE_EVENT_TYPES as readonly string[]).includes(value);
}

function traceDisabled(): boolean {
  const value = process.env.KYRO_TRACE?.toLowerCase();
  return value === '0' || value === 'off';
}

function now(): string {
  return new Date().toISOString();
}

function sanitizeTraceEvent(event: TraceEvent): TraceEvent {
  return sanitizeValue(event) as TraceEvent;
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === 'string') return boundString(value);
  if (Array.isArray(value)) return value.slice(0, 20).map(sanitizeValue);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[key] = sanitizeValue(item);
    return out;
  }
  return value;
}

function boundString(value: string): string {
  const clean = value.replace(/[\r\n]+/g, ' ');
  return clean.length <= 200 ? clean : `${clean.slice(0, 197)}...`;
}

function sanitizeArgs(args: Record<string, unknown>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(args).slice(0, 10)) {
    if (typeof value === 'string') out[key] = boundString(value);
    else if (typeof value === 'number' || typeof value === 'boolean') out[key] = value;
  }
  return out;
}

function normalizeTail(value: number | undefined): number | null {
  if (value === undefined) return null;
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.floor(value);
}

function isTraceEvent(value: unknown): value is TraceEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as { v?: unknown; ts?: unknown; scope?: unknown; type?: unknown };
  return record.v === 1
    && typeof record.ts === 'string'
    && typeof record.scope === 'string'
    && typeof record.type === 'string'
    && isTraceEventType(record.type);
}
