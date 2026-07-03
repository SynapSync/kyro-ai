import { AGENT } from '../constants';
import { loadBudgetManifest } from '../budget-manifest';
import { NEXT_ACTION_VALUES } from '../artifacts/schema';
import { isCliCommand } from '../commands';
import type { ValidationIssue } from '../artifacts/schema';
import type { EvalCase } from './types';

const ALLOWED_ROOT_KEYS = new Set(['evalCaseSchemaVersion', 'id', 'title', 'kind', 'tags', 'agents', 'scope', 'route', 'steps', 'expectFinalState']);
const ALLOWED_ROUTE_KEYS = new Set(['nextAction', 'expectedModes', 'expectedBudgetClass', 'expectedReasoningTier']);
const ALLOWED_STEP_KEYS = new Set(['run', 'env', 'expect']);
const ALLOWED_EXPECT_KEYS = new Set(['exitCode', 'stdoutIncludes', 'stdoutExcludes', 'stderrIncludes', 'stderrExcludes']);
const AGENT_VALUES = new Set<string>([...Object.values(AGENT), 'any']);
const REASONING_VALUES = new Set(['light', 'standard', 'deep']);

export function validateEvalCase(value: unknown, path: string, dirName: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) return [{ path, field: '<root>', message: 'must be an object' }];
  rejectUnknownKeys(value, ALLOWED_ROOT_KEYS, path, '<root>', issues);

  requireLiteral(value, 'evalCaseSchemaVersion', 1, path, issues);
  requireString(value, 'id', path, issues);
  if (value.id !== dirName) issues.push({ path, field: 'id', message: `must equal directory name (${dirName})` });
  if (typeof value.id === 'string' && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.id)) issues.push({ path, field: 'id', message: 'must be kebab-case' });
  requireString(value, 'title', path, issues);
  requireLiteral(value, 'kind', 'replay', path, issues);
  requireStringArray(value, 'tags', path, issues);
  requireString(value, 'scope', path, issues);
  requireBoolean(value, 'expectFinalState', path, issues);

  if (!Array.isArray(value.agents)) {
    issues.push({ path, field: 'agents', message: 'must be an array' });
  } else {
    value.agents.forEach((agent, index) => {
      if (typeof agent !== 'string' || !AGENT_VALUES.has(agent)) issues.push({ path, field: `agents[${index}]`, message: `must be one of ${[...AGENT_VALUES].join(', ')}` });
    });
  }

  if ('route' in value) validateRoute(value.route, path, issues);

  if (!Array.isArray(value.steps) || value.steps.length === 0) {
    issues.push({ path, field: 'steps', message: 'must be a non-empty array' });
  } else {
    value.steps.forEach((step, index) => validateStep(step, path, `steps[${index}]`, issues));
  }
  return issues;
}

export function asEvalCase(value: unknown): EvalCase {
  return value as EvalCase;
}

function validateRoute(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, field: 'route', message: 'must be an object' });
    return;
  }
  rejectUnknownKeys(value, ALLOWED_ROUTE_KEYS, path, 'route', issues);
  requireLiteralSet(value, 'nextAction', NEXT_ACTION_VALUES, path, issues, 'route.nextAction');
  requireStringArray(value, 'expectedModes', path, issues, 'route.expectedModes');
  const budgets = new Set(Object.keys(loadBudgetManifest()));
  if (typeof value.expectedBudgetClass !== 'string' || !budgets.has(value.expectedBudgetClass)) issues.push({ path, field: 'route.expectedBudgetClass', message: `must be one of ${[...budgets].join(', ')}` });
  if (typeof value.expectedReasoningTier !== 'string' || !REASONING_VALUES.has(value.expectedReasoningTier)) issues.push({ path, field: 'route.expectedReasoningTier', message: 'must be one of light, standard, deep' });
}

function validateStep(value: unknown, path: string, prefix: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, field: prefix, message: 'must be an object' });
    return;
  }
  rejectUnknownKeys(value, ALLOWED_STEP_KEYS, path, prefix, issues);
  if (!Array.isArray(value.run) || value.run.length === 0 || !value.run.every((item) => typeof item === 'string')) {
    issues.push({ path, field: `${prefix}.run`, message: 'must be a non-empty string array' });
  } else if (!isCliCommand(value.run[0])) {
    issues.push({ path, field: `${prefix}.run[0]`, message: `must be a known CLI command, got ${value.run[0]}` });
  }
  if ('env' in value) validateEnv(value.env, path, `${prefix}.env`, issues);
  validateExpectation(value.expect, path, `${prefix}.expect`, issues);
}

function validateEnv(value: unknown, path: string, prefix: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, field: prefix, message: 'must be an object' });
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if (!/^[A-Z0-9_]+$/.test(key)) issues.push({ path, field: `${prefix}.${key}`, message: 'must be an uppercase environment variable name' });
    if (typeof item !== 'string') issues.push({ path, field: `${prefix}.${key}`, message: 'must be a string' });
  }
}

function validateExpectation(value: unknown, path: string, prefix: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, field: prefix, message: 'must be an object' });
    return;
  }
  rejectUnknownKeys(value, ALLOWED_EXPECT_KEYS, path, prefix, issues);
  if (typeof value.exitCode !== 'number') issues.push({ path, field: `${prefix}.exitCode`, message: 'must be a number' });
  for (const key of ['stdoutIncludes', 'stdoutExcludes', 'stderrIncludes', 'stderrExcludes']) {
    if (key in value) requireStringArray(value, key, path, issues, `${prefix}.${key}`);
  }
}

function rejectUnknownKeys(value: Record<string, unknown>, allowed: Set<string>, path: string, prefix: string, issues: ValidationIssue[]): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) issues.push({ path, field: prefix === '<root>' ? key : `${prefix}.${key}`, message: 'unknown key' });
  }
}

function requireString(value: Record<string, unknown>, field: string, path: string, issues: ValidationIssue[], label = field): void {
  if (typeof value[field] !== 'string') issues.push({ path, field: label, message: 'must be a string' });
}

function requireBoolean(value: Record<string, unknown>, field: string, path: string, issues: ValidationIssue[]): void {
  if (typeof value[field] !== 'boolean') issues.push({ path, field, message: 'must be a boolean' });
}

function requireLiteral(value: Record<string, unknown>, field: string, literal: string | number, path: string, issues: ValidationIssue[]): void {
  if (value[field] !== literal) issues.push({ path, field, message: `must be literal ${JSON.stringify(literal)}` });
}

function requireLiteralSet(value: Record<string, unknown>, field: string, allowed: readonly string[], path: string, issues: ValidationIssue[], label = field): void {
  if (typeof value[field] !== 'string' || !allowed.includes(value[field] as never)) issues.push({ path, field: label, message: `must be one of ${allowed.join(', ')}` });
}

function requireStringArray(value: Record<string, unknown>, field: string, path: string, issues: ValidationIssue[], label = field): void {
  if (!Array.isArray(value[field]) || !(value[field] as unknown[]).every((item) => typeof item === 'string')) issues.push({ path, field: label, message: 'must be an array of strings' });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
