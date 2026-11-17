import { TASK_DISPOSITION_KIND, TASK_DISPOSITION_TARGET_KIND } from '../types';
import {
  type ValidationIssue,
  isRecord,
  requireNumber,
  requireString,
  requireStringArrayField,
  requireLiteralSet,
  TASK_STATUS_VALUES,
  TASK_DISPOSITION_KIND_VALUES,
  requireNonEmptyString,
  requireIsoString,
  TASK_DISPOSITION_TARGET_KIND_VALUES,
  TASK_VERDICT_RESULT_VALUES,
  TASK_VERDICT_FINDING_SEVERITY_VALUES,
  type DebtValidationMode,
  DEBT_VALIDATION_MODE,
  DEBT_PRIORITY_VALUES,
  DEBT_STATUS_VALUES,
  requireNullableNumber,
  CANONICAL_DEBT_KEY_VALUES,
  REMEDIATION_ANCHOR_KEYS,
  SHA256_HEX_PATTERN,
  CERTIFICATION_ID_PATTERN,
} from './schema-primitives';

/** Git object ids: SHA-1 (40) or SHA-256 (64) lowercase hex. */
const GIT_COMMIT_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

export type GitBlockKind = 'start' | 'end' | 'ledger';

/**
 * Validate an optional sprint git block when present: `activeSprint.git` (start),
 * checkpoint `close.git` (end), or `ledger[].git` (ledger). Absence is always valid.
 */
export function validateGitBlock(value: unknown, kind: GitBlockKind, path: string, prefix: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, field: prefix, message: 'must be an object when present' });
    return;
  }
  if (!('branch' in value) || (value.branch !== null && (typeof value.branch !== 'string' || value.branch.length === 0))) {
    issues.push({ path, field: `${prefix}.branch`, message: 'must be a non-empty string or null' });
  }
  const commit = (key: string, nullable: boolean): void => {
    const candidate = value[key];
    if (nullable && candidate === null) return;
    if (typeof candidate !== 'string' || !GIT_COMMIT_PATTERN.test(candidate)) {
      issues.push({ path, field: `${prefix}.${key}`, message: `must be a 40- or 64-character lowercase hex commit${nullable ? ' or null' : ''}` });
    }
  };
  if (kind === 'start' || kind === 'ledger') commit('startCommit', kind === 'ledger');
  if (kind === 'end' || kind === 'ledger') {
    commit('endCommit', false);
    if (typeof value.dirty !== 'boolean') issues.push({ path, field: `${prefix}.dirty`, message: 'must be a boolean' });
  }
}

/**
 * Validate every field the runtime (close-sprint, analyze, context-pack) reads from activeSprint.
 * Contract: if this passes, no downstream command may crash on a missing field.
 */
export function validateActiveSprint(
  value: unknown,
  path: string,
  prefix: string,
  issues: ValidationIssue[],
  refs: DispositionRefs,
): void {
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
  if ('git' in value) validateGitBlock(value.git, 'start', path, `${prefix}.git`, issues);
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
      phase.tasks.forEach((task, ti) => validateTask(task, path, `${prefix}.phases[${pi}].tasks[${ti}]`, issues, refs));
    });
  }
  if ('emergentTasks' in value) {
    if (!Array.isArray(value.emergentTasks)) {
      issues.push({ path, field: `${prefix}.emergentTasks`, message: 'must be an array when present' });
    } else {
      value.emergentTasks.forEach((task, ti) => validateTask(task, path, `${prefix}.emergentTasks[${ti}]`, issues, refs));
    }
  }
}

interface DispositionRefs {
  taskIds: Set<string>;
  debtIds: Set<string>;
}

export function collectDispositionRefs(sprint: Record<string, unknown>): DispositionRefs {
  const taskIds = new Set<string>();
  const debtIds = new Set<string>();
  const active = sprint.activeSprint;
  if (isRecord(active)) {
    if (Array.isArray(active.phases)) {
      for (const phase of active.phases) {
        if (!isRecord(phase) || !Array.isArray(phase.tasks)) continue;
        for (const task of phase.tasks) {
          if (isRecord(task) && typeof task.id === 'string') taskIds.add(task.id);
        }
      }
    }
    if (Array.isArray(active.emergentTasks)) {
      for (const task of active.emergentTasks) {
        if (isRecord(task) && typeof task.id === 'string') taskIds.add(task.id);
      }
    }
  }
  if (Array.isArray(sprint.debt)) {
    for (const item of sprint.debt) {
      if (isRecord(item) && typeof item.id === 'string') debtIds.add(item.id);
    }
  }
  return { taskIds, debtIds };
}

function validateTask(
  value: unknown,
  path: string,
  prefix: string,
  issues: ValidationIssue[],
  refs: DispositionRefs,
): void {
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
  if ('disposition' in value) {
    const selfId = typeof value.id === 'string' ? value.id : '';
    validateTaskDisposition(value.disposition, path, `${prefix}.disposition`, issues, refs, selfId);
    if (value.status === 'done') {
      issues.push({ path, field: `${prefix}.disposition`, message: 'must not be present when status is done' });
    }
    if (isRecord(value.verdict) && value.verdict.result === 'pass') {
      issues.push({ path, field: `${prefix}.disposition`, message: 'must not accompany a pass verdict' });
    }
  }
}

const DISPOSITION_KEYS = ['kind', 'reason', 'by', 'recordedAt', 'target'] as const;
const DISPOSITION_TARGET_KEYS = ['kind', 'id'] as const;

