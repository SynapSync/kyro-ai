import type { ValidationIssue } from '../artifacts/schema';

/**
 * Append-only scope remediation protocol (v1).
 *
 * A remediation corrects the *live* state of a closed scope without touching the immutable
 * checkpoint, snapshot, narrative or ledger commitment that proves how the scope originally closed.
 * Every correction is a strongly typed, all-or-nothing batch: there is no generic JSON Patch and no
 * free-form payload anywhere in this contract. Adding a new correction capability means adding a
 * new discriminated-union member plus its own validation, preconditions and regression matrix.
 */

export const SCOPE_REMEDIATION_KIND = 'scope-remediation' as const;
/** Immutable record version emitted before compact witnesses existed. */
export const SCOPE_REMEDIATION_SCHEMA_VERSION = 1 as const;
/** Current immutable record version: operations plus a compact replay witness, never a SprintFile. */
export const SCOPE_REMEDIATION_V2_SCHEMA_VERSION = 2 as const;
/**
 * Revision that introduces record-level debt canonicalization (ADR-0003).
 *
 * It is an explicit revision rather than a silent extension of v2 so a reader that predates
 * `debt.canonicalize` fails closed as unsupported instead of interpreting a record it cannot
 * execute. `CURRENT_…` deliberately stays at v2: a batch is written at the LOWEST revision that
 * admits every operation in it (see `requiredRemediationRevision`), so an origin-only remediation
 * still emits exactly the v2 bytes it always did and only a canonicalization raises the revision.
 */
export const SCOPE_REMEDIATION_V3_SCHEMA_VERSION = 3 as const;
export const CURRENT_SCOPE_REMEDIATION_SCHEMA_VERSION = SCOPE_REMEDIATION_V2_SCHEMA_VERSION;
export const SCOPE_REMEDIATION_SCHEMA_VERSIONS = {
  V1: SCOPE_REMEDIATION_SCHEMA_VERSION,
  V2: SCOPE_REMEDIATION_V2_SCHEMA_VERSION,
  V3: SCOPE_REMEDIATION_V3_SCHEMA_VERSION,
} as const;
export type ScopeRemediationSchemaVersion = (typeof SCOPE_REMEDIATION_SCHEMA_VERSIONS)[keyof typeof SCOPE_REMEDIATION_SCHEMA_VERSIONS];

/** Closed operation registry across every revision. An unknown kind fails before any plan is produced. */
export const REMEDIATION_OPERATION_KINDS = ['debt.origin.set', 'debt.canonicalize'] as const;
export type RemediationOperationKind = (typeof REMEDIATION_OPERATION_KINDS)[number];

/**
 * Which operations each revision may carry. A kind is bound to the revision that introduced it, so
 * a v1/v2 record containing `debt.canonicalize` is rejected rather than reinterpreted, and a v3
 * record keeps executing the older operation unchanged.
 */
export const OPERATION_KINDS_BY_REVISION: Record<ScopeRemediationSchemaVersion, readonly RemediationOperationKind[]> = {
  [SCOPE_REMEDIATION_SCHEMA_VERSION]: ['debt.origin.set'],
  [SCOPE_REMEDIATION_V2_SCHEMA_VERSION]: ['debt.origin.set'],
  [SCOPE_REMEDIATION_V3_SCHEMA_VERSION]: ['debt.origin.set', 'debt.canonicalize'],
};

/**
 * The revisions current Kyro is allowed to WRITE, lowest first. v1 is readable forever but is never
 * emitted again: its snapshot witness was retired by the compact record.
 */
export const WRITABLE_SCOPE_REMEDIATION_SCHEMA_VERSIONS = [
  SCOPE_REMEDIATION_V2_SCHEMA_VERSION,
  SCOPE_REMEDIATION_V3_SCHEMA_VERSION,
] as const;
export type WritableScopeRemediationSchemaVersion = (typeof WRITABLE_SCOPE_REMEDIATION_SCHEMA_VERSIONS)[number];

/** The exact canonical debt key set an after-image must carry — no more, no fewer. */
export const CANONICAL_DEBT_AFTER_KEYS = ['id', 'title', 'origin', 'priority', 'status', 'targetSprint', 'note'] as const;
const DEBT_PRIORITIES = ['critical', 'high', 'medium', 'low'] as const;
const DEBT_STATUSES = ['open', 'in_progress', 'resolved', 'deferred'] as const;

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const REMEDIATION_ID_PATTERN = /^R-\d{3,}$/;

/** SHA-256 commitment to an immutable checkpoint payload, copied from the live ledger anchor. */
export interface RemediationCheckpointCommitment {
  path: string;
  commitment: string;
}

