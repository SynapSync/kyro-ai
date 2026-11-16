import {
  type ValidationIssue,
  isRecord,
  requireLiteral,
  requireString,
  requireNullableString,
  requireLiteralSet,
  SCOPE_STATUS_VALUES,
  requireNonEmptyString,
  requireIsoString,
  SHA256_HEX_PATTERN,
  requireStringArrayField,
  requireNumber,
} from './schema-primitives';
import { validateDebtItem } from './schema-sprint-records';

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
  if ('scopes' in value && !Array.isArray(value.scopes)) {
    issues.push({ path, field: 'scopes', message: 'must be an array when present' });
  } else if (Array.isArray(value.scopes)) {
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
  if ('installedAdapters' in value && !Array.isArray(value.installedAdapters)) {
    issues.push({ path, field: 'installedAdapters', message: 'must be an array when present (legacy)' });
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
  if ('git' in value && value.git !== undefined) {
    if (!isRecord(value.git)) {
      issues.push({ path, field: 'git', message: 'must be an object when present' });
    } else if ('commitOnSprintClose' in value.git && value.git.commitOnSprintClose !== undefined && typeof value.git.commitOnSprintClose !== 'boolean') {
      issues.push({ path, field: 'git.commitOnSprintClose', message: 'must be a boolean when present' });
    }
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
  validateCompletionInvariant(value, path, prefix, issues);
  validateCompletionHistoryInvariant(value, path, prefix, issues);
}

export function validateRetirementInvariant(value: Record<string, unknown>, path: string, prefix: string, issues: ValidationIssue[]): void {
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

export function validateCompletionInvariant(value: Record<string, unknown>, path: string, prefix: string, issues: ValidationIssue[]): void {
  const field = (name: string): string => prefix ? `${prefix}.${name}` : name;
  const completion = value.completion;
  if (completion === undefined) return;
  // Completion and retirement are distinct lifecycle facts; both present is contradictory.
  if (value.retirement !== undefined) {
    issues.push({ path, field: field('completion'), message: 'must not coexist with retirement (a scope cannot be both completed and retired)' });
  }
  if (value.status !== 'completed') {
    issues.push({ path, field: field('status'), message: 'must be completed when completion is present' });
  }
  if ('activeSprint' in value && value.activeSprint !== null) {
    issues.push({ path, field: field('activeSprint'), message: 'must be null when completion is present' });
  }
  validateCompletionRecord(completion, path, field('completion'), issues);
}

/** Shape of a single completion record, wherever it lives: live `completion` or preserved history. */
function validateCompletionRecord(completion: unknown, path: string, field: string, issues: ValidationIssue[]): void {
  if (!isRecord(completion)) {
    issues.push({ path, field, message: 'must be an object' });
    return;
  }
  requireIsoString(completion, 'completedAt', path, issues, `${field}.completedAt`);
  requireNonEmptyString(completion, 'by', path, issues, `${field}.by`);
  if ('summary' in completion) requireNonEmptyString(completion, 'summary', path, issues, `${field}.summary`);
  if ('policy' in completion) {
    const policy = completion.policy;
    if (!isRecord(policy) || typeof policy.acceptOpenDebt !== 'boolean' || typeof policy.reconcileDebt !== 'boolean' || typeof policy.reason !== 'string' || !policy.reason.trim()) issues.push({ path, field: `${field}.policy`, message: 'must contain acceptOpenDebt, reconcileDebt and a non-empty reason' });
  }
  if ('debtAcceptance' in completion) {
    const accepted = completion.debtAcceptance;
    if (!isRecord(accepted) || typeof accepted.reason !== 'string' || !accepted.reason.trim() || !Array.isArray(accepted.items) || typeof accepted.debtCollectionSha256 !== 'string' || !SHA256_HEX_PATTERN.test(accepted.debtCollectionSha256)) {
      issues.push({ path, field: `${field}.debtAcceptance`, message: 'must contain reason, canonical items and a debt collection digest' });
    } else {
      accepted.items.forEach((item, index) => validateDebtItem(item, path, `${field}.debtAcceptance.items[${index}]`, issues));
    }
    if (!isRecord(completion.policy) || completion.policy.acceptOpenDebt !== true) issues.push({ path, field: `${field}.debtAcceptance`, message: 'requires an acceptOpenDebt policy' });
  } else if (isRecord(completion.policy) && completion.policy.acceptOpenDebt === true) issues.push({ path, field: `${field}.debtAcceptance`, message: 'is required when accepting open debt' });
  if ('planDigest' in completion && (typeof completion.planDigest !== 'string' || !SHA256_HEX_PATTERN.test(completion.planDigest))) issues.push({ path, field: `${field}.planDigest`, message: 'must be a SHA-256 digest' });
  validatePairedDigests(completion, path, field, issues);
}

/**
 * `requestDigest`/`beforeEntryDigest` are written together by the locked transactional applies and
 * absent together on legacy records. One without the other is drift, not a legacy shape.
 */
function validatePairedDigests(record: Record<string, unknown>, path: string, field: string, issues: ValidationIssue[]): void {
  if ('beforeStateDigest' in record && (typeof record.beforeStateDigest !== 'string' || !SHA256_HEX_PATTERN.test(record.beforeStateDigest))) issues.push({ path, field: `${field}.beforeStateDigest`, message: 'must be a SHA-256 digest' });
  if ('requestDigest' in record && (typeof record.requestDigest !== 'string' || !SHA256_HEX_PATTERN.test(record.requestDigest))) {
    issues.push({ path, field: `${field}.requestDigest`, message: 'must be a lowercase SHA-256 digest' });
  }
  if ('beforeEntryDigest' in record && (typeof record.beforeEntryDigest !== 'string' || !SHA256_HEX_PATTERN.test(record.beforeEntryDigest))) {
    issues.push({ path, field: `${field}.beforeEntryDigest`, message: 'must be a lowercase SHA-256 digest' });
  }
  if (('requestDigest' in record) !== ('beforeEntryDigest' in record)) {
    issues.push({ path, field, message: 'requestDigest and beforeEntryDigest must be present together or both absent' });
  }
}

/**
 * `completionHistory` is append-only audit evidence of completions that `kyro scope reopen`
 * superseded. It is independent of the live lifecycle state: a reopened scope is open again and
 * carries no `completion`, yet must still show that it was once completed and why it was reopened.
 * It may therefore coexist with any status, including a later completion or a retirement.
 */
export function validateCompletionHistoryInvariant(value: Record<string, unknown>, path: string, prefix: string, issues: ValidationIssue[]): void {
  const name = prefix ? `${prefix}.completionHistory` : 'completionHistory';
  const history = value.completionHistory;
  if (history === undefined) return;
  if (!Array.isArray(history)) {
    issues.push({ path, field: name, message: 'must be an array of reopen records' });
    return;
  }
  if (history.length === 0) {
    issues.push({ path, field: name, message: 'must be absent rather than empty' });
    return;
  }
  let previousReopenedAt = '';
  history.forEach((entry, index) => {
    const field = `${name}[${index}]`;
    if (!isRecord(entry)) {
      issues.push({ path, field, message: 'must be an object { reopenedAt, by, reason, completion }' });
      return;
    }
    requireIsoString(entry, 'reopenedAt', path, issues, `${field}.reopenedAt`);
    requireNonEmptyString(entry, 'by', path, issues, `${field}.by`);
    requireNonEmptyString(entry, 'reason', path, issues, `${field}.reason`);
    validateCompletionRecord(entry.completion, path, `${field}.completion`, issues);
    validatePairedDigests(entry, path, field, issues);
    if (typeof entry.reopenedAt === 'string') {
      if (entry.reopenedAt < previousReopenedAt) {
        issues.push({ path, field: `${field}.reopenedAt`, message: 'must not precede the previous entry (history is append-only)' });
      }
      previousReopenedAt = entry.reopenedAt;
    }
  });
}

export function validateConvention(value: unknown, path: string, prefix: string, issues: ValidationIssue[]): void {
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
  const hasRetirementMetadata = 'retiredReason' in value || 'retiredAt' in value;
  if ('retired' in value && value.retired !== true) {
    issues.push({ path, field: `${prefix}.retired`, message: 'must be true when present' });
  }
  if (value.retired === true) {
    requireLiteralSet(value, 'retiredReason', ['removed', 'replaced'], path, issues, `${prefix}.retiredReason`);
    requireIsoString(value, 'retiredAt', path, issues, `${prefix}.retiredAt`);
  } else if (hasRetirementMetadata) {
    issues.push({ path, field: prefix, message: 'retiredReason and retiredAt require retired: true' });
  }
}

function validateOptionalConventions(value: Record<string, unknown>, path: string, issues: ValidationIssue[]): void {
  if (!('conventions' in value)) return;
  if (!Array.isArray(value.conventions)) {
    issues.push({ path, field: 'conventions', message: 'must be an array when present' });
    return;
  }
  value.conventions.forEach((convention, index) => validateConvention(convention, path, `conventions[${index}]`, issues));
}