export function validateTaskDisposition(
  value: unknown,
  path: string,
  prefix: string,
  issues: ValidationIssue[],
  refs: DispositionRefs,
  selfId: string,
): void {
  if (!isRecord(value)) {
    issues.push({ path, field: prefix, message: 'must be an object when present' });
    return;
  }
  for (const key of Object.keys(value)) {
    if (!DISPOSITION_KEYS.includes(key as (typeof DISPOSITION_KEYS)[number])) {
      issues.push({ path, field: `${prefix}.${key}`, message: 'is not a disposition key' });
    }
  }
  requireLiteralSet(value, 'kind', TASK_DISPOSITION_KIND_VALUES, path, issues, `${prefix}.kind`);
  requireNonEmptyString(value, 'reason', path, issues, `${prefix}.reason`);
  requireNonEmptyString(value, 'by', path, issues, `${prefix}.by`);
  requireIsoString(value, 'recordedAt', path, issues, `${prefix}.recordedAt`);
  const kind = value.kind;
  const requiresTarget = kind === TASK_DISPOSITION_KIND.DEFERRED || kind === TASK_DISPOSITION_KIND.SUPERSEDED;
  if (requiresTarget && !('target' in value)) {
    issues.push({ path, field: `${prefix}.target`, message: `is required for ${String(kind)} dispositions` });
  }
  if ('target' in value) {
    validateTaskDispositionTarget(value.target, path, `${prefix}.target`, issues, refs, selfId, typeof kind === 'string' ? kind : null);
  }
}

function validateTaskDispositionTarget(
  value: unknown,
  path: string,
  prefix: string,
  issues: ValidationIssue[],
  refs: DispositionRefs,
  selfId: string,
  dispositionKind: string | null,
): void {
  if (!isRecord(value)) {
    issues.push({ path, field: prefix, message: 'must be an object { kind, id }' });
    return;
  }
  for (const key of Object.keys(value)) {
    if (!DISPOSITION_TARGET_KEYS.includes(key as (typeof DISPOSITION_TARGET_KEYS)[number])) {
      issues.push({ path, field: `${prefix}.${key}`, message: 'is not a disposition target key' });
    }
  }
  requireLiteralSet(value, 'kind', TASK_DISPOSITION_TARGET_KIND_VALUES, path, issues, `${prefix}.kind`);
  requireNonEmptyString(value, 'id', path, issues, `${prefix}.id`);
  const targetKind = value.kind;
  const targetId = value.id;
  if (typeof targetKind !== 'string' || typeof targetId !== 'string') return;
  if (dispositionKind === TASK_DISPOSITION_KIND.DEFERRED && targetKind !== TASK_DISPOSITION_TARGET_KIND.DEBT && targetKind !== TASK_DISPOSITION_TARGET_KIND.SPRINT) {
    issues.push({ path, field: prefix, message: 'deferred target kind must be debt or sprint' });
  }
  if (dispositionKind === TASK_DISPOSITION_KIND.SUPERSEDED && targetKind !== TASK_DISPOSITION_TARGET_KIND.TASK) {
    issues.push({ path, field: prefix, message: 'superseded target kind must be task' });
  }
  if (targetKind === TASK_DISPOSITION_TARGET_KIND.DEBT && !refs.debtIds.has(targetId)) {
    issues.push({ path, field: `${prefix}.id`, message: `must reference an existing debt id (unknown "${targetId}")` });
  }
  if (targetKind === TASK_DISPOSITION_TARGET_KIND.TASK) {
    if (!refs.taskIds.has(targetId)) {
      issues.push({ path, field: `${prefix}.id`, message: `must reference an existing task id (unknown "${targetId}")` });
    } else if (targetId === selfId) {
      issues.push({ path, field: `${prefix}.id`, message: 'must not reference the same task' });
    }
  }
  if (targetKind === TASK_DISPOSITION_TARGET_KIND.SPRINT && !isPositiveSprintId(targetId)) {
    issues.push({ path, field: `${prefix}.id`, message: 'must be a positive integer sprint number' });
  }
}

function isPositiveSprintId(value: string): boolean {
  return /^[1-9]\d*$/.test(value);
}

export function validateTaskEvidence(value: unknown, path: string, prefix: string, issues: ValidationIssue[]): void {
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

export function validateTaskVerdict(value: unknown, path: string, prefix: string, issues: ValidationIssue[]): void {
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
  for (const digestField of ['requestDigest', 'reviewedMaterialDigest'] as const) {
    if (!(digestField in value) || value[digestField] === undefined) continue;
    if (typeof value[digestField] !== 'string' || !/^[a-f0-9]{64}$/.test(value[digestField])) {
      issues.push({ path, field: `${prefix}.${digestField}`, message: 'must be a lowercase sha256 digest when present' });
    }
  }
}

function validateTaskVerdictFinding(value: unknown, path: string, prefix: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, field: prefix, message: 'must be an object { severity, detail }' });
    return;
  }
  requireLiteralSet(value, 'severity', TASK_VERDICT_FINDING_SEVERITY_VALUES, path, issues, `${prefix}.severity`);
  requireNonEmptyString(value, 'detail', path, issues, `${prefix}.detail`);
}

export function validateDebtItem(
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

export function validateRemediationAnchors(value: unknown, path: string, prefix: string, issues: ValidationIssue[]): void {
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
export function validateCertificationAnchors(value: unknown, path: string, prefix: string, issues: ValidationIssue[]): void {
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
