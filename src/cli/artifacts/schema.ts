import { ADR_LINK_KEYS, ADR_STATUS, KYRO_SCOPE_ENTRY_STATUS } from '../types';
import type {
  AdrLinkKey,
  KyroLocalProjectState,
  KyroProjectState,
  KyroSharedProjectState,
  SprintFile,
  TaskEvidence,
  TaskVerdict,
} from '../types';

export const KYRO_SCOPE_STATUS = KYRO_SCOPE_ENTRY_STATUS;

export type KyroScopeStatus = (typeof KYRO_SCOPE_STATUS)[keyof typeof KYRO_SCOPE_STATUS];

export const SCOPE_STATUS_VALUES = Object.values(KYRO_SCOPE_STATUS);
export const NEXT_ACTION_VALUES = ['init', 'clarify', 'plan_sprint', 'execute_task', 'review_task', 'close_sprint', 'done'] as const;
export const TASK_STATUS_VALUES = ['pending', 'in_progress', 'done', 'blocked'] as const;
export const PHASE_STATUS_VALUES = ['pending', 'active', 'blocked', 'done'] as const;
export const DEBT_STATUS_VALUES = ['open', 'in_progress', 'resolved', 'deferred'] as const;
export const DEBT_PRIORITY_VALUES = ['critical', 'high', 'medium', 'low'] as const;
/** The exact canonical debt output key set. Kept here so the validator owns no second vocabulary. */
export const CANONICAL_DEBT_KEY_VALUES = ['id', 'title', 'origin', 'priority', 'status', 'targetSprint', 'note'] as const;

/**
 * `exact` is the write boundary: canonical debt output, no extra keys (ADR-0001).
 * `compatible` is the read boundary: required fields must still be valid, but legacy-only keys are
 * tolerated so a diagnostic or a remediation preparation path can read a legacy scope at all.
 * Reading a record in `compatible` mode is never authorization to write it back.
 */
export const DEBT_VALIDATION_MODE = { EXACT: 'exact', COMPATIBLE: 'compatible' } as const;
export type DebtValidationMode = (typeof DEBT_VALIDATION_MODE)[keyof typeof DEBT_VALIDATION_MODE];
export const TASK_VERDICT_RESULT_VALUES = ['pass', 'fail'] as const;
export const TASK_VERDICT_FINDING_SEVERITY_VALUES = ['critical', 'warning', 'suggestion'] as const;
export const SPEC_REQUIREMENT_PRIORITY_VALUES = ['must', 'should', 'could'] as const;
export const ADR_STATUS_VALUES = Object.values(ADR_STATUS);
export const ADR_LINK_KEY_VALUES = Object.values(ADR_LINK_KEYS);
const ADR_ID_PATTERN = /^ADR-\d{4}$/;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;
const REMEDIATION_ANCHOR_KEYS = ['id', 'path', 'commitment'];
const CERTIFICATION_ID_PATTERN = /^C-\d{3,}$/;

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
  validateOptionalConventions(value, path, issues);
  if ('team' in value) validateTeamPolicy(value.team, path, 'team', issues);
  return issues;
}

/**
 * Shared team file (`.agents/kyro/project.json`).
 * Must never include activeScope or installedAdapters (personal/machine fields).
 */
export function validateSharedProjectStateShape(value: unknown, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) return [{ path, field: '<root>', message: 'must be an object' }];
  requireLiteral(value, 'schemaVersion', 4, path, issues);
  requireString(value, 'artifactRoot', path, issues);
  if (!Array.isArray(value.scopes)) {
    issues.push({ path, field: 'scopes', message: 'must be an array' });
  } else {
    value.scopes.forEach((entry, index) => validateScopeEntry(entry, path, `scopes[${index}]`, issues));
  }
  if ('activeScope' in value) {
    issues.push({ path, field: 'activeScope', message: 'must not be present on shared project state (local-only field)' });
  }
  if ('installedAdapters' in value) {
    issues.push({ path, field: 'installedAdapters', message: 'must not be present on shared project state (local-only field)' });
  }
  if ('execution' in value) {
    issues.push({ path, field: 'execution', message: 'must not be present on shared project state (local-only field)' });
  }
  if ('kyroInvocation' in value) {
    issues.push({ path, field: 'kyroInvocation', message: 'must not be present on project files (global manifest only)' });
  }
  if ('principles' in value) {
    if (!Array.isArray(value.principles)) {
      issues.push({ path, field: 'principles', message: 'must be an array when present' });
    } else {
      value.principles.forEach((p, i) => validatePrinciple(p, path, `principles[${i}]`, issues));
    }
  }
  validateOptionalConventions(value, path, issues);
  if ('team' in value) validateTeamPolicy(value.team, path, 'team', issues);
  return issues;
}

