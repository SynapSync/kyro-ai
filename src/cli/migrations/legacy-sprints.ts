import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { ARTIFACT_ROOT, KYRO_PROJECT_ROOT } from '../constants';
import { resolveManagedPath } from '../fs';
import { sprintJsonPath } from '../artifacts/paths';
import { validateSprintFile } from '../artifacts/schema';
import { LEGACY_MIGRATION_DEBT_KEYS } from '../artifacts/debt-contract';
import { atomicReplace } from '../checkpoints/sprint-close';
import { KyroCoreError } from '../core/errors';
import { assertSafeManagedPath, assertSafePathSegment, withStateWriterLock } from '../pipeline/state-writer-lock';

const BACKUP_ROOT = `${KYRO_PROJECT_ROOT}/legacy-migrations`;

export interface LegacySprintMigration {
  readonly scope: string;
  readonly fields: readonly string[];
  readonly backupPath: string;
}

interface Candidate {
  scope: string;
  path: string;
  original: string;
  migrated: string;
  backupPath: string;
}

function candidateFor(scope: string): Candidate | null {
  assertSafePathSegment(scope, 'scope');
  const path = sprintJsonPath(scope);
  assertSafeManagedPath(path);
  if (!existsSync(resolveManagedPath(path))) return null;
  const original = readFileSync(resolveManagedPath(path), 'utf8');
  let value: Record<string, unknown>;
  try { value = JSON.parse(original) as Record<string, unknown>; } catch { return null; }
  if (!Array.isArray(value.debt)) return null;
  let changed = false;
  const debt = value.debt.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
    const record = { ...(entry as Record<string, unknown>) };
    if (!Object.prototype.hasOwnProperty.call(record, LEGACY_MIGRATION_DEBT_KEYS[0])) return record;
    if (typeof record.resolvedSprint !== 'number' || !Number.isFinite(record.resolvedSprint)) {
      throw new KyroCoreError('INVALID_INPUT', `${scope}/sprint.json has invalid debt.resolvedSprint.`, 'The legacy value is not safely migratable; restore the file and reconcile it manually.');
    }
    if (record.resolvedSprint !== record.targetSprint) {
      throw new KyroCoreError('INVALID_INPUT', `${scope}/sprint.json has conflicting debt.resolvedSprint for ${String(record.id ?? 'unknown')}.`, 'resolvedSprint differs from targetSprint; no files were changed.');
    }
    delete record.resolvedSprint;
    changed = true;
    return record;
  });
  if (!changed) return null;
  const migratedValue = { ...value, debt };
  const issues = validateSprintFile(migratedValue, path);
  if (issues.length > 0) throw new KyroCoreError('INVALID_INPUT', `${scope}/sprint.json cannot be migrated safely: ${issues.map((issue) => `${issue.field} ${issue.message}`).join('; ')}`, 'No files were changed. Repair the sprint shape and retry.');
  return {
    scope,
    path,
    original,
    migrated: `${JSON.stringify(migratedValue, null, 2)}\n`,
    backupPath: `${BACKUP_ROOT}/${scope}.sprint.json`,
  };
}

function collectCandidates(): Candidate[] {
    const root = resolveManagedPath(ARTIFACT_ROOT);
    if (!existsSync(root)) return [];
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => candidateFor(entry.name))
      .filter((candidate): candidate is Candidate => candidate !== null);
}

export function hasSafelyMigratableLegacySprintFiles(): boolean {
  return collectCandidates().length > 0;
}

export function migrateLegacySprintFiles(): readonly LegacySprintMigration[] {
  return withStateWriterLock(() => {
    const candidates = collectCandidates();
    if (candidates.length === 0) return [];
    const written: Candidate[] = [];
    try {
      mkdirSync(resolveManagedPath(BACKUP_ROOT), { recursive: true });
      for (const candidate of candidates) {
        const backup = resolveManagedPath(candidate.backupPath);
        if (!existsSync(backup)) copyFileSync(resolveManagedPath(candidate.path), backup);
        atomicReplace(candidate.path, candidate.migrated);
        written.push(candidate);
      }
    } catch (error) {
      for (const candidate of written) atomicReplace(candidate.path, candidate.original);
      throw error;
    }
    return written.map((candidate) => ({ scope: candidate.scope, fields: [...LEGACY_MIGRATION_DEBT_KEYS], backupPath: candidate.backupPath }));
  });
}
