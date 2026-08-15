import { readJsonSafely } from '../artifacts/json';
import { scopeRoot } from '../artifacts/paths';
import {
  checkpointCommitment,
  checkpointIntegrityIssues,
} from './sprint-close';
import {
  findCanonicalizationCandidate,
  fileSha256,
  rebuildCanonicalCheckpointFromDisk,
  validateCanonicalizationRecord,
} from './canonicalize';
import type { SprintCloseCheckpointV1 } from '../types';

export const EFFECTIVE_CHECKPOINT_STATUS = {
  VALID: 'valid',
  CANONICALIZED: 'canonicalized',
  CORRUPT: 'corrupt',
  DIVERGED: 'diverged',
  UNSUPPORTED: 'unsupported',
} as const;

export type EffectiveCheckpointStatus = (typeof EFFECTIVE_CHECKPOINT_STATUS)[keyof typeof EFFECTIVE_CHECKPOINT_STATUS];

export interface EffectiveCheckpoint {
  status: EffectiveCheckpointStatus;
  path: string;
  checkpoint: SprintCloseCheckpointV1 | null;
  originalSha256: string | null;
  detail: string;
}

export interface LedgerCheckpointRef {
  n?: number;
  slug?: string;
  checkpoint?: string;
  checkpointSha256?: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function resolveEffectiveCheckpoint(scope: string, ledgerEntry: LedgerCheckpointRef): EffectiveCheckpoint {
  if (typeof ledgerEntry.checkpoint !== 'string' || ledgerEntry.checkpoint.length === 0) {
    return { status: EFFECTIVE_CHECKPOINT_STATUS.CORRUPT, path: '', checkpoint: null, originalSha256: null, detail: 'ledger entry has no checkpoint path' };
  }
  const path = `${scopeRoot(scope)}/${ledgerEntry.checkpoint}`;
  return resolveEffectiveCheckpointAtPath(scope, path, ledgerEntry);
}

export function resolveEffectiveCheckpointAtPath(
  scope: string,
  path: string,
  ledgerEntry?: LedgerCheckpointRef,
): EffectiveCheckpoint {
  const read = readJsonSafely(path);
  if (!read.exists) {
    return { status: EFFECTIVE_CHECKPOINT_STATUS.CORRUPT, path, checkpoint: null, originalSha256: null, detail: `missing ${path}` };
  }
  if (read.error) {
    return { status: EFFECTIVE_CHECKPOINT_STATUS.CORRUPT, path, checkpoint: null, originalSha256: null, detail: `unreadable (${read.error})` };
  }
  const raw = asRecord(read.value);
  if (raw?.schemaVersion !== 1) {
    return {
      status: EFFECTIVE_CHECKPOINT_STATUS.UNSUPPORTED,
      path,
      checkpoint: null,
      originalSha256: null,
      detail: `schemaVersion=${String(raw?.schemaVersion ?? '(missing)')}`,
    };
  }

  let originalSha256: string | null = null;
  try {
    originalSha256 = fileSha256(path);
  } catch {
    originalSha256 = null;
  }

  const integrityIssues = checkpointIntegrityIssues(read.value, path);
  if (integrityIssues.length === 0) {
    const checkpoint = read.value as SprintCloseCheckpointV1;
    if (checkpoint.identity.scope !== scope) {
      return { status: EFFECTIVE_CHECKPOINT_STATUS.CORRUPT, path, checkpoint: null, originalSha256, detail: `identity scope ${checkpoint.identity.scope} does not match ${scope}` };
    }
    if (ledgerEntry && (checkpoint.identity.sprintN !== ledgerEntry.n || checkpoint.identity.sprintSlug !== ledgerEntry.slug)) {
      return { status: EFFECTIVE_CHECKPOINT_STATUS.CORRUPT, path, checkpoint: null, originalSha256, detail: 'identity does not match ledger entry' };
    }
    return { status: EFFECTIVE_CHECKPOINT_STATUS.VALID, path, checkpoint, originalSha256, detail: 'physical checkpoint is integrity-valid' };
  }

  if (!originalSha256) {
    return { status: EFFECTIVE_CHECKPOINT_STATUS.CORRUPT, path, checkpoint: null, originalSha256: null, detail: integrityIssues.join('; ') };
  }

  const candidate = findCanonicalizationCandidate(scope, path, originalSha256);
  if (!candidate) {
    return { status: EFFECTIVE_CHECKPOINT_STATUS.CORRUPT, path, checkpoint: null, originalSha256, detail: integrityIssues.join('; ') };
  }
  const overlayIssues = validateCanonicalizationRecord(candidate.value, candidate.path);
  if (overlayIssues.length > 0) {
    return { status: EFFECTIVE_CHECKPOINT_STATUS.DIVERGED, path, checkpoint: null, originalSha256, detail: overlayIssues.join('; ') };
  }

  const rebuilt = rebuildCanonicalCheckpointFromDisk(path);
  if (!rebuilt) {
    return { status: EFFECTIVE_CHECKPOINT_STATUS.CORRUPT, path, checkpoint: null, originalSha256, detail: 'original checkpoint cannot be rebuilt from current bytes' };
  }
  const overlay = candidate.value as { id: string; originalSha256: string; canonicalCommitment: string; snapshotSha256: string; narrativeSha256: string };
  if (overlay.originalSha256 !== rebuilt.originalSha256) {
    return { status: EFFECTIVE_CHECKPOINT_STATUS.DIVERGED, path, checkpoint: null, originalSha256, detail: 'overlay is not bound to the current checkpoint bytes' };
  }
  if (overlay.canonicalCommitment !== rebuilt.canonicalCommitment) {
    return { status: EFFECTIVE_CHECKPOINT_STATUS.DIVERGED, path, checkpoint: null, originalSha256, detail: 'canonical commitment does not match a fresh rebuild' };
  }
  if (overlay.snapshotSha256 !== rebuilt.snapshotSha256 || overlay.narrativeSha256 !== rebuilt.narrativeSha256) {
    return { status: EFFECTIVE_CHECKPOINT_STATUS.DIVERGED, path, checkpoint: null, originalSha256, detail: 'snapshot or narrative bytes no longer match a fresh rebuild' };
  }
  if (checkpointCommitment(rebuilt.projection) !== rebuilt.canonicalCommitment) {
    return { status: EFFECTIVE_CHECKPOINT_STATUS.DIVERGED, path, checkpoint: null, originalSha256, detail: 'canonical commitment does not match rebuilt projection' };
  }
  if (rebuilt.projection.identity.scope !== scope) {
    return { status: EFFECTIVE_CHECKPOINT_STATUS.CORRUPT, path, checkpoint: null, originalSha256, detail: 'canonical identity scope mismatch' };
  }
  if (ledgerEntry && (rebuilt.projection.identity.sprintN !== ledgerEntry.n || rebuilt.projection.identity.sprintSlug !== ledgerEntry.slug)) {
    return { status: EFFECTIVE_CHECKPOINT_STATUS.CORRUPT, path, checkpoint: null, originalSha256, detail: 'canonical identity does not match ledger entry' };
  }

  return {
    status: EFFECTIVE_CHECKPOINT_STATUS.CANONICALIZED,
    path,
    checkpoint: rebuilt.projection,
    originalSha256,
    detail: `canonicalized via ${overlay.id}`,
  };
}

export function effectiveCommitment(resolved: EffectiveCheckpoint): string | null {
  if (!resolved.checkpoint) return null;
  return checkpointCommitment(resolved.checkpoint);
}
