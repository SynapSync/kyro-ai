/**
 * Read-only preparation and preview for debt canonicalization.
 *
 * One module backs both the CLI and the MCP tools, so the two surfaces cannot drift into different
 * answers for the same scope: they render the same typed result rather than each assembling one.
 *
 * Everything here reads. Nothing writes state, emits trace, or creates a file — including on the
 * happy path, where a complete manifest is *returned* for the operator to inspect and save, never
 * persisted on their behalf. Applying that manifest is a separate, explicitly confirmed step
 * (`kyro remediate apply --yes`), which re-derives and re-checks every precondition under the
 * state-writer lock rather than trusting anything decided here.
 */
import { readJsonSafely } from '../artifacts/json';
import { sprintJsonPath } from '../artifacts/paths';
import { KyroCoreError } from '../core/errors';
import { debtCollectionDigest, observedValueDigest } from './canonical-state';
import { businessStateDigest } from './plan';
import {
  CANONICALIZE_PLAN_STATUS,
  planDebtCanonicalization,
  type CanonicalizeDecisions,
  type CanonicalizePlan,
  type ResolvedField,
  type UnresolvedDecision,
} from './canonicalize-plan';
import {
  REMEDIATION_MANIFEST_KIND,
  SCOPE_REMEDIATION_V3_SCHEMA_VERSION,
  isCanonicalizeDebtOperation,
  validateRemediationManifest,
  verifyCanonicalizePreconditions,
  type CanonicalizeDebtOperation,
  type RemediationIssue,
  type RemediationManifestV1,
} from './protocol';
import type { ValidationIssue } from '../artifacts/schema';

export interface CanonicalizePrepareInput {
  scope: string;
  debtId: string;
  decisions?: CanonicalizeDecisions;
  reason?: string;
  actor?: string;
}

export interface CanonicalizePrepareResult {
  readonly phase: 'prepare';
  /** Always true in this runtime: preparation has no write mode to opt into. */
  readonly readOnly: true;
  readonly scope: string;
  readonly debtId: string;
  readonly status: CanonicalizePlan['status'];
  readonly classification: string | null;
  readonly resolved: readonly ResolvedField[];
  readonly unresolved: readonly UnresolvedDecision[];
  readonly retiredKeys: readonly string[];
  readonly debtCollectionSha256: string | null;
  readonly after: CanonicalizeDebtOperation['after'] | null;
  /** A complete, apply-ready manifest — only when every canonical value is settled. */
  readonly manifest: RemediationManifestV1 | null;
  readonly detail: string | null;
}

export interface CanonicalizePreviewResult {
  readonly phase: 'preview';
  readonly readOnly: true;
  readonly scope: string;
  readonly accepted: boolean;
  readonly debtIds: readonly string[];
  readonly debtCollectionSha256: string;
  readonly operations: readonly CanonicalizeDebtOperation[];
  readonly after: readonly CanonicalizeDebtOperation['after'][];
  readonly retiredKeys: readonly string[];
  readonly issues: readonly ValidationIssue[];
  readonly detail: string;
}

/** Read the live state of a scope without asserting write authority over it. */
function readLiveDebt(scope: string): { sprint: Record<string, unknown>; debt: readonly unknown[] } {
  const read = readJsonSafely(sprintJsonPath(scope));
  if (!read.exists) {
    throw new KyroCoreError('SCOPE_NOT_FOUND', `Scope "${scope}" has no sprint.json.`, 'Target a scope that exists; preparation never creates one.');
  }
  if (read.error) {
    throw new KyroCoreError('INVALID_JSON', `sprint.json for "${scope}" is invalid JSON (${read.error}).`, 'Fix the JSON before preparing a canonicalization; a manifest must describe a readable state.');
  }
  const sprint = read.value as Record<string, unknown>;
  const debt = Array.isArray(sprint.debt) ? (sprint.debt as unknown[]) : [];
  return { sprint, debt };
}

/**
 * Turn an observed legacy debt into either a complete manifest or an explicit list of the decisions
 * still missing. Suggested values are rendered as evidence and never adopted.
 */