/**
 * Local overlay (`.agents/kyro/local.json`).
 * Personal/machine fields only — principles belong on shared after migration.
 */
export function validateLocalProjectStateShape(value: unknown, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) return [{ path, field: '<root>', message: 'must be an object' }];
  requireLiteral(value, 'schemaVersion', 4, path, issues);
  requireNullableString(value, 'activeScope', path, issues);
  if (!Array.isArray(value.installedAdapters)) {
    issues.push({ path, field: 'installedAdapters', message: 'must be an array' });
  }
  if ('runtimePath' in value && value.runtimePath !== undefined && typeof value.runtimePath !== 'string') {
    issues.push({ path, field: 'runtimePath', message: 'must be a string when present' });
  }
  if ('principles' in value) {
    issues.push({ path, field: 'principles', message: 'must not be present on local overlay (shared-only field)' });
  }
  if ('conventions' in value) {
    issues.push({ path, field: 'conventions', message: 'must not be present on local overlay (shared-only field)' });
  }
  if ('team' in value) {
    issues.push({ path, field: 'team', message: 'must not be present on local overlay (shared-only field)' });
  }
  if ('execution' in value && value.execution !== undefined) {
    validateExecutionPreferences(value.execution, path, 'execution', issues);
  }
  if ('kyroInvocation' in value) {
    issues.push({ path, field: 'kyroInvocation', message: 'must not be present on project files (global manifest only)' });
  }
  return issues;
}

function validateTeamPolicy(value: unknown, path: string, prefix: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, field: prefix, message: 'must be an object when present' });
    return;
  }
  if ('minPackageVersion' in value && value.minPackageVersion !== undefined && typeof value.minPackageVersion !== 'string') {
    issues.push({ path, field: `${prefix}.minPackageVersion`, message: 'must be a string when present' });
  }
  if ('recommendedAdapters' in value) {
    if (!Array.isArray(value.recommendedAdapters)) {
      issues.push({ path, field: `${prefix}.recommendedAdapters`, message: 'must be an array when present' });
    } else if (!value.recommendedAdapters.every((entry) => typeof entry === 'string')) {
      issues.push({ path, field: `${prefix}.recommendedAdapters`, message: 'must be an array of strings when present' });
    }
  }
}

function validateExecutionPreferences(value: unknown, path: string, prefix: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, field: prefix, message: 'must be an object when present' });
    return;
  }
  if ('delegationEnabled' in value && value.delegationEnabled !== undefined && typeof value.delegationEnabled !== 'boolean') {
    issues.push({ path, field: `${prefix}.delegationEnabled`, message: 'must be a boolean when present' });
  }
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
    issues.push({ path, field: prefix, message: 'must be an object { id, title, status }, not a bare string' });
    return;
  }
  if (!isRecord(value)) {
    issues.push({ path, field: prefix, message: 'must be an object { id, title, status }' });
    return;
  }
  requireString(value, 'id', path, issues, `${prefix}.id`);
  requireString(value, 'title', path, issues, `${prefix}.title`);
  requireLiteralSet(value, 'status', SCOPE_STATUS_VALUES, path, issues, `${prefix}.status`);
  validateRetirementInvariant(value, path, prefix, issues);
}

export interface SprintFileValidationOptions {
  /** Debt boundary: `exact` (default) for anything that will be written, `compatible` for readers. */
  readonly debt?: DebtValidationMode;
}

