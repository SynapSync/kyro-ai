/**
 * Pure planner for record-level debt canonicalization (R3, R4).
 *
 * It turns an observed legacy debt plus explicit operator decisions into either a complete,
 * reviewable `debt.canonicalize` operation or a list of what is still undecided. It never writes,
 * never reads the filesystem, and never adopts a suggestion on the operator's behalf.
 *
 * This module deliberately imports no `node:fs`, no path helper and no state reader: "the planner
 * cannot write" is then a structural fact about its dependency graph rather than a claim about its
 * body (convention explicit-operator-authority, ADR-0004).
 *
 * The separation it enforces:
 *
 * - **observed**  — id, title, status and any already-valid canonical value. Facts. Carried through
 *                   unchanged; canonicalization repairs a record's shape, it never edits its content.
 * - **evidence**  — a value the observed record supports, such as `addedSprint` for a broken origin,
 *                   or the note a compatibility reader would compose from legacy prose. Suggestions.
 *                   Offered, never applied.
 * - **decision**  — an explicit operator value. The only thing that can resolve an unresolved field.
 */
import { DEBT_CLASSIFICATION, assessRawDebt } from '../artifacts/debt-contract';
import {
  CANONICAL_DEBT_AFTER_KEYS,
  type CanonicalDebtAfterImage,
  type CanonicalizeDebtOperation,
  type RemediationIssue,
} from './protocol';

export const CANONICALIZE_PLAN_STATUS = {
  /** Every canonical value is settled: the operation is complete and reviewable. */
  READY: 'READY',
  /** At least one canonical value is neither observed-valid nor operator-supplied. */
  INPUT_REQUIRED: 'INPUT_REQUIRED',
  /** This debt cannot be canonicalized by this operation at all. */
  NOT_APPLICABLE: 'NOT_APPLICABLE',
} as const;
export type CanonicalizePlanStatus = (typeof CANONICALIZE_PLAN_STATUS)[keyof typeof CANONICALIZE_PLAN_STATUS];

/** Why a field still needs a human. */
export const CANONICALIZE_DECISION_REASON = {
  /** The observed value is absent. */
  ABSENT: 'ABSENT',
  /** The observed value is present but not a valid canonical value. */
  INVALID: 'INVALID',
  /** The operator supplied a value that is itself not a valid canonical value. */
  REJECTED: 'REJECTED',
  /** The operator supplied a value for a field that is already canonical. */
  NOT_NEGOTIABLE: 'NOT_NEGOTIABLE',
} as const;
export type CanonicalizeDecisionReason =
  (typeof CANONICALIZE_DECISION_REASON)[keyof typeof CANONICALIZE_DECISION_REASON];

export interface UnresolvedDecision {
  /** Canonical field path, e.g. `debt[0].priority`. */
  readonly path: string;
  readonly field: string;
  readonly reason: CanonicalizeDecisionReason;
  /** What the record actually holds today, if anything. */
  readonly observed: unknown;
  /** What the observed record supports, in words. Never an authorization. */
  readonly evidence: string | null;
  /** A value the evidence supports. Still requires an explicit decision to take effect. */
  readonly suggested: string | number | null;
  readonly detail: string;
}

/** How each canonical field of the after-image was settled. Preparation output is auditable. */
export interface ResolvedField {
  readonly field: string;
  readonly source: 'observed' | 'decision';
  readonly value: unknown;
  readonly evidence: string | null;
}

export interface CanonicalizeDecisions {
  readonly origin?: unknown;
  readonly priority?: unknown;
  readonly targetSprint?: unknown;
  readonly note?: unknown;
}

export interface CanonicalizePlanInput {
  /** The complete observed `debt[]` collection, exactly as read. */
  readonly debt: readonly unknown[];
  readonly debtId: string;
  readonly decisions?: CanonicalizeDecisions;
  readonly reason?: string;
  readonly operationId?: string;
  readonly issueIdPrefix?: string;
  /** Injected so the planner owns no hashing dependency. */
  readonly digest: (value: unknown) => string;
  readonly collectionDigest: (debt: readonly unknown[]) => string;
}

interface PlanCommon {
  readonly debtId: string;
  readonly classification: string | null;
  readonly resolved: readonly ResolvedField[];
  readonly unresolved: readonly UnresolvedDecision[];
  readonly retiredKeys: readonly string[];
}

