import {
  type ValidationIssue,
  isRecord,
  requireLiteral,
  requireString,
  requireNullableString,
  requireNumber,
  requireStringArray,
  requireStringArrayField,
} from './schema-primitives';

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