export function prepareDebtCanonicalization(input: CanonicalizePrepareInput): CanonicalizePrepareResult {
  const { sprint, debt } = readLiveDebt(input.scope);
  const plan = planDebtCanonicalization({
    debt,
    debtId: input.debtId,
    decisions: input.decisions,
    reason: input.reason,
    digest: observedValueDigest,
    collectionDigest: debtCollectionDigest,
  });

  const common = {
    phase: 'prepare' as const,
    readOnly: true as const,
    scope: input.scope,
    debtId: input.debtId,
    status: plan.status,
    classification: plan.classification,
    resolved: plan.resolved,
    unresolved: plan.unresolved,
    retiredKeys: plan.retiredKeys,
    debtCollectionSha256: plan.debtCollectionSha256,
    detail: plan.detail,
  };

  if (plan.status !== CANONICALIZE_PLAN_STATUS.READY) {
    return { ...common, after: null, manifest: null };
  }

  const baseDigest = businessStateDigest(sprint);
  if (baseDigest === null) {
    throw new KyroCoreError('INVALID_SPRINT_SHAPE', `sprint.json for "${input.scope}" is not an object.`, 'A manifest must be bound to a readable business state.');
  }
  const manifest: RemediationManifestV1 = {
    schemaVersion: SCOPE_REMEDIATION_V3_SCHEMA_VERSION,
    kind: REMEDIATION_MANIFEST_KIND,
    scope: input.scope,
    base: {
      stateSha256: baseDigest,
      remediationHead: latestRemediationCommitment(sprint),
    },
    issues: plan.issues as RemediationIssue[],
    operations: [plan.operation],
    provenance: {
      reason: input.reason ?? `Legacy debt ${input.debtId} predates the canonical debt contract.`,
      actor: input.actor ?? 'operator',
    },
  };

  return { ...common, after: plan.operation.after, manifest };
}

/**
 * Re-check a manifest an operator already holds: is it still well-formed, still about this scope,
 * and still true of the state on disk? Preview answers only that — it never applies anything.
 */
export function previewDebtCanonicalization(input: { scope: string; manifestPath: string }): CanonicalizePreviewResult {
  const read = readJsonSafely(input.manifestPath);
  if (!read.exists) {
    throw new KyroCoreError('INVALID_INPUT', `Manifest not found: ${input.manifestPath}`, 'Pass the path to a scope-remediation-manifest document.');
  }
  if (read.error) {
    throw new KyroCoreError('INVALID_JSON', `Manifest is invalid JSON (${read.error}).`, 'Fix the manifest JSON and retry.');
  }
  const manifest = read.value as Record<string, unknown>;
  const { debt } = readLiveDebt(input.scope);
  const collectionSha = debtCollectionDigest(debt);

  const issues = validateRemediationManifest(manifest, input.manifestPath);
  if (manifest.scope !== input.scope) {
    issues.push({
      path: input.manifestPath,
      field: 'scope',
      message: `targets "${String(manifest.scope)}" but the command targets "${input.scope}"; a manifest is bound to one scope`,
    });
  }

  const operations = Array.isArray(manifest.operations) ? (manifest.operations as unknown[]) : [];
  const typed = issues.length === 0
    ? (operations as CanonicalizeDebtOperation[]).filter((operation) => isCanonicalizeDebtOperation(operation))
    : [];
  if (issues.length === 0 && typed.length === 0) {
    issues.push({
      path: input.manifestPath,
      field: 'operations',
      message: 'declares no debt.canonicalize operation; use kyro remediate preview for the origin-only flow',
    });
  }

  // Well-formed is not the same as still true: re-check every precondition against live state.
  for (const [index, operation] of typed.entries()) {
    issues.push(...verifyCanonicalizePreconditions(operation, debt, debtCollectionDigest, input.manifestPath, `operations[${index}]`));
  }

  const accepted = issues.length === 0;
  return {
    phase: 'preview',
    readOnly: true,
    scope: input.scope,
    accepted,
    debtIds: typed.map((operation) => operation.debtId),
    debtCollectionSha256: collectionSha,
    operations: accepted ? typed : [],
    // The exact after-image is shown only for a manifest that is complete and still true.
    after: accepted ? typed.map((operation) => operation.after) : [],
    retiredKeys: accepted ? typed.flatMap((operation) => operation.retiredKeys) : [],
    issues,
    detail: accepted
      ? `${typed.length} canonicalization(s) are complete and still match the observed debt collection. Apply them with kyro remediate apply --yes; every precondition is re-checked under the state-writer lock.`
      : `${issues.length} problem(s) block this manifest.`,
  };
}

function latestRemediationCommitment(sprint: Record<string, unknown>): string | null {
  const anchors = Array.isArray(sprint.remediations) ? (sprint.remediations as Array<Record<string, unknown>>) : [];
  const last = anchors.at(-1);
  return last !== undefined && typeof last.commitment === 'string' ? last.commitment : null;
}
