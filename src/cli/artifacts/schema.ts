import type { KyroProjectState, SprintFile } from '../types';

export const KYRO_SCOPE_STATUS = {
  PLANNING: 'planning',
  ACTIVE: 'active',
  COMPLETED: 'completed',
  BLOCKED: 'blocked',
} as const;

export type KyroScopeStatus = (typeof KYRO_SCOPE_STATUS)[keyof typeof KYRO_SCOPE_STATUS];

export const SCOPE_STATUS_VALUES = ['planning', 'active', 'blocked', 'completed'] as const;
export const NEXT_ACTION_VALUES = ['init', 'clarify', 'plan_sprint', 'execute_task', 'review_task', 'close_sprint', 'wrap_up'] as const;
export const TASK_STATUS_VALUES = ['pending', 'in_progress', 'done', 'blocked'] as const;
export const DEBT_STATUS_VALUES = ['open', 'in_progress', 'resolved', 'deferred'] as const;
export const DEBT_PRIORITY_VALUES = ['critical', 'high', 'medium', 'low'] as const;

export interface ValidationIssue {
  path: string;
  field: string;
  message: string;
}

export interface KyroScopeState {
  schemaVersion: 1;
  scope: string;
  status: string;
  activeSprint: string | null;
  currentPhase: string;
  nextAction: string;
  roadmapPath: string;
  sprintsPath: string;
  lastUpdated: string;
}

export interface SizingDecisionSummary {
  recommendedSprintCount: number;
  riskLevel: string;
  rationale: string;
  splitTriggers: string[];
  whyNotFewer: string;
  whyNotMore: string;
  sprintProofs: string[];
}

export interface RelevantArtifactPaths {
  roadmap: string;
  roadmapSummary: string;
  sprints: string;
  reentry: string;
}

export interface KyroScopeIndex {
  schemaVersion: 1;
  scope: string;
  roadmapSummary: string;
  activeSprintSummary: string | null;
  openDebtCount: number;
  nextTask: string | null;
  sizingDecision?: SizingDecisionSummary;
  relevantArtifactPaths: RelevantArtifactPaths;
  lastUpdated: string;
}

export interface RoadmapSummary {
  schemaVersion: 1;
  scope: string;
  status: string;
  summary: string;
  plannedSprintCount: number;
  completedSprintCount: number;
  adaptationCount: number;
  sizingDecision?: SizingDecisionSummary;
  nextRecommendedAction: string;
  openDecisions: string[];
  relevantArtifactPaths: string[];
  lastUpdated: string;
}

export interface SprintSummary {
  schemaVersion: 1;
  scope: string;
  sprint: string;
  status: string;
  completedTasks: number;
  blockedTasks: number;
  carryOverTasks: number;
  nextRecommendedAction: string;
  nextTask: string | null;
  openDecisions: string[];
  filesTouched: string[];
  debtDeltas: unknown[];
  sourceMarkdown: string;
  lastUpdated: string;
}

export interface DebtSummary {
  schemaVersion: 1;
  scope: string;
  open: number;
  inProgress: number;
  resolved: number;
  deferred: number;
  critical: number;
  oldestOpenItem: string | null;
  sourceMarkdown: string | null;
  lastUpdated: string;
}

export interface RuleIndex {
  schemaVersion: 1;
  rules: RuleIndexEntry[];
  sourceMarkdown: string;
  lastUpdated: string;
}

export interface RuleIndexEntry {
  id: string;
  category: string;
  tags: string[];
  affectedModes: string[];
  summary: string;
  sourceLocation: string;
}

export function validateProjectStateShape(value: unknown, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) return [{ path, field: '<root>', message: 'must be an object' }];
  requireLiteral(value, 'schemaVersion', 4, path, issues);
  requireString(value, 'artifactRoot', path, issues);
  if (!Array.isArray(value.scopes)) {
    issues.push({ path, field: 'scopes', message: 'must be an array' });
  } else {
    value.scopes.forEach((entry, index) => validateScopeEntry(entry, path, `scopes[${index}]`, issues));
  }
  requireNullableString(value, 'activeScope', path, issues);
  requireString(value, 'runtimeVersion', path, issues);
  requireString(value, 'runtimePath', path, issues);
  if (!Array.isArray(value.installedAdapters)) issues.push({ path, field: 'installedAdapters', message: 'must be an array' });
  // principles[] is a v4.1 addition — validate shape only if present so pre-4.1 kyro.json stays valid.
  if ('principles' in value) {
    if (!Array.isArray(value.principles)) {
      issues.push({ path, field: 'principles', message: 'must be an array when present' });
    } else {
      value.principles.forEach((p, i) => validatePrinciple(p, path, `principles[${i}]`, issues));
    }
  }
  return issues;
}

