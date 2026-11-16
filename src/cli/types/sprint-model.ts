import type {
  TaskDispositionTargetKind,
  TaskDispositionKind,
  AdrLinkKey,
  AdrStatus,
  TaskVerdictFindingSeverity,
  TaskVerdictResult,
  SpecRequirementPriority,
} from './vocabularies';
import type { RemediationAnchor, CertificationAnchor } from './certification';

/** Human-authorized, state-bound reason a scope left the active work lifecycle. */
export interface ScopeRetirement {
  /** Redundant lifecycle marker makes inspectable terminal state explicit in the record. */
  status: 'retired';
  reason: string;
  retiredAt: string;
  supersededBy?: string;
  planDigest: string;
}

/** Explicit, confirmed statement that an open scope's work is complete. Not a retirement and never automatic. */
export interface ScopeCompletion {
  completedAt: string;
  by: string;
  summary?: string;
  /**
   * sha256({kind:'scope-completion', schemaVersion, part:'request', scope, summary}). Present on
   * completions written by the locked transactional apply; absent on legacy pre-fix records, which
   * remain readable but are not resumable/idempotent.
   */
  requestDigest?: string;
  /**
   * sha256 of the registry KyroScopeEntry exactly as it stood immediately before this completion was
   * applied. Present iff requestDigest is present; lets an interrupted apply resume by writing only
   * the registry once it verifies the registry hasn't drifted since sprint.json was completed.
   */
  beforeEntryDigest?: string;
  /** Business-state binding for composed remediation/lifecycle replay. */
  beforeStateDigest?: string;
  /** Request options for extended completion; absent preserves the historical request digest. */
  policy?: { acceptOpenDebt: boolean; reconcileDebt: boolean; reason: string };
  debtAcceptance?: { reason: string; items: Debt[]; debtCollectionSha256: string };
  /** Digest of the reviewed closure plan, preserved for interruption recovery. */
  planDigest?: string;
}

/**
 * Append-only evidence that a completed, non-retired scope was explicitly reopened for later work.
 * Reopening clears the live `completion` (the scope is no longer complete) but never erases it: the
 * superseded record is preserved here with the reason it was reopened. Reopen is not a retirement
 * reversal — a retired scope is terminal and this path never applies to it.
 */
export interface ScopeReopenRecord {
  reopenedAt: string;
  by: string;
  reason: string;
  /** The completion record this reopen superseded, preserved verbatim. */
  completion: ScopeCompletion;
  /**
   * sha256({kind:'scope-reopen', schemaVersion, part:'request', scope, reason, completion}). Binds the
   * reopen to the exact completion it reverses, so a retry is idempotent and a later, different
   * reopen can never be mistaken for this one.
   */
  requestDigest?: string;
  /**
   * sha256 of the registry KyroScopeEntry exactly as it stood immediately before this reopen was
   * applied. Present iff requestDigest is present; lets an interrupted apply resume by writing only
   * the registry once it verifies the registry has not drifted since sprint.json was reopened.
   */
  beforeEntryDigest?: string;
  beforeStateDigest?: string;
}

// --- v4 sprint.json model (single source of truth per scope) ---

export type NextAction =
  | 'init'
  | 'clarify'
  | 'plan_sprint'
  | 'await_scope_completion'
  | 'execute_task'
  | 'review_task'
  | 'qa_or_close'
  | 'close_sprint'
  | 'done';

/** A resolved ambiguity, recorded verbatim like spec-kit's Clarifications section. */
export interface Clarification {
  q: string;
  a: string;
  sprint: number;
  date: string;
}

export type TaskStatus = 'pending' | 'in_progress' | 'done' | 'blocked';
export type DebtStatus = 'open' | 'in_progress' | 'resolved' | 'deferred';

/** Derived only; never persisted on Task. Used by routing and read models. */
export type TaskExecutionState = 'ready' | 'awaiting_review' | 'waiting_on_dependency' | 'blocked' | 'disposed' | 'verified';
export type TaskBlockReason = 'self_blocked' | 'blocked_dependency' | 'terminal_dependency';
export interface TaskExecutionInfo {
  taskId: string;
  state: TaskExecutionState;
  blockedByTaskIds: string[];
  blockReason: TaskBlockReason | null;
}

