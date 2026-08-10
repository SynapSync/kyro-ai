/**
 * Raw debt input contract (ADR-0001).
 *
 * Compatibility is not canonicality. `Debt` is the exact seven-field *output* every writer must
 * emit; this module is the *input* reader that says what an observed raw entry actually is:
 *
 * - `canonical`            — exactly the seven canonical keys, every value valid.
 * - `legacy_compatible`    — every present value is valid, but canonical fields may be absent and
 *                            legacy-only keys may be present, so one explicit projection is
 *                            derivable with the same defaults Kyro Lens applies.
 * - `remediation_required` — identity and status are readable, but a *present* canonical value has
 *                            the wrong type. Nothing may be projected: the record needs an
 *                            operator-authorized canonicalization.
 * - `unsupported`          — the entry is not a debt object, or its id, title or status is unusable.
 *
 * The assessment is pure and total: it consumes `unknown`, never throws, never mutates its input,
 * and never fabricates a projection it cannot justify. Suggestions carry their evidence and are
 * never authorization (ADR-0004): fields that are business judgments are reported with
 * `authority: 'operator'` and no suggested value, whatever default a renderer would show.
 *
 * The behaviour frozen here is the shared Kyro/Lens vector set in `fixtures/debt-contract/golden.json`
 * (convention `shared-debt-vectors`); change one and you must change the other.
 */
import { DEBT_PRIORITY_VALUES, DEBT_STATUS_VALUES } from './schema';
import type { Debt, DebtStatus } from '../types';

/** The exact canonical debt output key set, in canonical order. */
export const CANONICAL_DEBT_KEYS = ['id', 'title', 'origin', 'priority', 'status', 'targetSprint', 'note'] as const;

/** Keys that legacy writers produced and the canonical projection retires. */
export const LEGACY_DEBT_KEYS = ['detail', 'resolution', 'addedSprint', 'severity', 'source', 'disposition'] as const;

export const DEBT_CLASSIFICATION = {
  CANONICAL: 'canonical',
  LEGACY_COMPATIBLE: 'legacy_compatible',
  REMEDIATION_REQUIRED: 'remediation_required',
  UNSUPPORTED: 'unsupported',
} as const;

export type DebtClassification = (typeof DEBT_CLASSIFICATION)[keyof typeof DEBT_CLASSIFICATION];

export const DEBT_DIAGNOSTIC_CODE = {
  NOT_AN_OBJECT: 'NOT_AN_OBJECT',
  IDENTITY_NOT_STRING: 'IDENTITY_NOT_STRING',
  STATUS_NOT_RECOGNIZED: 'STATUS_NOT_RECOGNIZED',
  ORIGIN_NOT_SPRINT_NUMBER: 'ORIGIN_NOT_SPRINT_NUMBER',
  PRIORITY_NOT_RECOGNIZED: 'PRIORITY_NOT_RECOGNIZED',
  TARGET_SPRINT_NOT_NUMBER: 'TARGET_SPRINT_NOT_NUMBER',
  NOTE_NOT_STRING: 'NOTE_NOT_STRING',
  MISSING_CANONICAL_FIELD: 'MISSING_CANONICAL_FIELD',
  LEGACY_KEY_PRESENT: 'LEGACY_KEY_PRESENT',
  LEGACY_VALUE_NOT_STRING: 'LEGACY_VALUE_NOT_STRING',
  SEVERITY_NOT_RECOGNIZED: 'SEVERITY_NOT_RECOGNIZED',
  UNKNOWN_KEY_PRESENT: 'UNKNOWN_KEY_PRESENT',
} as const;

export type DebtDiagnosticCode = (typeof DEBT_DIAGNOSTIC_CODE)[keyof typeof DEBT_DIAGNOSTIC_CODE];

/** `blocking` withholds the projection; `info` only records what the projection had to decide. */
export type DebtDiagnosticSeverity = 'info' | 'blocking';

/**
 * Who may fix the field. `derived` is mechanical, `evidence` is a suggestion backed by an observed
 * value, and `operator` is a business judgment that canonicalization must be told explicitly.
 */
export type DebtDiagnosticAuthority = 'derived' | 'evidence' | 'operator';