const PRINCIPLE_SEVERITY_VALUES = ['non-negotiable', 'strong', 'advisory'] as const;
const PRINCIPLE_CHECK_VALUES = ['tasks-have-acceptance-criteria', 'no-clarification-markers', 'success-criteria-present'] as const;

function validatePrinciple(value: unknown, path: string, prefix: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, field: prefix, message: 'must be an object { id, rule, severity, rationale }' });
    return;
  }
  requireString(value, 'id', path, issues, `${prefix}.id`);
  requireString(value, 'rule', path, issues, `${prefix}.rule`);
  requireLiteralSet(value, 'severity', PRINCIPLE_SEVERITY_VALUES, path, issues, `${prefix}.severity`);
  requireString(value, 'rationale', path, issues, `${prefix}.rationale`);
  if ('check' in value && !PRINCIPLE_CHECK_VALUES.includes(value.check as (typeof PRINCIPLE_CHECK_VALUES)[number])) {
    issues.push({ path, field: `${prefix}.check`, message: `must be one of ${PRINCIPLE_CHECK_VALUES.join(', ')} when present` });
  }
}

function validateScopeEntry(value: unknown, path: string, prefix: string, issues: ValidationIssue[]): void {
  if (typeof value === 'string') {
    issues.push({ path, field: prefix, message: 'must be an object { id, title, status }, not a string (v3 drift)' });
    return;
  }
  if (!isRecord(value)) {
    issues.push({ path, field: prefix, message: 'must be an object { id, title, status }' });
    return;
  }
  requireString(value, 'id', path, issues, `${prefix}.id`);
  requireString(value, 'title', path, issues, `${prefix}.title`);
  requireLiteralSet(value, 'status', SCOPE_STATUS_VALUES, path, issues, `${prefix}.status`);
}

/** Validate a v4 sprint.json. Catches shape drift (string conventions, bad snapshot, etc.). */
export function validateSprintFile(value: unknown, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) return [{ path, field: '<root>', message: 'must be an object' }];
  requireLiteral(value, 'schemaVersion', 4, path, issues);
  requireString(value, 'scope', path, issues);
  requireString(value, 'title', path, issues);
  requireString(value, 'status', path, issues);
  requireString(value, 'objective', path, issues);

  // successCriteria / clarifications are v4.1 additions — validate shape only if present so
  // scopes created before 4.1 (which omit them) are not failed by close-sprint's gate.
  if ('successCriteria' in value && !Array.isArray(value.successCriteria)) {
    issues.push({ path, field: 'successCriteria', message: 'must be an array of strings when present' });
  }
  if ('clarifications' in value) {
    if (!Array.isArray(value.clarifications)) {
      issues.push({ path, field: 'clarifications', message: 'must be an array when present' });
    } else {
      value.clarifications.forEach((c, i) => validateClarification(c, path, `clarifications[${i}]`, issues));
    }
  }

  if (!Array.isArray(value.conventions)) {
    issues.push({ path, field: 'conventions', message: 'must be an array' });
  } else {
    value.conventions.forEach((c, i) => validateConvention(c, path, `conventions[${i}]`, issues));
  }

  if (!isRecord(value.roadmap)) {
    issues.push({ path, field: 'roadmap', message: 'must be an object' });
  } else {
    requireNumber(value.roadmap, 'plannedSprintCount', path, issues, 'roadmap.plannedSprintCount');
    if (!Array.isArray(value.roadmap.sprints)) issues.push({ path, field: 'roadmap.sprints', message: 'must be an array' });
  }

  if (!Array.isArray(value.ledger)) {
    issues.push({ path, field: 'ledger', message: 'must be an array' });
  } else {
    value.ledger.forEach((e, i) => validateLedgerEntry(e, path, `ledger[${i}]`, issues));
  }

  if (value.activeSprint !== null) validateActiveSprint(value.activeSprint, path, 'activeSprint', issues);

  if (!Array.isArray(value.debt)) {
    issues.push({ path, field: 'debt', message: 'must be an array' });
  } else {
    value.debt.forEach((d, i) => validateDebtItem(d, path, `debt[${i}]`, issues));
  }

  if (!isRecord(value.handoff)) {
    issues.push({ path, field: 'handoff', message: 'must be an object' });
  } else {
    requireLiteralSet(value.handoff, 'nextAction', NEXT_ACTION_VALUES, path, issues, 'handoff.nextAction');
    requireNullableString(value.handoff, 'nextTaskId', path, issues);
  }
  return issues;
}