/** Validate a v4 sprint.json. Catches shape drift (string conventions, bad snapshot, etc.). */
export function validateSprintFile(value: unknown, path: string, options: SprintFileValidationOptions = {}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) return [{ path, field: '<root>', message: 'must be an object' }];
  requireLiteral(value, 'schemaVersion', 4, path, issues);
  requireString(value, 'scope', path, issues);
  requireString(value, 'title', path, issues);
  requireString(value, 'status', path, issues);
  requireString(value, 'objective', path, issues);
  validateRetirementInvariant(value, path, '', issues);

  // author is optional (captured at init from git when available). Present-only so pre-feature
  // scopes and sandboxes without git identity still validate.
  if ('author' in value) {
    validateScopeAuthor(value.author, path, 'author', issues);
  }

  // successCriteria / clarifications are v4.1 additions — validate shape only if present so
  // scopes created before 4.1 (which omit them) are not failed by close-sprint's gate.
  if ('successCriteria' in value && !Array.isArray(value.successCriteria)) {
    issues.push({ path, field: 'successCriteria', message: 'must be an array of strings when present' });
  }
  if ('spec' in value) {
    validateSpec(value.spec, path, 'spec', issues);
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

  // adrs[] is optional for scopes created before JSON ADR support. New templates include it.
  if ('adrs' in value) {
    if (!Array.isArray(value.adrs)) {
      issues.push({ path, field: 'adrs', message: 'must be an array when present' });
    } else {
      const adrIds = collectAdrIds(value.adrs);
      for (const id of collectDuplicateAdrIds(value.adrs)) {
        issues.push({ path, field: 'adrs', message: `contains duplicate ADR id ${id}` });
      }
      value.adrs.forEach((adr, index) => validateAdrRecord(adr, path, `adrs[${index}]`, issues, adrIds));
    }
  }

  if (!isRecord(value.roadmap)) {
    issues.push({ path, field: 'roadmap', message: 'must be an object' });
  } else {
    requireNumber(value.roadmap, 'plannedSprintCount', path, issues, 'roadmap.plannedSprintCount');
    if (!Array.isArray(value.roadmap.sprints)) {
      issues.push({ path, field: 'roadmap.sprints', message: 'must be an array' });
    } else {
      value.roadmap.sprints.forEach((s, i) => validateRoadmapSprint(s, path, `roadmap.sprints[${i}]`, issues));
    }
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
    value.debt.forEach((d, i) => validateDebtItem(d, path, `debt[${i}]`, issues, options.debt ?? DEBT_VALIDATION_MODE.EXACT));
  }

  // remediations[] is the append-only anchor to post-close corrections. Absent on scopes that were
  // never remediated; when present it must be well-formed, since an unverifiable anchor would let a
  // corrected state claim a provenance nobody can check.
  if ('remediations' in value) {
    validateRemediationAnchors(value.remediations, path, 'remediations', issues);
  }

  // certifications[] is the append-only anchor to independent validation of a corrected state. The
  // id and the path must derive from each other, or an anchor could name C-001 while pointing at
  // the bytes of another record (the E3 lesson).
  if ('certifications' in value) {
    validateCertificationAnchors(value.certifications, path, 'certifications', issues);
  }

  if (!isRecord(value.handoff)) {
    issues.push({ path, field: 'handoff', message: 'must be an object' });
  } else {
    // Pre-4.32 scopes wrote terminal close as wrap_up. Collapse to done on read so
    // wrap_up never remains a first-class nextAction in the runtime contract.
    if (value.handoff.nextAction === 'wrap_up') {
      value.handoff.nextAction = 'done';
    }
    requireLiteralSet(value.handoff, 'nextAction', NEXT_ACTION_VALUES, path, issues, 'handoff.nextAction');
    requireNullableString(value.handoff, 'nextTaskId', path, issues);
    if (value.retirement !== undefined && value.handoff.nextAction !== 'done') {
      issues.push({ path, field: 'handoff.nextAction', message: 'must be done when retirement is present' });
    }
  }
  if (value.retirement !== undefined && value.activeSprint !== null) {
    issues.push({ path, field: 'activeSprint', message: 'must be null when retirement is present' });
  }
  return issues;
}

function validateRetirementInvariant(value: Record<string, unknown>, path: string, prefix: string, issues: ValidationIssue[]): void {
  const field = (name: string): string => prefix ? `${prefix}.${name}` : name;
  const retirement = value.retirement;
  if (value.status === 'retired' && retirement === undefined) {
    issues.push({ path, field: field('retirement'), message: 'is required when status is retired' });
    return;
  }
  if (retirement === undefined) return;
  if (value.status !== 'retired') {
    issues.push({ path, field: field('status'), message: 'must be retired when retirement is present' });
  }
  if (!isRecord(retirement)) {
    issues.push({ path, field: field('retirement'), message: 'must be an object' });
    return;
  }
  requireNonEmptyString(retirement, 'reason', path, issues, field('retirement.reason'));
  requireIsoString(retirement, 'retiredAt', path, issues, field('retirement.retiredAt'));
  if (typeof retirement.planDigest !== 'string' || !SHA256_HEX_PATTERN.test(retirement.planDigest)) {
    issues.push({ path, field: field('retirement.planDigest'), message: 'must be a lowercase SHA-256 digest' });
  }
  if ('supersededBy' in retirement) requireNonEmptyString(retirement, 'supersededBy', path, issues, field('retirement.supersededBy'));
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

function validateSpec(value: unknown, path: string, prefix: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, field: prefix, message: 'must be an object { requirements, scenarios, nonGoals, openQuestions } when present' });
    return;
  }
  if (!Array.isArray(value.requirements)) {
    issues.push({ path, field: `${prefix}.requirements`, message: 'must be an array' });
  } else {
    value.requirements.forEach((requirement, index) => validateSpecRequirement(requirement, path, `${prefix}.requirements[${index}]`, issues));
  }
  if (!Array.isArray(value.scenarios)) {
    issues.push({ path, field: `${prefix}.scenarios`, message: 'must be an array' });
  } else {
    value.scenarios.forEach((scenario, index) => validateSpecScenario(scenario, path, `${prefix}.scenarios[${index}]`, issues));
  }
  requireStringArrayField(value, 'nonGoals', path, issues, `${prefix}.nonGoals`);
  requireStringArrayField(value, 'openQuestions', path, issues, `${prefix}.openQuestions`);
}