/** The exact state a remediation is bound to. A stale digest or head must fail the transaction. */
export interface RemediationBase {
  stateSha256: string;
  /** Commitment of the preceding remediation record, or null for the first link in the chain. */
  remediationHead: string | null;
  checkpoints: RemediationCheckpointCommitment[];
}

/** A concrete historical defect. `path` is diagnostic only — it is never an executable pointer. */
export interface RemediationIssue {
  id: string;
  code: string;
  path: string;
  observedValueSha256: string;
}

/** Replace a `Debt.origin` that was persisted with a non-numeric value. */
export interface SetDebtOriginOperation {
  id: string;
  kind: 'debt.origin.set';
  /** Ids of the issues this operation resolves; preserves the issue-to-operation mapping. */
  resolves: string[];
  debtId: string;
  /** Precondition: digest of the value currently stored in `debt[].origin`. */
  expectedOriginSha256: string;
  /** Explicit numeric replacement supplied by the operator. Never inferred. */
  origin: number;
  reason: string;
}

/**
 * Rewrite one legacy debt record into its exact canonical form (ADR-0002).
 *
 * This is deliberately record-level and closed: one debt, one atomic after-image, no path
 * expressions and no partial field patches. The origin-only operation above cannot add an absent
 * canonical field or retire a legacy-only key, which is precisely why the motivating scope could
 * not be repaired at all.
 *
 * The precondition binds the *whole* observed `debt[]` collection, not the single record: reordering
 * or editing any other debt entry between preparation and application changes what the operator
 * reviewed, and must invalidate the operation.
 *
 * Every value in `after` is operator-authorized. Evidence may suggest a value (ADR-0004), but no
 * suggestion reaches this structure without an explicit decision.
 */
export interface CanonicalizeDebtOperation {
  id: string;
  kind: 'debt.canonicalize';
  /** Ids of the issues this operation resolves; preserves the issue-to-operation mapping. */
  resolves: string[];
  /** Identity of the debt being canonicalized. Must equal `after.id`. */
  debtId: string;
  /** Precondition: digest of the complete observed `debt[]` collection. */
  expectedDebtCollectionSha256: string;
  /** The exact seven-key canonical record that replaces the legacy one. */
  after: CanonicalDebtAfterImage;
  /** Legacy-only keys this operation retires, recorded so the audit trail names what disappeared. */
  retiredKeys: string[];
  reason: string;
}

/** The seven-key canonical debt image. Structurally identical to `Debt`, declared here so the
 *  protocol contract does not depend on the live state module. */
export interface CanonicalDebtAfterImage {
  id: string;
  title: string;
  origin: number;
  priority: (typeof DEBT_PRIORITIES)[number];
  status: (typeof DEBT_STATUSES)[number];
  targetSprint: number | null;
  note: string;
}

export type RemediationOperation = SetDebtOriginOperation | CanonicalizeDebtOperation;

export interface RemediationResult {
  stateSha256: string;
  /** Snapshot of the scope state after applying operations. Used by E1 to replay multi-record chains. */
  snapshot: unknown;
}

export const COMPACT_REPLAY_WITNESS_KIND = 'operations-replay' as const;
export const COMPACT_REPLAY_WITNESS_SCHEMA_VERSION = 1 as const;

/** v2 needs no state image: the typed operations and bound digests are the replay evidence. */
export interface CompactReplayWitnessV1 {
  schemaVersion: typeof COMPACT_REPLAY_WITNESS_SCHEMA_VERSION;
  kind: typeof COMPACT_REPLAY_WITNESS_KIND;
}

export interface CompactRemediationResult {
  stateSha256: string;
  witness: CompactReplayWitnessV1;
}

export interface RemediationProvenance {
  reason: string;
  actor: string;
  kyroVersion: string;
}

/** Immutable record persisted at `archive/remediations/remediation-NNN.json`. */
export interface ScopeRemediationV1 {
  schemaVersion: typeof SCOPE_REMEDIATION_SCHEMA_VERSION;
  kind: typeof SCOPE_REMEDIATION_KIND;
  id: string;
  scope: string;
  createdAt: string;
  base: RemediationBase;
  issues: RemediationIssue[];
  operations: RemediationOperation[];
  result: RemediationResult;
  provenance: RemediationProvenance;
}

/**
 * Immutable compact record emitted by current Kyro. Historic v1 records are never rewritten.
 *
 * v2 and v3 share this one shape by design: the revision names which operations the record may
 * carry, not how the record is laid out. Keeping a single structure is what lets a v3 chain be
 * verified, replayed and certified by exactly the code paths that already handle v2 (ADR-0003).
 */
