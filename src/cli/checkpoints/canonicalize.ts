import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolveManagedPath } from '../fs';
import { readJsonSafely } from '../artifacts/json';
import { archiveDir } from '../artifacts/paths';
import { assertSafeManagedPath } from '../pipeline/state-writer-lock';
import {
  checkpointCommitment,
  checkpointIntegrityIssues,
  sha256,
} from './sprint-close';
import type { SprintCloseCheckpointV1 } from '../types';

export const CHECKPOINT_CANONICALIZATION_KIND = 'kyro.checkpoint-canonicalization' as const;
export const CHECKPOINT_CANONICALIZATION_SCHEMA_VERSION = 1 as const;

export interface CheckpointCanonicalizationRecord {
  schemaVersion: typeof CHECKPOINT_CANONICALIZATION_SCHEMA_VERSION;
  kind: typeof CHECKPOINT_CANONICALIZATION_KIND;
  id: string;
  scope: string;
  sprintN: number;
  sprintSlug: string;
  originalPath: string;
  originalSha256: string;
  observedLedgerCommitment: string;
  originalIntegrityIssues: string[];
  snapshotSha256: string;
  narrativeSha256: string;
  canonicalProjection: SprintCloseCheckpointV1;
  canonicalCommitment: string;
  previousChainHead: string | null;
  recordCommitment: string;
  reason: string;
  actor: string;
  kyroVersion: string;
  createdAt: string;
}

