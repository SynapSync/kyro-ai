import { readFileSync } from 'node:fs';
import { scopeRoot } from '../artifacts/paths';
import { validateSprintFile } from '../artifacts/schema';
import { assertSafeManagedPath } from '../pipeline/state-writer-lock';
import { effectiveCommitment, resolveEffectiveCheckpoint } from './effective';
import type { EffectiveCheckpoint } from './effective';
import type { ActiveSprint, LedgerEntry, Spec, SprintFile } from '../types';

export type ClosedSprintFailure = 'unsafe-path' | 'unverified' | 'unreadable' | 'malformed' | 'absent';

/** One ledger entry's closed sprint image. Read-only; never throws for bad history — callers pick strictness. */
export type ClosedSprintRead =
  | { source: 'checkpoint'; active: ActiveSprint | null; spec: Spec | undefined; resolved: EffectiveCheckpoint }
  | { source: 'snapshot'; active: ActiveSprint; raw: unknown }
  | { source: 'checkpoint' | 'snapshot' | 'none'; active: null; failure: ClosedSprintFailure; detail: string; error?: unknown };

const isSafeArchivePath = (path: string): boolean => path.startsWith('archive/') && !path.includes('..') && !path.includes('\\');

/**
 * Single home of the closed-sprint acceptance rules. active-plan's inspectHistory maps each failure to a throw;
 * the read-only verification matrix maps it to unknown. A checkpoint must be
 * valid/canonicalized and match the ledger commitment; a legacy snapshot must be a schema-valid activeSprint.
 * Identity (n/slug) is left to the caller. No fallback from checkpoint to snapshot.
 */
export function readClosedSprint(scope: string, sprint: SprintFile, entry: LedgerEntry): ClosedSprintRead {
  if (entry.checkpoint) {
    if (!isSafeArchivePath(entry.checkpoint)) {
      return { source: 'checkpoint', active: null, failure: 'unsafe-path', detail: 'unsafe historical checkpoint path' };
    }
    const resolved = resolveEffectiveCheckpoint(scope, entry);
    if (!resolved.checkpoint || !['valid', 'canonicalized'].includes(resolved.status)
      || (entry.checkpointSha256 && entry.checkpointSha256 !== effectiveCommitment(resolved))) {
      return { source: 'checkpoint', active: null, failure: 'unverified', detail: `Cannot verify historical checkpoint for sprint ${entry.n}: ${resolved.detail}` };
    }
    return { source: 'checkpoint', active: resolved.checkpoint.beforeClose.activeSprint, spec: resolved.checkpoint.beforeClose.spec, resolved };
  }
  if (entry.snapshot) {
    if (!isSafeArchivePath(entry.snapshot)) {
      return { source: 'snapshot', active: null, failure: 'unsafe-path', detail: 'unsafe historical snapshot path' };
    }
    let path: string;
    try { path = assertSafeManagedPath(`${scopeRoot(scope)}/${entry.snapshot}`); }
    catch (error) { return { source: 'snapshot', active: null, failure: 'unsafe-path', detail: error instanceof Error ? error.message : String(error), error }; }
    let raw: unknown;
    try { raw = JSON.parse(readFileSync(path, 'utf8')); } catch { return { source: 'snapshot', active: null, failure: 'unreadable', detail: `Historical snapshot ${entry.snapshot} is unreadable.` }; }
    if (!raw || validateSprintFile({ ...sprint, activeSprint: raw }, path).length) return { source: 'snapshot', active: null, failure: 'malformed', detail: `Historical snapshot ${entry.snapshot} is malformed.` };
    return { source: 'snapshot', active: raw as ActiveSprint, raw };
  }
  return { source: 'none', active: null, failure: 'absent', detail: 'ledger entry has no checkpoint or snapshot' };
}