function validateClarification(value: unknown, path: string, prefix: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, field: prefix, message: 'must be an object { q, a, sprint, date }' });
    return;
  }
  requireString(value, 'q', path, issues, `${prefix}.q`);
  requireString(value, 'a', path, issues, `${prefix}.a`);
  requireNumber(value, 'sprint', path, issues, `${prefix}.sprint`);
  requireString(value, 'date', path, issues, `${prefix}.date`);
}

function validateConvention(value: unknown, path: string, prefix: string, issues: ValidationIssue[]): void {
  if (typeof value === 'string') {
    issues.push({ path, field: prefix, message: 'must be an object { id, rule, tags, addedSprint }, not a string (v3 drift)' });
    return;
  }
  if (!isRecord(value)) {
    issues.push({ path, field: prefix, message: 'must be an object { id, rule, tags, addedSprint }' });
    return;
  }
  requireString(value, 'id', path, issues, `${prefix}.id`);
  requireString(value, 'rule', path, issues, `${prefix}.rule`);
  requireStringArrayField(value, 'tags', path, issues, `${prefix}.tags`);
  requireNumber(value, 'addedSprint', path, issues, `${prefix}.addedSprint`);
}

function validateLedgerEntry(value: unknown, path: string, prefix: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, field: prefix, message: 'must be an object' });
    return;
  }
  requireNumber(value, 'n', path, issues, `${prefix}.n`);
  requireString(value, 'slug', path, issues, `${prefix}.slug`);
  requireString(value, 'outcome', path, issues, `${prefix}.outcome`);
  requireString(value, 'archive', path, issues, `${prefix}.archive`);
  if ('snapshot' in value && typeof value.snapshot !== 'string') {
    issues.push({ path, field: `${prefix}.snapshot`, message: 'must be a string when present' });
  }
}

function validateActiveSprint(value: unknown, path: string, prefix: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, field: prefix, message: 'must be an object or null' });
    return;
  }
  requireNumber(value, 'n', path, issues, `${prefix}.n`);
  requireString(value, 'slug', path, issues, `${prefix}.slug`);
  if (!Array.isArray(value.phases)) {
    issues.push({ path, field: `${prefix}.phases`, message: 'must be an array' });
  } else {
    value.phases.forEach((phase, pi) => {
      if (!isRecord(phase) || !Array.isArray(phase.tasks)) {
        issues.push({ path, field: `${prefix}.phases[${pi}].tasks`, message: 'must be an array' });
        return;
      }
      phase.tasks.forEach((task, ti) => validateTask(task, path, `${prefix}.phases[${pi}].tasks[${ti}]`, issues));
    });
  }
}

function validateTask(value: unknown, path: string, prefix: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, field: prefix, message: 'must be an object' });
    return;
  }
  requireString(value, 'id', path, issues, `${prefix}.id`);
  requireString(value, 'description', path, issues, `${prefix}.description`);
  requireLiteralSet(value, 'status', TASK_STATUS_VALUES, path, issues, `${prefix}.status`);
}

function validateDebtItem(value: unknown, path: string, prefix: string, issues: ValidationIssue[]): void {
  if (typeof value === 'string') {
    issues.push({ path, field: prefix, message: 'must be an object { id, title, ... }, not a string (v3 drift)' });
    return;
  }
  if (!isRecord(value)) {
    issues.push({ path, field: prefix, message: 'must be an object' });
    return;
  }
  requireString(value, 'id', path, issues, `${prefix}.id`);
  requireString(value, 'title', path, issues, `${prefix}.title`);
  requireLiteralSet(value, 'status', DEBT_STATUS_VALUES, path, issues, `${prefix}.status`);
}

