import type { AdrLinkKey } from '../types';
import {
  type ValidationIssue,
  isRecord,
  requireAdrId,
  requireNonEmptyString,
  requireLiteralSet,
  ADR_STATUS_VALUES,
  requireDateString,
  requireNonEmptyStringArrayField,
  ADR_LINK_KEY_VALUES,
} from './schema-primitives';

const ADR_SHAPE_EXAMPLE =
  '{ "id": "ADR-0001", "title": "Short title", "status": "accepted", "date": "2026-07-22", "context": "Why this decision is needed", "decision": "What we decided", "consequences": ["Follow-on impact"], "alternatives": ["Option we rejected"] }';

export function validateAdrRecord(value: unknown, path: string, prefix: string, issues: ValidationIssue[], adrIds: Set<string>): void {
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

export function collectAdrIds(values: unknown[]): Set<string> {
  const ids = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (!isRecord(value) || typeof value.id !== 'string') continue;
    if (ids.has(value.id)) duplicates.add(value.id);
    ids.add(value.id);
  }
  return new Set([...ids].filter((id) => !duplicates.has(id)));
}

export function collectDuplicateAdrIds(values: unknown[]): string[] {
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
