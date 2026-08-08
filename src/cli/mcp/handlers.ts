import { existsSync } from 'node:fs';
import { applyPlan } from '../fs';
import { runDoctorChecks } from '../commands/doctor';
import { inspectScope } from '../commands/artifact-doctor';
import { buildContextPack } from '../commands/context-pack';
import { buildClosePlan, type CloseSprintArgs } from '../commands/close-sprint';
import { applySprintCloseTransaction } from '../checkpoints/sprint-close';
import { buildRepairPlan } from '../commands/repair';
import { planRemediation } from '../remediation/plan';
import { applyRemediationTransaction } from '../remediation/transaction';
import { readPackageVersion } from '../help';
import { buildReviewPlan, checkerErrorCode, parseFinding, parseVerdict, parseWaiver, type ReviewArgs } from '../commands/review';
import { readJsonSafely } from '../artifacts/json';
import { sprintJsonPath } from '../artifacts/paths';
import { validateSprintFile } from '../artifacts/schema';
import { runAnalysis } from '../core/analysis';
import { KyroCoreError, toErrorEnvelope } from '../core/errors';
import { evaluateGuard } from '../core/policy';
import { listScopes } from '../core/scopes';
import { resolveScope } from '../core/scope-resolution';
import { emitBlockedReason, emitGateApproved, emitToolCommandRun, emitTraceEvent, normalizeTraceCloseOutcome, readTrace, traceSnapshotId } from '../core/trace';
import { getTool } from './tool-catalog';
import { validateInput } from './input-validation';
import type { OperationPlan, PackVerbosity, TaskVerdictFinding } from '../types';
import { withStateWriterLock } from '../pipeline/state-writer-lock';

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
    if (!tool) throw new KyroCoreError('UNKNOWN_TOOL', `Unknown tool: ${name}`);
    const args = validateInput(tool.inputSchema, rawArgs ?? {});
    const data = isConfirmedMutator(name, args) ? withStateWriterLock(() => dispatchTool(name, args)) : dispatchTool(name, args);
    return ok(data, summarize(name, data));
  } catch (error: unknown) {
    const envelope = toErrorEnvelope(error);
    return { isError: true, structuredContent: envelope, content: [{ type: 'text', text: JSON.stringify(envelope) }] };
  }
}

function isConfirmedMutator(name: string, args: Record<string, unknown>): boolean {
  return args.confirm === true && ['close_sprint', 'repair_scope', 'review_task', 'remediate_scope'].includes(name);
}