export function validateScopeState(value: unknown, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) return [{ path, field: '<root>', message: 'must be an object' }];
  requireLiteral(value, 'schemaVersion', 1, path, issues);
  requireString(value, 'scope', path, issues);
  requireString(value, 'status', path, issues);
  requireNullableString(value, 'activeSprint', path, issues);
  requireString(value, 'currentPhase', path, issues);
  requireString(value, 'nextAction', path, issues);
  requireString(value, 'roadmapPath', path, issues);
  requireString(value, 'sprintsPath', path, issues);
  requireString(value, 'lastUpdated', path, issues);
  return issues;
}

export function validateScopeIndex(value: unknown, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) return [{ path, field: '<root>', message: 'must be an object' }];
  requireLiteral(value, 'schemaVersion', 1, path, issues);
  requireString(value, 'scope', path, issues);
  requireString(value, 'roadmapSummary', path, issues);
  requireNullableString(value, 'activeSprintSummary', path, issues);
  requireNumber(value, 'openDebtCount', path, issues);
  requireNullableString(value, 'nextTask', path, issues);
  if (!isRecord(value.relevantArtifactPaths)) {
    issues.push({ path, field: 'relevantArtifactPaths', message: 'must be an object' });
  } else {
    requireString(value.relevantArtifactPaths, 'roadmap', path, issues, 'relevantArtifactPaths.roadmap');
    requireString(value.relevantArtifactPaths, 'roadmapSummary', path, issues, 'relevantArtifactPaths.roadmapSummary');
    requireString(value.relevantArtifactPaths, 'sprints', path, issues, 'relevantArtifactPaths.sprints');
    requireString(value.relevantArtifactPaths, 'reentry', path, issues, 'relevantArtifactPaths.reentry');
  }
  requireString(value, 'lastUpdated', path, issues);
  return issues;
}

export function validateRoadmapSummary(value: unknown, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) return [{ path, field: '<root>', message: 'must be an object' }];
  requireLiteral(value, 'schemaVersion', 1, path, issues);
  requireString(value, 'scope', path, issues);
  requireString(value, 'status', path, issues);
  requireString(value, 'summary', path, issues);
  requireNumber(value, 'plannedSprintCount', path, issues);
  requireNumber(value, 'completedSprintCount', path, issues);
  requireNumber(value, 'adaptationCount', path, issues);
  requireString(value, 'nextRecommendedAction', path, issues);
  requireStringArray(value, 'openDecisions', path, issues);
  requireStringArray(value, 'relevantArtifactPaths', path, issues);
  requireString(value, 'lastUpdated', path, issues);
  return issues;
}

export function validateSprintSummary(value: unknown, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) return [{ path, field: '<root>', message: 'must be an object' }];
  requireLiteral(value, 'schemaVersion', 1, path, issues);
  requireString(value, 'scope', path, issues);
  requireString(value, 'sprint', path, issues);
  requireString(value, 'status', path, issues);
  requireNumber(value, 'completedTasks', path, issues);
  requireNumber(value, 'blockedTasks', path, issues);
  requireNumber(value, 'carryOverTasks', path, issues);
  requireString(value, 'nextRecommendedAction', path, issues);
  requireNullableString(value, 'nextTask', path, issues);
  requireStringArray(value, 'openDecisions', path, issues);
  requireStringArray(value, 'filesTouched', path, issues);
  if (!Array.isArray(value.debtDeltas)) issues.push({ path, field: 'debtDeltas', message: 'must be an array' });
  requireString(value, 'sourceMarkdown', path, issues);
  requireString(value, 'lastUpdated', path, issues);
  return issues;
}


export function validateRuleIndex(value: unknown, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) return [{ path, field: '<root>', message: 'must be an object' }];
  requireLiteral(value, 'schemaVersion', 1, path, issues);
  if (!Array.isArray(value.rules)) {
    issues.push({ path, field: 'rules', message: 'must be an array' });
  } else {
    value.rules.forEach((entry, index) => validateRuleIndexEntry(entry, path, `rules[${index}]`, issues));
  }
  requireString(value, 'sourceMarkdown', path, issues);
  requireString(value, 'lastUpdated', path, issues);
  return issues;
}