function validateScopeAuthor(value: unknown, path: string, prefix: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, field: prefix, message: 'must be an object { name?, email?, source, capturedAt } with at least one of name/email' });
    return;
  }
  const hasName = 'name' in value;
  const hasEmail = 'email' in value;
  if (!hasName && !hasEmail) {
    issues.push({ path, field: prefix, message: 'must include at least one of name or email' });
  }
  if (hasName) {
    requireNonEmptyString(value, 'name', path, issues, `${prefix}.name`);
  }
  if (hasEmail) {
    requireNonEmptyString(value, 'email', path, issues, `${prefix}.email`);
    if (typeof value.email === 'string' && value.email.trim() !== '') {
      const email = value.email.trim();
      // Lightweight shape check only — not full RFC validation.
      // Keep in sync with isPlausibleAuthorEmail in core/actor.ts (capture path uses the same rule).
      if (!email.includes('@') || /\s/.test(email)) {
        issues.push({ path, field: `${prefix}.email`, message: 'must look like an email (contain @, no whitespace)' });
      }
    }
  }
  requireLiteralSet(value, 'source', ['git'], path, issues, `${prefix}.source`);
  requireIsoString(value, 'capturedAt', path, issues, `${prefix}.capturedAt`);
}

function validateSpecRequirement(value: unknown, path: string, prefix: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, field: prefix, message: 'must be an object { id, statement }' });
    return;
  }
  requireNonEmptyString(value, 'id', path, issues, `${prefix}.id`);
  requireNonEmptyString(value, 'statement', path, issues, `${prefix}.statement`);
  if ('priority' in value) requireLiteralSet(value, 'priority', SPEC_REQUIREMENT_PRIORITY_VALUES, path, issues, `${prefix}.priority`);
  if ('rationale' in value && typeof value.rationale !== 'string') {
    issues.push({ path, field: `${prefix}.rationale`, message: 'must be a string when present' });
  }
}

function validateSpecScenario(value: unknown, path: string, prefix: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, field: prefix, message: 'must be an object { id, requirement, given, when, then }' });
    return;
  }
  requireNonEmptyString(value, 'id', path, issues, `${prefix}.id`);
  requireNonEmptyString(value, 'requirement', path, issues, `${prefix}.requirement`);
  requireNonEmptyString(value, 'given', path, issues, `${prefix}.given`);
  requireNonEmptyString(value, 'when', path, issues, `${prefix}.when`);
  requireNonEmptyString(value, 'then', path, issues, `${prefix}.then`);
}

function validateConvention(value: unknown, path: string, prefix: string, issues: ValidationIssue[]): void {
  if (typeof value === 'string') {
    issues.push({ path, field: prefix, message: 'must be an object { id, rule, tags, addedSprint }, not a bare string' });
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

function validateOptionalConventions(value: Record<string, unknown>, path: string, issues: ValidationIssue[]): void {
  if (!('conventions' in value)) return;
  if (!Array.isArray(value.conventions)) {
    issues.push({ path, field: 'conventions', message: 'must be an array when present' });
    return;
  }
  value.conventions.forEach((convention, index) => validateConvention(convention, path, `conventions[${index}]`, issues));
}

const ADR_SHAPE_EXAMPLE =
  '{ "id": "ADR-0001", "title": "Short title", "status": "accepted", "date": "2026-07-22", "context": "Why this decision is needed", "decision": "What we decided", "consequences": ["Follow-on impact"], "alternatives": ["Option we rejected"] }';

function validateAdrRecord(value: unknown, path: string, prefix: string, issues: ValidationIssue[], adrIds: Set<string>): void {
  const before = issues.length;
  if (!isRecord(value)) {
    issues.push({
      path,
      field: prefix,
      message: `must be an object with fields id, title, status, date, context, decision, consequences, alternatives — example: ${ADR_SHAPE_EXAMPLE}`,
    });
    return;
  }
  requireAdrId(value, 'id', path, issues, `${prefix}.id`);
  requireNonEmptyString(value, 'title', path, issues, `${prefix}.title`);
  requireLiteralSet(value, 'status', ADR_STATUS_VALUES, path, issues, `${prefix}.status`);
  requireDateString(value, 'date', path, issues, `${prefix}.date`);
  requireNonEmptyString(value, 'context', path, issues, `${prefix}.context`);
  requireNonEmptyString(value, 'decision', path, issues, `${prefix}.decision`);
  requireNonEmptyStringArrayField(value, 'consequences', path, issues, `${prefix}.consequences`);
  requireNonEmptyStringArrayField(value, 'alternatives', path, issues, `${prefix}.alternatives`);
  if ('links' in value) validateAdrLinks(value.links, value.id, path, `${prefix}.links`, issues, adrIds);
  // When any field failed, append one actionable example so agents do not guess free-form ADR prose.
  if (issues.length > before) {
    issues.push({
      path,
      field: prefix,
      message: `incomplete or invalid ADR shape — required example: ${ADR_SHAPE_EXAMPLE}. Prefer: kyro adr add --title ... --context ... --decision ... --consequence ... --alternative ...`,
    });
  }
}

function collectAdrIds(values: unknown[]): Set<string> {
  const ids = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (!isRecord(value) || typeof value.id !== 'string') continue;
    if (ids.has(value.id)) duplicates.add(value.id);
    ids.add(value.id);
  }
  return new Set([...ids].filter((id) => !duplicates.has(id)));
}

function collectDuplicateAdrIds(values: unknown[]): string[] {
  const ids = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (!isRecord(value) || typeof value.id !== 'string') continue;
    if (ids.has(value.id)) duplicates.add(value.id);
    ids.add(value.id);
  }
  return [...duplicates].sort();
}

