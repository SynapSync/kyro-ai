import type {
  KyroLocalProjectState,
  KyroProjectState,
  KyroSharedProjectState,
  SprintFile,
  TaskDisposition,
  TaskEvidence,
  TaskVerdict,
} from '../types';
import {
  type DebtValidationMode,
  type ValidationIssue,
  isRecord,
  requireLiteral,
  requireString,
  requireNumber,
  DEBT_VALIDATION_MODE,
  requireLiteralSet,
  NEXT_ACTION_VALUES,
  requireNullableString,
  requireStringArrayField,
  requireNonEmptyString,
  requireIsoString,
  SPEC_REQUIREMENT_PRIORITY_VALUES,
} from './schema-primitives';
import {
  validateRetirementInvariant,
  validateCompletionInvariant,
  validateCompletionHistoryInvariant,
  validateConvention,
  validateProjectStateShape,
  validateSharedProjectStateShape,
  validateLocalProjectStateShape,
} from './schema-project-state';
import { collectAdrIds, collectDuplicateAdrIds, validateAdrRecord } from './schema-adr';
import {
  collectDispositionRefs,
  validateActiveSprint,
  validateDebtItem,
  validateRemediationAnchors,
  validateCertificationAnchors,
  validateGitBlock,
  validateTaskEvidence,
  validateTaskVerdict,
  validateTaskDisposition,
} from './schema-sprint-records';
import { type KyroScopeState, validateScopeState, type KyroScopeIndex, validateScopeIndex } from './schema-index-records';
export { KYRO_SCOPE_STATUS, SCOPE_STATUS_VALUES, NEXT_ACTION_VALUES, TASK_STATUS_VALUES, TASK_DISPOSITION_KIND_VALUES, TASK_DISPOSITION_TARGET_KIND_VALUES, PHASE_STATUS_VALUES, DEBT_STATUS_VALUES, DEBT_PRIORITY_VALUES, CANONICAL_DEBT_KEY_VALUES, DEBT_VALIDATION_MODE, TASK_VERDICT_RESULT_VALUES, TASK_VERDICT_FINDING_SEVERITY_VALUES, SPEC_REQUIREMENT_PRIORITY_VALUES, ADR_STATUS_VALUES, ADR_LINK_KEY_VALUES } from './schema-primitives';
export type { KyroScopeStatus, DebtValidationMode, ValidationIssue } from './schema-primitives';
export { validateScopeState, validateScopeIndex, validateRoadmapSummary, validateSprintSummary, validateRuleIndex, validateExecutionEvent, validateDebtSummary } from './schema-index-records';
export type { KyroScopeState, SizingDecisionSummary, RelevantArtifactPaths, KyroScopeIndex, RoadmapSummary, SprintSummary, DebtSummary, RuleIndex, RuleIndexEntry } from './schema-index-records';
export { validateProjectStateShape, validateSharedProjectStateShape, validateLocalProjectStateShape } from './schema-project-state';
export { validateGitBlock, taskEvidenceIssues } from './schema-sprint-records';
export type { GitBlockKind } from './schema-sprint-records';


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
  validateCompletionInvariant(value, path, '', issues);
  validateCompletionHistoryInvariant(value, path, '', issues);

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

  const refs = collectDispositionRefs(value);
  if (value.activeSprint !== null) validateActiveSprint(value.activeSprint, path, 'activeSprint', issues, refs);

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
    if (value.completion !== undefined && value.handoff.nextAction !== 'done') {
      issues.push({ path, field: 'handoff.nextAction', message: 'must be done when completion is present' });
    }
  }
  if (value.retirement !== undefined && value.activeSprint !== null) {
    issues.push({ path, field: 'activeSprint', message: 'must be null when retirement is present' });
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

export function validateScopeAuthor(value: unknown, path: string, prefix: string, issues: ValidationIssue[]): void {
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
  if ('git' in value) validateGitBlock(value.git, 'ledger', path, `${prefix}.git`, issues);
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

export function asTaskDisposition(
  value: unknown,
  refs: { taskIds: Iterable<string>; debtIds: Iterable<string> } = { taskIds: [], debtIds: [] },
  selfId = '',
): TaskDisposition | null {
  const issues: ValidationIssue[] = [];
  if (value === undefined) return null;
  validateTaskDisposition(
    value,
    'task.disposition',
    'disposition',
    issues,
    { taskIds: new Set(refs.taskIds), debtIds: new Set(refs.debtIds) },
    selfId,
  );
  return issues.length === 0 ? value as TaskDisposition : null;
}

export function asScopeState(value: unknown): KyroScopeState | null {
  return validateScopeState(value, 'state.json').length === 0 ? value as KyroScopeState : null;
}

export function asScopeIndex(value: unknown): KyroScopeIndex | null {
  return validateScopeIndex(value, 'index.json').length === 0 ? value as KyroScopeIndex : null;
}