export interface TaskDispositionTarget {
  kind: TaskDispositionTargetKind;
  id: string;
}

export interface TaskDisposition {
  kind: TaskDispositionKind;
  reason: string;
  by: string;
  recordedAt: string;
  target?: TaskDispositionTarget;
}

export type ConventionRetirementReason = 'removed' | 'replaced';

/** A scope-local operational rule; retired rules remain as validated local history. */
export interface Convention {
  id: string;
  rule: string;
  tags: string[];
  addedSprint: number;
  /** Present only for an inactive rule retained for local audit history. */
  retired?: true;
  /** Why this retired local rule ceased to be effective. Required with `retired`. */
  retiredReason?: ConventionRetirementReason;
  /** CLI-stamped retirement time. Required with `retired`. */
  retiredAt?: string;
}

export type AdrLinks = Partial<Record<AdrLinkKey, string[]>>;

export interface AdrRecord {
  id: string;
  title: string;
  status: AdrStatus;
  date: string;
  context: string;
  decision: string;
  consequences: string[];
  alternatives: string[];
  links?: AdrLinks;
}

export interface Roadmap {
  plannedSprintCount: number;
  sizingRationale: string;
  sprints: Array<{ n: number; slug: string; title: string; state: string }>;
}

export interface LedgerEntry {
  n: number;
  slug: string;
  outcome: string;
  closedAt: string;
  archive: string;
  /** Path to the verbatim JSON snapshot of the closed activeSprint (write-only audit trail). */
  snapshot?: string;
  /** Path to the immutable, versioned full-scope close checkpoint. */
  checkpoint?: string;
  /** External SHA-256 commitment to the checkpoint payload, anchored in live scope state. */
  checkpointSha256?: string;
  recommendations?: string[];
  /** Git range of the sprint, derived from activeSprint.git and the frozen close.git inputs. */
  git?: LedgerGitRange;
}

/** Git position captured when a sprint is planned. Absent outside a repository or before the first commit. */
export interface SprintGitStart {
  /** Current branch, or null when HEAD is detached. */
  branch: string | null;
  startCommit: string;
}

/** Git position captured before any close write and frozen in the close checkpoint inputs. */
export interface SprintGitEnd {
  branch: string | null;
  endCommit: string;
  /** True when uncommitted changes outside .agents/kyro/ existed at close (outside the sprint range). */
  dirty: boolean;
}

export interface LedgerGitRange {
  branch: string | null;
  /** Null when the sprint was planned without git capture (older runtime, or no repository at planning). */
  startCommit: string | null;
  endCommit: string;
  dirty: boolean;
}

export interface TaskEvidence {
  summary: string;
  // A single validation line, or a list of them. Real runs record multiple validation commands, so
  // both shapes are accepted; readers must tolerate either (see asValidationLines).
  validation: string | string[];
  files_changed: string[];
  notes?: string;
  by: string;
  recordedAt: string;
}

export interface TaskVerdictFinding {
  severity: TaskVerdictFindingSeverity;
  detail: string;
}

export interface WaivedCriterion {
  criterion: string;
  reason: string;
}

export interface TaskVerdict {
  result: TaskVerdictResult;
  checked_criteria: string[];
  // Acceptance criteria that an approved scope change made unmeetable (e.g. the code was deleted).
  // A waiver requires a reason and is treated as satisfied by the checker; it is archived for audit.
  waived_criteria?: WaivedCriterion[];
  findings: TaskVerdictFinding[];
  by: string;
  reviewedAt: string;
  /** Canonical digest of the review request. Optional only when reading verdicts written before 4.48.0. */
  requestDigest?: string;
  /** Canonical digest of the evidence and task material checked by this verdict. */
  reviewedMaterialDigest?: string;
}

export interface SpecRequirement {
  id: string;
  statement: string;
  priority?: SpecRequirementPriority;
  rationale?: string;
}

export interface SpecScenario {
  id: string;
  requirement: string;
  given: string;
  when: string;
  then: string;
}

