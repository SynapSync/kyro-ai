import { SCOPE_RECERTIFICATION_SCHEMA_VERSION, SCOPE_RECERTIFICATION_KIND } from './vocabularies';

/**
 * Named verification vocabulary for a closed scope (T2.1, ADR-0002).
 *
 * A reader must be able to tell an audited correction from tampering without parsing prose, so
 * doctor and status both derive exactly one of these states from the checkpoint position plus the
 * replayed remediation chain. The WORST applicable state always wins:
 *
 *   diverged > unsupported > remediated > recertified > historical
 *
 * - `historical`: live business state equals the checkpoint after-image — nothing has drifted.
 * - `remediated`: live drift is explained by a valid, replayed remediation chain.
 * - `recertified`: remediated AND a valid certification exists for the current chain head.
 * - `diverged`: drift that no chain can reproduce, or an unreadable/contract-invalid record
 *   behind a well-formed anchor, or any digest/commitment/ordering mismatch.
 * - `unsupported`: a remediation or certification record declares an unknown schemaVersion.
 */
export type ScopeVerificationState =
  | 'historical'
  | 'remediated'
  | 'recertified'
  | 'diverged'
  | 'unsupported';

/** One named scope verification state plus the specific reason it applies (ADR-0002). */
export interface ScopeVerification {
  state: ScopeVerificationState;
  detail: string;
}

/**
 * Live anchor to an immutable remediation record under `archive/remediations/`. It stores only the
 * commitment — never a duplicate state image — so the corrected live state stays the single
 * canonical copy while the correction remains independently verifiable.
 */
export interface RemediationAnchor {
  /** Remediation id, e.g. R-001. */
  id: string;
  /** Scope-relative path to the immutable record. */
  path: string;
  /** SHA-256 commitment to the remediation record payload. */
  commitment: string;
}

/**
 * Live anchor to an immutable certification record under `archive/certifications/`. Mirrors
 * RemediationAnchor structure: stores only the commitment so the certified chain head remains
 * independently verifiable.
 */
export interface CertificationAnchor {
  /** Certification id, e.g. C-001. */
  id: string;
  /** Scope-relative path to the immutable record. */
  path: string;
  /** SHA-256 commitment to the certification record payload. */
  commitment: string;
}

/** Evidence source: a Kyro task verdict (re-read and re-verified from sprint.json). */
export interface CertificationEvidenceKyroVerdictSource {
  kind: 'kyro-task-verdict';
  /** Scope id where the task was run. */
  scope: string;
  /** Task id, e.g. T2.1. */
  taskId: string;
  /** SHA-256 of the verdict object as recorded in sprint.json. */
  verdictDigest: string;
}

/** Evidence source: an external artifact file (re-hashed at verification time). */
export interface CertificationEvidenceExternalArtifactSource {
  kind: 'external-artifact';
  /** Workspace-relative path to the artifact. */
  path: string;
  /** SHA-256 of the artifact content. */
  contentDigest: string;
}

export type CertificationEvidenceSource =
  | CertificationEvidenceKyroVerdictSource
  | CertificationEvidenceExternalArtifactSource;

/**
 * One piece of evidence cited to support a certification. Evidence is verifiable at cert-time:
 * each entry's digest must reproduce from the workspace and chain head must match current.
 */
export interface CertificationEvidence {
  source: CertificationEvidenceSource;
  /** The remediation/certification chain head commitment this evidence was produced against. */
  chainHeadCommitment: string;
}

/** Typed checker verdict: who ran it, when, what was the outcome. */
export interface CertificationVerdict {
  /** Checker identity, e.g. npm run check:cli-verbs. */
  checker: string;
  /** Outcome: pass, fail, inconclusive. */
  outcome: 'pass' | 'fail' | 'inconclusive';
  /** ISO-8601 timestamp when verdict was recorded. */
  recordedAt: string;
}

/** Immutable scope-relative provenance: who requested this certification and why. */
export interface CertificationProvenance {
  /** Actor identity, e.g. kyro-ai-cli or a person's email. */
  actor: string;
  /** Reason for the certification request, free-text. */
  reason: string;
}

/**
 * Versioned scope recertification record (v1). An immutable, audit-trail entry proving that
 * a remediated scope's live state has been validated against explicit evidence.
 * Bound to one chain head commitment so remediating again drops the certificate.
 */
export interface ScopeRecertificationV1 {
  schemaVersion: typeof SCOPE_RECERTIFICATION_SCHEMA_VERSION;
  kind: typeof SCOPE_RECERTIFICATION_KIND;
  /** Certification id, e.g. C-001. */
  certificationId: string;
  /** Identity of the scope this certification covers. */
  identity: {
    scope: string;
  };
  /** The remediation chain head commitment this certification binds to. */
  certifiedChainHeadCommitment: string;
  /** Business state digest (remediations[] and certifications[] excluded), the authoritative corrected state. */
  certifiedStateDigest: string;
  /** Named validation evidence sources (Kyro verdicts and external artifacts). */
  evidence: CertificationEvidence[];
  /** The checker verdict that justified this certification. */
  verdict: CertificationVerdict;
  /** Provenance: who requested this and why. */
  provenance: CertificationProvenance;
  /** ISO-8601 timestamp when this certification was created. */
  createdAt: string;
}