export function validateExecutionEvent(value: unknown, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) return [{ path, field: '<root>', message: 'must be an object' }];
  requireString(value, 'timestamp', path, issues);
  requireString(value, 'scope', path, issues);
  requireString(value, 'sprint', path, issues);
  requireString(value, 'phase', path, issues);
  requireString(value, 'task', path, issues);
  requireString(value, 'status', path, issues);
  requireStringArray(value, 'changedFiles', path, issues);
  if (!Array.isArray(value.validation)) issues.push({ path, field: 'validation', message: 'must be an array' });
  if (!Array.isArray(value.blockers)) issues.push({ path, field: 'blockers', message: 'must be an array' });
  if (!Array.isArray(value.debtDeltas)) issues.push({ path, field: 'debtDeltas', message: 'must be an array' });
  requireString(value, 'notes', path, issues);
  return issues;
}

function validateRuleIndexEntry(value: unknown, path: string, prefix: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, field: prefix, message: 'must be an object' });
    return;
  }
  requireString(value, 'id', path, issues, `${prefix}.id`);
  requireString(value, 'category', path, issues, `${prefix}.category`);
  requireStringArrayField(value, 'tags', path, issues, `${prefix}.tags`);
  requireStringArrayField(value, 'affectedModes', path, issues, `${prefix}.affectedModes`);
  requireString(value, 'summary', path, issues, `${prefix}.summary`);
  requireString(value, 'sourceLocation', path, issues, `${prefix}.sourceLocation`);
}

export function validateDebtSummary(value: unknown, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) return [{ path, field: '<root>', message: 'must be an object' }];
  requireLiteral(value, 'schemaVersion', 1, path, issues);
  requireString(value, 'scope', path, issues);
  requireNumber(value, 'open', path, issues);
  requireNumber(value, 'inProgress', path, issues);
  requireNumber(value, 'resolved', path, issues);
  requireNumber(value, 'deferred', path, issues);
  requireNumber(value, 'critical', path, issues);
  requireNullableString(value, 'oldestOpenItem', path, issues);
  requireNullableString(value, 'sourceMarkdown', path, issues);
  requireString(value, 'lastUpdated', path, issues);
  return issues;
}

export function asProjectState(value: unknown): KyroProjectState | null {
  return validateProjectStateShape(value, '.agents/kyro/kyro.json').length === 0 ? value as KyroProjectState : null;
}

export function asSprintFile(value: unknown): SprintFile | null {
  return validateSprintFile(value, 'sprint.json').length === 0 ? value as SprintFile : null;
}

export function asScopeState(value: unknown): KyroScopeState | null {
  return validateScopeState(value, 'state.json').length === 0 ? value as KyroScopeState : null;
}

export function asScopeIndex(value: unknown): KyroScopeIndex | null {
  return validateScopeIndex(value, 'index.json').length === 0 ? value as KyroScopeIndex : null;
}

function requireLiteral(record: Record<string, unknown>, key: string, expected: unknown, path: string, issues: ValidationIssue[]): void {
  if (record[key] !== expected) issues.push({ path, field: key, message: `must be ${String(expected)}` });
}

function requireString(record: Record<string, unknown>, key: string, path: string, issues: ValidationIssue[], field = key): void {
  if (typeof record[key] !== 'string') issues.push({ path, field, message: 'must be a string' });
}

function requireNullableString(record: Record<string, unknown>, key: string, path: string, issues: ValidationIssue[]): void {
  if (record[key] !== null && typeof record[key] !== 'string') issues.push({ path, field: key, message: 'must be a string or null' });
}

function requireNumber(record: Record<string, unknown>, key: string, path: string, issues: ValidationIssue[], field = key): void {
  if (typeof record[key] !== 'number' || Number.isNaN(record[key])) issues.push({ path, field, message: 'must be a number' });
}

function requireLiteralSet(record: Record<string, unknown>, key: string, allowed: readonly string[], path: string, issues: ValidationIssue[], field = key): void {
  if (typeof record[key] !== 'string' || !allowed.includes(record[key] as string)) {
    issues.push({ path, field, message: `must be one of: ${allowed.join(', ')}` });
  }
}

function requireStringArray(record: Record<string, unknown>, key: string, path: string, issues: ValidationIssue[]): void {
  requireStringArrayField(record, key, path, issues, key);
}

function requireStringArrayField(record: Record<string, unknown>, key: string, path: string, issues: ValidationIssue[], field: string): void {
  if (!Array.isArray(record[key]) || !record[key].every((item) => typeof item === 'string')) {
    issues.push({ path, field, message: 'must be an array of strings' });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
