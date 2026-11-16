

export const KYRO_SCOPE_ENTRY_STATUS = {
  PLANNING: 'planning',
  ACTIVE: 'active',
  COMPLETED: 'completed',
  BLOCKED: 'blocked',
  RETIRED: 'retired',
} as const;

export type KyroScopeEntryStatus =
  (typeof KYRO_SCOPE_ENTRY_STATUS)[keyof typeof KYRO_SCOPE_ENTRY_STATUS];

/** Terminal explanation for unfinished work. Not a success status and not a checker verdict. */
export const TASK_DISPOSITION_KIND = {
  DEFERRED: 'deferred',
  BLOCKED: 'blocked',
  SUPERSEDED: 'superseded',
  CANCELLED: 'cancelled',
} as const;
export type TaskDispositionKind = (typeof TASK_DISPOSITION_KIND)[keyof typeof TASK_DISPOSITION_KIND];

export const TASK_DISPOSITION_TARGET_KIND = {
  DEBT: 'debt',
  TASK: 'task',
  SPRINT: 'sprint',
} as const;
export type TaskDispositionTargetKind =
  (typeof TASK_DISPOSITION_TARGET_KIND)[keyof typeof TASK_DISPOSITION_TARGET_KIND];
export const TASK_VERDICT_RESULT = {
  PASS: 'pass',
  FAIL: 'fail',
} as const;
export type TaskVerdictResult = (typeof TASK_VERDICT_RESULT)[keyof typeof TASK_VERDICT_RESULT];

export const TASK_VERDICT_FINDING_SEVERITY = {
  CRITICAL: 'critical',
  WARNING: 'warning',
  SUGGESTION: 'suggestion',
} as const;
export type TaskVerdictFindingSeverity = (typeof TASK_VERDICT_FINDING_SEVERITY)[keyof typeof TASK_VERDICT_FINDING_SEVERITY];

export const ADR_STATUS = {
  PROPOSED: 'proposed',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
  SUPERSEDED: 'superseded',
} as const;
export type AdrStatus = (typeof ADR_STATUS)[keyof typeof ADR_STATUS];

export const ADR_LINK_KEYS = {
  TASKS: 'tasks',
  DEBT: 'debt',
  CONVENTIONS: 'conventions',
  DOCS: 'docs',
  ADRS: 'adrs',
  SUPERSEDES: 'supersedes',
} as const;
export type AdrLinkKey = (typeof ADR_LINK_KEYS)[keyof typeof ADR_LINK_KEYS];

export const SPRINT_CLOSE_CHECKPOINT_KIND = 'kyro.sprint-close-checkpoint' as const;
export const SPRINT_CLOSE_CHECKPOINT_SCHEMA_VERSION = 1 as const;

export const SCOPE_RECERTIFICATION_KIND = 'kyro.scope-recertification' as const;
export const SCOPE_RECERTIFICATION_SCHEMA_VERSION = 1 as const;

export const SPRINT_CLOSE_OUTCOME = {
  SHIPPED: 'shipped',
  COMPLETED: 'completed',
  PARTIAL: 'partial',
  ABANDONED: 'abandoned',
  ABORTED: 'aborted',
} as const;
export type SprintCloseOutcome = (typeof SPRINT_CLOSE_OUTCOME)[keyof typeof SPRINT_CLOSE_OUTCOME];

export const SPRINT_CLOSE_TRANSACTION_STATUS = {
  PREPARED: 'PREPARED',
  PARTIAL: 'PARTIAL',
  APPLIED: 'APPLIED',
  CANONICALIZED: 'CANONICALIZED',
  DIVERGED: 'DIVERGED',
  CORRUPT: 'CORRUPT',
  UNSUPPORTED_VERSION: 'UNSUPPORTED_VERSION',
} as const;
export type SprintCloseTransactionStatus = (typeof SPRINT_CLOSE_TRANSACTION_STATUS)[keyof typeof SPRINT_CLOSE_TRANSACTION_STATUS];

export const SPEC_REQUIREMENT_PRIORITY = {
  MUST: 'must',
  SHOULD: 'should',
  COULD: 'could',
} as const;
export type SpecRequirementPriority = (typeof SPEC_REQUIREMENT_PRIORITY)[keyof typeof SPEC_REQUIREMENT_PRIORITY];
