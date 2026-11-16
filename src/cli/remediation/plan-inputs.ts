import { readJsonSafely } from '../artifacts/json';
import { scopeRoot, sprintJsonPath } from '../artifacts/paths';
import { validateSprintFile } from '../artifacts/schema';
import { checkpointCommitmentOfRecord } from '../checkpoints/sprint-close';
import { EFFECTIVE_CHECKPOINT_STATUS, resolveEffectiveCheckpoint } from '../checkpoints/effective';
import { KyroCoreError } from '../core/errors';
import type { RemediationAnchor } from '../types';
import {
  REMEDIATION_MANIFEST_KIND,
  validateRemediationManifest,
  validateScopeRemediation,
  type RemediationManifestV1,
  type ScopeRemediation,
} from './protocol';
import { formatIssues, asRecord, REMEDIATION_ID_PATTERN, relativeRecordPath, remediationRecordPath } from './plan-common';

// --- inputs -----------------------------------------------------------------------------------

export function readManifest(path: string): RemediationManifestV1 {
  const read = readJsonSafely(path);
  if (!read.exists) {
    throw new KyroCoreError('INVALID_INPUT', `Remediation manifest ${path} not found.`, `Write a ${REMEDIATION_MANIFEST_KIND} manifest and pass it with --manifest.`);
  }
  if (read.error) {
    throw new KyroCoreError('INVALID_JSON', `Remediation manifest ${path} is invalid JSON (${read.error}).`, 'Fix the manifest JSON and re-run the preview.');
  }
  const issues = validateRemediationManifest(read.value, path);
  if (issues.length > 0) {
    throw new KyroCoreError(
      'INVALID_INPUT',
      `Remediation manifest ${path} is invalid — ${formatIssues(issues)}.`,
      'Every operation must be an explicitly typed member of the v1 registry. Generic patch payloads and unknown fields are rejected by design.',
    );
  }
  return read.value as RemediationManifestV1;
}

/**
 * The live state is read raw, without the strict SprintFile validator.
 *
 * A scope needing remediation is by definition one whose persisted state no longer satisfies the
 * current contract — validating here would refuse to load exactly the files this feature exists to
 * repair. The corrected projection *is* validated strictly before any plan is returned.
 */
export function readLiveState(scope: string): Record<string, unknown> {
  const path = sprintJsonPath(scope);
  const read = readJsonSafely(path);
  if (!read.exists) {
    throw new KyroCoreError('SCOPE_NOT_FOUND', `${path} not found.`, 'Remediation targets an existing closed scope; check --kyro-scope.');
  }
  if (read.error) {
    throw new KyroCoreError('INVALID_JSON', `${path} is invalid JSON (${read.error}).`, 'Remediation corrects typed values, not broken JSON. Restore the file from versioned storage first.');
  }
  const state = asRecord(read.value);
  if (!state || !Array.isArray(state.debt) || !Array.isArray(state.ledger)) {
    throw new KyroCoreError('INVALID_SPRINT_SHAPE', `${path} is too damaged to remediate (debt[] and ledger[] must be arrays).`, 'Remediation is a narrow typed correction, not a structural rebuild. Restore the file from versioned storage.');
  }
  return state;
}

export function readLiveStateOrNull(scope: string): Record<string, unknown> | null {
  const read = readJsonSafely(sprintJsonPath(scope));
  if (!read.exists || read.error) return null;
  return asRecord(read.value);
}

/**
 * Every closed sprint must still present an intact, anchored checkpoint before its live state may be
 * corrected. Verification is commitment-based on purpose: the checkpoint proves the original close,
 * and re-validating it against today's stricter schema would reject the very history being protected.
 */