function validateAdrLinks(value: unknown, ownId: unknown, path: string, prefix: string, issues: ValidationIssue[], adrIds: Set<string>): void {
  if (!isRecord(value) || Array.isArray(value)) {
    issues.push({ path, field: prefix, message: 'must be an object when present' });
    return;
  }
  for (const key of Object.keys(value)) {
    if (!ADR_LINK_KEY_VALUES.includes(key as AdrLinkKey)) {
      issues.push({ path, field: `${prefix}.${key}`, message: `must be one of: ${ADR_LINK_KEY_VALUES.join(', ')}` });
      continue;
    }
    requireNonEmptyStringArrayField(value, key, path, issues, `${prefix}.${key}`);
  }
  validateAdrReferenceLinks(value, 'adrs', ownId, path, prefix, issues, adrIds);
  validateAdrReferenceLinks(value, 'supersedes', ownId, path, prefix, issues, adrIds);
}

function validateAdrReferenceLinks(
  links: Record<string, unknown>,
  key: 'adrs' | 'supersedes',
  ownId: unknown,
  path: string,
  prefix: string,
  issues: ValidationIssue[],
  adrIds: Set<string>,
): void {
  if (!(key in links) || !Array.isArray(links[key])) return;
  for (const ref of links[key]) {
    if (typeof ref !== 'string') continue;
    if (ref === ownId) {
      issues.push({ path, field: `${prefix}.${key}`, message: `must not reference its own ADR id ${ref}` });
    } else if (!adrIds.has(ref)) {
      issues.push({ path, field: `${prefix}.${key}`, message: `references unknown ADR id ${ref}` });
    }
  }
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
  if ('checkpoint' in value && typeof value.checkpoint !== 'string') {
    issues.push({ path, field: `${prefix}.checkpoint`, message: 'must be a string when present' });
  }
  if ('checkpointSha256' in value && (typeof value.checkpointSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.checkpointSha256))) {
    issues.push({ path, field: `${prefix}.checkpointSha256`, message: 'must be a SHA-256 hex digest when present' });
  }
}

/** Roadmap sprint entries are consumed by close-sprint (`s.n`, `s.state`) and narrative render (`s.title`). */
function validateRoadmapSprint(value: unknown, path: string, prefix: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, field: prefix, message: 'must be an object { n, slug, title, state }' });
    return;
  }
  requireNumber(value, 'n', path, issues, `${prefix}.n`);
  requireString(value, 'slug', path, issues, `${prefix}.slug`);
  requireString(value, 'title', path, issues, `${prefix}.title`);
  requireString(value, 'state', path, issues, `${prefix}.state`);
}

/**
 * Validate every field the runtime (close-sprint, analyze, context-pack) reads from activeSprint.
 * Contract: if this passes, no downstream command may crash on a missing field.
 */
