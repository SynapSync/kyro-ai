import { existsSync } from 'node:fs';
import { applyPlan } from '../fs';
import { runDoctorChecks } from '../commands/doctor';
import { inspectScope } from '../commands/artifact-doctor';
import { buildContextPack } from '../commands/context-pack';
import { buildClosePlan, type CloseSprintArgs } from '../commands/close-sprint';
import { buildRepairPlan } from '../commands/repair';
import { readJsonSafely } from '../artifacts/json';
import { sprintJsonPath } from '../artifacts/paths';
import { validateSprintFile } from '../artifacts/schema';
import { runAnalysis } from '../core/analysis';
import { KyroCoreError, toErrorEnvelope } from '../core/errors';
import { listScopes } from '../core/scopes';
import { resolveScope } from '../core/scope-resolution';
import { emitToolCommandRun, emitTraceEvent, normalizeTraceCloseOutcome, traceSnapshotId } from '../core/trace';
import { getTool } from './tool-catalog';
import { validateInput } from './input-validation';
import type { OperationPlan } from '../types';

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: unknown;
  isError?: boolean;
}

export function listTools(): unknown {
  const { MCP_TOOLS } = require('./tool-catalog') as typeof import('./tool-catalog');
  return { tools: MCP_TOOLS };
}

export function callTool(name: string, rawArgs: unknown): ToolResult {
  try {
    const tool = getTool(name);
    if (!tool) throw new KyroCoreError('INVALID_INPUT', `Unknown tool: ${name}`);
    const args = validateInput(tool.inputSchema, rawArgs ?? {});
    const data = dispatchTool(name, args);
    return ok(data, summarize(name, data));
  } catch (error: unknown) {
    const envelope = toErrorEnvelope(error);
    return { isError: true, structuredContent: envelope, content: [{ type: 'text', text: JSON.stringify(envelope) }] };
  }
}

function dispatchTool(name: string, args: Record<string, unknown>): unknown {
  switch (name) {
    case 'context_pack':
      return buildContextPack(resolveScope(optionalString(args.scope) ?? null), taskOption(args.task_id));
    case 'doctor_artifacts':
      return { checks: runDoctorChecks(false, true, false, false, optionalString(args.scope) ?? null) };
    case 'analyze_scope':
      return runAnalysis(optionalString(args.scope) ?? null);
    case 'scope_list':
      return listScopes();
    case 'scope_inspect':
      return { scope: requiredString(args.scope, 'scope'), checks: inspectScope(requiredString(args.scope, 'scope')) };
    case 'close_sprint':
      return closeSprintTool(args);
    case 'repair_scope':
      return repairScopeTool(args);
    default:
      throw new KyroCoreError('INVALID_INPUT', `Unknown tool: ${name}`);
  }
}

function closeSprintTool(args: Record<string, unknown>): unknown {
  const scope = resolveScope(optionalString(args.scope) ?? null);
  const closeArgs: CloseSprintArgs = {
    scope,
    outcome: requiredString(args.outcome, 'outcome'),
    note: optionalString(args.note),
    summary: optionalString(args.summary),
    recommendations: optionalStringArray(args.recommendations),
    learnings: optionalStringArray(args.learnings),
    dryRun: false,
    yes: true,
    help: false,
  };
  const { sprint, plan, snapshotPath } = buildClosePlan(scope, closeArgs);
  if (args.confirm !== true) return planResult(scope, plan, { snapshotPath, activeSprint: sprint.activeSprint });
  emitToolCommandRun(scope, 'mcp', 'close_sprint', { outcome: closeArgs.outcome });
  applyPlan(plan);
  assertValidSprint(scope, snapshotPath);
  emitTraceEvent({
    v: 1,
    ts: new Date().toISOString(),
    scope,
    type: 'close_snapshot',
    sprintN: sprint.activeSprint!.n,
    snapshotId: traceSnapshotId(snapshotPath),
    outcome: normalizeTraceCloseOutcome(closeArgs.outcome),
  });
  return { phase: 'applied', scope, snapshotPath, plan };
}

function repairScopeTool(args: Record<string, unknown>): unknown {
  const scope = resolveScope(optionalString(args.scope) ?? null);
  const plan = buildRepairPlan(scope);
  if (args.confirm !== true) return planResult(scope, plan);
  emitToolCommandRun(scope, 'mcp', 'repair_scope');
  applyPlan(plan);
  assertValidSprint(scope);
  return { phase: 'applied', scope, plan };
}

function planResult(scope: string, plan: OperationPlan[], extra: Record<string, unknown> = {}): unknown {
  return { phase: 'plan', scope, plan, requiresConfirm: true, ...extra };
}

function assertValidSprint(scope: string, snapshotPath?: string): void {
  const read = readJsonSafely(sprintJsonPath(scope));
  if (read.error || !read.exists) throw new KyroCoreError('INVALID_JSON', `Post-write sprint.json validation failed (${read.error ?? 'missing'}).`, snapshotPath ? `Snapshot preserves the sprint at ${snapshotPath}.` : undefined);
  const issues = validateSprintFile(read.value, `${scope}/sprint.json`);
  if (issues.length > 0) throw new KyroCoreError('INVALID_SPRINT_SHAPE', `Post-write sprint.json validation failed — ${issues.map((i) => `${i.field} ${i.message}`).join('; ')}`, snapshotPath ? `Snapshot preserves the sprint at ${snapshotPath}.` : undefined);
  if (snapshotPath && !existsSync(snapshotPath)) void snapshotPath;
}

function ok(data: unknown, text: string): ToolResult {
  return { isError: false, structuredContent: data, content: [{ type: 'text', text: JSON.stringify(data) || text }] };
}

function summarize(name: string, data: unknown): string {
  void data;
  return `${name} completed`;
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new KyroCoreError('INVALID_INPUT', `${field} is required.`);
  return value;
}

function optionalStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function taskOption(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