export interface CompactScopeRemediation {
  schemaVersion: WritableScopeRemediationSchemaVersion;
  kind: typeof SCOPE_REMEDIATION_KIND;
  id: string;
  scope: string;
  createdAt: string;
  base: RemediationBase;
  issues: RemediationIssue[];
  operations: RemediationOperation[];
  result: CompactRemediationResult;
  provenance: RemediationProvenance;
}

/** The compact record pinned to one revision, for callers that mean specifically v2 or v3. */
export type ScopeRemediationV2 = CompactScopeRemediation & { schemaVersion: typeof SCOPE_REMEDIATION_V2_SCHEMA_VERSION };
export type ScopeRemediationV3 = CompactScopeRemediation & { schemaVersion: typeof SCOPE_REMEDIATION_V3_SCHEMA_VERSION };

export type ScopeRemediation = ScopeRemediationV1 | CompactScopeRemediation;

/**
 * The LOWEST revision current Kyro writes that admits every operation in a batch.
 *
 * Choosing per batch rather than globally is what keeps ADR-0003 honest in both directions: an
 * origin-only remediation keeps emitting a v2 record byte-for-byte as before, so no existing chain,
 * reader or fixture is disturbed; a batch containing a `debt.canonicalize` is written as v3, so a
 * reader that predates the operation refuses the record instead of silently ignoring an operation it
 * cannot execute. Bumping a global CURRENT_… would have made every remediation unreadable to older
 * Kyro, which is a migration, not a revision.
 */
export function requiredRemediationRevision(
  operations: readonly RemediationOperation[],
): WritableScopeRemediationSchemaVersion {
  for (const revision of WRITABLE_SCOPE_REMEDIATION_SCHEMA_VERSIONS) {
    const allowed = OPERATION_KINDS_BY_REVISION[revision];
    if (operations.every((operation) => allowed.includes(operation.kind))) return revision;
  }
  // Unreachable while the registry is closed and v3 admits every kind; failing to the newest
  // revision keeps this total rather than throwing from a pure selector.
  return SCOPE_REMEDIATION_V3_SCHEMA_VERSION;
}

const REMEDIATION_KEYS = [
  'schemaVersion',
  'kind',
  'id',
  'scope',
  'createdAt',
  'base',
  'issues',
  'operations',
  'result',
  'provenance',
] as const;

const OPERATION_KEYS: Record<RemediationOperationKind, readonly string[]> = {
  'debt.origin.set': ['id', 'kind', 'resolves', 'debtId', 'expectedOriginSha256', 'origin', 'reason'],
  'debt.canonicalize': ['id', 'kind', 'resolves', 'debtId', 'expectedDebtCollectionSha256', 'after', 'retiredKeys', 'reason'],
};

/**
 * Validation entry point per operation kind. Keyed by the closed registry so a payload whose `kind`
 * is absent here can never reach a planner or an executor.
 */
const OPERATION_VALIDATORS: Record<
  RemediationOperationKind,
  (value: Record<string, unknown>, path: string, prefix: string, issues: ValidationIssue[]) => void
> = {
  'debt.origin.set': validateSetDebtOriginOperation,
  'debt.canonicalize': validateCanonicalizeDebtOperation,
};

export function isRemediationOperationKind(value: unknown): value is RemediationOperationKind {
  return typeof value === 'string' && (REMEDIATION_OPERATION_KINDS as readonly string[]).includes(value);
}

/**
 * Full fail-closed validation of a remediation record. Returns one issue per defect with a
 * field-specific path (e.g. `operations[0].origin`) so a rejection is actionable without guessing.
 */
export function validateScopeRemediation(value: unknown, path: string): ValidationIssue[] {
  if (!isRecord(value)) return [{ path, field: '<root>', message: 'must be an object' }];
  if (value.schemaVersion === SCOPE_REMEDIATION_SCHEMA_VERSION) return validateScopeRemediationV1(value, path);
  if (value.schemaVersion === SCOPE_REMEDIATION_V2_SCHEMA_VERSION) return validateScopeRemediationV2(value, path);
  // v3 reuses the compact record shape; only the operation registry widens (ADR-0003).
  if (value.schemaVersion === SCOPE_REMEDIATION_V3_SCHEMA_VERSION) {
    return validateScopeRemediationV2(value, path, SCOPE_REMEDIATION_V3_SCHEMA_VERSION);
  }
  return [{
    path,
    field: 'schemaVersion',
    message: `must be one of ${Object.values(SCOPE_REMEDIATION_SCHEMA_VERSIONS).join(', ')}`,
  }];
}

