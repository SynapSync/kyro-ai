import { archiveDir } from '../artifacts/paths';
import { EFFECTIVE_CHECKPOINT_STATUS, resolveEffectiveCheckpointAtPath } from '../checkpoints/effective';
import { surveyScopeCheckpoints } from '../checkpoints/discovery';
import type { SprintCloseCheckpointV1 } from '../types';

// --- scope verification state (T2.1) ------------------------------------------------------------

/** A valid close checkpoint located by the shared scan, newest first. */
export interface ValidCloseCheckpoint {
  path: string;
  checkpoint: SprintCloseCheckpointV1;
}

/**
 * Newest close wins: sprintN desc, then createdAt desc, then checkpointId desc. The single shared
 * recency definition used by doctor and by the scope verification derivation.
 */
export function compareCheckpointRecency(left: SprintCloseCheckpointV1, right: SprintCloseCheckpointV1): number {
  return left.identity.sprintN - right.identity.sprintN
    || left.createdAt.localeCompare(right.createdAt)
    || left.checkpointId.localeCompare(right.checkpointId);
}

/** Every valid close checkpoint for a scope, newest first. One shared scan for doctor and status. */
export function listValidCloseCheckpoints(scope: string): ValidCloseCheckpoint[] {
  const entries: ValidCloseCheckpoint[] = [];
  for (const file of surveyScopeCheckpoints(scope).safeFiles) {
    const path = `${archiveDir(scope)}/${file}`;
    const resolved = resolveEffectiveCheckpointAtPath(scope, path);
    if (resolved.status !== EFFECTIVE_CHECKPOINT_STATUS.VALID && resolved.status !== EFFECTIVE_CHECKPOINT_STATUS.CANONICALIZED) continue;
    if (!resolved.checkpoint || resolved.checkpoint.identity.scope !== scope) continue;
    entries.push({ path, checkpoint: resolved.checkpoint });
  }
  entries.sort((left, right) => compareCheckpointRecency(right.checkpoint, left.checkpoint));
  return entries;
}

/** The most recent valid close checkpoint for a scope, or null when none exists. */
export function latestValidCloseCheckpoint(scope: string): SprintCloseCheckpointV1 | null {
  return listValidCloseCheckpoints(scope)[0]?.checkpoint ?? null;
}

export function latestValidCloseCheckpointEntry(scope: string): ValidCloseCheckpoint | null {
  return listValidCloseCheckpoints(scope)[0] ?? null;
}
