import { canonicalJson, sha256 } from '../checkpoints/sprint-close';
import type { SprintFile } from '../types';

/**
 * Canonical business-state projection used by remediation digests.
 *
 * `remediations[]` is deliberately excluded. The live anchor stores the commitment of a remediation
 * record whose own `base.stateSha256` / `result.stateSha256` describe the state around it — hashing
 * the anchor into that state would create a cycle where no digest can ever be satisfied. Doctor
 * therefore validates the business-state projection and the remediation ledger independently.
 *
 * `certifications[]` is excluded for the same reason: a certification record commits to the business
 * state it certifies, so hashing its own anchor back into that state forms the same cycle. Without
 * this exclusion, certifying a healthy scope moves the business digest and reports the scope as
 * `diverged` — certification would be indistinguishable from tampering.
 */
export const REMEDIATION_EXCLUDED_STATE_KEYS = ['remediations', 'certifications'] as const;

/** The sprint file minus the remediation anchor, with keys ordered deterministically downstream. */
export function canonicalRemediationState(sprint: SprintFile): Record<string, unknown> {
  const projected = { ...(sprint as unknown as Record<string, unknown>) };
  for (const key of REMEDIATION_EXCLUDED_STATE_KEYS) delete projected[key];
  return projected;
}

/** Deterministic digest of the business state a remediation is bound to and produces. */
export function remediationStateDigest(sprint: SprintFile): string {
  return sha256(canonicalRemediationState(sprint));
}

/**
 * Digest of a single observed value, used for `issues[].observedValueSha256` and operation
 * preconditions such as `expectedOriginSha256`. Values are canonicalised before hashing so a
 * precondition never depends on incidental key ordering or formatting.
 */
export function observedValueDigest(value: unknown): string {
  return sha256(canonicalJson(value));
}