export function isScopeRemediationSchemaVersion(value: unknown): value is ScopeRemediationSchemaVersion {
  return Object.values(SCOPE_REMEDIATION_SCHEMA_VERSIONS).includes(value as ScopeRemediationSchemaVersion);
}

function validateScopeRemediationV1(value: Record<string, unknown>, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (value.kind !== SCOPE_REMEDIATION_KIND) {
    issues.push({ path, field: 'kind', message: `must be "${SCOPE_REMEDIATION_KIND}"` });
  }
  requireUnknownKeys(value, REMEDIATION_KEYS, path, '<root>', issues);
  requirePattern(value, 'id', REMEDIATION_ID_PATTERN, 'must match R-NNN', path, issues, 'id');
  requireNonEmptyString(value, 'scope', path, issues, 'scope');
  requireNonEmptyString(value, 'createdAt', path, issues, 'createdAt');

  validateBase(value.base, path, 'base', issues);

  const issueIds = validateIssues(value.issues, path, 'issues', issues);
  validateOperations(value.operations, issueIds, path, 'operations', issues, OPERATION_KINDS_BY_REVISION[SCOPE_REMEDIATION_SCHEMA_VERSION]);

  if (!isRecord(value.result)) {
    issues.push({ path, field: 'result', message: 'must be an object { stateSha256, snapshot }' });
  } else {
    requireUnknownKeys(value.result, ['stateSha256', 'snapshot'], path, 'result', issues);
    requireDigest(value.result, 'stateSha256', path, issues, 'result.stateSha256');
    // The record contract preserves the snapshot as opaque archival data. Replay validates every
    // non-final snapshot as a SprintFile and rechecks it against result.stateSha256 before reuse.
  }

  if (!isRecord(value.provenance)) {
    issues.push({ path, field: 'provenance', message: 'must be an object { reason, actor, kyroVersion }' });
  } else {
    requireUnknownKeys(value.provenance, ['reason', 'actor', 'kyroVersion'], path, 'provenance', issues);
    requireNonEmptyString(value.provenance, 'reason', path, issues, 'provenance.reason');
    requireNonEmptyString(value.provenance, 'actor', path, issues, 'provenance.actor');
    requireNonEmptyString(value.provenance, 'kyroVersion', path, issues, 'provenance.kyroVersion');
  }

  return issues;
}

function validateScopeRemediationV2(
  value: Record<string, unknown>,
  path: string,
  revision: ScopeRemediationSchemaVersion = SCOPE_REMEDIATION_V2_SCHEMA_VERSION,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (value.kind !== SCOPE_REMEDIATION_KIND) {
    issues.push({ path, field: 'kind', message: `must be "${SCOPE_REMEDIATION_KIND}"` });
  }
  requireUnknownKeys(value, REMEDIATION_KEYS, path, '<root>', issues);
  requirePattern(value, 'id', REMEDIATION_ID_PATTERN, 'must match R-NNN', path, issues, 'id');
  requireNonEmptyString(value, 'scope', path, issues, 'scope');
  requireNonEmptyString(value, 'createdAt', path, issues, 'createdAt');
  validateBase(value.base, path, 'base', issues);

  const issueIds = validateIssues(value.issues, path, 'issues', issues);
  validateOperations(value.operations, issueIds, path, 'operations', issues, OPERATION_KINDS_BY_REVISION[revision]);

  if (!isRecord(value.result)) {
    issues.push({ path, field: 'result', message: 'must be an object { stateSha256, witness }' });
  } else {
    requireUnknownKeys(value.result, ['stateSha256', 'witness'], path, 'result', issues);
    requireDigest(value.result, 'stateSha256', path, issues, 'result.stateSha256');
    validateCompactReplayWitness(value.result.witness, path, issues);
  }

  validateProvenance(value.provenance, path, issues);
  return issues;
}

export function asScopeRemediation(value: unknown): ScopeRemediation | null {
  return validateScopeRemediation(value, '<memory>').length === 0 ? (value as ScopeRemediation) : null;
}

export const REMEDIATION_MANIFEST_KIND = 'scope-remediation-manifest' as const;

/**
 * Operator-authored input to `remediate preview` / `remediate apply`.
 *
 * It declares the state the operator inspected (`base`) so a manifest written against an older
 * live state is rejected as stale rather than silently re-targeted. `kyroVersion`, `id`, `createdAt`
 * and `result` are supplied by the runtime — an operator cannot pre-declare the outcome of a
 * transaction Kyro has not evaluated yet.
 */
