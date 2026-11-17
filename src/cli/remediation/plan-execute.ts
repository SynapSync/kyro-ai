import { scopeRoot } from '../artifacts/paths';
import { canonicalJson } from '../checkpoints/sprint-close';
import { findCanonicalizationForBytes } from '../checkpoints/canonicalize';
import { effectiveCommitment, resolveEffectiveCheckpoint } from '../checkpoints/effective';
import { KyroCoreError } from '../core/errors';
import type { SprintFile } from '../types';
import { applyDebtChange } from '../core/debt-transition';
import { debtCollectionDigest, observedValueDigest } from './canonical-state';
import { CANONICAL_DEBT_AFTER_KEYS, verifyCanonicalizePreconditions, type RemediationOperation } from './protocol';
import { type RemediationChange, asRecord, formatIssues } from './plan-common';

// --- projection -------------------------------------------------------------------------------

/**
 * Apply a batch's operations IN ORDER, evaluating each precondition against the state as it stands
 * at that point in the batch.
 *
 * Planning and replay share this one implementation on purpose. When they were separate, the planner
 * checked every precondition against the original state while the replay checked them sequentially,
 * so a batch touching the same field twice was accepted at apply time and then failed its own
 * verification — an honestly applied remediation that doctor reported as tampering. One executor
 * makes that class of disagreement impossible by construction.
 */
export function executeRemediationOperations(
  state: Record<string, unknown>,
  operations: RemediationOperation[],
  skipPreconditions = false,
): { state: Record<string, unknown>; changes: RemediationChange[] } | { failure: KyroCoreError } {
  return executeOperations(state, operations, skipPreconditions);
}

