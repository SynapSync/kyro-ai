import { ADR_LINK_KEYS, ADR_STATUS, KYRO_SCOPE_ENTRY_STATUS, TASK_DISPOSITION_KIND, TASK_DISPOSITION_TARGET_KIND } from '../types';

export const KYRO_SCOPE_STATUS = KYRO_SCOPE_ENTRY_STATUS;

export type KyroScopeStatus = (typeof KYRO_SCOPE_STATUS)[keyof typeof KYRO_SCOPE_STATUS];

export const SCOPE_STATUS_VALUES = Object.values(KYRO_SCOPE_STATUS);
export const NEXT_ACTION_VALUES = ['init', 'clarify', 'plan_sprint', 'await_scope_completion', 'execute_task', 'review_task', 'qa_or_close', 'close_sprint', 'done'] as const;
export const TASK_STATUS_VALUES = ['pending', 'in_progress', 'done', 'blocked'] as const;
export const TASK_DISPOSITION_KIND_VALUES = Object.values(TASK_DISPOSITION_KIND);
export const TASK_DISPOSITION_TARGET_KIND_VALUES = Object.values(TASK_DISPOSITION_TARGET_KIND);
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
export const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;
export const REMEDIATION_ANCHOR_KEYS = ['id', 'path', 'commitment'];
export const CERTIFICATION_ID_PATTERN = /^C-\d{3,}$/;

export interface ValidationIssue {
  path: string;
  field: string;
  message: string;
}

export function requireLiteral(record: Record<string, unknown>, key: string, expected: unknown, path: string, issues: ValidationIssue[]): void {
  if (record[key] !== expected) issues.push({ path, field: key, message: `must be ${String(expected)}` });
}

export function requireString(record: Record<string, unknown>, key: string, path: string, issues: ValidationIssue[], field = key): void {
  if (typeof record[key] !== 'string') issues.push({ path, field, message: 'must be a string' });
}

export function requireNonEmptyString(record: Record<string, unknown>, key: string, path: string, issues: ValidationIssue[], field = key): void {
  if (typeof record[key] !== 'string' || record[key].trim() === '') issues.push({ path, field, message: 'must be a non-empty string' });
}

export function requireIsoString(record: Record<string, unknown>, key: string, path: string, issues: ValidationIssue[], field = key): void {
  if (typeof record[key] !== 'string' || Number.isNaN(Date.parse(record[key]))) issues.push({ path, field, message: 'must be an ISO-8601 timestamp string' });
}

export function requireNullableString(record: Record<string, unknown>, key: string, path: string, issues: ValidationIssue[]): void {
  if (record[key] !== null && typeof record[key] !== 'string') issues.push({ path, field: key, message: 'must be a string or null' });
}

export function requireNullableNumber(record: Record<string, unknown>, key: string, path: string, issues: ValidationIssue[], field = key): void {
  if (record[key] !== null && (typeof record[key] !== 'number' || Number.isNaN(record[key]))) {
    issues.push({ path, field, message: 'must be a number or null' });
  }
}

export function requireNumber(record: Record<string, unknown>, key: string, path: string, issues: ValidationIssue[], field = key): void {
  if (typeof record[key] !== 'number' || Number.isNaN(record[key])) issues.push({ path, field, message: 'must be a number' });
}

export function requireLiteralSet(record: Record<string, unknown>, key: string, allowed: readonly string[], path: string, issues: ValidationIssue[], field = key): void {
  if (typeof record[key] !== 'string' || !allowed.includes(record[key] as string)) {
    issues.push({ path, field, message: `must be one of: ${allowed.join(', ')}` });
  }
}

export function requireAdrId(record: Record<string, unknown>, key: string, path: string, issues: ValidationIssue[], field = key): void {
  if (typeof record[key] !== 'string' || !ADR_ID_PATTERN.test(record[key])) {
    issues.push({ path, field, message: 'must match ADR-0001 format' });
  }
}

export function requireDateString(record: Record<string, unknown>, key: string, path: string, issues: ValidationIssue[], field = key): void {
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

export function requireStringArray(record: Record<string, unknown>, key: string, path: string, issues: ValidationIssue[]): void {
  requireStringArrayField(record, key, path, issues, key);
}

export function requireStringArrayField(record: Record<string, unknown>, key: string, path: string, issues: ValidationIssue[], field: string): void {
  if (!Array.isArray(record[key]) || !record[key].every((item) => typeof item === 'string')) {
    issues.push({ path, field, message: 'must be an array of strings' });
  }
}

export function requireNonEmptyStringArrayField(record: Record<string, unknown>, key: string, path: string, issues: ValidationIssue[], field: string): void {
  if (!Array.isArray(record[key]) || record[key].length === 0 || !record[key].every((item) => typeof item === 'string' && item.trim() !== '')) {
    issues.push({ path, field, message: 'must be a non-empty array of non-empty strings' });
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
