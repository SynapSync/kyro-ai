import type { NextAction } from './sprint-model';
import type { ContextPackMode } from './cli-runtime';

// --- portable guardrail policy ---

export type GuardedOperation = 'close_sprint' | 'repair_scope' | 'scope_set_active' | 'scope_retire' | 'scope_complete' | 'scope_reopen' | 'clear_active_sprint' | 'delete_archive' | 'review_task';
export type GuardLevel = 'tool_owned' | 'confirm' | 'blocked';
export type GuardDecisionKind = 'allow' | 'confirmation_required' | 'blocked';
export type EnforcementTier = 'enforced' | 'advisory';

export interface PolicyOperationRule {
  level: GuardLevel;
}

export interface PolicyDefinition {
  policyVersion: 1;
  operations: Record<GuardedOperation, PolicyOperationRule>;
  allow: GuardedOperation[];
  maker_checker: MakerCheckerPolicy;
}

export interface MakerCheckerPolicy {
  requireSeparateChecker: boolean;
}

export interface PolicyIssue {
  field: string;
  message: string;
}

export interface GuardContext {
  surface: 'cli' | 'mcp';
  scope?: string;
  confirmed: boolean;
}

export interface GuardDecision {
  op: GuardedOperation;
  level: GuardLevel;
  kind: GuardDecisionKind;
  code?: 'CONFIRMATION_REQUIRED' | 'POLICY_BLOCKED';
  message: string;
  remedy?: string;
}

// --- append-only trace model (audit trail, never source of truth) ---

export type TraceEventType =
  | 'route_selected'
  | 'tool_command_run'
  | 'validation_result'
  | 'gate_approved'
  | 'retry_count'
  | 'blocked_reason'
  | 'close_snapshot';

export interface TraceEventBase {
  v: 1;
  ts: string;
  scope: string;
  type: TraceEventType;
}

export type TraceEvent =
  | (TraceEventBase & {
      type: 'route_selected';
      nextAction: NextAction;
      packMode: ContextPackMode;
      budgetClass: string;
      reasoningTier: string;
    })
  | (TraceEventBase & {
      type: 'tool_command_run';
      surface: 'cli' | 'mcp';
      command: string;
      args?: Record<string, string | number | boolean>;
    })
  | (TraceEventBase & {
      type: 'validation_result';
      source: 'analyze' | 'doctor';
      blocking: boolean;
      findingCount: number;
      codes: string[];
    })
  | (TraceEventBase & { type: 'gate_approved'; gate: string; taskId?: string })
  | (TraceEventBase & { type: 'retry_count'; round: number; limit: number; blocked: boolean })
  | (TraceEventBase & { type: 'blocked_reason'; reason: string; code?: string })
  | (TraceEventBase & { type: 'close_snapshot'; sprintN: number; snapshotId: string; outcome: 'shipped' | 'partial' | 'aborted' });


export type AnalysisSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface AnalysisFinding {
  id: string;
  severity: AnalysisSeverity;
  category: string;
  detail: string;
  remedy: string;
}

export interface CheckResult {
  status: 'pass' | 'warn' | 'fail';
  name: string;
  detail: string;
  remedy?: string;
}