function validateActiveSprint(value: unknown, path: string, prefix: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, field: prefix, message: 'must be an object or null' });
    return;
  }
  requireNumber(value, 'n', path, issues, `${prefix}.n`);
  requireString(value, 'slug', path, issues, `${prefix}.slug`);
  requireString(value, 'objective', path, issues, `${prefix}.objective`);
  // title is a v4.2 addition — optional (narrative falls back to roadmap title → objective).
  if ('title' in value && typeof value.title !== 'string') {
    issues.push({ path, field: `${prefix}.title`, message: 'must be a string when present' });
  }
  requireStringArrayField(value, 'definitionOfDone', path, issues, `${prefix}.definitionOfDone`);
  if (!Array.isArray(value.phases)) {
    issues.push({ path, field: `${prefix}.phases`, message: 'must be an array' });
  } else {
    value.phases.forEach((phase, pi) => {
      if (!isRecord(phase)) {
        issues.push({ path, field: `${prefix}.phases[${pi}]`, message: 'must be an object' });
        return;
      }
      requireString(phase, 'id', path, issues, `${prefix}.phases[${pi}].id`);
      requireString(phase, 'title', path, issues, `${prefix}.phases[${pi}].title`);
      if (!Array.isArray(phase.tasks)) {
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
  requireString(value, 'title', path, issues, `${prefix}.title`);
  requireString(value, 'description', path, issues, `${prefix}.description`);
  requireLiteralSet(value, 'status', TASK_STATUS_VALUES, path, issues, `${prefix}.status`);
  if ('files_to_touch' in value) requireStringArrayField(value, 'files_to_touch', path, issues, `${prefix}.files_to_touch`);
  if ('acceptance_criteria' in value) requireStringArrayField(value, 'acceptance_criteria', path, issues, `${prefix}.acceptance_criteria`);
  if ('depends_on' in value) requireStringArrayField(value, 'depends_on', path, issues, `${prefix}.depends_on`);
  if ('scenario_refs' in value) requireStringArrayField(value, 'scenario_refs', path, issues, `${prefix}.scenario_refs`);
}

function validateTaskEvidence(value: unknown, path: string, prefix: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, field: prefix, message: 'must be an object { summary, validation, files_changed, by, recordedAt } or null' });
    return;
  }
  requireNonEmptyString(value, 'summary', path, issues, `${prefix}.summary`);
  // validation tolerates a single string or a non-empty array of strings (real runs list many).
  const validation = value.validation;
  const validationOk = (typeof validation === 'string' && validation.trim().length > 0)
    || (Array.isArray(validation) && validation.length > 0 && validation.every((line) => typeof line === 'string'));
  if (!validationOk) issues.push({ path, field: `${prefix}.validation`, message: 'must be a non-empty string or a non-empty array of strings' });
  requireStringArrayField(value, 'files_changed', path, issues, `${prefix}.files_changed`);
  if ('notes' in value && typeof value.notes !== 'string') issues.push({ path, field: `${prefix}.notes`, message: 'must be a string when present' });
  requireNonEmptyString(value, 'by', path, issues, `${prefix}.by`);
  requireIsoString(value, 'recordedAt', path, issues, `${prefix}.recordedAt`);
}

/**
 * Per-field reasons a task.evidence value fails the schema, e.g. `evidence.notes must be a string
 * when present`. Reuses validateTaskEvidence so analyze/review can name the exact malformed field
 * instead of the generic "missing or malformed evidence".
 */
export function taskEvidenceIssues(value: unknown, prefix = 'evidence'): string[] {
  const issues: ValidationIssue[] = [];
  validateTaskEvidence(value, prefix, prefix, issues);
  return issues.map((issue) => `${issue.field} ${issue.message}`);
}

function validateTaskVerdict(value: unknown, path: string, prefix: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, field: prefix, message: 'must be an object { result, checked_criteria, findings, by, reviewedAt } or null' });
    return;
  }
  requireLiteralSet(value, 'result', TASK_VERDICT_RESULT_VALUES, path, issues, `${prefix}.result`);
  requireStringArrayField(value, 'checked_criteria', path, issues, `${prefix}.checked_criteria`);
  if ('waived_criteria' in value && value.waived_criteria !== undefined) {
    if (!Array.isArray(value.waived_criteria)) {
      issues.push({ path, field: `${prefix}.waived_criteria`, message: 'must be an array when present' });
    } else {
      value.waived_criteria.forEach((waiver, index) => {
        const wp = `${prefix}.waived_criteria[${index}]`;
        if (!isRecord(waiver)) { issues.push({ path, field: wp, message: 'must be an object { criterion, reason }' }); return; }
        requireNonEmptyString(waiver, 'criterion', path, issues, `${wp}.criterion`);
        requireNonEmptyString(waiver, 'reason', path, issues, `${wp}.reason`);
      });
    }
  }
  if (!Array.isArray(value.findings)) {
    issues.push({ path, field: `${prefix}.findings`, message: 'must be an array' });
  } else {
    value.findings.forEach((finding, index) => validateTaskVerdictFinding(finding, path, `${prefix}.findings[${index}]`, issues));
  }
  requireNonEmptyString(value, 'by', path, issues, `${prefix}.by`);
  requireIsoString(value, 'reviewedAt', path, issues, `${prefix}.reviewedAt`);
}