export interface DebtDiagnostic {
  /** Stable field path: a canonical or legacy key, or `$root` for the whole entry. */
  readonly field: string;
  readonly code: DebtDiagnosticCode;
  readonly severity: DebtDiagnosticSeverity;
  readonly authority: DebtDiagnosticAuthority;
  /** What was observed, when something was. */
  readonly evidence: string | null;
  /** Never authorization — only a value the evidence supports. */
  readonly suggested: string | number | null;
  /** What a compatibility reader renders when the field is absent. */
  readonly lensDefault: string | number | null;
}

interface AssessmentShape<C extends DebtClassification, P extends Debt | null> {
  readonly classification: C;
  /** The exact seven-field projection, or `null` when none may be trusted. */
  readonly canonical: P;
  /** Legacy-only keys observed on the raw entry, in canonical legacy order. */
  readonly legacyKeys: readonly string[];
  readonly diagnostics: readonly DebtDiagnostic[];
}

export type DebtAssessment =
  | AssessmentShape<typeof DEBT_CLASSIFICATION.CANONICAL, Debt>
  | AssessmentShape<typeof DEBT_CLASSIFICATION.LEGACY_COMPATIBLE, Debt>
  | AssessmentShape<typeof DEBT_CLASSIFICATION.REMEDIATION_REQUIRED, null>
  | AssessmentShape<typeof DEBT_CLASSIFICATION.UNSUPPORTED, null>;

export interface DebtAssessmentOptions {
  /** The enclosing sprint number, used only as the compatibility default for an absent origin. */
  readonly sprintNumber?: number | null;
}

type DebtPriority = Debt['priority'];

/** Legacy severity vocabulary, mapped exactly as the compatibility reader maps it. */
const SEVERITY_TO_PRIORITY: Readonly<Record<string, DebtPriority>> = {
  critical: 'critical',
  high: 'high',
  medium: 'medium',
  low: 'low',
  blocker: 'critical',
  major: 'high',
  minor: 'low',
};

