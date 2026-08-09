/**
 * Certification planning (T2.4).
 *
 * A certification is a different claim from a remediation: remediation asserts "this correction was
 * applied", certification asserts "the corrected state was independently validated". They therefore
 * use separate record types, separate archives and separate anchors — but the same transaction
 * discipline, because both are immutable evidence that must never be silently rewritten.
 *
 * Nothing here writes. `planCertification` is a warrant computed from observed state; only
 * `applyCertificationTransaction` may act on it, and only while holding the state-writer lock.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { readJsonSafely } from '../artifacts/json';
import { scopeRoot, sprintJsonPath } from '../artifacts/paths';
import { validateSprintFile, type ValidationIssue } from '../artifacts/schema';
import { sha256 } from '../checkpoints/sprint-close';
import { KyroCoreError } from '../core/errors';
import { resolveManagedPath } from '../fs';
import type {
  CertificationAnchor,
  CertificationEvidence,
  CertificationProvenance,
  CertificationVerdict,
  RemediationAnchor,
  ScopeRecertificationV1,
  SprintFile,
} from '../types';
import { SCOPE_RECERTIFICATION_KIND, SCOPE_RECERTIFICATION_SCHEMA_VERSION } from '../types';
import { certificationCommitment, validateScopeRecertification } from './certification';
import { canonicalRemediationState } from './canonical-state';
import { deriveScopeVerificationState } from './plan';

export const CERTIFICATION_MANIFEST_KIND = 'scope-certification-manifest';
export const CERTIFICATION_MANIFEST_SCHEMA_VERSION = 1;

export const CERTIFICATION_TRANSACTION_STATUS = {
  /** No record and no anchor on disk — this certificate has never been published. */
  NOT_APPLIED: 'NOT_APPLIED',
  /** The immutable record exists but the live anchor does not: persistence was interrupted. */
  PREPARED: 'PREPARED',
  /** Record, anchor and commitment all agree. */
  APPLIED: 'APPLIED',
  /** Record and anchor exist but disagree with each other. */
  DIVERGED: 'DIVERGED',
  /** The record is unreadable or fails the certification contract. */
  CORRUPT: 'CORRUPT',
  /** The record declares a schema version this runtime cannot evaluate. */
  UNSUPPORTED_VERSION: 'UNSUPPORTED_VERSION',
} as const;
export type CertificationTransactionStatus =
  (typeof CERTIFICATION_TRANSACTION_STATUS)[keyof typeof CERTIFICATION_TRANSACTION_STATUS];

export interface CertificationPlanOptions {
  scope: string;
  manifestPath: string;
  now: string;
  kyroVersion: string;
}

export interface CertificationPlan {
  scope: string;
  certificationId: string;
  recordPath: string;
  sprintPath: string;
  record: ScopeRecertificationV1;
  commitment: string;
  anchor: CertificationAnchor;
  projectedSprint: SprintFile;
  /** Human-readable description of each evidence entry that was re-verified from the workspace. */
  evidenceSummary: string[];
  transactionStatus: CertificationTransactionStatus;
  transactionDetail: string;
}

interface CertificationManifest {
  schemaVersion: number;
  kind: string;
  scope: string;
  certifiedChainHeadCommitment: string;
  evidence: CertificationEvidence[];
  verdict: Omit<CertificationVerdict, 'recordedAt'> & { recordedAt?: string };
  provenance: CertificationProvenance;
}

export function certificationsDir(scope: string): string {
  return `${scopeRoot(scope)}/archive/certifications`;
}

export function certificationRecordPath(scope: string, certificationId: string): string {
  return `${certificationsDir(scope)}/certification-${certificationId.replace(/^C-/, '')}.json`;
}

/** Scope-relative path stored in the live anchor. Bound to the id so neither can drift alone. */
export function relativeCertificationPath(certificationId: string): string {
  return `archive/certifications/certification-${certificationId.replace(/^C-/, '')}.json`;
}