export function verifyLedgerCheckpoints(scope: string, state: Record<string, unknown>): void {
  const ledger = (state.ledger as unknown[]).map(asRecord);
  if (ledger.length === 0) {
    throw new KyroCoreError('INVALID_INPUT', `Scope ${scope} has no closed sprint in its ledger.`, 'Remediation corrects the live state of a closed scope. Use the normal sprint flow for work that is still open.');
  }
  ledger.forEach((entry, index) => {
    const label = `ledger[${index}]`;
    if (!entry || typeof entry.checkpoint !== 'string') {
      throw new KyroCoreError('CHECKPOINT_CONFLICT', `${label} has no checkpoint reference.`, 'A sprint closed without a checkpoint cannot be protected during remediation. Do not manufacture one.');
    }
    if (typeof entry.checkpointSha256 !== 'string') {
      throw new KyroCoreError('CHECKPOINT_CONFLICT', `${label} checkpoint ${entry.checkpoint} is unanchored (no checkpointSha256).`, 'Without a live commitment, archive tampering cannot be ruled out. Remediation refuses to proceed on unanchored history.');
    }
    const resolved = resolveEffectiveCheckpoint(scope, {
      n: typeof entry.n === 'number' ? entry.n : undefined,
      slug: typeof entry.slug === 'string' ? entry.slug : undefined,
      checkpoint: entry.checkpoint,
      checkpointSha256: typeof entry.checkpointSha256 === 'string' ? entry.checkpointSha256 : undefined,
    });
    if (resolved.status === EFFECTIVE_CHECKPOINT_STATUS.CORRUPT || resolved.status === EFFECTIVE_CHECKPOINT_STATUS.UNSUPPORTED) {
      throw new KyroCoreError('CHECKPOINT_CORRUPT', `${label} checkpoint ${entry.checkpoint} is ${resolved.status}: ${resolved.detail}.`, 'Restore the immutable checkpoint or apply a valid canonicalization overlay before remediating.');
    }
    if (resolved.status === EFFECTIVE_CHECKPOINT_STATUS.DIVERGED || !resolved.checkpoint) {
      throw new KyroCoreError('CHECKPOINT_CONFLICT', `${label} checkpoint ${entry.checkpoint} is ${resolved.status}: ${resolved.detail}.`, 'Treat the archive or overlay as tampered. Restore trusted bytes before remediating.');
    }
    const liveSha = entry.checkpointSha256;
    if (resolved.status === EFFECTIVE_CHECKPOINT_STATUS.VALID) {
      const commitment = checkpointCommitmentOfRecord(resolved.checkpoint);
      if (commitment !== liveSha) {
        throw new KyroCoreError('CHECKPOINT_CONFLICT', `${label} checkpoint ${entry.checkpoint} does not match its ledger commitment.`, 'Treat the archive as tampered. Restore the checkpoint bytes from trusted versioned storage before remediating.');
      }
    } else {
      const overlay = resolved;
      const physical = readJsonSafely(`${scopeRoot(scope)}/${entry.checkpoint}`);
      const observed = typeof physical.value === 'object' && physical.value !== null
        ? ((physical.value as { intendedAfterClose?: { ledger?: Array<{ checkpointSha256?: string }> } }).intendedAfterClose?.ledger ?? []).slice(-1)[0]?.checkpointSha256
        : undefined;
      const canonical = checkpointCommitmentOfRecord(resolved.checkpoint);
      if (liveSha !== observed && liveSha !== canonical) {
        throw new KyroCoreError(
          'CHECKPOINT_CONFLICT',
          `${label} checkpoint ${entry.checkpoint} ledger commitment matches neither the original overlay binding nor the canonical commitment.`,
          'Re-run repair integrity prepare so the ledger can be reanchored to the effective checkpoint.',
        );
      }
      void overlay;
    }
  });
}

export function collectCheckpointCommitments(state: Record<string, unknown>): Array<{ path: string; commitment: string }> {
  return (state.ledger as unknown[])
    .map(asRecord)
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .map((entry) => ({ path: String(entry.checkpoint), commitment: String(entry.checkpointSha256) }));
}

export function readAnchors(scope: string, state: Record<string, unknown>): RemediationAnchor[] {
  const anchors = readAnchorsSafely(scope, state);
  if (anchors === null) {
    throw new KyroCoreError('INVALID_SPRINT_SHAPE', `${sprintJsonPath(scope)}.remediations[] is malformed.`, 'Do not hand-edit remediations[]. Restore it from versioned storage.');
  }
  return anchors;
}

export function readAnchorsSafely(scope: string, state: Record<string, unknown>): RemediationAnchor[] | null {
  if (!('remediations' in state)) return [];
  const anchored = { ...state, remediations: state.remediations };
  // Reuse the SprintFile gate so the anchor contract has exactly one definition. Only anchor issues
  // matter here — the rest of a scope awaiting remediation is expected to be invalid.
  const issues = validateSprintFile(anchored, sprintJsonPath(scope)).filter((issue) => issue.field.startsWith('remediations'));
  if (issues.length > 0) return null;
  const anchors = state.remediations as RemediationAnchor[];
  // The record is located by id, so an unconstrained `path` would be decoration that doctor and the
  // reader could disagree about — Lens resolves the record through this field. Bind them: the id and
  // the path must name the same file, and the id must be a real remediation id.
  for (const anchor of anchors) {
    if (!REMEDIATION_ID_PATTERN.test(anchor.id)) return null;
    if (anchor.path !== relativeRecordPath(anchor.id)) return null;
  }
  return anchors;
}

export function readRemediationRecord(scope: string, remediationId: string): ScopeRemediation | null {
  const path = remediationRecordPath(scope, remediationId);
  const read = readJsonSafely(path);
  if (!read.exists || read.error) return null;
  if (validateScopeRemediation(read.value, path).length > 0) return null;
  const record = read.value as ScopeRemediation;
  return record.scope === scope && record.id === remediationId ? record : null;
}
