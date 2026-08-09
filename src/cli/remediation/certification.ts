/**
 * Typed scope recertification contract (T2.3). Fail-closed validator with explicit exported types,
 * no unknown payload, and field-specific rejection paths mirroring the remediation protocol style.
 */

import { createHash } from 'node:crypto';
import type {
  CertificationEvidenceExternalArtifactSource,
  CertificationEvidenceKyroVerdictSource,
  ScopeRecertificationV1,
} from '../types';
import { SCOPE_RECERTIFICATION_KIND, SCOPE_RECERTIFICATION_SCHEMA_VERSION } from '../types';

function sha256(value: unknown): string {
  const input = typeof value === 'string' ? value : JSON.stringify(sortJson(value));
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, sortJson((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === 'string' || value === null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/**
 * Commitment of a certification record, bound to the chain head it certifies.
 *
 * `certificationId` IS part of the commitment. It is assigned by the publisher and never derived
 * from the hash, so including it creates no cycle — while excluding it would let two certificates
 * with different ids share one commitment, so an anchor could name C-001 and be satisfied by the
 * bytes of C-002. That is the E3 lesson applied to certification.
 */
export function certificationCommitment(cert: ScopeRecertificationV1): string {
  return sha256(JSON.parse(JSON.stringify(cert)));
}

/** Validate a complete certification record (T2.3, AC1-2). */
export function validateScopeRecertification(value: unknown, path: string): string[] {
  const issues: string[] = [];
  const cert = asRecord(value);
  if (!cert) return [`${path}:<root> must be an object`];

  // Schema version and kind
  if (cert.schemaVersion !== SCOPE_RECERTIFICATION_SCHEMA_VERSION) {
    issues.push(`${path}:schemaVersion must be ${SCOPE_RECERTIFICATION_SCHEMA_VERSION}`);
  }
  if (cert.kind !== SCOPE_RECERTIFICATION_KIND) {
    issues.push(`${path}:kind must be ${SCOPE_RECERTIFICATION_KIND}`);
  }

  // Required string fields
  for (const key of ['certificationId', 'createdAt'] as const) {
    if (typeof cert[key] !== 'string' || (cert[key] as string).length === 0) {
      issues.push(`${path}:${key} must be a non-empty string`);
    }
  }

  // Digest fields must be SHA-256 hex, never a free-form string. Accepting "non-empty" here is what
  // let a 'sha256-placeholder' stub validate as a real certificate (T2.4).
  for (const key of ['certifiedChainHeadCommitment', 'certifiedStateDigest'] as const) {
    if (typeof cert[key] !== 'string' || !/^[a-f0-9]{64}$/.test(cert[key] as string)) {
      issues.push(`${path}:${key} must be a SHA-256 hex digest`);
    }
  }

  // ISO timestamp validation
  if (typeof cert.createdAt === 'string' && Number.isNaN(Date.parse(cert.createdAt))) {
    issues.push(`${path}:createdAt must be an ISO-compatible timestamp`);
  }

  // Identity
  const identity = asRecord(cert.identity);
  if (!identity || typeof identity.scope !== 'string' || identity.scope.length === 0) {
    issues.push(`${path}:identity must contain scope as a non-empty string`);
  }

  // Evidence array (T2.3, AC1). An empty array is a certificate asserting a verdict with nothing
  // behind it — the exact "pass string without a verifiable source" the contract must reject.
  if (!Array.isArray(cert.evidence)) {
    issues.push(`${path}:evidence must be an array`);
  } else if ((cert.evidence as unknown[]).length === 0) {
    issues.push(`${path}:evidence must contain at least one verifiable evidence entry`);
  } else {
    for (let i = 0; i < (cert.evidence as unknown[]).length; i++) {
      const ev = asRecord((cert.evidence as unknown[])[i]);
      if (!ev) {
        issues.push(`${path}:evidence[${i}] must be an object`);
        continue;
      }
      const source = asRecord(ev.source);
      if (!source) {
        issues.push(`${path}:evidence[${i}].source must be an object`);
        continue;
      }
      const sourceKind = source.kind;
      if (sourceKind === 'kyro-task-verdict') {
        const kyroSource = source as Partial<CertificationEvidenceKyroVerdictSource>;
        if (typeof kyroSource.scope !== 'string' || kyroSource.scope.length === 0) {
          issues.push(`${path}:evidence[${i}].source.scope must be a non-empty string`);
        }
        if (typeof kyroSource.taskId !== 'string' || kyroSource.taskId.length === 0) {
          issues.push(`${path}:evidence[${i}].source.taskId must be a non-empty string`);
        }
        if (typeof kyroSource.verdictDigest !== 'string' || !/^[a-f0-9]{64}$/.test(kyroSource.verdictDigest ?? '')) {
          issues.push(`${path}:evidence[${i}].source.verdictDigest must be a SHA-256 hex digest`);
        }
      } else if (sourceKind === 'external-artifact') {
        const extSource = source as Partial<CertificationEvidenceExternalArtifactSource>;
        if (typeof extSource.path !== 'string' || extSource.path.length === 0) {
          issues.push(`${path}:evidence[${i}].source.path must be a non-empty string`);
        }
        if (typeof extSource.contentDigest !== 'string' || !/^[a-f0-9]{64}$/.test(extSource.contentDigest ?? '')) {
          issues.push(`${path}:evidence[${i}].source.contentDigest must be a SHA-256 hex digest`);
        }
      } else {
        issues.push(`${path}:evidence[${i}].source.kind must be 'kyro-task-verdict' or 'external-artifact', got ${String(sourceKind)}`);
      }
      if (typeof ev.chainHeadCommitment !== 'string' || !/^[a-f0-9]{64}$/.test(ev.chainHeadCommitment ?? '')) {
        issues.push(`${path}:evidence[${i}].chainHeadCommitment must be a SHA-256 hex digest`);
      }
    }
  }

  // Verdict (T2.3, AC1)
  const verdict = asRecord(cert.verdict);
  if (!verdict) {
    issues.push(`${path}:verdict must be an object`);
  } else {
    if (typeof verdict.checker !== 'string' || (verdict.checker as string).length === 0) {
      issues.push(`${path}:verdict.checker must be a non-empty string`);
    }
    if (!['pass', 'fail', 'inconclusive'].includes(verdict.outcome as string)) {
      issues.push(`${path}:verdict.outcome must be 'pass', 'fail', or 'inconclusive'`);
    }
    if (typeof verdict.recordedAt === 'string' && Number.isNaN(Date.parse(verdict.recordedAt))) {
      issues.push(`${path}:verdict.recordedAt must be an ISO-compatible timestamp`);
    }
  }

  // Provenance
  const provenance = asRecord(cert.provenance);
  if (!provenance) {
    issues.push(`${path}:provenance must be an object`);
  } else {
    if (typeof provenance.actor !== 'string' || (provenance.actor as string).length === 0) {
      issues.push(`${path}:provenance.actor must be a non-empty string`);
    }
    if (typeof provenance.reason !== 'string' || (provenance.reason as string).length === 0) {
      issues.push(`${path}:provenance.reason must be a non-empty string`);
    }
  }

  // No unknown fields (T2.3, AC1)
  const allowedKeys = new Set([
    'schemaVersion',
    'kind',
    'certificationId',
    'identity',
    'certifiedChainHeadCommitment',
    'certifiedStateDigest',
    'evidence',
    'verdict',
    'provenance',
    'createdAt',
  ]);
  for (const key of Object.keys(cert)) {
    if (!allowedKeys.has(key)) {
      issues.push(`${path}:${key} is not a recognized field`);
    }
  }

  // Nested objects fail closed too: a payload smuggled into identity/verdict/provenance would
  // otherwise ride along inside the commitment without ever being validated.
  const rejectUnknown = (record: Record<string, unknown> | null, field: string, allowed: string[]): void => {
    if (!record) return;
    const permitted = new Set(allowed);
    for (const key of Object.keys(record)) {
      if (!permitted.has(key)) issues.push(`${path}:${field}.${key} is not a recognized field`);
    }
  };
  rejectUnknown(identity, 'identity', ['scope']);
  rejectUnknown(verdict, 'verdict', ['checker', 'outcome', 'recordedAt']);
  rejectUnknown(provenance, 'provenance', ['actor', 'reason']);

  return issues;
}

/** Validate that a certification record matches expected commitment in an anchor. */
export function validateCertificationCommitment(cert: ScopeRecertificationV1, expectedCommitment: string, path: string): string[] {
  const issues: string[] = [];
  const calculated = certificationCommitment(cert);
  if (calculated !== expectedCommitment) {
    issues.push(`${path}:certificate commitment mismatch (calculated ${calculated}, expected ${expectedCommitment})`);
  }
  return issues;
}
