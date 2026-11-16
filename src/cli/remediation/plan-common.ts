import { existsSync } from 'node:fs';
import { resolveManagedPath } from '../fs';
import { archiveDir, scopeRoot } from '../artifacts/paths';
import type { ValidationIssue } from '../artifacts/schema';
import { sha256 } from '../checkpoints/sprint-close';
import type { RemediationAnchor, SprintFile } from '../types';
import { canonicalRemediationState } from './canonical-state';
import type { RemediationOperation } from './protocol';

export const REMEDIATION_TRANSACTION_STATUS = {
  /** No record and no anchor on disk — the plan has never been applied. */
  NOT_APPLIED: 'NOT_APPLIED',
  /** The immutable record exists but the live anchor does not: persistence was interrupted. */
  PREPARED: 'PREPARED',
  /** Record, anchor, commitment and live result digest all agree. */
  APPLIED: 'APPLIED',
  /** Record and anchor exist but disagree with each other or with live state. */
  DIVERGED: 'DIVERGED',
  /** The record is unreadable or fails the remediation contract. */
  CORRUPT: 'CORRUPT',
  /** The record declares a schema version this runtime cannot evaluate. */
  UNSUPPORTED_VERSION: 'UNSUPPORTED_VERSION',
} as const;
export type RemediationTransactionStatus =
  (typeof REMEDIATION_TRANSACTION_STATUS)[keyof typeof REMEDIATION_TRANSACTION_STATUS];

/** Only APPLIED is a remediation. PREPARED is an interrupted write, never a success. */
export function isAppliedRemediationStatus(status: RemediationTransactionStatus): boolean {
  return status === REMEDIATION_TRANSACTION_STATUS.APPLIED;
}

export interface RemediationChange {
  operationId: string;
  kind: RemediationOperation['kind'];
  target: string;
  from: unknown;
  to: unknown;
}

// --- helpers ----------------------------------------------------------------------------------

/**
 * Business-state digest. Accepts the raw record because the pre-remediation state does not satisfy
 * the SprintFile contract yet; the projection excludes remediations[] either way.
 */
export function stateDigest(state: Record<string, unknown>): string {
  return sha256(canonicalRemediationState(state as unknown as SprintFile));
}

export function remediationsDir(scope: string): string {
  return `${archiveDir(scope)}/remediations`;
}

export function remediationRecordPath(scope: string, remediationId: string): string {
  return `${scopeRoot(scope)}/${relativeRecordPath(remediationId)}`;
}

export function relativeRecordPath(remediationId: string): string {
  return `archive/remediations/remediation-${remediationId.replace(/^R-/, '')}.json`;
}

export const REMEDIATION_ID_PATTERN = /^R-\d{3,}$/;

/** Ids are sequential and gap-free so the chain order is readable without parsing every record. */
export function nextRemediationId(anchors: RemediationAnchor[]): string {
  return `R-${String(anchors.length + 1).padStart(3, '0')}`;
}

export function remediationRecordExists(scope: string, remediationId: string): boolean {
  return existsSync(resolveManagedPath(remediationRecordPath(scope, remediationId)));
}

export function formatIssues(issues: ValidationIssue[]): string {
  return issues.map((issue) => `${issue.path}:${issue.field} ${issue.message}`).join('; ');
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}
