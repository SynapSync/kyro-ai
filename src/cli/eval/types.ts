import type { Agent, BudgetClassId, NextAction, ReasoningTier } from '../types';

export interface EvalExpectation {
  exitCode: number;
  stdoutIncludes?: string[];
  stdoutExcludes?: string[];
  stderrIncludes?: string[];
  stderrExcludes?: string[];
}

export interface EvalStep {
  run: string[];
  env?: Record<string, string>;
  expect: EvalExpectation;
}

export interface EvalRouteExpectation {
  nextAction: NextAction;
  expectedModes: string[];
  expectedBudgetClass: BudgetClassId;
  expectedReasoningTier: ReasoningTier;
}

export interface EvalCase {
  evalCaseSchemaVersion: 1;
  id: string;
  title: string;
  kind: 'replay';
  tags: string[];
  agents: Array<Agent | 'any'>;
  scope: string;
  route?: EvalRouteExpectation;
  steps: EvalStep[];
  expectFinalState: boolean;
}

export interface EvalFailure {
  at: string;
  expected: unknown;
  actual: unknown;
}

export interface EvalCaseResult {
  id: string;
  status: 'pass' | 'fail';
  durationMs: number;
  failures: EvalFailure[];
  sandboxPath?: string;
}

export interface EvalReport {
  evalReportSchemaVersion: 1;
  runtimeVersion: string;
  selected: number;
  passed: number;
  failed: number;
  durationMs: number;
  cases: EvalCaseResult[];
}