export function executeOperations(
  state: Record<string, unknown>,
  operations: RemediationOperation[],
  skipPreconditions = false,
): { state: Record<string, unknown>; changes: RemediationChange[] } | { failure: KyroCoreError } {
  const next = JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
  if (!Array.isArray(next.debt)) {
    return { failure: new KyroCoreError('INVALID_SPRINT_SHAPE', 'Cannot apply remediation operations: debt[] is not an array.') };
  }
  // Read live from `next.debt` inside each operation rather than from a snapshot taken before the
  // loop: a canonicalization REPLACES an element, so a pre-computed view would leave a later
  // operation in the same batch reasoning about a record that no longer exists.
  const collection = next.debt as unknown[];
  const changes: RemediationChange[] = [];

  for (const operation of operations) {
    switch (operation.kind) {
      case 'debt.change': {
        if (debtCollectionDigest(next.debt as unknown[]) !== operation.expectedDebtCollectionSha256) return { failure: new KyroCoreError('STATE_DIVERGED', `Operation ${operation.id} has a stale debt collection digest.`) };
        if (next.completion || next.retirement) return { failure: new KyroCoreError('SCOPE_COMPLETED', 'Reopen the scope before changing debt.') };
        try {
          const before = structuredClone(next.debt);
          next.debt = applyDebtChange(next as unknown as SprintFile, operation.action, operation.after);
          // Keep the collection alias current for subsequent operations in this batch.
          collection.splice(0, collection.length, ...(next.debt as unknown[]));
          next.debt = collection;
          changes.push({ operationId: operation.id, kind: operation.kind, target: `debt[${operation.debtId}]`, from: before, to: operation.after });
        } catch (error) {
          return { failure: error instanceof KyroCoreError ? error : new KyroCoreError('INVALID_INPUT', String(error)) };
        }
        break;
      }
      case 'debt.origin.set': {
        const target = collection.map(asRecord).find((entry) => entry?.id === operation.debtId) ?? null;
        if (!target) {
          return {
            failure: new KyroCoreError(
              'DEBT_NOT_FOUND',
              `Operation ${operation.id} targets debt "${operation.debtId}", which does not exist in the live state.`,
              'Remediation never creates records. Correct the debt id in the manifest.',
            ),
          };
        }
        if (!skipPreconditions) {
          const observed = observedValueDigest(target.origin);
          if (observed !== operation.expectedOriginSha256) {
            return {
              failure: new KyroCoreError(
                'STATE_DIVERGED',
                `Operation ${operation.id} expected debt "${operation.debtId}" origin digest ${operation.expectedOriginSha256} but the live value digests to ${observed}.`,
                'The value changed since the manifest was written, or an earlier operation in this batch already changed it. Re-inspect the live value and regenerate the manifest.',
              ),
            };
          }
        }
        changes.push({
          operationId: operation.id,
          kind: operation.kind,
          target: `debt[${operation.debtId}].origin`,
          from: target.origin,
          to: operation.origin,
        });
        target.origin = operation.origin;
        break;
      }
      case 'debt.canonicalize': {
        const index = collection.findIndex((entry) => asRecord(entry)?.id === operation.debtId);
        if (index === -1) {
          return {
            failure: new KyroCoreError(
              'DEBT_NOT_FOUND',
              `Operation ${operation.id} targets debt "${operation.debtId}", which does not exist in the live state.`,
              'Remediation never creates records. Correct the debt id in the manifest.',
            ),
          };
        }
        if (!skipPreconditions) {
          // The whole collection is the precondition, not just the target record: if any other debt
          // was added, removed, reordered or edited since preparation, the operator authorized an
          // after-image for a collection that no longer exists.
          const issues = verifyCanonicalizePreconditions(
            operation,
            collection,
            debtCollectionDigest,
            '<live state>',
            `operation ${operation.id}`,
          );
          if (issues.length > 0) {
            return {
              failure: new KyroCoreError(
                'STATE_DIVERGED',
                `Operation ${operation.id} no longer describes the live debt — ${formatIssues(issues)}.`,
                'The debt collection changed since the manifest was written, or an earlier operation in this batch already changed it. Re-run kyro remediate canonicalize-prepare and regenerate the manifest.',
              ),
            };
          }
        }
        const before = collection[index];
        // Rebuilt key by key in canonical order rather than spread: the after-image is the whole
        // point of the operation, so the record that lands on disk carries exactly the seven keys
        // and nothing a validated payload happened to also hold.
        const after: Record<string, unknown> = {};
        for (const key of CANONICAL_DEBT_AFTER_KEYS) after[key] = operation.after[key];
        collection[index] = after;
        changes.push({
          operationId: operation.id,
          kind: operation.kind,
          target: `debt[${operation.debtId}]`,
          from: before,
          to: after,
        });
        break;
      }
      case 'convention.append': {
        if (!Array.isArray(next.conventions)) {
          return { failure: new KyroCoreError('INVALID_SPRINT_SHAPE', 'Cannot apply convention.append: conventions[] is not an array.') };
        }
        const conventions = next.conventions as unknown[];
        if (!skipPreconditions) {
          const observed = observedValueDigest(conventions);
          if (observed !== operation.expectedConventionCollectionSha256) {
            return {
              failure: new KyroCoreError(
                'STATE_DIVERGED',
                `Operation ${operation.id} expected conventions[] digest ${operation.expectedConventionCollectionSha256} but the live collection digests to ${observed}.`,
                'The convention collection changed since the plan was written. Re-run repair integrity prepare.',
              ),
            };
          }
        }
        const duplicate = conventions.map(asRecord).find((entry) => entry?.id === operation.after.id);
        if (duplicate) {
          if (canonicalJson(duplicate) !== canonicalJson(operation.after)) {
            return {
              failure: new KyroCoreError(
                'INVALID_INPUT',
                `Operation ${operation.id} conflicts with existing convention "${operation.after.id}".`,
                'Convention ids must be unique. Do not reuse an id with a different rule.',
              ),
            };
          }
          break;
        }
        const after = {
          id: operation.after.id,
          rule: operation.after.rule,
          tags: [...operation.after.tags],
          addedSprint: operation.after.addedSprint,
        };
        conventions.push(after);
        changes.push({
          operationId: operation.id,
          kind: operation.kind,
          target: `conventions[${operation.after.id}]`,
          from: null,
          to: after,
        });
        break;
      }
      case 'adr.append': {
        if (!Array.isArray(next.adrs)) next.adrs = [];
        const adrs = next.adrs as unknown[];
        if (!skipPreconditions) {
          const observed = observedValueDigest(adrs);
          if (observed !== operation.expectedAdrCollectionSha256) {
            return {
              failure: new KyroCoreError(
                'STATE_DIVERGED',
                `Operation ${operation.id} expected adrs[] digest ${operation.expectedAdrCollectionSha256} but the live collection digests to ${observed}.`,
                'The ADR collection changed since the plan was written. Re-run repair integrity prepare.',
              ),
            };
          }
        }
        const duplicate = adrs.map(asRecord).find((entry) => entry?.id === operation.after.id);
        if (duplicate) {
          if (canonicalJson(duplicate) !== canonicalJson(operation.after)) {
            return {
              failure: new KyroCoreError(
                'INVALID_INPUT',
                `Operation ${operation.id} conflicts with existing ADR "${operation.after.id}".`,
              ),
            };
          }
          break;
        }
        adrs.push(JSON.parse(JSON.stringify(operation.after)));
        changes.push({
          operationId: operation.id,
          kind: operation.kind,
          target: `adrs[${operation.after.id}]`,
          from: null,
          to: operation.after,
        });
        break;
      }
      case 'ledger.checkpoint.reanchor': {
        if (!Array.isArray(next.ledger)) {
          return { failure: new KyroCoreError('INVALID_SPRINT_SHAPE', 'Cannot apply ledger.checkpoint.reanchor: ledger[] is not an array.') };
        }
        const ledger = next.ledger as unknown[];
        const index = ledger.findIndex((entry) => {
          const record = asRecord(entry);
          return record?.n === operation.sprintN && record?.slug === operation.sprintSlug;
        });
        if (index === -1) {
          return {
            failure: new KyroCoreError(
              'INVALID_INPUT',
              `Operation ${operation.id} targets ledger sprint ${operation.sprintN} (${operation.sprintSlug}), which does not exist.`,
            ),
          };
        }
        const target = asRecord(ledger[index]);
        if (!target) {
          return { failure: new KyroCoreError('INVALID_SPRINT_SHAPE', `ledger[${index}] is not an object.`) };
        }
        const current = typeof target.checkpointSha256 === 'string' ? target.checkpointSha256 : '';
        if (!skipPreconditions && current !== operation.expectedOldSha256) {
          return {
            failure: new KyroCoreError(
              'STATE_DIVERGED',
              `Operation ${operation.id} expected ledger checkpointSha256 ${operation.expectedOldSha256} but the live value is ${current || '(missing)'}.`,
              'The ledger commitment changed since the plan was written. Re-run repair integrity prepare.',
            ),
          };
        }
        if (!skipPreconditions && !reanchorTargetAllowed(next, operation, target)) {
          return {
            failure: new KyroCoreError(
              'CHECKPOINT_CONFLICT',
              `Operation ${operation.id} reanchor target ${operation.afterSha256} is not the effective checkpoint commitment.`,
              'Reanchor only to the effective or originally observed ledger commitment. Doctor would reject any other destination.',
            ),
          };
        }
        const keys = Object.keys(target);
        const allowed = new Set(['n', 'slug', 'outcome', 'closedAt', 'archive', 'snapshot', 'checkpoint', 'checkpointSha256', 'recommendations']);
        for (const key of keys) {
          if (!allowed.has(key)) {
            return { failure: new KyroCoreError('INVALID_INPUT', `Operation ${operation.id} refuses to touch unexpected ledger key ${key}.`) };
          }
        }
        changes.push({
          operationId: operation.id,
          kind: operation.kind,
          target: `ledger[${operation.sprintN}].checkpointSha256`,
          from: current,
          to: operation.afterSha256,
        });
        target.checkpointSha256 = operation.afterSha256;
        break;
      }
      default: {
        const exhaustive: never = operation;
        return { failure: new KyroCoreError('INVALID_INPUT', `Unsupported remediation operation ${JSON.stringify(exhaustive)}.`, 'Only registry operations can be planned.') };
      }
    }
  }

  // The anchor is never part of the corrected business state; it is appended by the caller.
  delete next.remediations;
  return { state: next, changes };
}

function reanchorTargetAllowed(
  state: Record<string, unknown>,
  operation: Extract<RemediationOperation, { kind: 'ledger.checkpoint.reanchor' }>,
  target: Record<string, unknown>,
): boolean {
  const scope = typeof state.scope === 'string' ? state.scope : '';
  const checkpointPath = typeof target.checkpoint === 'string' ? target.checkpoint : '';
  if (!scope || !checkpointPath) return false;
  const resolved = resolveEffectiveCheckpoint(scope, {
    n: operation.sprintN,
    slug: operation.sprintSlug,
    checkpoint: checkpointPath,
    checkpointSha256: operation.afterSha256,
  });
  const allowed = new Set<string>();
  const effective = effectiveCommitment(resolved);
  if (effective) allowed.add(effective);
  if (resolved.originalSha256) {
    const overlay = findCanonicalizationForBytes(scope, `${scopeRoot(scope)}/${checkpointPath}`, resolved.originalSha256);
    if (overlay) allowed.add(overlay.observedLedgerCommitment);
  }
  return allowed.has(operation.afterSha256);
}