function validateTaskVerdictFinding(value: unknown, path: string, prefix: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, field: prefix, message: 'must be an object { severity, detail }' });
    return;
  }
  requireLiteralSet(value, 'severity', TASK_VERDICT_FINDING_SEVERITY_VALUES, path, issues, `${prefix}.severity`);
  requireNonEmptyString(value, 'detail', path, issues, `${prefix}.detail`);
}

function validateDebtItem(
  value: unknown,
  path: string,
  prefix: string,
  issues: ValidationIssue[],
  mode: DebtValidationMode = DEBT_VALIDATION_MODE.EXACT,
): void {
  if (typeof value === 'string') {
    issues.push({ path, field: prefix, message: 'must be an object { id, title, ... }, not a bare string' });
    return;
  }
  if (!isRecord(value)) {
    issues.push({ path, field: prefix, message: 'must be an object' });
    return;
  }
  requireString(value, 'id', path, issues, `${prefix}.id`);
  requireString(value, 'title', path, issues, `${prefix}.title`);
  requireNumber(value, 'origin', path, issues, `${prefix}.origin`);
  requireLiteralSet(value, 'priority', DEBT_PRIORITY_VALUES, path, issues, `${prefix}.priority`);
  requireLiteralSet(value, 'status', DEBT_STATUS_VALUES, path, issues, `${prefix}.status`);
  requireNullableNumber(value, 'targetSprint', path, issues, `${prefix}.targetSprint`);
  requireString(value, 'note', path, issues, `${prefix}.note`);
  // ADR-0001: canonical debt is an exact output shape. Recognizing a legacy key is a reader's job;
  // tolerating it here would let a hybrid record be written back as if it were canonical.
  if (mode === DEBT_VALIDATION_MODE.EXACT) {
    for (const key of Object.keys(value)) {
      if (!(CANONICAL_DEBT_KEY_VALUES as readonly string[]).includes(key)) {
        issues.push({ path, field: `${prefix}.${key}`, message: 'is not a canonical debt key and must not be written' });
      }
    }
  }
}

function validateRemediationAnchors(value: unknown, path: string, prefix: string, issues: ValidationIssue[]): void {
  if (!Array.isArray(value)) {
    issues.push({ path, field: prefix, message: 'must be an array when present' });
    return;
  }
  const seen = new Set<string>();
  value.forEach((entry, index) => {
    const field = `${prefix}[${index}]`;
    if (!isRecord(entry)) {
      issues.push({ path, field, message: 'must be an object { id, path, commitment }' });
      return;
    }
    for (const key of Object.keys(entry)) {
      if (!REMEDIATION_ANCHOR_KEYS.includes(key)) {
        issues.push({ path, field: `${field}.${key}`, message: 'is not part of the remediation anchor contract' });
      }
    }
    requireNonEmptyString(entry, 'id', path, issues, `${field}.id`);
    requireNonEmptyString(entry, 'path', path, issues, `${field}.path`);
    if (typeof entry.commitment !== 'string' || !SHA256_HEX_PATTERN.test(entry.commitment)) {
      issues.push({ path, field: `${field}.commitment`, message: 'must be a sha-256 hex digest' });
    }
    if (typeof entry.id === 'string') {
      if (seen.has(entry.id)) issues.push({ path, field: `${field}.id`, message: `duplicates remediation id ${entry.id}` });
      seen.add(entry.id);
    }
  });
}

/**
 * A certification anchor is only well-formed when its id is a certification id, its commitment is a
 * real digest, and its path is EXACTLY the path derived from that id. Accepting a free-form path
 * would let the anchor point anywhere while still passing every other check.
 */
