import type { KyroProjectState } from '../types';

export const KYRO_SCOPE_STATUS = {
  PLANNING: 'planning',
  ACTIVE: 'active',
  COMPLETED: 'completed',
  BLOCKED: 'blocked',
} as const;

export type KyroScopeStatus = (typeof KYRO_SCOPE_STATUS)[keyof typeof KYRO_SCOPE_STATUS];

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

export function validateProjectStateShape(value: unknown, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) return [{ path, field: '<root>', message: 'must be an object' }];
  requireLiteral(value, 'schemaVersion', 1, path, issues);
  requireString(value, 'artifactRoot', path, issues);
  requireStringArray(value, 'scopes', path, issues);
  requireNullableString(value, 'activeScope', path, issues);
  requireString(value, 'runtimeVersion', path, issues);
  requireString(value, 'runtimePath', path, issues);
  if (!Array.isArray(value.installedAdapters)) issues.push({ path, field: 'installedAdapters', message: 'must be an array' });
  return issues;
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

function requireNumber(record: Record<string, unknown>, key: string, path: string, issues: ValidationIssue[]): void {
  if (typeof record[key] !== 'number' || Number.isNaN(record[key])) issues.push({ path, field: key, message: 'must be a number' });
}

function requireStringArray(record: Record<string, unknown>, key: string, path: string, issues: ValidationIssue[]): void {
  if (!Array.isArray(record[key]) || !record[key].every((item) => typeof item === 'string')) {
    issues.push({ path, field: key, message: 'must be an array of strings' });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
