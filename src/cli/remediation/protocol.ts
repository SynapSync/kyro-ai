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
export const SCOPE_REMEDIATION_SCHEMA_VERSION = 1 as const;

/** Closed v1 operation registry. An unknown kind fails before any plan is produced. */
export const REMEDIATION_OPERATION_KINDS = ['debt.origin.set'] as const;
export type RemediationOperationKind = (typeof REMEDIATION_OPERATION_KINDS)[number];

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

export type RemediationOperation = SetDebtOriginOperation;

export interface RemediationResult {
  stateSha256: string;
  /** Snapshot of the scope state after applying operations. Used by E1 to replay multi-record chains. */
  snapshot: unknown;
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
};

export function isRemediationOperationKind(value: unknown): value is RemediationOperationKind {
  return typeof value === 'string' && (REMEDIATION_OPERATION_KINDS as readonly string[]).includes(value);
}

/**
 * Full fail-closed validation of a remediation record. Returns one issue per defect with a
 * field-specific path (e.g. `operations[0].origin`) so a rejection is actionable without guessing.
 */
export function validateScopeRemediation(value: unknown, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) return [{ path, field: '<root>', message: 'must be an object' }];

  if (value.schemaVersion !== SCOPE_REMEDIATION_SCHEMA_VERSION) {
    issues.push({ path, field: 'schemaVersion', message: `must be ${SCOPE_REMEDIATION_SCHEMA_VERSION}` });
  }
  if (value.kind !== SCOPE_REMEDIATION_KIND) {
    issues.push({ path, field: 'kind', message: `must be "${SCOPE_REMEDIATION_KIND}"` });
  }
  requireUnknownKeys(value, REMEDIATION_KEYS, path, '<root>', issues);
  requirePattern(value, 'id', REMEDIATION_ID_PATTERN, 'must match R-NNN', path, issues, 'id');
  requireNonEmptyString(value, 'scope', path, issues, 'scope');
  requireNonEmptyString(value, 'createdAt', path, issues, 'createdAt');

  validateBase(value.base, path, 'base', issues);

  const issueIds = validateIssues(value.issues, path, 'issues', issues);
  validateOperations(value.operations, issueIds, path, 'operations', issues);

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

export function asScopeRemediation(value: unknown): ScopeRemediationV1 | null {
  return validateScopeRemediation(value, '<memory>').length === 0 ? (value as ScopeRemediationV1) : null;
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
  schemaVersion: typeof SCOPE_REMEDIATION_SCHEMA_VERSION;
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

  if (value.schemaVersion !== SCOPE_REMEDIATION_SCHEMA_VERSION) {
    issues.push({ path, field: 'schemaVersion', message: `must be ${SCOPE_REMEDIATION_SCHEMA_VERSION}` });
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
  validateOperations(value.operations, issueIds, path, 'operations', issues);

  if (!isRecord(value.provenance)) {
    issues.push({ path, field: 'provenance', message: 'must be an object { reason, actor }' });
  } else {
    requireUnknownKeys(value.provenance, ['reason', 'actor'], path, 'provenance', issues);
    requireNonEmptyString(value.provenance, 'reason', path, issues, 'provenance.reason');
    requireNonEmptyString(value.provenance, 'actor', path, issues, 'provenance.actor');
  }

  return issues;
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
    if (!isRemediationOperationKind(entry.kind)) {
      issues.push({
        path,
        field: `${field}.kind`,
        message: `must be one of ${REMEDIATION_OPERATION_KINDS.join(', ')}`,
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
