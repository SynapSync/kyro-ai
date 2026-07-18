import { readJsonSafely } from '../artifacts/json';
import { KYRO_PROJECT_ROOT } from '../constants';
import type { GuardContext, GuardDecision, GuardLevel, GuardedOperation, MakerCheckerPolicy, PolicyDefinition, PolicyIssue } from '../types';

export const POLICY_PATH = `${KYRO_PROJECT_ROOT}/policy.json`;
export const GUARDED_OPERATIONS: readonly GuardedOperation[] = ['close_sprint', 'repair_scope', 'scope_set_active', 'clear_active_sprint', 'delete_archive', 'review_task'];
export const GUARD_LEVELS: readonly GuardLevel[] = ['tool_owned', 'confirm', 'blocked'];

export const DEFAULT_POLICY: PolicyDefinition = {
  policyVersion: 1,
  operations: {
    close_sprint: { level: 'tool_owned' },
    repair_scope: { level: 'confirm' },
    scope_set_active: { level: 'confirm' },
    clear_active_sprint: { level: 'blocked' },
    delete_archive: { level: 'blocked' },
    review_task: { level: 'tool_owned' },
  },
  allow: [],
  maker_checker: { requireSeparateChecker: false },
};

export interface LoadedPolicy {
  policy: PolicyDefinition;
  issues: PolicyIssue[];
}

export function loadPolicy(): LoadedPolicy {
  const read = readJsonSafely(POLICY_PATH);
  if (!read.exists) return { policy: clonePolicy(DEFAULT_POLICY), issues: [] };
  if (read.error) return { policy: clonePolicy(DEFAULT_POLICY), issues: [{ field: POLICY_PATH, message: `invalid JSON (${read.error})` }] };
  const issues = validatePolicyOverride(read.value);
  if (issues.length > 0) return { policy: clonePolicy(DEFAULT_POLICY), issues };
  return { policy: mergePolicy(read.value as PartialPolicy), issues: [] };
}

export function evaluateGuard(op: GuardedOperation, context: GuardContext): GuardDecision {
  const { policy } = loadPolicy();
  const level = policy.operations[op].level;
  if (level === 'blocked') {
    return {
      op,
      level,
      kind: 'blocked',
      code: 'POLICY_BLOCKED',
      message: `Operation ${op} is blocked by Kyro policy.`,
      remedy: `Remove the operation from blocked policy, or add it to allow[] in ${POLICY_PATH} to downgrade blocked→confirm when appropriate.`,
    };
  }
  if (level === 'confirm' && !context.confirmed) {
    return {
      op,
      level,
      kind: 'confirmation_required',
      code: 'CONFIRMATION_REQUIRED',
      message: `Operation ${op} requires explicit confirmation.`,
      remedy: context.surface === 'mcp' ? 'Call the tool again with confirm: true after reviewing the plan.' : 'Review the plan, then re-run with --yes.',
    };
  }
  return { op, level, kind: 'allow', message: `Operation ${op} allowed by Kyro policy.` };
}

export function policyIssues(): PolicyIssue[] {
  return loadPolicy().issues;
}

export function guardedOperationLevel(op: GuardedOperation): GuardLevel {
  return loadPolicy().policy.operations[op].level;
}

export function makerCheckerPolicy(): MakerCheckerPolicy {
  return loadPolicy().policy.maker_checker;
}

interface PartialPolicy {
  policyVersion?: unknown;
  operations?: Record<string, { level?: unknown }>;
  allow?: unknown[];
  maker_checker?: { requireSeparateChecker?: unknown };
}

function mergePolicy(override: PartialPolicy): PolicyDefinition {
  const merged = clonePolicy(DEFAULT_POLICY);
  const ops = override.operations ?? {};
  for (const op of GUARDED_OPERATIONS) {
    const overrideLevel = ops[op]?.level;
    if (isGuardLevel(overrideLevel)) merged.operations[op] = { level: stricter(merged.operations[op].level, overrideLevel) };
  }
  for (const item of override.allow ?? []) {
    if (isGuardedOperation(item) && merged.operations[item].level === 'blocked') merged.operations[item] = { level: 'confirm' };
  }
  if (override.maker_checker?.requireSeparateChecker === true) {
    merged.maker_checker = { requireSeparateChecker: true };
  }
  return merged;
}

function validatePolicyOverride(value: unknown): PolicyIssue[] {
  const issues: PolicyIssue[] = [];
  if (!isRecord(value)) return [{ field: '<root>', message: 'must be an object' }];
  if (value.policyVersion !== 1) issues.push({ field: 'policyVersion', message: 'must be literal 1' });
  if ('operations' in value) {
    if (!isRecord(value.operations)) {
      issues.push({ field: 'operations', message: 'must be an object' });
    } else {
      for (const [key, rule] of Object.entries(value.operations)) {
        if (!isGuardedOperation(key)) issues.push({ field: `operations.${key}`, message: 'unknown guarded operation' });
        if (!isRecord(rule) || !isGuardLevel(rule.level)) issues.push({ field: `operations.${key}.level`, message: 'must be one of tool_owned, confirm, blocked' });
      }
    }
  }
  if ('allow' in value) {
    if (!Array.isArray(value.allow)) {
      issues.push({ field: 'allow', message: 'must be an array' });
    } else {
      for (const [index, item] of value.allow.entries()) {
        if (!isGuardedOperation(item)) issues.push({ field: `allow[${index}]`, message: 'must be a guarded operation' });
      }
    }
  }
  if ('maker_checker' in value) {
    if (!isRecord(value.maker_checker)) {
      issues.push({ field: 'maker_checker', message: 'must be an object' });
    } else if ('requireSeparateChecker' in value.maker_checker && typeof value.maker_checker.requireSeparateChecker !== 'boolean') {
      issues.push({ field: 'maker_checker.requireSeparateChecker', message: 'must be a boolean' });
    }
  }
  return issues;
}

function stricter(a: GuardLevel, b: GuardLevel): GuardLevel {
  return rank(b) > rank(a) ? b : a;
}

function rank(level: GuardLevel): number {
  return level === 'blocked' ? 3 : level === 'confirm' ? 2 : 1;
}

function clonePolicy(policy: PolicyDefinition): PolicyDefinition {
  return JSON.parse(JSON.stringify(policy)) as PolicyDefinition;
}

function isGuardedOperation(value: unknown): value is GuardedOperation {
  return typeof value === 'string' && (GUARDED_OPERATIONS as readonly string[]).includes(value);
}

function isGuardLevel(value: unknown): value is GuardLevel {
  return typeof value === 'string' && (GUARD_LEVELS as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