export function readCertificationRecord(scope: string, certificationId: string): ScopeRecertificationV1 | null {
  const read = readJsonSafely(certificationRecordPath(scope, certificationId));
  if (!read.exists || read.error) return null;
  const issues = validateScopeRecertification(read.value, certificationRecordPath(scope, certificationId));
  if (issues.length > 0) return null;
  return read.value as ScopeRecertificationV1;
}

function readLiveState(scope: string): Record<string, unknown> {
  const path = sprintJsonPath(scope);
  const read = readJsonSafely(path);
  if (!read.exists || read.error) {
    throw new KyroCoreError('INVALID_SPRINT_SHAPE', `Cannot read ${path}: ${read.error ?? 'missing'}.`, 'Run kyro doctor --artifacts for this scope.');
  }
  const issues = validateSprintFile(read.value, path);
  if (issues.length > 0) {
    throw new KyroCoreError(
      'INVALID_SPRINT_SHAPE',
      `${path} does not satisfy the current contract — ${formatIssues(issues)}.`,
      'A scope that does not satisfy the contract cannot be certified. Remediate it first.',
    );
  }
  return read.value as Record<string, unknown>;
}

function readRemediationAnchors(state: Record<string, unknown>): RemediationAnchor[] {
  const anchors = state.remediations;
  return Array.isArray(anchors) ? (anchors as RemediationAnchor[]) : [];
}

function readCertificationAnchors(state: Record<string, unknown>): CertificationAnchor[] {
  const anchors = state.certifications;
  return Array.isArray(anchors) ? (anchors as CertificationAnchor[]) : [];
}

function stateDigest(state: Record<string, unknown>): string {
  return sha256(canonicalRemediationState(state as unknown as SprintFile));
}

function nextCertificationId(anchors: CertificationAnchor[]): string {
  let highest = 0;
  for (const anchor of anchors) {
    const parsed = Number.parseInt(anchor.id.replace(/^C-/, ''), 10);
    if (Number.isFinite(parsed) && parsed > highest) highest = parsed;
  }
  return `C-${String(highest + 1).padStart(3, '0')}`;
}

