import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { assertStateWriterLeaseHealthyIfHeld } from '../pipeline/state-writer-lock';
import { basename } from 'node:path';
import { resolveManagedPath } from '../fs';
import { legacyTraceEventsPath, traceDir, traceEventsPath } from '../artifacts/paths';
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
    assertStateWriterLeaseHealthyIfHeld();
    mkdirSync(resolveManagedPath(traceDir(safe.scope)), { recursive: true });
    assertStateWriterLeaseHealthyIfHeld();
    appendFileSync(resolveManagedPath(traceEventsPath(safe.scope)), `${JSON.stringify(safe)}\n`, 'utf-8');
  } catch (error: unknown) {
    if ((error as { code?: string })?.code === 'CHECKPOINT_CONFLICT') throw error;
    if (process.env.KYRO_TRACE_DEBUG === '1' || process.env.KYRO_TRACE_DEBUG === 'true') {
      process.stderr.write(`kyro trace disabled for this event: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }
}

/**
 * Read a scope's trace from the current path plus the legacy one it used through 4.47.0.
 *
 * This runtime only ever appends to the current path, but that is not a guarantee about the file
 * on disk: a rollback, a mixed-version team, or an older binary run by hand can still append to the
 * legacy path *after* current-path events exist. So the two files are merged by timestamp rather
 * than concatenated — otherwise `--tail` would drop genuinely newer events. Ties keep legacy first
 * and preserve each file's own line order, so the same inputs always render the same output.
 */
export function readTrace(scope: string, options: TraceReadOptions = {}): TraceReadResult {
  const legacy = parseTraceFile(resolveManagedPath(legacyTraceEventsPath(scope)), options.type);
  const current = parseTraceFile(resolveManagedPath(traceEventsPath(scope)), options.type);
  const events = mergeTraceEventsByTime(legacy.events, current.events);
  const skipped = legacy.skipped + current.skipped;
  const tail = normalizeTail(options.tail);
  return { events: tail === null ? events : events.slice(-tail), skipped };
}

/**
 * Total, deterministic order: ISO-8601 `ts` compares lexicographically (every writer emits
 * `toISOString()`, always UTC), then legacy before current, then original line index.
 */
function mergeTraceEventsByTime(legacyEvents: TraceEvent[], currentEvents: TraceEvent[]): TraceEvent[] {
  const tagged = [
    ...legacyEvents.map((event, index) => ({ event, source: 0, index })),
    ...currentEvents.map((event, index) => ({ event, source: 1, index })),
  ];
  tagged.sort((left, right) => {
    if (left.event.ts !== right.event.ts) return left.event.ts < right.event.ts ? -1 : 1;
    if (left.source !== right.source) return left.source - right.source;
    return left.index - right.index;
  });
  return tagged.map((entry) => entry.event);
}

function parseTraceFile(path: string, type: TraceEventType | undefined): TraceReadResult {
  if (!existsSync(path)) return { events: [], skipped: 0 };
  const text = readFileSync(path, 'utf-8');
  const events: TraceEvent[] = [];
  let skipped = 0;
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (isTraceEvent(parsed) && (!type || parsed.type === type)) events.push(parsed);
      else skipped += 1;
    } catch {
      skipped += 1;
    }
  }
  return { events, skipped };
}

export function traceSnapshotId(snapshotPath: string): string {
  return basename(snapshotPath);
}

export function normalizeTraceCloseOutcome(outcome: string): 'shipped' | 'partial' | 'aborted' {
  return outcome === 'partial' || outcome === 'aborted' ? outcome : 'shipped';
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