export interface CanonicalRebuild {
  projection: SprintCloseCheckpointV1;
  originalSha256: string;
  observedLedgerCommitment: string;
  originalIntegrityIssues: string[];
  snapshotSha256: string;
  narrativeSha256: string;
  canonicalCommitment: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function fileSha256(absoluteOrManagedPath: string): string {
  const absolute = resolveManagedPath(absoluteOrManagedPath);
  return createHash('sha256').update(readFileSync(absolute)).digest('hex');
}

export function checkpointRemediationsDir(scope: string): string {
  return `${archiveDir(scope)}/checkpoint-remediations`;
}

export function canonicalizationRecordPath(scope: string, id: string): string {
  return `${checkpointRemediationsDir(scope)}/${id}.json`;
}

export function rebuildCanonicalCheckpoint(
  raw: unknown,
  checkpointPath: string,
  snapshotContent: string,
  narrativeContent: string,
): CanonicalRebuild | null {
  const stored = asRecord(raw);
  if (!stored) return null;
  const originalIssues = checkpointIntegrityIssues(raw, checkpointPath);
  const after = asRecord(stored.intendedAfterClose);
  const ledger = Array.isArray(after?.ledger) ? after.ledger : [];
  const last = asRecord(ledger[ledger.length - 1]);
  const observedLedgerCommitment = typeof last?.checkpointSha256 === 'string' ? last.checkpointSha256 : '';

  const projection = JSON.parse(JSON.stringify(raw)) as SprintCloseCheckpointV1;
  if (!projection.digests) return null;
  projection.digests.beforeClose = sha256(projection.beforeClose);
  projection.digests.projectScopeBefore = sha256(projection.projectScopeBefore);
  projection.digests.projectScopeAfter = sha256(projection.projectScopeAfter);
  projection.digests.legacySnapshot = sha256(snapshotContent);
  projection.digests.narrative = sha256(narrativeContent);
  const commitment = checkpointCommitment(projection);
  const lastLedger = projection.intendedAfterClose.ledger[projection.intendedAfterClose.ledger.length - 1];
  if (!lastLedger) return null;
  lastLedger.checkpointSha256 = commitment;
  projection.digests.intendedAfterClose = sha256(projection.intendedAfterClose);
  if (checkpointIntegrityIssues(projection, checkpointPath).length > 0) return null;

  return {
    projection,
    originalSha256: sha256(typeof raw === 'string' ? raw : JSON.stringify(raw)),
    observedLedgerCommitment,
    originalIntegrityIssues: originalIssues,
    snapshotSha256: sha256(snapshotContent),
    narrativeSha256: sha256(narrativeContent),
    canonicalCommitment: checkpointCommitment(projection),
  };
}

export function rebuildCanonicalCheckpointFromDisk(checkpointPath: string): CanonicalRebuild | null {
  const read = readJsonSafely(checkpointPath);
  if (!read.exists || read.error) return null;
  const record = asRecord(read.value);
  const paths = asRecord(record?.paths);
  if (!paths || typeof paths.legacySnapshot !== 'string' || typeof paths.narrative !== 'string') return null;
  const snapshotAbs = resolveManagedPath(paths.legacySnapshot);
  const narrativeAbs = resolveManagedPath(paths.narrative);
  if (!existsSync(snapshotAbs) || !existsSync(narrativeAbs)) return null;
  const snapshotContent = readFileSync(snapshotAbs, 'utf8');
  const narrativeContent = readFileSync(narrativeAbs, 'utf8');
  const rebuilt = rebuildCanonicalCheckpoint(read.value, checkpointPath, snapshotContent, narrativeContent);
  if (!rebuilt) return null;
  rebuilt.originalSha256 = fileSha256(checkpointPath);
  return rebuilt;
}

export function canonicalizationRecordCommitment(value: unknown): string {
  const record = asRecord(value);
  if (!record) return sha256(value);
  const payload = JSON.parse(JSON.stringify(record)) as Record<string, unknown>;
  delete payload.recordCommitment;
  return sha256(payload);
}

export function validateCanonicalizationRecord(value: unknown, path: string): string[] {
  const issues: string[] = [];
  const record = asRecord(value);
  if (!record) return [`${path}:<root> must be an object`];
  if (record.schemaVersion !== CHECKPOINT_CANONICALIZATION_SCHEMA_VERSION) {
    issues.push(`${path}:schemaVersion must be ${CHECKPOINT_CANONICALIZATION_SCHEMA_VERSION}`);
  }
  if (record.kind !== CHECKPOINT_CANONICALIZATION_KIND) {
    issues.push(`${path}:kind must be ${CHECKPOINT_CANONICALIZATION_KIND}`);
  }
  for (const key of ['id', 'scope', 'sprintSlug', 'originalPath', 'originalSha256', 'observedLedgerCommitment', 'snapshotSha256', 'narrativeSha256', 'canonicalCommitment', 'recordCommitment', 'reason', 'actor', 'kyroVersion', 'createdAt'] as const) {
    if (typeof record[key] !== 'string' || record[key].length === 0) issues.push(`${path}:${key} must be a non-empty string`);
  }
  if (typeof record.sprintN !== 'number' || !Number.isInteger(record.sprintN) || record.sprintN < 1) {
    issues.push(`${path}:sprintN must be an integer >= 1`);
  }
  if (!Array.isArray(record.originalIntegrityIssues)) issues.push(`${path}:originalIntegrityIssues must be an array`);
  if (record.previousChainHead !== null && (typeof record.previousChainHead !== 'string' || !/^[0-9a-f]{64}$/.test(record.previousChainHead))) {
    issues.push(`${path}:previousChainHead must be a sha-256 hex digest or null`);
  }
  if (typeof record.recordCommitment === 'string' && record.recordCommitment !== canonicalizationRecordCommitment(record)) {
    issues.push(`${path}:recordCommitment does not match the stored overlay bytes`);
  }
  const originalPath = typeof record.originalPath === 'string' ? record.originalPath : path;
  const projectionIssues = checkpointIntegrityIssues(record.canonicalProjection, originalPath);
  if (projectionIssues.length > 0) issues.push(...projectionIssues.map((issue) => `${path}:canonicalProjection ${issue}`));
  if (typeof record.originalPath === 'string' && existsSync(resolveManagedPath(record.originalPath))) {
    const rebuilt = rebuildCanonicalCheckpointFromDisk(record.originalPath);
    if (!rebuilt) {
      issues.push(`${path}:original checkpoint cannot be rebuilt from current bytes`);
    } else {
      if (rebuilt.originalSha256 !== record.originalSha256) {
        issues.push(`${path}:originalSha256 does not match the current original bytes`);
      }
      if (rebuilt.canonicalCommitment !== record.canonicalCommitment) {
        issues.push(`${path}:canonicalCommitment does not match a fresh rebuild`);
      }
      if (rebuilt.observedLedgerCommitment !== record.observedLedgerCommitment) {
        issues.push(`${path}:observedLedgerCommitment does not match a fresh rebuild`);
      }
      if (sha256(rebuilt.projection) !== sha256(record.canonicalProjection)) {
        issues.push(`${path}:canonicalProjection does not match a fresh rebuild from original bytes`);
      }
      if (rebuilt.snapshotSha256 !== record.snapshotSha256 || rebuilt.narrativeSha256 !== record.narrativeSha256) {
        issues.push(`${path}:snapshot or narrative digest does not match a fresh rebuild`);
      }
    }
  }
  const expectedHead = expectedPreviousChainHead(path);
  if (expectedHead !== undefined && record.previousChainHead !== expectedHead) {
    issues.push(`${path}:previousChainHead does not match the preceding overlay commitment`);
  }
  return issues;
}

function expectedPreviousChainHead(path: string): string | null | undefined {
  const slash = path.lastIndexOf('/');
  if (slash < 0) return undefined;
  const directory = path.slice(0, slash);
  const current = path.slice(slash + 1);
  let absolute: string;
  try {
    absolute = assertSafeManagedPath(directory);
  } catch {
    return undefined;
  }
  if (!existsSync(absolute)) return undefined;
  const files = readdirSync(absolute).filter((file) => file.endsWith('.json') && !file.endsWith('.checkpoint.json')).sort();
  const index = files.indexOf(current);
  if (index < 0) return undefined;
  if (index === 0) return null;
  const previousPath = `${directory}/${files[index - 1]}`;
  const previous = readJsonSafely(previousPath);
  if (!previous.exists || previous.error) return undefined;
  return canonicalizationRecordCommitment(previous.value);
}

export function listCanonicalizationRecords(scope: string): CheckpointCanonicalizationRecord[] {
  const records: CheckpointCanonicalizationRecord[] = [];
  for (const candidate of listCanonicalizationCandidates(scope)) {
    if (candidate.error || validateCanonicalizationRecord(candidate.value, candidate.path).length > 0) continue;
    const record = candidate.value as CheckpointCanonicalizationRecord;
    if (record.scope !== scope) continue;
    records.push(record);
  }
  return records;
}

export interface CanonicalizationCandidate {
  path: string;
  value: unknown;
  error?: string;
}

export function listCanonicalizationCandidates(scope: string): CanonicalizationCandidate[] {
  const directory = checkpointRemediationsDir(scope);
  let absolute: string;
  try {
    absolute = assertSafeManagedPath(directory);
  } catch {
    return [];
  }
  if (!existsSync(absolute)) return [];
  const candidates: CanonicalizationCandidate[] = [];
  for (const file of readdirSync(absolute).sort()) {
    if (!file.endsWith('.json') || file.endsWith('.checkpoint.json')) continue;
    const path = `${directory}/${file}`;
    const read = readJsonSafely(path);
    if (!read.exists) continue;
    candidates.push({ path, value: read.value, ...(read.error ? { error: read.error } : {}) });
  }
  return candidates;
}

export function canonicalizationChainIssues(scope: string): string[] {
  const issues: string[] = [];
  for (const candidate of listCanonicalizationCandidates(scope)) {
    if (candidate.error) issues.push(`${candidate.path}: ${candidate.error}`);
    else issues.push(...validateCanonicalizationRecord(candidate.value, candidate.path));
  }
  return issues;
}

export function findCanonicalizationCandidate(
  scope: string,
  originalPath: string,
  originalSha256: string,
): CanonicalizationCandidate | null {
  let match: CanonicalizationCandidate | null = null;
  for (const candidate of listCanonicalizationCandidates(scope)) {
    if (candidate.error) continue;
    const record = asRecord(candidate.value);
    if (record?.scope !== scope) continue;
    if (record.originalPath !== originalPath || record.originalSha256 !== originalSha256) continue;
    match = candidate;
  }
  return match;
}

export function findCanonicalizationForBytes(
  scope: string,
  originalPath: string,
  originalSha256: string,
): CheckpointCanonicalizationRecord | null {
  const candidate = findCanonicalizationCandidate(scope, originalPath, originalSha256);
  if (!candidate) return null;
  if (validateCanonicalizationRecord(candidate.value, candidate.path).length > 0) return null;
  return candidate.value as CheckpointCanonicalizationRecord;
}