export interface RemediationManifestV1 {
  schemaVersion: typeof SCOPE_REMEDIATION_SCHEMA_VERSION | typeof SCOPE_REMEDIATION_V3_SCHEMA_VERSION;
  kind: typeof REMEDIATION_MANIFEST_KIND;
  scope: string;
  base: {
    stateSha256: string;
    remediationHead: string | null;
  };
  issues: RemediationIssue[];
  operations: RemediationOperation[];
  provenance: {
    reason: string;
    actor: string;
  };
}

const MANIFEST_KEYS = ['schemaVersion', 'kind', 'scope', 'base', 'issues', 'operations', 'provenance'] as const;

export function validateRemediationManifest(value: unknown, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) return [{ path, field: '<root>', message: 'must be an object' }];

  // A manifest declares which protocol revision it was written against, so an operator cannot smuggle
  // a canonicalization into the older revision's semantics — nor lose the ability to write a v1 one.
  const manifestRevision: ScopeRemediationSchemaVersion =
    value.schemaVersion === SCOPE_REMEDIATION_V3_SCHEMA_VERSION
      ? SCOPE_REMEDIATION_V3_SCHEMA_VERSION
      : SCOPE_REMEDIATION_SCHEMA_VERSION;
  if (value.schemaVersion !== SCOPE_REMEDIATION_SCHEMA_VERSION && value.schemaVersion !== SCOPE_REMEDIATION_V3_SCHEMA_VERSION) {
    issues.push({
      path,
      field: 'schemaVersion',
      message: `must be ${SCOPE_REMEDIATION_SCHEMA_VERSION} or ${SCOPE_REMEDIATION_V3_SCHEMA_VERSION}`,
    });
  }
  if (value.kind !== REMEDIATION_MANIFEST_KIND) {
    issues.push({ path, field: 'kind', message: `must be "${REMEDIATION_MANIFEST_KIND}"` });
  }
  requireUnknownKeys(value, MANIFEST_KEYS, path, '<root>', issues);
  requireNonEmptyString(value, 'scope', path, issues, 'scope');

  if (!isRecord(value.base)) {
    issues.push({ path, field: 'base', message: 'must be an object { stateSha256, remediationHead }' });
  } else {
    requireUnknownKeys(value.base, ['stateSha256', 'remediationHead'], path, 'base', issues);
    requireDigest(value.base, 'stateSha256', path, issues, 'base.stateSha256');
    if (value.base.remediationHead !== null && !isDigest(value.base.remediationHead)) {
      issues.push({ path, field: 'base.remediationHead', message: 'must be a sha-256 hex digest or null' });
    }
  }

  const issueIds = validateIssues(value.issues, path, 'issues', issues);
  validateOperations(value.operations, issueIds, path, 'operations', issues, OPERATION_KINDS_BY_REVISION[manifestRevision]);

  if (!isRecord(value.provenance)) {
    issues.push({ path, field: 'provenance', message: 'must be an object { reason, actor }' });
  } else {
    requireUnknownKeys(value.provenance, ['reason', 'actor'], path, 'provenance', issues);
    requireNonEmptyString(value.provenance, 'reason', path, issues, 'provenance.reason');
    requireNonEmptyString(value.provenance, 'actor', path, issues, 'provenance.actor');
  }

  return issues;
}

/**
 * Preconditions a canonicalization must satisfy against the state actually on disk.
 *
 * Schema validation proves the operation is well-formed; this proves it still describes reality.
 * Pure and read-only: it takes the observed collection as a value and returns issues, so it can be
 * called from a planner, a preview, or a future apply without any of them owning the rule.
 *
 * `debtCollectionDigest` is injected rather than imported so this module stays free of the state
 * and hashing layers it must not depend on.
 */