function validateCertificationAnchors(value: unknown, path: string, prefix: string, issues: ValidationIssue[]): void {
  if (!Array.isArray(value)) {
    issues.push({ path, field: prefix, message: 'must be an array when present' });
    return;
  }
  const seen = new Set<string>();
  value.forEach((entry, index) => {
    const field = `${prefix}[${index}]`;
    if (!isRecord(entry)) {
      issues.push({ path, field, message: 'must be an object { id, path, commitment }' });
      return;
    }
    for (const key of Object.keys(entry)) {
      if (!REMEDIATION_ANCHOR_KEYS.includes(key)) {
        issues.push({ path, field: `${field}.${key}`, message: 'is not part of the certification anchor contract' });
      }
    }
    if (typeof entry.commitment !== 'string' || !SHA256_HEX_PATTERN.test(entry.commitment)) {
      issues.push({ path, field: `${field}.commitment`, message: 'must be a sha-256 hex digest' });
    }
    if (typeof entry.id !== 'string' || !CERTIFICATION_ID_PATTERN.test(entry.id)) {
      issues.push({ path, field: `${field}.id`, message: 'must be a certification id of the form C-NNN' });
      return;
    }
    const derived = `archive/certifications/certification-${entry.id.slice('C-'.length)}.json`;
    if (entry.path !== derived) {
      issues.push({ path, field: `${field}.path`, message: `must be ${derived}, the path derived from ${entry.id}` });
    }
    if (seen.has(entry.id)) issues.push({ path, field: `${field}.id`, message: `duplicates certification id ${entry.id}` });
    seen.add(entry.id);
  });
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

export function asSharedProjectState(value: unknown): KyroSharedProjectState | null {
  return validateSharedProjectStateShape(value, '.agents/kyro/project.json').length === 0
    ? value as KyroSharedProjectState
    : null;
}

export function asLocalProjectState(value: unknown): KyroLocalProjectState | null {
  return validateLocalProjectStateShape(value, '.agents/kyro/local.json').length === 0
    ? value as KyroLocalProjectState
    : null;
}

export function asSprintFile(value: unknown): SprintFile | null {
  return validateSprintFile(value, 'sprint.json').length === 0 ? value as SprintFile : null;
}

export function asTaskEvidence(value: unknown): TaskEvidence | null {
  const issues: ValidationIssue[] = [];
  if (value === null) return null;
  validateTaskEvidence(value, 'task.evidence', 'evidence', issues);
  return issues.length === 0 ? value as TaskEvidence : null;
}

export function asTaskVerdict(value: unknown): TaskVerdict | null {
  const issues: ValidationIssue[] = [];
  if (value === null) return null;
  validateTaskVerdict(value, 'task.verdict', 'verdict', issues);
  return issues.length === 0 ? value as TaskVerdict : null;
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

function requireNonEmptyString(record: Record<string, unknown>, key: string, path: string, issues: ValidationIssue[], field = key): void {
  if (typeof record[key] !== 'string' || record[key].trim() === '') issues.push({ path, field, message: 'must be a non-empty string' });
}

function requireIsoString(record: Record<string, unknown>, key: string, path: string, issues: ValidationIssue[], field = key): void {
  if (typeof record[key] !== 'string' || Number.isNaN(Date.parse(record[key]))) issues.push({ path, field, message: 'must be an ISO-8601 timestamp string' });
}

function requireNullableString(record: Record<string, unknown>, key: string, path: string, issues: ValidationIssue[]): void {
  if (record[key] !== null && typeof record[key] !== 'string') issues.push({ path, field: key, message: 'must be a string or null' });
}

function requireNullableNumber(record: Record<string, unknown>, key: string, path: string, issues: ValidationIssue[], field = key): void {
  if (record[key] !== null && (typeof record[key] !== 'number' || Number.isNaN(record[key]))) {
    issues.push({ path, field, message: 'must be a number or null' });
  }
}

function requireNumber(record: Record<string, unknown>, key: string, path: string, issues: ValidationIssue[], field = key): void {
  if (typeof record[key] !== 'number' || Number.isNaN(record[key])) issues.push({ path, field, message: 'must be a number' });
}

function requireLiteralSet(record: Record<string, unknown>, key: string, allowed: readonly string[], path: string, issues: ValidationIssue[], field = key): void {
  if (typeof record[key] !== 'string' || !allowed.includes(record[key] as string)) {
    issues.push({ path, field, message: `must be one of: ${allowed.join(', ')}` });
  }
}

function requireAdrId(record: Record<string, unknown>, key: string, path: string, issues: ValidationIssue[], field = key): void {
  if (typeof record[key] !== 'string' || !ADR_ID_PATTERN.test(record[key])) {
    issues.push({ path, field, message: 'must match ADR-0001 format' });
  }
}

function requireDateString(record: Record<string, unknown>, key: string, path: string, issues: ValidationIssue[], field = key): void {
  const value = record[key];
  if (typeof value !== 'string' || !isValidIsoDate(value)) {
    issues.push({ path, field, message: 'must be a YYYY-MM-DD date string' });
  }
}

function isValidIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function requireStringArray(record: Record<string, unknown>, key: string, path: string, issues: ValidationIssue[]): void {
  requireStringArrayField(record, key, path, issues, key);
}

function requireStringArrayField(record: Record<string, unknown>, key: string, path: string, issues: ValidationIssue[], field: string): void {
  if (!Array.isArray(record[key]) || !record[key].every((item) => typeof item === 'string')) {
    issues.push({ path, field, message: 'must be an array of strings' });
  }
}

function requireNonEmptyStringArrayField(record: Record<string, unknown>, key: string, path: string, issues: ValidationIssue[], field: string): void {
  if (!Array.isArray(record[key]) || record[key].length === 0 || !record[key].every((item) => typeof item === 'string' && item.trim() !== '')) {
    issues.push({ path, field, message: 'must be a non-empty array of non-empty strings' });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