export type CanonicalizePlan =
  | (PlanCommon & {
      readonly status: typeof CANONICALIZE_PLAN_STATUS.READY;
      readonly operation: CanonicalizeDebtOperation;
      readonly issues: readonly RemediationIssue[];
      readonly debtCollectionSha256: string;
      readonly detail: null;
    })
  | (PlanCommon & {
      readonly status: typeof CANONICALIZE_PLAN_STATUS.INPUT_REQUIRED;
      readonly operation: null;
      readonly issues: readonly RemediationIssue[];
      readonly debtCollectionSha256: string;
      readonly detail: string;
    })
  | (PlanCommon & {
      readonly status: typeof CANONICALIZE_PLAN_STATUS.NOT_APPLICABLE;
      readonly operation: null;
      readonly issues: readonly [];
      readonly debtCollectionSha256: string | null;
      readonly detail: string;
    });

const DEBT_PRIORITIES = ['critical', 'high', 'medium', 'low'] as const;
/** Fields the operator may decide. id, title and status are observed facts and are never decided. */
const DECIDABLE_FIELDS = ['origin', 'priority', 'targetSprint', 'note'] as const;
type DecidableField = (typeof DECIDABLE_FIELDS)[number];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isSprintNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1;

/** Whether an already-present value is a valid canonical value for its field. */
function isValidCanonicalValue(field: DecidableField, value: unknown): boolean {
  switch (field) {
    case 'origin':
      return isSprintNumber(value);
    case 'priority':
      return typeof value === 'string' && (DEBT_PRIORITIES as readonly string[]).includes(value);
    case 'targetSprint':
      return value === null || isSprintNumber(value);
    case 'note':
      return typeof value === 'string' && value.length > 0;
  }
}

/**
 * What the observed record supports for a field it cannot supply itself. Evidence is descriptive:
 * it says what was seen and what that would imply, and stops there.
 */
function evidenceFor(field: DecidableField, observed: Record<string, unknown>): { evidence: string | null; suggested: string | number | null } {
  if (field === 'origin' && isSprintNumber(observed.addedSprint)) {
    return { evidence: `addedSprint=${observed.addedSprint}`, suggested: observed.addedSprint };
  }
  if (field === 'note') {
    const parts: string[] = [];
    if (typeof observed.note === 'string' && observed.note.length > 0) parts.push(observed.note);
    for (const [key, prefix] of [['source', 'Source'], ['resolution', 'Resolution'], ['disposition', 'Disposition']] as const) {
      const value = observed[key];
      if (typeof value === 'string' && value.length > 0) parts.push(`${prefix}: ${value}`);
    }
    if (parts.length > 0) {
      return { evidence: 'composed from the legacy prose keys a compatibility reader would join', suggested: parts.join('; ') };
    }
  }
  // priority and targetSprint are business decisions: no observation implies them (ADR-0004).
  return { evidence: null, suggested: null };
}

function notApplicable(debtId: string, detail: string, classification: string | null, collectionSha: string | null): CanonicalizePlan {
  return {
    status: CANONICALIZE_PLAN_STATUS.NOT_APPLICABLE,
    debtId,
    classification,
    resolved: [],
    unresolved: [],
    retiredKeys: [],
    operation: null,
    issues: [],
    debtCollectionSha256: collectionSha,
    detail,
  };
}

/**
 * Plan the canonicalization of one debt record. Total over malformed input: any shape yields a
 * plan object, never a throw.
 */