function dispatchTool(name: string, args: Record<string, unknown>): unknown {
  switch (name) {
    case 'context_pack':
      return buildContextPack(resolveScope(optionalString(args.scope) ?? null), taskOption(args.task_id), verbosityOption(args.verbosity));
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
    case 'remediate_scope':
      return remediateScopeTool(args);
    case 'review_task':
      return reviewTaskTool(args);
    case 'trace_tail':
      return traceTailTool(args);
    default:
      throw new KyroCoreError('UNKNOWN_TOOL', `Unknown tool: ${name}`);
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
  const { sprint, plan, snapshotPath, checkpointPath, transaction } = buildClosePlan(scope, closeArgs);
  const guard = evaluateGuard('close_sprint', { surface: 'mcp', scope, confirmed: args.confirm === true });
  if (guard.kind === 'blocked') {
    emitBlockedReason(scope, guard.message, guard.code);
    throw new KyroCoreError(guard.code ?? 'POLICY_BLOCKED', guard.message, guard.remedy);
  }
  if (args.confirm !== true) return planResult(scope, plan, { snapshotPath, checkpointPath, checkpointId: transaction.checkpoint.checkpointId, activeSprint: sprint.activeSprint });
  if (guard.kind === 'confirmation_required') {
    emitBlockedReason(scope, guard.message, guard.code);
    throw new KyroCoreError(guard.code ?? 'CONFIRMATION_REQUIRED', guard.message, guard.remedy);
  }
  emitGateApproved(scope, 'close_sprint');
  emitToolCommandRun(scope, 'mcp', 'close_sprint', { outcome: closeArgs.outcome });
  const applied = applySprintCloseTransaction(transaction);
  assertValidSprint(scope, snapshotPath);
  emitTraceEvent({
    v: 1,
    ts: new Date().toISOString(),
    scope,
    type: 'close_snapshot',
    sprintN: transaction.checkpoint.identity.sprintN,
    snapshotId: traceSnapshotId(snapshotPath),
    outcome: normalizeTraceCloseOutcome(closeArgs.outcome),
  });
  return { phase: 'applied', scope, snapshotPath, checkpointPath, checkpointId: applied.checkpointId, resumed: applied.resumed, plan };
}

function repairScopeTool(args: Record<string, unknown>): unknown {
  const scope = resolveScope(optionalString(args.scope) ?? null);
  const plan = buildRepairPlan(scope);
  const guard = evaluateGuard('repair_scope', { surface: 'mcp', scope, confirmed: args.confirm === true });
  if (guard.kind === 'blocked') {
    emitBlockedReason(scope, guard.message, guard.code);
    throw new KyroCoreError(guard.code ?? 'POLICY_BLOCKED', guard.message, guard.remedy);
  }
  if (args.confirm !== true || guard.kind === 'confirmation_required') {
    return confirmationRequiredResult(scope, plan, guard.message, guard.remedy);
  }
  emitGateApproved(scope, 'repair_scope');
  emitToolCommandRun(scope, 'mcp', 'repair_scope');
  applyPlan(plan);
  assertValidSprint(scope);
  return { phase: 'applied', scope, plan };
}

/**
 * Preview is a pure plan; apply reuses the same locked transaction the CLI uses, so both surfaces
 * enforce identical digests, preconditions and post-write verification.
 */
function remediateScopeTool(args: Record<string, unknown>): unknown {
  const scope = resolveScope(optionalString(args.scope) ?? null);
  const options = {
    scope,
    manifestPath: requiredString(args.manifest, 'manifest'),
    now: new Date().toISOString(),
    kyroVersion: readPackageVersion(),
  };
  if (args.confirm !== true) {
    const plan = planRemediation(options);
    return { phase: 'preview', scope, remediationId: plan.remediationId, recordPath: plan.recordPath, commitment: plan.commitment, base: plan.record.base, issues: plan.record.issues, operations: plan.record.operations, result: plan.record.result, changes: plan.changes, transactionStatus: plan.transactionStatus };
  }
  emitGateApproved(scope, 'remediate_scope');
  emitToolCommandRun(scope, 'mcp', 'remediate_scope', { manifest: options.manifestPath });
  const applied = applyRemediationTransaction(options);
  return { phase: 'applied', scope, remediationId: applied.remediationId, recordPath: applied.recordPath, sprintPath: applied.sprintPath, commitment: applied.commitment, resumed: applied.resumed, changes: applied.plan.changes };
}

function reviewTaskTool(args: Record<string, unknown>): unknown {
  const scope = resolveScope(optionalString(args.scope) ?? null);
  const reviewArgs: ReviewArgs = {
    taskId: requiredString(args.task_id, 'task_id'),
    scope,
    verdict: args.verdict === undefined ? 'pass' : parseVerdict(requiredString(args.verdict, 'verdict')),
    checkedCriteria: optionalStringArray(args.checked_criteria),
    waivedCriteria: optionalStringArray(args.waived_criteria).map(parseWaiver),
    findings: parseFindings(args.findings),
    by: optionalString(args.by) ?? 'checker',
    yes: args.confirm === true,
    dryRun: false,
    help: false,
  };
  const { sprint, plan, findings } = buildReviewPlan(scope, reviewArgs);
  if (findings.length > 0 && reviewArgs.verdict === 'pass') {
    const code = checkerErrorCode(findings);
    emitBlockedReason(scope, `checker refused pass for task ${reviewArgs.taskId}`, code);
    throw new KyroCoreError(code, `Checker refused pass for task ${reviewArgs.taskId}.`, 'Resolve the checker findings, then re-run review_task.');
  }
  const guard = evaluateGuard('review_task', { surface: 'mcp', scope, confirmed: args.confirm === true });
  if (guard.kind === 'blocked') {
    emitBlockedReason(scope, guard.message, guard.code);
    throw new KyroCoreError(guard.code ?? 'POLICY_BLOCKED', guard.message, guard.remedy);
  }
  if (args.confirm !== true) return planResult(scope, plan, { verdict: reviewArgs.verdict });
  if (guard.kind === 'confirmation_required') {
    emitBlockedReason(scope, guard.message, guard.code);
    throw new KyroCoreError(guard.code ?? 'CONFIRMATION_REQUIRED', guard.message, guard.remedy);
  }
  emitToolCommandRun(scope, 'mcp', 'review', { task: reviewArgs.taskId, verdict: reviewArgs.verdict });
  applyPlan(plan);
  assertValidSprint(scope);
  if (reviewArgs.verdict === 'pass') emitGateApproved(scope, 'checker', reviewArgs.taskId);
  else emitBlockedReason(scope, `checker failed task ${reviewArgs.taskId}`, 'CHECKER_FAILED');
  return { phase: 'applied', scope, taskId: reviewArgs.taskId, verdict: reviewArgs.verdict, nextAction: sprint.handoff.nextAction };
}

function traceTailTool(args: Record<string, unknown>): unknown {
  const scope = resolveScope(optionalString(args.scope) ?? null);
  const result = readTrace(scope, { tail: parseLimit(args.limit) });
  return { scope, events: result.events, skipped: result.skipped };
}

function parseFindings(value: unknown): TaskVerdictFinding[] {
  return optionalStringArray(value).map((entry) => parseFinding(entry));
}

function parseLimit(value: unknown): number {
  if (value === undefined || value === null) return 20;
  const parsed = Number(optionalString(value) ?? value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new KyroCoreError('INVALID_INPUT', 'limit must be a non-negative integer', 'Pass a numeric string like "20".');
  return parsed;
}

function verbosityOption(value: unknown): PackVerbosity {
  return value === 'concise' || value === 'detailed' ? value : 'detailed';
}

function confirmationRequiredResult(scope: string, plan: OperationPlan[], message: string, remedy?: string): unknown {
  return {
    phase: 'plan',
    scope,
    plan,
    requiresConfirm: true,
    error: { code: 'CONFIRMATION_REQUIRED', message, ...(remedy ? { remedy } : {}) },
  };
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
  // ACI: content[].text is the high-signal summary the model reads; the full machine payload
  // stays in structuredContent.
  return { isError: false, structuredContent: data, content: [{ type: 'text', text }] };
}

function summarize(name: string, data: unknown): string {
  const rec = (data ?? {}) as Record<string, unknown>;
  switch (name) {
    case 'context_pack': {
      const tokens = typeof rec.estimatedTokens === 'number' ? rec.estimatedTokens : '?';
      return `context_pack: scope=${rec.scope} (${rec.status ?? '—'}), next=${rec.nextAction ?? '—'} ${rec.nextTaskId ?? ''}, ~${tokens} tokens.`.replace(/\s+/g, ' ').trim();
    }
    case 'analyze_scope': {
      const findings = asArray(rec.findings);
      const crit = findings.filter((f) => f.severity === 'CRITICAL').length;
      const high = findings.filter((f) => f.severity === 'HIGH').length;
      const next = findings[0]?.id ? ` Next: ${findings[0].id}.` : '';
      return `analyze_scope: ${findings.length} finding(s) (${crit} CRITICAL, ${high} HIGH) — ${rec.blocking ? 'BLOCKING' : 'non-blocking'}.${next}`;
    }
    case 'doctor_artifacts': {
      const checks = asArray(rec.checks);
      return `doctor_artifacts: ${checks.length} check(s), ${countStatus(checks, 'fail')} fail, ${countStatus(checks, 'warn')} warn.`;
    }
    case 'scope_inspect': {
      const checks = asArray(rec.checks);
      return `scope_inspect: ${rec.scope} — ${checks.length} check(s), ${countStatus(checks, 'fail')} fail.`;
    }
    case 'scope_list': {
      const scopes = Array.isArray(data) ? data : asArray(rec.scopes);
      return `scope_list: ${scopes.length} scope(s).`;
    }
    case 'close_sprint':
      return rec.phase === 'applied' ? `close_sprint: applied, snapshot=${rec.snapshotPath ?? '?'}.` : `close_sprint: plan ready (${planLen(rec.plan)} ops). Re-call with confirm:true.`;
    case 'repair_scope':
      return rec.phase === 'applied' ? `repair_scope: applied to ${rec.scope}.` : `repair_scope: plan ready (${planLen(rec.plan)} ops). Re-call with confirm:true.`;
    case 'remediate_scope':
      return rec.phase === 'applied'
        ? `remediate_scope: ${rec.remediationId} applied${rec.resumed ? ' (resumed)' : ''}, record=${rec.recordPath ?? '?'}.`
        : `remediate_scope: ${rec.remediationId} planned (${asArray(rec.changes).length} typed change(s)). Re-call with confirm:true.`;
    case 'review_task':
      return rec.phase === 'applied' ? `review_task: ${rec.verdict}, next=${rec.nextAction ?? '—'}.` : `review_task: plan ready (${rec.verdict}). Re-call with confirm:true.`;
    case 'trace_tail':
      return `trace_tail: ${asArray(rec.events).length} event(s)${typeof rec.skipped === 'number' && rec.skipped > 0 ? `, ${rec.skipped} skipped` : ''}.`;
    default:
      return `${name} completed`;
  }
}

function asArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
}

function countStatus(items: Array<Record<string, unknown>>, status: string): number {
  return items.filter((item) => item.status === status).length;
}

function planLen(plan: unknown): number {
  return Array.isArray(plan) ? plan.length : 0;
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