function readManifest(manifestPath: string): CertificationManifest {
  const resolved = resolveManagedPath(manifestPath);
  if (!existsSync(resolved)) {
    throw new KyroCoreError('INVALID_INPUT', `Certification manifest not found: ${manifestPath}.`, 'Pass --manifest <path> pointing at a scope-certification-manifest v1 document.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(resolved, 'utf8'));
  } catch (error) {
    throw new KyroCoreError('INVALID_INPUT', `Certification manifest is not valid JSON: ${(error as Error).message}.`);
  }
  const manifest = parsed as Partial<CertificationManifest> | null;
  if (!manifest || typeof manifest !== 'object') {
    throw new KyroCoreError('INVALID_INPUT', 'Certification manifest must be an object.');
  }
  if (manifest.schemaVersion !== CERTIFICATION_MANIFEST_SCHEMA_VERSION) {
    throw new KyroCoreError(
      'INVALID_INPUT',
      `Certification manifest declares schemaVersion=${String(manifest.schemaVersion ?? '(missing)')}, expected ${CERTIFICATION_MANIFEST_SCHEMA_VERSION}.`,
      'This runtime cannot evaluate that manifest version. Do not downgrade the field to force it through.',
    );
  }
  if (manifest.kind !== CERTIFICATION_MANIFEST_KIND) {
    throw new KyroCoreError('INVALID_INPUT', `Certification manifest kind must be "${CERTIFICATION_MANIFEST_KIND}".`);
  }
  if (typeof manifest.scope !== 'string' || manifest.scope.length === 0) {
    throw new KyroCoreError('INVALID_INPUT', 'Certification manifest must declare a scope.');
  }
  if (typeof manifest.certifiedChainHeadCommitment !== 'string') {
    throw new KyroCoreError('INVALID_INPUT', 'Certification manifest must declare certifiedChainHeadCommitment.');
  }
  if (!Array.isArray(manifest.evidence)) {
    throw new KyroCoreError('INVALID_INPUT', 'Certification manifest must declare an evidence array.');
  }
  if (!manifest.verdict || typeof manifest.verdict !== 'object') {
    throw new KyroCoreError('INVALID_INPUT', 'Certification manifest must declare a verdict.');
  }
  if (!manifest.provenance || typeof manifest.provenance !== 'object') {
    throw new KyroCoreError('INVALID_INPUT', 'Certification manifest must declare provenance.');
  }
  return manifest as CertificationManifest;
}

/**
 * Re-derive every evidence digest from the workspace. A certificate that merely repeats a digest
 * the manifest author typed proves nothing — the point of the evidence array is that each entry can
 * be reproduced independently at certification time and again by any later auditor.
 */
function verifyEvidence(
  scope: string,
  state: Record<string, unknown>,
  evidence: CertificationEvidence[],
  chainHead: string,
): string[] {
  const summary: string[] = [];
  evidence.forEach((entry, index) => {
    const label = `evidence[${index}]`;
    if (!entry || typeof entry !== 'object' || !entry.source) {
      throw new KyroCoreError('INVALID_INPUT', `${label} must declare a source.`);
    }
    if (entry.chainHeadCommitment !== chainHead) {
      throw new KyroCoreError(
        'STATE_DIVERGED',
        `${label} was produced against chain head ${entry.chainHeadCommitment}, but the current head is ${chainHead}.`,
        'Evidence only certifies the state it was observed against. Re-run the validation against the current chain head.',
      );
    }
    const source = entry.source;
    if (source.kind === 'kyro-task-verdict') {
      const verdict = findTaskVerdict(state, source.taskId);
      if (verdict === null) {
        throw new KyroCoreError(
          'INVALID_INPUT',
          `${label} cites task ${source.taskId}, which has no recorded verdict in this scope.`,
          'Evidence must name a task Kyro actually verified. Record the verdict before certifying.',
        );
      }
      const actual = sha256(verdict);
      if (actual !== source.verdictDigest) {
        throw new KyroCoreError(
          'STATE_DIVERGED',
          `${label} declares verdict digest ${source.verdictDigest} for task ${source.taskId}, but the recorded verdict hashes to ${actual}.`,
          'The verdict changed after the manifest was written. Regenerate the manifest against the current verdict.',
        );
      }
      if (source.scope !== scope) {
        throw new KyroCoreError('INVALID_INPUT', `${label} declares scope "${source.scope}" but is being applied to "${scope}".`);
      }
      summary.push(`${label} kyro-task-verdict ${source.taskId} @ ${actual}`);
      return;
    }
    if (source.kind === 'external-artifact') {
      const resolved = resolveManagedPath(source.path);
      if (!existsSync(resolved)) {
        throw new KyroCoreError('INVALID_INPUT', `${label} cites a missing artifact: ${source.path}.`, 'Evidence must be re-hashable at certification time.');
      }
      const actual = sha256(readFileSync(resolved, 'utf8'));
      if (actual !== source.contentDigest) {
        throw new KyroCoreError(
          'STATE_DIVERGED',
          `${label} declares content digest ${source.contentDigest} for ${source.path}, but the file hashes to ${actual}.`,
          'The artifact changed after the manifest was written. Regenerate the manifest.',
        );
      }
      summary.push(`${label} external-artifact ${source.path} @ ${actual}`);
      return;
    }
    throw new KyroCoreError('INVALID_INPUT', `${label}.source.kind is not a recognized evidence kind.`);
  });
  return summary;
}

/** Locate a task's recorded verdict anywhere in the scope's sprint structure. */
function findTaskVerdict(state: Record<string, unknown>, taskId: string): unknown {
  const active = state.activeSprint as Record<string, unknown> | undefined;
  const buckets: unknown[] = [];
  if (active) {
    const phases = active.phases;
    if (Array.isArray(phases)) {
      for (const phase of phases) {
        const tasks = (phase as Record<string, unknown>)?.tasks;
        if (Array.isArray(tasks)) buckets.push(...tasks);
      }
    }
    const emergent = active.emergentTasks;
    if (Array.isArray(emergent)) buckets.push(...emergent);
  }
  for (const task of buckets) {
    const record = task as Record<string, unknown> | null;
    if (record?.id === taskId) return record.verdict ?? null;
  }
  return null;
}

/**
 * Classify a certification id's on-disk transaction. PREPARED means the record was persisted but
 * the live anchor was not — an interrupted write, never a certificate.
 */
export function inspectCertificationTransaction(
  scope: string,
  certificationId: string,
  expectedCommitment: string | null,
): { status: CertificationTransactionStatus; detail: string } {
  const path = certificationRecordPath(scope, certificationId);
  const read = readJsonSafely(path);
  const liveRead = readJsonSafely(sprintJsonPath(scope));
  const state = liveRead.exists && !liveRead.error ? (liveRead.value as Record<string, unknown>) : null;
  const anchor = state ? readCertificationAnchors(state).find((entry) => entry.id === certificationId) ?? null : null;

  if (!read.exists) {
    return anchor
      ? { status: CERTIFICATION_TRANSACTION_STATUS.DIVERGED, detail: `live anchor ${certificationId} references a missing record (${path})` }
      : { status: CERTIFICATION_TRANSACTION_STATUS.NOT_APPLIED, detail: 'no record and no live anchor' };
  }
  if (read.error) {
    return { status: CERTIFICATION_TRANSACTION_STATUS.CORRUPT, detail: `record is unreadable: ${read.error}` };
  }
  const declaredVersion = (read.value as { schemaVersion?: unknown } | null)?.schemaVersion;
  if (declaredVersion !== SCOPE_RECERTIFICATION_SCHEMA_VERSION) {
    return {
      status: CERTIFICATION_TRANSACTION_STATUS.UNSUPPORTED_VERSION,
      detail: `record declares schemaVersion=${String(declaredVersion ?? '(missing)')}`,
    };
  }
  const issues = validateScopeRecertification(read.value, path);
  if (issues.length > 0) {
    return { status: CERTIFICATION_TRANSACTION_STATUS.CORRUPT, detail: issues.join('; ') };
  }
  const record = read.value as ScopeRecertificationV1;
  // Self-declared identity must match where the record actually lives, or it can misreport its own
  // provenance while passing every digest (the E3 lesson).
  if (record.identity.scope !== scope) {
    return { status: CERTIFICATION_TRANSACTION_STATUS.CORRUPT, detail: `record declares scope "${record.identity.scope}" but lives in "${scope}"` };
  }
  if (record.certificationId !== certificationId) {
    return { status: CERTIFICATION_TRANSACTION_STATUS.CORRUPT, detail: `record declares id "${record.certificationId}" but is anchored as "${certificationId}"` };
  }
  const commitment = certificationCommitment(record);
  if (expectedCommitment !== null && commitment !== expectedCommitment) {
    return { status: CERTIFICATION_TRANSACTION_STATUS.DIVERGED, detail: `record ${certificationId} exists with a different commitment than the planned one` };
  }
  if (!anchor) {
    return {
      status: CERTIFICATION_TRANSACTION_STATUS.PREPARED,
      detail: `record ${certificationId} is persisted but the live anchor is absent (persistence was interrupted)`,
    };
  }
  if (anchor.commitment !== commitment) {
    return { status: CERTIFICATION_TRANSACTION_STATUS.DIVERGED, detail: `live anchor commitment ${anchor.commitment} does not match record commitment ${commitment}` };
  }
  if (anchor.path !== relativeCertificationPath(certificationId)) {
    return { status: CERTIFICATION_TRANSACTION_STATUS.DIVERGED, detail: `live anchor path ${anchor.path} is not the path derived from ${certificationId}` };
  }
  return { status: CERTIFICATION_TRANSACTION_STATUS.APPLIED, detail: `record and live anchor agree on ${commitment}` };
}

/**
 * Build the certification warrant. Every refusal here happens before any write, so a rejected
 * certification leaves the scope byte-identical.
 */
export function planCertification(options: CertificationPlanOptions): CertificationPlan {
  const manifest = readManifest(options.manifestPath);
  if (manifest.scope !== options.scope) {
    throw new KyroCoreError(
      'INVALID_INPUT',
      `Manifest targets scope "${manifest.scope}" but the command targets "${options.scope}".`,
      'A certification manifest is bound to one scope.',
    );
  }

  const state = readLiveState(options.scope);

  // The chain must actually explain the live state. Certifying a scope whose corrections do not
  // replay would stamp an audit trail onto state nobody can reproduce.
  const verification = deriveScopeVerificationState(options.scope);
  if (verification === null || verification.state === 'diverged' || verification.state === 'unsupported') {
    throw new KyroCoreError(
      'STATE_DIVERGED',
      `Scope ${options.scope} reports verification state "${verification?.state ?? '(unknown)'}" — ${verification?.detail ?? 'no verification could be derived'}.`,
      'Only a scope whose remediation chain replays to its live state can be certified. Resolve the divergence first.',
    );
  }

  const remediationAnchors = readRemediationAnchors(state);
  if (remediationAnchors.length === 0) {
    throw new KyroCoreError(
      'STATE_DIVERGED',
      `Scope ${options.scope} has no remediation chain to certify.`,
      'Certification records that a correction was independently validated. An untouched scope has nothing to certify.',
    );
  }
  const chainHead = remediationAnchors[remediationAnchors.length - 1].commitment;
  if (manifest.certifiedChainHeadCommitment !== chainHead) {
    throw new KyroCoreError(
      'STATE_DIVERGED',
      `Manifest certifies chain head ${manifest.certifiedChainHeadCommitment} but the current head is ${chainHead}.`,
      'The scope was remediated again after the manifest was written. A certificate covers one chain head; regenerate the manifest.',
    );
  }

  if (manifest.evidence.length === 0) {
    throw new KyroCoreError(
      'INVALID_INPUT',
      'Certification manifest declares no evidence.',
      'A certificate asserting a verdict with nothing behind it is exactly what this contract exists to reject.',
    );
  }
  if (manifest.verdict.outcome !== 'pass') {
    throw new KyroCoreError(
      'INVALID_INPUT',
      `Checker verdict is "${manifest.verdict.outcome}", not "pass".`,
      'Only a passing verdict can certify a scope. Record the failure and remediate instead.',
    );
  }

  const evidenceSummary = verifyEvidence(options.scope, state, manifest.evidence, chainHead);

  const certificationAnchors = readCertificationAnchors(state);
  const certificationId = nextCertificationId(certificationAnchors);
  const recordPath = certificationRecordPath(options.scope, certificationId);

  // Resume determinism, same as remediation: reusing a prepared record's timestamps is what makes a
  // retry reproduce the SAME commitment rather than mint a second, competing certificate.
  const prepared = readCertificationRecord(options.scope, certificationId);

  const record: ScopeRecertificationV1 = {
    schemaVersion: SCOPE_RECERTIFICATION_SCHEMA_VERSION,
    kind: SCOPE_RECERTIFICATION_KIND,
    certificationId,
    identity: { scope: options.scope },
    certifiedChainHeadCommitment: chainHead,
    certifiedStateDigest: stateDigest(state),
    evidence: manifest.evidence,
    verdict: {
      checker: manifest.verdict.checker,
      outcome: 'pass',
      recordedAt: prepared?.verdict.recordedAt ?? manifest.verdict.recordedAt ?? options.now,
    },
    provenance: { actor: manifest.provenance.actor, reason: manifest.provenance.reason },
    createdAt: prepared?.createdAt ?? options.now,
  };

  const recordIssues = validateScopeRecertification(record, recordPath);
  if (recordIssues.length > 0) {
    throw new KyroCoreError(
      'INVALID_INPUT',
      `Projected certification record is invalid — ${recordIssues.join('; ')}.`,
      'This is a planner defect or a manifest Kyro cannot represent. Do not apply it.',
    );
  }

  const commitment = certificationCommitment(record);
  const anchor: CertificationAnchor = {
    id: certificationId,
    path: relativeCertificationPath(certificationId),
    commitment,
  };
  const projectedSprint = { ...state, certifications: [...certificationAnchors, anchor] } as unknown as SprintFile;

  const projectedIssues = validateSprintFile(projectedSprint, sprintJsonPath(options.scope));
  if (projectedIssues.length > 0) {
    throw new KyroCoreError(
      'INVALID_SPRINT_SHAPE',
      `The certified state would be invalid — ${formatIssues(projectedIssues)}.`,
      'Kyro does not anchor a certificate onto a state that fails its own contract.',
    );
  }

  // Certification must not disturb the business state: appending the anchor may not move the digest
  // the certificate itself commits to.
  if (stateDigest(projectedSprint as unknown as Record<string, unknown>) !== record.certifiedStateDigest) {
    throw new KyroCoreError(
      'STATE_DIVERGED',
      'Appending the certification anchor changed the business-state digest.',
      'certifications[] must be excluded from the canonical projection. This is a Kyro defect; do not apply.',
    );
  }

  const transaction = inspectCertificationTransaction(options.scope, certificationId, commitment);

  return {
    scope: options.scope,
    certificationId,
    recordPath,
    sprintPath: sprintJsonPath(options.scope),
    record,
    commitment,
    anchor,
    projectedSprint,
    evidenceSummary,
    transactionStatus: transaction.status,
    transactionDetail: transaction.detail,
  };
}

/**
 * Resolve whether a valid certificate exists for a given chain head. This is what makes the
 * `recertified` verification state reachable: an anchor alone proves nothing, the record behind it
 * must be readable, contract-valid, commitment-matching and bound to THIS head.
 */
export function resolveCertificationForChainHead(
  scope: string,
): { kind: 'none' } | { kind: 'valid'; through: string } {
  const read = readJsonSafely(sprintJsonPath(scope));
  if (!read.exists || read.error) return { kind: 'none' };
  const state = read.value as Record<string, unknown>;
  const anchors = readCertificationAnchors(state);
  if (anchors.length === 0) return { kind: 'none' };

  // The head is read from live state rather than passed in, so a caller can never accidentally
  // hand this function a record id where a commitment belongs and get a false positive.
  const remediationAnchors = readRemediationAnchors(state);
  if (remediationAnchors.length === 0) return { kind: 'none' };
  const chainHead = remediationAnchors[remediationAnchors.length - 1].commitment;

  const liveDigest = stateDigest(state);
  // Walk newest-first: the most recent certificate bound to this head is the one that certifies it.
  for (let i = anchors.length - 1; i >= 0; i -= 1) {
    const anchor = anchors[i];
    const transaction = inspectCertificationTransaction(scope, anchor.id, anchor.commitment);
    if (transaction.status !== CERTIFICATION_TRANSACTION_STATUS.APPLIED) continue;
    const record = readCertificationRecord(scope, anchor.id);
    if (!record) continue;
    // A certificate covers ONE chain head and ONE state. Remediating again must drop it.
    if (record.certifiedChainHeadCommitment !== chainHead) continue;
    if (record.certifiedStateDigest !== liveDigest) continue;
    if (record.verdict.outcome !== 'pass') continue;
    if (record.evidence.length === 0) continue;
    return { kind: 'valid', through: anchor.id };
  }
  return { kind: 'none' };
}

/** Certification record files present on disk, used by doctor to spot unanchored records. */
export function listCertificationRecordFiles(scope: string): string[] {
  const dir = certificationsDir(scope);
  const resolved = resolveManagedPath(dir);
  if (!existsSync(resolved)) return [];
  return readdirSync(resolved).filter((name) => name.endsWith('.json')).sort();
}

function formatIssues(issues: ValidationIssue[]): string {
  return issues.map((issue) => `${issue.path}:${issue.field} ${issue.message}`).join('; ');
}