export function verifyCanonicalizePreconditions(
  operation: CanonicalizeDebtOperation,
  observedDebt: readonly unknown[],
  debtCollectionDigest: (debt: readonly unknown[]) => string,
  path: string,
  prefix: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const observedDigest = debtCollectionDigest(observedDebt);
  if (observedDigest !== operation.expectedDebtCollectionSha256) {
    issues.push({
      path,
      field: `${prefix}.expectedDebtCollectionSha256`,
      message: `is stale: the observed debt collection now digests to ${observedDigest}`,
    });
  }

  const target = observedDebt.find((entry) => isRecord(entry) && entry.id === operation.debtId);
  if (target === undefined) {
    issues.push({ path, field: `${prefix}.debtId`, message: `no debt with id ${operation.debtId} exists in the observed collection` });
    return issues;
  }
  const observed = target as Record<string, unknown>;

  // Identity and lifecycle are observed facts, not operator decisions: canonicalization repairs the
  // shape of a record, it never renames it or moves it through its lifecycle (ADR-0002).
  for (const key of ['title', 'status'] as const) {
    if (observed[key] !== operation.after[key]) {
      issues.push({
        path,
        field: `${prefix}.after.${key}`,
        message: `must preserve the observed ${key} (${JSON.stringify(observed[key])}), not ${JSON.stringify(operation.after[key])}`,
      });
    }
  }

  // Every retired key must actually be there, and every legacy key that is there must be accounted
  // for: an unlisted survivor would silently persist into the "canonical" record.
  for (const key of operation.retiredKeys) {
    if (!(key in observed)) {
      issues.push({ path, field: `${prefix}.retiredKeys`, message: `retires ${key}, which the observed debt does not carry` });
    }
  }
  for (const key of Object.keys(observed)) {
    if ((CANONICAL_DEBT_AFTER_KEYS as readonly string[]).includes(key)) continue;
    if (!operation.retiredKeys.includes(key)) {
      issues.push({ path, field: `${prefix}.retiredKeys`, message: `does not account for the observed non-canonical key ${key}` });
    }
  }

  return issues;
}

export function isCanonicalizeDebtOperation(value: RemediationOperation): value is CanonicalizeDebtOperation {
  return value.kind === 'debt.canonicalize';
}

function validateBase(value: unknown, path: string, prefix: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, field: prefix, message: 'must be an object { stateSha256, remediationHead, checkpoints }' });
    return;
  }
  requireUnknownKeys(value, ['stateSha256', 'remediationHead', 'checkpoints'], path, prefix, issues);
  requireDigest(value, 'stateSha256', path, issues, `${prefix}.stateSha256`);
  if (value.remediationHead !== null && !isDigest(value.remediationHead)) {
    issues.push({ path, field: `${prefix}.remediationHead`, message: 'must be a sha-256 hex digest or null' });
  }
  if (!Array.isArray(value.checkpoints)) {
    issues.push({ path, field: `${prefix}.checkpoints`, message: 'must be an array' });
    return;
  }
  value.checkpoints.forEach((entry, index) => {
    const field = `${prefix}.checkpoints[${index}]`;
    if (!isRecord(entry)) {
      issues.push({ path, field, message: 'must be an object { path, commitment }' });
      return;
    }
    requireUnknownKeys(entry, ['path', 'commitment'], path, field, issues);
    requireNonEmptyString(entry, 'path', path, issues, `${field}.path`);
    requireDigest(entry, 'commitment', path, issues, `${field}.commitment`);
  });
}

/** Returns the set of declared issue ids so operations can be cross-checked against it. */
function validateIssues(value: unknown, path: string, prefix: string, issues: ValidationIssue[]): Set<string> {
  const declared = new Set<string>();
  if (!Array.isArray(value)) {
    issues.push({ path, field: prefix, message: 'must be an array' });
    return declared;
  }
  if (value.length === 0) {
    issues.push({ path, field: prefix, message: 'must declare at least one issue' });
  }
  value.forEach((entry, index) => {
    const field = `${prefix}[${index}]`;
    if (!isRecord(entry)) {
      issues.push({ path, field, message: 'must be an object { id, code, path, observedValueSha256 }' });
      return;
    }
    requireUnknownKeys(entry, ['id', 'code', 'path', 'observedValueSha256'], path, field, issues);
    requireNonEmptyString(entry, 'id', path, issues, `${field}.id`);
    requireNonEmptyString(entry, 'code', path, issues, `${field}.code`);
    requireNonEmptyString(entry, 'path', path, issues, `${field}.path`);
    requireDigest(entry, 'observedValueSha256', path, issues, `${field}.observedValueSha256`);
    if (typeof entry.id === 'string') {
      if (declared.has(entry.id)) issues.push({ path, field: `${field}.id`, message: `duplicates issue id ${entry.id}` });
      declared.add(entry.id);
    }
  });
  return declared;
}