export function planDebtCanonicalization(input: CanonicalizePlanInput): CanonicalizePlan {
  const debt = Array.isArray(input.debt) ? input.debt : [];
  const collectionSha = input.collectionDigest(debt);
  const index = debt.findIndex((entry) => isRecord(entry) && entry.id === input.debtId);
  if (index < 0) {
    return notApplicable(input.debtId, `No debt with id "${input.debtId}" exists in the observed collection.`, null, collectionSha);
  }
  const observed = debt[index] as Record<string, unknown>;
  const path = `debt[${index}]`;

  const assessment = assessRawDebt(observed);
  if (assessment.classification === DEBT_CLASSIFICATION.UNSUPPORTED) {
    return notApplicable(
      input.debtId,
      `Debt "${input.debtId}" is structurally unsupported: its identity or status cannot be read, so there is nothing to preserve and canonicalization cannot describe it.`,
      assessment.classification,
      collectionSha,
    );
  }
  if (assessment.classification === DEBT_CLASSIFICATION.CANONICAL) {
    return notApplicable(
      input.debtId,
      `Debt "${input.debtId}" is already canonical. Use the normal debt commands for content changes.`,
      assessment.classification,
      collectionSha,
    );
  }

  const decisions = (input.decisions ?? {}) as Record<string, unknown>;
  const resolved: ResolvedField[] = [
    // Identity and lifecycle come from the record itself, always.
    { field: 'id', source: 'observed', value: observed.id, evidence: null },
    { field: 'title', source: 'observed', value: observed.title, evidence: null },
    { field: 'status', source: 'observed', value: observed.status, evidence: null },
  ];
  const unresolved: UnresolvedDecision[] = [];
  const values: Record<string, unknown> = { id: observed.id, title: observed.title, status: observed.status };

  for (const field of DECIDABLE_FIELDS) {
    const present = field in observed;
    const observedValue = present ? observed[field] : undefined;
    const observedIsValid = present && isValidCanonicalValue(field, observedValue);
    const supplied = field in decisions;
    const { evidence, suggested } = evidenceFor(field, observed);

    if (observedIsValid) {
      // Already canonical. A decision here would be a content edit wearing a repair's clothes.
      if (supplied && decisions[field] !== observedValue) {
        unresolved.push({
          path: `${path}.${field}`,
          field,
          reason: CANONICALIZE_DECISION_REASON.NOT_NEGOTIABLE,
          observed: observedValue,
          evidence: null,
          suggested: null,
          detail: `${field} is already canonical; canonicalization preserves it. Change it with the normal debt commands instead.`,
        });
        continue;
      }
      resolved.push({ field, source: 'observed', value: observedValue, evidence: null });
      values[field] = observedValue;
      continue;
    }

    if (!supplied) {
      unresolved.push({
        path: `${path}.${field}`,
        field,
        reason: present ? CANONICALIZE_DECISION_REASON.INVALID : CANONICALIZE_DECISION_REASON.ABSENT,
        observed: present ? observedValue : null,
        evidence,
        suggested,
        detail: present
          ? `${field} is present but is not a valid canonical value; supply an explicit value.`
          : `${field} is absent; supply an explicit value.${evidence === null ? ' No observation implies it.' : ''}`,
      });
      continue;
    }

    const decided = decisions[field];
    if (!isValidCanonicalValue(field, decided)) {
      unresolved.push({
        path: `${path}.${field}`,
        field,
        reason: CANONICALIZE_DECISION_REASON.REJECTED,
        observed: present ? observedValue : null,
        evidence,
        suggested,
        detail: `the supplied ${field} is not a valid canonical value.`,
      });
      continue;
    }
    resolved.push({ field, source: 'decision', value: decided, evidence });
    values[field] = decided;
  }

  // Legacy-only keys are retired in the *proposed* after-image and nowhere else: the observed record
  // is untouched, and history keeps its own copy.
  const retiredKeys = Object.keys(observed).filter((key) => !(CANONICAL_DEBT_AFTER_KEYS as readonly string[]).includes(key));

  const issues: RemediationIssue[] = assessment.diagnostics
    .filter((diagnostic) => diagnostic.severity === 'blocking' || diagnostic.code === 'MISSING_CANONICAL_FIELD')
    .map((diagnostic, position) => ({
      id: `${input.issueIdPrefix ?? 'I'}-${position + 1}`,
      code: diagnostic.code,
      path: `${path}.${diagnostic.field}`,
      observedValueSha256: input.digest(diagnostic.field in observed ? observed[diagnostic.field] : null),
    }));

  if (unresolved.length > 0) {
    return {
      status: CANONICALIZE_PLAN_STATUS.INPUT_REQUIRED,
      debtId: input.debtId,
      classification: assessment.classification,
      resolved,
      unresolved,
      retiredKeys,
      operation: null,
      issues,
      debtCollectionSha256: collectionSha,
      detail: `${unresolved.length} canonical value(s) still need an explicit operator decision.`,
    };
  }

  const after: CanonicalDebtAfterImage = {
    id: values.id as string,
    title: values.title as string,
    origin: values.origin as number,
    priority: values.priority as CanonicalDebtAfterImage['priority'],
    status: values.status as CanonicalDebtAfterImage['status'],
    targetSprint: values.targetSprint as number | null,
    note: values.note as string,
  };

  const operation: CanonicalizeDebtOperation = {
    id: input.operationId ?? 'O-1',
    kind: 'debt.canonicalize',
    resolves: issues.map((issue) => issue.id),
    debtId: input.debtId,
    expectedDebtCollectionSha256: collectionSha,
    after,
    retiredKeys,
    reason: input.reason ?? `Canonicalize legacy debt ${input.debtId} into the exact seven-key contract.`,
  };

  return {
    status: CANONICALIZE_PLAN_STATUS.READY,
    debtId: input.debtId,
    classification: assessment.classification,
    resolved,
    unresolved: [],
    retiredKeys,
    operation,
    issues,
    debtCollectionSha256: collectionSha,
    detail: null,
  };
}
