import { readJsonSafely } from './json';
import { sprintJsonPath } from './paths';
import { asSprintFile, validateSprintFile } from './schema';
import { KyroCoreError } from '../core/errors';
import type { SprintFile } from '../types';

export interface LoadScopeSprintOptions {
  /** Both modes accept the same schema; strict includes issue details for mutating commands. */
  strict?: boolean;
  /** Adds the attempted action to failure messages. */
  action?: string;
  /** Overrides canonical guidance only for genuinely context-specific recovery instructions. */
  remedy?: Partial<Record<'SCOPE_NOT_FOUND' | 'INVALID_JSON' | 'INVALID_SPRINT_SHAPE', string>>;
  /** Adds call-site-specific shape guidance only when the raw value provides useful diagnostics. */
  shapeDetail?: (value: unknown) => string;
}

/** Loads live scope state; tolerant and strict modes accept the same schema, while strict adds issue detail. */
export function loadScopeSprint(scope: string, options: LoadScopeSprintOptions = {}): SprintFile {
  const read = readJsonSafely(sprintJsonPath(scope));
  const actionPrefix = options.action ? `Cannot ${options.action} "${scope}": ` : '';
  if (!read.exists) {
    const message = options.action ? `${actionPrefix}sprint.json is missing.` : `Scope "${scope}" has no sprint.json.`;
    throw new KyroCoreError('SCOPE_NOT_FOUND', message, options.remedy?.SCOPE_NOT_FOUND ?? 'Create the scope with /kyro:forge (INIT) or choose another scope.');
  }
  if (read.error) {
    const message = options.action ? `${actionPrefix}sprint.json is invalid JSON (${read.error}).` : `sprint.json for "${scope}" is invalid JSON (${read.error}).`;
    throw new KyroCoreError('INVALID_JSON', message, options.remedy?.INVALID_JSON ?? 'Fix invalid JSON or restore from an archive snapshot.');
  }

  if (options.strict) {
    const issues = validateSprintFile(read.value, `${scope}/sprint.json`);
    if (issues.length > 0) {
      const detail = issues.map((issue) => `${issue.field} ${issue.message}`).join('; ');
      const message = options.action
        ? `${actionPrefix}sprint.json has shape drift — ${detail}.`
        : `sprint.json for "${scope}" has shape drift — ${detail}.`;
      const extra = options.shapeDetail?.(read.value) ?? '';
      throw new KyroCoreError(
        'INVALID_SPRINT_SHAPE',
        `${message}${extra}`,
        options.remedy?.INVALID_SPRINT_SHAPE ?? `Run kyro doctor --artifacts --kyro-scope ${scope}.`,
      );
    }
    return read.value as SprintFile;
  }

  const sprint = asSprintFile(read.value);
  if (!sprint) {
    throw new KyroCoreError(
      'INVALID_SPRINT_SHAPE',
      `sprint.json for "${scope}" has shape drift.${options.shapeDetail?.(read.value) ?? ''}`,
      options.remedy?.INVALID_SPRINT_SHAPE ?? `Run kyro doctor --artifacts --kyro-scope ${scope}.`,
    );
  }
  return sprint;
}

/** Re-reads sprint.json after a write; a missing or invalid file is corruption, never an unknown scope. */
export function verifyWrittenSprint(scope: string, label: string, options: { remedy?: string } = {}): SprintFile {
  const remedy = options.remedy ?? 'Restore from an archive snapshot.';
  const read = readJsonSafely(sprintJsonPath(scope));
  if (read.error || !read.exists) throw new KyroCoreError('INVALID_JSON', `${label} wrote sprint.json but re-parse failed (${read.error ?? 'missing'}).`, remedy);
  const issues = validateSprintFile(read.value, `${scope}/sprint.json`);
  if (issues.length > 0) {
    const detail = issues.map((issue) => `${issue.field} ${issue.message}`).join('; ');
    throw new KyroCoreError('INVALID_SPRINT_SHAPE', `${label} wrote sprint.json but it failed validation — ${detail}.`, remedy);
  }
  return read.value as SprintFile;
}