function validateOperations(
  value: unknown,
  issueIds: Set<string>,
  path: string,
  prefix: string,
  issues: ValidationIssue[],
  allowedKinds: readonly RemediationOperationKind[],
): void {
  if (!Array.isArray(value)) {
    issues.push({ path, field: prefix, message: 'must be an array' });
    return;
  }
  if (value.length === 0) {
    issues.push({ path, field: prefix, message: 'must declare at least one operation' });
  }
  const seen = new Set<string>();
  value.forEach((entry, index) => {
    const field = `${prefix}[${index}]`;
    if (!isRecord(entry)) {
      issues.push({ path, field, message: 'must be an object with a typed kind' });
      return;
    }
    // A kind this revision does not carry is rejected here, never reinterpreted under another
    // revision's semantics: that is what makes the revision boundary meaningful.
    if (!isRemediationOperationKind(entry.kind) || !allowedKinds.includes(entry.kind)) {
      issues.push({
        path,
        field: `${field}.kind`,
        message: `must be one of ${allowedKinds.join(', ')}`,
      });
      return;
    }
    requireUnknownKeys(entry, OPERATION_KEYS[entry.kind], path, field, issues);
    requireNonEmptyString(entry, 'id', path, issues, `${field}.id`);
    if (typeof entry.id === 'string') {
      if (seen.has(entry.id)) issues.push({ path, field: `${field}.id`, message: `duplicates operation id ${entry.id}` });
      seen.add(entry.id);
    }
    validateResolves(entry, issueIds, path, field, issues);
    OPERATION_VALIDATORS[entry.kind](entry, path, field, issues);
  });
}

function validateResolves(
  entry: Record<string, unknown>,
  issueIds: Set<string>,
  path: string,
  field: string,
  issues: ValidationIssue[],
): void {
  if (!Array.isArray(entry.resolves)) {
    issues.push({ path, field: `${field}.resolves`, message: 'must be an array of issue ids' });
    return;
  }
  if (entry.resolves.length === 0) {
    issues.push({ path, field: `${field}.resolves`, message: 'must reference at least one issue id' });
  }
  entry.resolves.forEach((id, index) => {
    if (typeof id !== 'string' || id.length === 0) {
      issues.push({ path, field: `${field}.resolves[${index}]`, message: 'must be a non-empty string' });
      return;
    }
    if (!issueIds.has(id)) {
      issues.push({ path, field: `${field}.resolves[${index}]`, message: `references undeclared issue id ${id}` });
    }
  });
}

function validateSetDebtOriginOperation(
  value: Record<string, unknown>,
  path: string,
  prefix: string,
  issues: ValidationIssue[],
): void {
  requireNonEmptyString(value, 'debtId', path, issues, `${prefix}.debtId`);
  requireDigest(value, 'expectedOriginSha256', path, issues, `${prefix}.expectedOriginSha256`);
  // The replacement must be an explicit, finite, integral sprint number. A string origin is the
  // exact defect this operation exists to correct, so accepting one here would be self-defeating.
  if (typeof value.origin !== 'number' || !Number.isInteger(value.origin)) {
    issues.push({ path, field: `${prefix}.origin`, message: 'must be an integer' });
  } else if (value.origin < 1) {
    issues.push({ path, field: `${prefix}.origin`, message: 'must be a sprint number >= 1' });
  }
  requireNonEmptyString(value, 'reason', path, issues, `${prefix}.reason`);
}

function validateCanonicalizeDebtOperation(
  value: Record<string, unknown>,
  path: string,
  prefix: string,
  issues: ValidationIssue[],
): void {
  requireNonEmptyString(value, 'debtId', path, issues, `${prefix}.debtId`);
  requireDigest(value, 'expectedDebtCollectionSha256', path, issues, `${prefix}.expectedDebtCollectionSha256`);
  requireNonEmptyString(value, 'reason', path, issues, `${prefix}.reason`);

  if (!Array.isArray(value.retiredKeys)) {
    issues.push({ path, field: `${prefix}.retiredKeys`, message: 'must be an array of legacy key names' });
  } else {
    const seen = new Set<string>();
    value.retiredKeys.forEach((key, index) => {
      const field = `${prefix}.retiredKeys[${index}]`;
      if (typeof key !== 'string' || key.length === 0) {
        issues.push({ path, field, message: 'must be a non-empty string' });
        return;
      }
      // Retiring a canonical key would be a deletion disguised as a cleanup.
      if ((CANONICAL_DEBT_AFTER_KEYS as readonly string[]).includes(key)) {
        issues.push({ path, field, message: `is a canonical debt key and cannot be retired` });
      }
      if (seen.has(key)) issues.push({ path, field, message: `duplicates retired key ${key}` });
      seen.add(key);
    });
  }

  validateCanonicalDebtAfterImage(value.after, value.debtId, path, `${prefix}.after`, issues);
}

/**
 * The after-image is the whole contract of this operation: exactly the seven canonical keys, every
 * value valid, identity matching the debt being corrected. A hybrid image — canonical fields plus a
 * surviving legacy key — is the failure mode this validation exists to prevent.
 */