export interface Spec {
  requirements: SpecRequirement[];
  scenarios: SpecScenario[];
  nonGoals: string[];
  openQuestions: string[];
}

export interface Task {
  id: string;
  title: string;
  description: string;
  files_to_touch: string[];
  context: string;
  acceptance_criteria: string[];
  depends_on: string[];
  scenario_refs?: string[];
  status: TaskStatus;
  evidence: TaskEvidence | null;
  verdict: TaskVerdict | null;
  /** Absent on historical tasks and on work that is still in progress. Never a pass. */
  disposition?: TaskDisposition;
}

export interface Phase {
  id: string;
  title: string;
  objective: string;
  status: string;
  tasks: Task[];
}

export interface ActiveSprint {
  n: number;
  slug: string;
  title: string;
  objective: string;
  status: string;
  phases: Phase[];
  emergentTasks: Task[];
  definitionOfDone: string[];
  /** Git position recorded when the sprint was planned. */
  git?: SprintGitStart;
}

export interface Debt {
  id: string;
  title: string;
  origin: number;
  priority: 'critical' | 'high' | 'medium' | 'low';
  status: DebtStatus;
  targetSprint: number | null;
  note: string;
}

export interface HandoffBlocker {
  code: string;
  object: string;
  reason: string;
  remedyCommand: string;
}

export interface Handoff {
  nextAction: NextAction;
  nextTaskId: string | null;
  blockers: Array<string | HandoffBlocker>;
  note: string;
  lastUpdated: string;
}

/** Provenance of a captured scope creator identity. Extensible later (e.g. env, manual). */
export type ScopeAuthorSource = 'git';

/**
 * Optional person who created the scope. Written only at init when at least one of git
 * `user.name` or `user.email` is set. Present fields only — missing name or email is omitted,
 * not empty. Immutable after write — later sprint plan/close must preserve it. Omitted (not null)
 * when neither identity field is available or on pre-feature scopes.
 */
export interface ScopeAuthor {
  name?: string;
  email?: string;
  source: ScopeAuthorSource;
  /** ISO-8601 timestamp when identity was captured. */
  capturedAt: string;
}

export interface SprintFile {
  schemaVersion: 4;
  scope: string;
  title: string;
  status: string;
  objective: string;
  /** Technology-agnostic, measurable outcomes for the scope (the WHAT/WHY layer). */
  successCriteria: string[];
  /**
   * Optional scope creator captured at init from git user.name and/or user.email.
   * Omitted when neither is available or on pre-feature scopes.
   */
  author?: ScopeAuthor;
  /** Optional minimal spec layer for Requirement → Scenario → Task traceability. */
  spec?: Spec;
  /** Resolved ambiguities, appended one per accepted clarify answer. */
  clarifications: Clarification[];
  conventions: Convention[];
  /** Durable, scope-local architectural decision records. Absent in pre-ADR scopes. */
  adrs?: AdrRecord[];
  roadmap: Roadmap;
  ledger: LedgerEntry[];
  previousSprint: unknown | null;
  activeSprint: ActiveSprint | null;
  debt: Debt[];
  /**
   * Append-only anchors to remediation records that corrected this scope's live state after close.
   * Absent on scopes that were never remediated. Excluded from the canonical state digest.
   */
  remediations?: RemediationAnchor[];
  /**
   * Append-only anchors to certification records that validated a remediated scope's live state.
   * Absent on scopes that were never certified. Excluded from the canonical state digest.
   * Each cert in certifications[] is bound to a chain head commitment; remediating again drops the cert.
   */
  certifications?: CertificationAnchor[];
  /** Present only after `kyro scope retire` applies its human-approved terminal transition. */
  retirement?: ScopeRetirement;
  /** Present only after `kyro scope complete` records an explicit, confirmed completion. Distinct from retirement. */
  completion?: ScopeCompletion;
  /**
   * Append-only history of completions superseded by `kyro scope reopen`. Absent on scopes that were
   * never reopened. Completion history is preserved for audit even while the scope is open again.
   */
  completionHistory?: ScopeReopenRecord[];
  handoff: Handoff;
}