const DEFAULT_PRIORITY: DebtPriority = 'medium';
const NOTE_SOURCES = [
  { key: 'source', prefix: 'Source' },
  { key: 'resolution', prefix: 'Resolution' },
  { key: 'disposition', prefix: 'Disposition' },
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isPriority = (value: unknown): value is DebtPriority =>
  typeof value === 'string' && (DEBT_PRIORITY_VALUES as readonly string[]).includes(value);
const isStatus = (value: unknown): value is DebtStatus =>
  typeof value === 'string' && (DEBT_STATUS_VALUES as readonly string[]).includes(value);

function describeType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function diagnostic(
  field: string,
  code: DebtDiagnosticCode,
  severity: DebtDiagnosticSeverity,
  authority: DebtDiagnosticAuthority,
  evidence: string | null,
  suggested: string | number | null,
  lensDefault: string | number | null,
): DebtDiagnostic {
  return { field, code, severity, authority, evidence, suggested, lensDefault };
}

function unsupported(diagnostics: readonly DebtDiagnostic[]): DebtAssessment {
  return { classification: DEBT_CLASSIFICATION.UNSUPPORTED, canonical: null, legacyKeys: [], diagnostics };
}

/** The note a compatibility reader composes from the note plus the legacy prose keys. */
function composeNote(raw: Record<string, unknown>): { note: string; composedFrom: readonly string[] } {
  const parts: string[] = [];
  const composedFrom: string[] = [];
  if (typeof raw.note === 'string' && raw.note.length > 0) parts.push(raw.note);
  for (const { key, prefix } of NOTE_SOURCES) {
    const value = raw[key];
    if (typeof value === 'string' && value.length > 0) {
      parts.push(`${prefix}: ${value}`);
      composedFrom.push(key);
    }
  }
  return { note: parts.join('; '), composedFrom };
}

/**
 * Classify one raw debt entry and, when it is safely readable, project it onto the exact
 * seven-field canonical shape. Total: any input, including `undefined`, yields an assessment.
 */
export function assessRawDebt(raw: unknown, options: DebtAssessmentOptions = {}): DebtAssessment {
  if (!isRecord(raw)) {
    return unsupported([
      diagnostic(
        '$root',
        DEBT_DIAGNOSTIC_CODE.NOT_AN_OBJECT,
        'blocking',
        'derived',
        `raw debt entry is a ${describeType(raw)}, not an object { id, title, ... }`,
        null,
        null,
      ),
    ]);
  }

  // Identity and status can be neither defaulted nor repaired: without them nothing else is trustworthy.
  const identityIssues: DebtDiagnostic[] = [];
  for (const field of ['id', 'title'] as const) {
    if (typeof raw[field] !== 'string' || raw[field] === '') {
      identityIssues.push(
        diagnostic(
          field,
          DEBT_DIAGNOSTIC_CODE.IDENTITY_NOT_STRING,
          'blocking',
          'derived',
          'identity cannot be defaulted or inferred',
          null,
          null,
        ),
      );
    }
  }
  if (identityIssues.length > 0) return unsupported(identityIssues);

  if (!isStatus(raw.status)) {
    return unsupported([
      diagnostic(
        'status',
        DEBT_DIAGNOSTIC_CODE.STATUS_NOT_RECOGNIZED,
        'blocking',
        'derived',
        'status must be open, in_progress, resolved or deferred',
        null,
        null,
      ),
    ]);
  }

  const id = raw.id as string;
  const title = raw.title as string;
  const status: DebtStatus = raw.status;

  const legacyKeys = LEGACY_DEBT_KEYS.filter((key) => key in raw);
  const unknownKeys = Object.keys(raw).filter(
    (key) => !(CANONICAL_DEBT_KEYS as readonly string[]).includes(key) && !(LEGACY_DEBT_KEYS as readonly string[]).includes(key),
  );
  const addedSprint = isFiniteNumber(raw.addedSprint) ? raw.addedSprint : null;
  const legacySeverity = typeof raw.severity === 'string' ? SEVERITY_TO_PRIORITY[raw.severity.toLowerCase()] : undefined;
  const { note: composedNote, composedFrom } = composeNote(raw);

  const blocking: DebtDiagnostic[] = [];
  const info: DebtDiagnostic[] = [];

  // A present value of the wrong type is never guessed away — it is exactly what needs authority.
  if ('origin' in raw && !isFiniteNumber(raw.origin)) {
    blocking.push(
      addedSprint === null
        ? diagnostic('origin', DEBT_DIAGNOSTIC_CODE.ORIGIN_NOT_SPRINT_NUMBER, 'blocking', 'derived', `origin is a ${describeType(raw.origin)}, not a sprint number`, null, null)
        : diagnostic('origin', DEBT_DIAGNOSTIC_CODE.ORIGIN_NOT_SPRINT_NUMBER, 'blocking', 'evidence', `addedSprint=${addedSprint}`, addedSprint, null),
    );
  }
  if ('priority' in raw && !isPriority(raw.priority)) {
    blocking.push(
      diagnostic('priority', DEBT_DIAGNOSTIC_CODE.PRIORITY_NOT_RECOGNIZED, 'blocking', 'operator', `priority is ${describeType(raw.priority)}, not critical, high, medium or low`, null, null),
    );
  }
  if ('targetSprint' in raw && raw.targetSprint !== null && !isFiniteNumber(raw.targetSprint)) {
    blocking.push(
      diagnostic('targetSprint', DEBT_DIAGNOSTIC_CODE.TARGET_SPRINT_NOT_NUMBER, 'blocking', 'operator', `targetSprint is a ${describeType(raw.targetSprint)}, not a sprint number or null`, null, null),
    );
  }
  if ('note' in raw && typeof raw.note !== 'string') {
    blocking.push(
      diagnostic('note', DEBT_DIAGNOSTIC_CODE.NOTE_NOT_STRING, 'blocking', 'derived', `note is a ${describeType(raw.note)}, not a string`, null, null),
    );
  }

  // Legacy keys are not free-form: the ones a compatibility reader interprets carry their own type
  // and vocabulary constraints, and a reader that cannot load the record must not be contradicted by
  // a classifier that calls it merely legacy-compatible (R1).
  for (const { key } of NOTE_SOURCES) {
    if (key in raw && typeof raw[key] !== 'string') {
      blocking.push(
        diagnostic(key, DEBT_DIAGNOSTIC_CODE.LEGACY_VALUE_NOT_STRING, 'blocking', 'derived', `${key} is a ${describeType(raw[key])}, not a string`, null, null),
      );
    }
  }
  if ('severity' in raw) {
    if (typeof raw.severity !== 'string') {
      blocking.push(
        diagnostic('severity', DEBT_DIAGNOSTIC_CODE.LEGACY_VALUE_NOT_STRING, 'blocking', 'derived', `severity is a ${describeType(raw.severity)}, not a string`, null, null),
      );
    } else if (legacySeverity === undefined && !('priority' in raw)) {
      // An unmapped severity only matters while it is the sole source of a priority: with an explicit
      // priority present, the compatibility reader ignores it, and so must the classification.
      blocking.push(
        diagnostic(
          'severity',
          DEBT_DIAGNOSTIC_CODE.SEVERITY_NOT_RECOGNIZED,
          'blocking',
          'operator',
          `severity "${raw.severity}" maps to no priority and no explicit priority is present`,
          null,
          null,
        ),
      );
    }
  }

  // An absent field is compatible, not broken: it is normalizable, but priority and target sprint
  // stay operator decisions however a renderer chooses to display them.
  if (!('origin' in raw)) {
    const fallback = isFiniteNumber(options.sprintNumber) ? options.sprintNumber : 0;
    info.push(
      addedSprint === null
        ? diagnostic('origin', DEBT_DIAGNOSTIC_CODE.MISSING_CANONICAL_FIELD, 'info', 'derived', 'defaulted to the enclosing sprint number', null, fallback)
        : diagnostic('origin', DEBT_DIAGNOSTIC_CODE.MISSING_CANONICAL_FIELD, 'info', 'evidence', `addedSprint=${addedSprint}`, addedSprint, fallback),
    );
  }
  if (!('priority' in raw)) {
    info.push(
      legacySeverity === undefined
        ? diagnostic('priority', DEBT_DIAGNOSTIC_CODE.MISSING_CANONICAL_FIELD, 'info', 'operator', null, null, DEFAULT_PRIORITY)
        : diagnostic('priority', DEBT_DIAGNOSTIC_CODE.MISSING_CANONICAL_FIELD, 'info', 'operator', `severity=${String(raw.severity)}`, null, legacySeverity),
    );
  }
  if (!('targetSprint' in raw)) {
    info.push(diagnostic('targetSprint', DEBT_DIAGNOSTIC_CODE.MISSING_CANONICAL_FIELD, 'info', 'operator', null, null, null));
  }
  if (!('note' in raw)) {
    info.push(
      composedFrom.length === 0
        ? diagnostic('note', DEBT_DIAGNOSTIC_CODE.MISSING_CANONICAL_FIELD, 'info', 'derived', 'no legacy note source is available', null, '')
        : diagnostic(
            'note',
            DEBT_DIAGNOSTIC_CODE.MISSING_CANONICAL_FIELD,
            'info',
            'derived',
            `composed from the legacy ${composedFrom.join(', ')} key${composedFrom.length > 1 ? 's' : ''}`,
            null,
            composedNote,
          ),
    );
  }

  const retired = blocking.length > 0;
  for (const key of legacyKeys) {
    info.push(
      diagnostic(
        key,
        DEBT_DIAGNOSTIC_CODE.LEGACY_KEY_PRESENT,
        'info',
        'derived',
        retired ? 'legacy-only key retired by canonicalization' : 'legacy-only key dropped by the canonical projection',
        null,
        null,
      ),
    );
  }
  for (const key of unknownKeys) {
    info.push(
      diagnostic(key, DEBT_DIAGNOSTIC_CODE.UNKNOWN_KEY_PRESENT, 'info', 'derived', 'key is not part of the canonical or legacy debt vocabulary', null, null),
    );
  }

  if (retired) {
    return {
      classification: DEBT_CLASSIFICATION.REMEDIATION_REQUIRED,
      canonical: null,
      legacyKeys,
      diagnostics: [...blocking, ...info],
    };
  }

  const canonical: Debt = {
    id,
    title,
    origin: isFiniteNumber(raw.origin) ? raw.origin : isFiniteNumber(options.sprintNumber) ? options.sprintNumber : 0,
    priority: isPriority(raw.priority) ? raw.priority : legacySeverity ?? DEFAULT_PRIORITY,
    status,
    targetSprint: isFiniteNumber(raw.targetSprint) ? raw.targetSprint : null,
    note: composedNote,
  };

  const exact = info.length === 0 && legacyKeys.length === 0 && unknownKeys.length === 0;
  return exact
    ? { classification: DEBT_CLASSIFICATION.CANONICAL, canonical, legacyKeys: [], diagnostics: [] }
    : { classification: DEBT_CLASSIFICATION.LEGACY_COMPATIBLE, canonical, legacyKeys, diagnostics: info };
}