function validateCanonicalDebtAfterImage(
  value: unknown,
  debtId: unknown,
  path: string,
  prefix: string,
  issues: ValidationIssue[],
): void {
  if (!isRecord(value)) {
    issues.push({ path, field: prefix, message: `must be an object with exactly ${CANONICAL_DEBT_AFTER_KEYS.join(', ')}` });
    return;
  }
  requireUnknownKeys(value, CANONICAL_DEBT_AFTER_KEYS, path, prefix, issues);
  for (const key of CANONICAL_DEBT_AFTER_KEYS) {
    if (!(key in value)) issues.push({ path, field: `${prefix}.${key}`, message: 'is required in a canonical after-image' });
  }

  requireNonEmptyString(value, 'id', path, issues, `${prefix}.id`);
  requireNonEmptyString(value, 'title', path, issues, `${prefix}.title`);
  requireNonEmptyString(value, 'note', path, issues, `${prefix}.note`);
  if (typeof value.id === 'string' && typeof debtId === 'string' && value.id !== debtId) {
    issues.push({ path, field: `${prefix}.id`, message: `must equal the operation debtId (${debtId})` });
  }
  if (typeof value.origin !== 'number' || !Number.isInteger(value.origin)) {
    issues.push({ path, field: `${prefix}.origin`, message: 'must be an integer sprint number' });
  } else if (value.origin < 1) {
    issues.push({ path, field: `${prefix}.origin`, message: 'must be a sprint number >= 1' });
  }
  if (typeof value.priority !== 'string' || !(DEBT_PRIORITIES as readonly string[]).includes(value.priority)) {
    issues.push({ path, field: `${prefix}.priority`, message: `must be one of ${DEBT_PRIORITIES.join(', ')}` });
  }
  if (typeof value.status !== 'string' || !(DEBT_STATUSES as readonly string[]).includes(value.status)) {
    issues.push({ path, field: `${prefix}.status`, message: `must be one of ${DEBT_STATUSES.join(', ')}` });
  }
  if (value.targetSprint !== null && (typeof value.targetSprint !== 'number' || !Number.isInteger(value.targetSprint))) {
    issues.push({ path, field: `${prefix}.targetSprint`, message: 'must be an integer sprint number or null' });
  } else if (typeof value.targetSprint === 'number' && value.targetSprint < 1) {
    issues.push({ path, field: `${prefix}.targetSprint`, message: 'must be a sprint number >= 1 or null' });
  }
}

function validateCompactReplayWitness(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, field: 'result.witness', message: 'must be an object { schemaVersion, kind }' });
    return;
  }
  requireUnknownKeys(value, ['schemaVersion', 'kind'], path, 'result.witness', issues);
  if (value.schemaVersion !== COMPACT_REPLAY_WITNESS_SCHEMA_VERSION) {
    issues.push({ path, field: 'result.witness.schemaVersion', message: `must be ${COMPACT_REPLAY_WITNESS_SCHEMA_VERSION}` });
  }
  if (value.kind !== COMPACT_REPLAY_WITNESS_KIND) {
    issues.push({ path, field: 'result.witness.kind', message: `must be "${COMPACT_REPLAY_WITNESS_KIND}"` });
  }
}

function validateProvenance(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, field: 'provenance', message: 'must be an object { reason, actor, kyroVersion }' });
    return;
  }
  requireUnknownKeys(value, ['reason', 'actor', 'kyroVersion'], path, 'provenance', issues);
  requireNonEmptyString(value, 'reason', path, issues, 'provenance.reason');
  requireNonEmptyString(value, 'actor', path, issues, 'provenance.actor');
  requireNonEmptyString(value, 'kyroVersion', path, issues, 'provenance.kyroVersion');
}

function requireUnknownKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  prefix: string,
  issues: ValidationIssue[],
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      issues.push({ path, field: `${prefix}.${key}`, message: 'is not part of the remediation contract' });
    }
  }
}

function requireNonEmptyString(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: ValidationIssue[],
  field: string,
): void {
  if (typeof record[key] !== 'string' || (record[key] as string).trim().length === 0) {
    issues.push({ path, field, message: 'must be a non-empty string' });
  }
}

function requirePattern(
  record: Record<string, unknown>,
  key: string,
  pattern: RegExp,
  message: string,
  path: string,
  issues: ValidationIssue[],
  field: string,
): void {
  if (typeof record[key] !== 'string' || !pattern.test(record[key] as string)) {
    issues.push({ path, field, message });
  }
}

function requireDigest(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: ValidationIssue[],
  field: string,
): void {
  if (!isDigest(record[key])) issues.push({ path, field, message: 'must be a sha-256 hex digest' });
}

function isDigest(value: unknown): value is string {
  return typeof value === 'string' && SHA256_PATTERN.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
