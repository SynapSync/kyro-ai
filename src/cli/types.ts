import type { AGENT, COMMAND_NAMES, SCOPE } from './constants';

export type Agent = (typeof AGENT)[keyof typeof AGENT];
export type InstallScope = (typeof SCOPE)[keyof typeof SCOPE];
export type KyroCommandName = (typeof COMMAND_NAMES)[number];

export const KYRO_SCOPE_ENTRY_STATUS = {
  PLANNING: 'planning',
  ACTIVE: 'active',
  COMPLETED: 'completed',
  BLOCKED: 'blocked',
  RETIRED: 'retired',
} as const;

export type KyroScopeEntryStatus =
  (typeof KYRO_SCOPE_ENTRY_STATUS)[keyof typeof KYRO_SCOPE_ENTRY_STATUS];

export interface KyroInstalledAdapter {
  agent: Agent;
  scope: InstallScope;
  installedAt: string;
  corePath: string;
  commandsPath?: string;
  skillsPath?: string;
}

/** A scope entry in kyro.json.scopes[] — always an object, never a bare string. */
export interface KyroScopeEntry {
  id: string;
  title: string;
  status: KyroScopeEntryStatus;
  /** Tool-owned terminal transition metadata. Absent on scopes that remain in the work lifecycle. */
  retirement?: ScopeRetirement;
}

/** Human-authorized, state-bound reason a scope left the active work lifecycle. */
export interface ScopeRetirement {
  reason: string;
  retiredAt: string;
  supersededBy?: string;
  planDigest: string;
}

/** Built-in, machine-checkable predicates a principle can bind to (enforced by `kyro analyze`). */
export type PrincipleCheck =
  | 'tasks-have-acceptance-criteria'
  | 'no-clarification-markers'
  | 'success-criteria-present';

/**
 * An authored, project-level principle (spec-kit's "constitution"). Distinct from learned
 * `conventions[]`: principles are immutable rules checked as gates. A free-text principle is an agent
 * gate; one with `check` is enforced deterministically by `kyro analyze`.
 */
export interface Principle {
  id: string;
  rule: string;
  severity: 'non-negotiable' | 'strong' | 'advisory';
  rationale: string;
  check?: PrincipleCheck;
}

/**
 * Optional team policy stored only on the shared project file (WARN-first fleet alignment).
 * Never personal: no activeScope, no installedAdapters.
 */
export interface TeamPolicy {
  /** When set, doctor may WARN if the runtime package is older (non-blocking default). */
  minPackageVersion?: string;
  /** Advisory adapter recommendations for teammates (not machine install records). */
  recommendedAdapters?: string[];
}

/** Personal execution preferences on the local overlay (L1 delegation opt-in). */
export interface ExecutionPreferences {
  /** When true, execute/review modes load delegate role helpers. Default false when absent. */
  delegationEnabled?: boolean;
}

/**
 * Field ownership for layered project state (D1–D6, D8):
 *
 * | Field              | Layer                         | Notes |
 * |--------------------|-------------------------------|-------|
 * | schemaVersion      | shared + effective            | Stay 4; additive layers |
 * | artifactRoot       | shared + effective            | Team constant under `.agents/kyro/scopes` |
 * | principles         | **shared only**               | Team constitution; must travel with git |
 * | conventions        | **shared only**               | Global operational rules; merged into every scope pack |
 * | team               | **shared only**               | TeamPolicy (minPackageVersion, …) |
 * | scopes             | shared cache + disk rehydrate | Presence SoT is scopes/ folders |
 * | activeScope        | **local only**                | Never on shared (git thrash) |
 * | installedAdapters  | **local only**                | Per-machine adapter install records |
 * | execution          | **local only**                | Personal delegation opt-in (L1); default off |
 * | runtimePath        | effective default / local     | Informational; not a git conflict surface |
 * | kyroInvocation     | **neither** (global only)     | `~/.agents/kyro/current/manifest.json` |
 *
 * Effective façade = merge(shared, local) + optional in-memory disk rehydrate on mutating paths.
 * Legacy monolito `.agents/kyro/kyro.json` dual-reads into the same effective shape.
 */

/** Committed shared project file shape (`.agents/kyro/project.json`). Never includes activeScope. */
export interface KyroSharedProjectState {
  schemaVersion: 4;
  artifactRoot: string;
  /** Registry cache + titles/status hints; disk folders remain recoverable SoT for presence. */
  scopes: KyroScopeEntry[];
  /** Team constitution (optional until authored). */
  principles?: Principle[];
  /** Global operational rules inherited by every scope context pack. */
  conventions?: Convention[];
  /** Optional team policy shell (WARN-first). */
  team?: TeamPolicy;
}

/** Gitignored local overlay (`.agents/kyro/local.json`). Personal/machine fields only. */
export interface KyroLocalProjectState {
  schemaVersion: 4;
  activeScope: string | null;
  installedAdapters: KyroInstalledAdapter[];
  /** Optional informational runtime path; defaults to global current when absent. */
  runtimePath?: string;
  /** Optional personal execution preferences (delegation opt-in). */
  execution?: ExecutionPreferences;
}

/**
 * Effective merged project state used by CLI/MCP readers.
 * Stable façade: call sites keep using KyroProjectState; layering is internal.
 */
export interface KyroProjectState {
  schemaVersion: 4;
  artifactRoot: string;
  scopes: KyroScopeEntry[];
  activeScope: string | null;
  runtimePath: string;
  installedAdapters: KyroInstalledAdapter[];
  /** Optional project-level principles (v4.1+). From shared layer after migration. */
  principles?: Principle[];
  /** Optional global operational rules from the shared project layer. */
  conventions?: Convention[];
  /** Optional team policy from shared layer (v4 layered). */
  team?: TeamPolicy;
  // kyroInvocation is intentionally NOT project state. Authoritative value lives on the
  // global runtime manifest (~/.agents/kyro/current/manifest.json). Install/sync strip any
  // legacy project-local copy so multi-workspace fleets cannot drift.
}

// --- v4 sprint.json model (single source of truth per scope) ---

export type NextAction =
  | 'init'
  | 'clarify'
  | 'plan_sprint'
  | 'execute_task'
  | 'review_task'
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

export interface Convention {
  id: string;
  rule: string;
  tags: string[];
  addedSprint: number;
}

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
}

export const SPRINT_CLOSE_CHECKPOINT_KIND = 'kyro.sprint-close-checkpoint' as const;
export const SPRINT_CLOSE_CHECKPOINT_SCHEMA_VERSION = 1 as const;

export const SCOPE_RECERTIFICATION_KIND = 'kyro.scope-recertification' as const;
export const SCOPE_RECERTIFICATION_SCHEMA_VERSION = 1 as const;

export interface SprintCloseIdentity {
  scope: string;
  sprintN: number;
  sprintSlug: string;
}

export interface SprintCloseInputs {
  outcome: string;
  note: string | null;
  summary: string | null;
  recommendations: string[];
  learnings: string[];
}

export interface SprintClosePaths {
  legacySnapshot: string;
  narrative: string;
}

export interface SprintCloseDigests {
  beforeClose: string;
  intendedAfterClose: string;
  projectScopeBefore: string;
  projectScopeAfter: string;
  legacySnapshot: string;
  narrative: string;
}

/** Immutable transaction record used to resume and audit a sprint close without losing scope state. */
export interface SprintCloseCheckpointV1 {
  schemaVersion: typeof SPRINT_CLOSE_CHECKPOINT_SCHEMA_VERSION;
  kind: typeof SPRINT_CLOSE_CHECKPOINT_KIND;
  checkpointId: string;
  createdAt: string;
  identity: SprintCloseIdentity;
  close: SprintCloseInputs;
  paths: SprintClosePaths;
  beforeClose: SprintFile;
  intendedAfterClose: SprintFile;
  projectScopeBefore: KyroScopeEntry;
  projectScopeAfter: KyroScopeEntry;
  digests: SprintCloseDigests;
}

export const SPRINT_CLOSE_TRANSACTION_STATUS = {
  PREPARED: 'PREPARED',
  PARTIAL: 'PARTIAL',
  APPLIED: 'APPLIED',
  DIVERGED: 'DIVERGED',
  CORRUPT: 'CORRUPT',
  UNSUPPORTED_VERSION: 'UNSUPPORTED_VERSION',
} as const;
export type SprintCloseTransactionStatus = (typeof SPRINT_CLOSE_TRANSACTION_STATUS)[keyof typeof SPRINT_CLOSE_TRANSACTION_STATUS];

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
}

export const SPEC_REQUIREMENT_PRIORITY = {
  MUST: 'must',
  SHOULD: 'should',
  COULD: 'could',
} as const;
export type SpecRequirementPriority = (typeof SPEC_REQUIREMENT_PRIORITY)[keyof typeof SPEC_REQUIREMENT_PRIORITY];

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

/**
 * `Debt` above is the exact canonical *output* every writer must emit. The raw *input* contract —
 * what an observed legacy entry actually is, and whether it may be projected at all — lives in
 * `artifacts/debt-contract`. Re-exported as types only, so this module stays free of imports.
 */
export type {
  DebtAssessment,
  DebtAssessmentOptions,
  DebtClassification,
  DebtDiagnostic,
  DebtDiagnosticAuthority,
  DebtDiagnosticCode,
  DebtDiagnosticSeverity,
} from './artifacts/debt-contract';

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

export interface Handoff {
  nextAction: NextAction;
  nextTaskId: string | null;
  blockers: string[];
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
  handoff: Handoff;
}

export interface KyroManifest {
  schemaVersion: 1;
  packageName: string;
  packageVersion: string;
  installedAt: string;
  installScope: InstallScope;
  managedFiles: string[];
  managedBlocks: string[];
  adapters: KyroInstalledAdapter[];
  kyroInvocation: string;
}

export interface CliOptions {
  agents: Agent[];
  scope: InstallScope;
  dryRun: boolean;
  yes: boolean;
  help: boolean;
  tokens: boolean;
  artifacts: boolean;
  adapters: boolean;
  trace: boolean;
  kyroScope: string | null;
  task: string | null;
  json: boolean;
  verbosity: PackVerbosity;
  verbose: boolean;
  purgeAdapterAssets: boolean;
  prune: boolean;
  initWorkspace: boolean;
  noInitWorkspace: boolean;
  evalCases: string[];
  evalTags: string[];
  evalList: boolean;
  keepSandbox: boolean;
}

export type ContextPackMode = 'scope' | 'task';

export type PackVerbosity = 'concise' | 'detailed';

export type BudgetClassId = 'brief' | 'execute' | 'review' | 'close';

export type ReasoningTier = 'light' | 'standard' | 'deep';

export interface BudgetClassDefinition {
  maxContextTokens: number;
  reasoningTier: ReasoningTier;
  guidance: string;
}

export type BudgetManifest = Record<BudgetClassId, BudgetClassDefinition>;

export interface OperationPlan {
  action: 'write' | 'copy' | 'mkdir' | 'remove' | 'rmdir-if-empty' | 'upsert-block' | 'remove-block' | 'merge-json' | 'remove-json-key';
  commentStyle?: 'html' | 'hash';
  path: string;
  source?: string;
  content?: string;
  blockName?: string;
  jsonPath?: string;
  /** Literal token -> value replacements applied to `copy` operations at apply time (e.g. `{{KYRO_CLI}}`). */
  substitutions?: Record<string, string>;
}


// --- portable guardrail policy ---

export type GuardedOperation = 'close_sprint' | 'repair_scope' | 'scope_set_active' | 'scope_retire' | 'clear_active_sprint' | 'delete_archive' | 'review_task';
export type GuardLevel = 'tool_owned' | 'confirm' | 'blocked';
export type GuardDecisionKind = 'allow' | 'confirmation_required' | 'blocked';
export type EnforcementTier = 'enforced' | 'advisory';

export interface PolicyOperationRule {
  level: GuardLevel;
}

export interface PolicyDefinition {
  policyVersion: 1;
  operations: Record<GuardedOperation, PolicyOperationRule>;
  allow: GuardedOperation[];
  maker_checker: MakerCheckerPolicy;
}

export interface MakerCheckerPolicy {
  requireSeparateChecker: boolean;
}

export interface PolicyIssue {
  field: string;
  message: string;
}

export interface GuardContext {
  surface: 'cli' | 'mcp';
  scope?: string;
  confirmed: boolean;
}

export interface GuardDecision {
  op: GuardedOperation;
  level: GuardLevel;
  kind: GuardDecisionKind;
  code?: 'CONFIRMATION_REQUIRED' | 'POLICY_BLOCKED';
  message: string;
  remedy?: string;
}

// --- append-only trace model (audit trail, never source of truth) ---

export type TraceEventType =
  | 'route_selected'
  | 'tool_command_run'
  | 'validation_result'
  | 'gate_approved'
  | 'retry_count'
  | 'blocked_reason'
  | 'close_snapshot';

export interface TraceEventBase {
  v: 1;
  ts: string;
  scope: string;
  type: TraceEventType;
}

export type TraceEvent =
  | (TraceEventBase & {
      type: 'route_selected';
      nextAction: NextAction;
      packMode: ContextPackMode;
      budgetClass: string;
      reasoningTier: string;
    })
  | (TraceEventBase & {
      type: 'tool_command_run';
      surface: 'cli' | 'mcp';
      command: string;
      args?: Record<string, string | number | boolean>;
    })
  | (TraceEventBase & {
      type: 'validation_result';
      source: 'analyze' | 'doctor';
      blocking: boolean;
      findingCount: number;
      codes: string[];
    })
  | (TraceEventBase & { type: 'gate_approved'; gate: string; taskId?: string })
  | (TraceEventBase & { type: 'retry_count'; round: number; limit: number; blocked: boolean })
  | (TraceEventBase & { type: 'blocked_reason'; reason: string; code?: string })
  | (TraceEventBase & { type: 'close_snapshot'; sprintN: number; snapshotId: string; outcome: 'shipped' | 'partial' | 'aborted' });


export type AnalysisSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface AnalysisFinding {
  id: string;
  severity: AnalysisSeverity;
  category: string;
  detail: string;
  remedy: string;
}

export interface CheckResult {
  status: 'pass' | 'warn' | 'fail';
  name: string;
  detail: string;
  remedy?: string;
}

export interface ContextPackConvention {
  id: string;
  rule: string;
  tags: string[];
}

export interface ContextPackAdr {
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

export interface NextTaskReview {
  taskId: string;
  status: TaskStatus;
  hasPassVerdict: boolean;
  checkerFindings: string[];
}

/** Copy-paste CLI recipe for the current handoff (context-pack agent UX). */
export interface ContextPackCliRecipe {
  id: string;
  purpose: string;
  /** Full shell-invocable command string using the canonical agent entrypoint. */
  command: string;
}

export interface ContextPackOutput {
  schemaVersion: 4;
  packMode: ContextPackMode;
  verbosity: PackVerbosity;
  scope: string;
  status: string | null;
  objective: string | null;
  retirement: ScopeRetirement | null;
  nextAction: string | null;
  nextTaskId: string | null;
  activeSprintSlug: string | null;
  activeSprintObjective: string | null;
  openDebtCount: number;
  taskId: string | null;
  taskTitle: string | null;
  taskDescription: string | null;
  taskFiles: string[];
  taskContext: string | null;
  taskAcceptanceCriteria: string[];
  specRequirements: SpecRequirement[];
  specNonGoals: string[];
  specOpenQuestions: string[];
  taskScenarios: SpecScenario[];
  handoffNote: string | null;
  blockers: string[];
  reviewPending: string[];
  nextTaskReview: NextTaskReview | null;
  conventions: ContextPackConvention[];
  adrs: ContextPackAdr[];
  /** Copy-paste CLI argv for the current nextAction (+ common preflight). */
  cliRecipes: ContextPackCliRecipe[];
  warnings: string[];
  estimatedTokens: number;
  routing: { modes: string[] };
  budgetClass: BudgetClassId;
  reasoningTier: ReasoningTier;
  maxContextTokens: number;
  budgetGuidance: string;
  /** Personal delegation opt-in from local.json execution.delegationEnabled (false when unset). */
  delegationEnabled: boolean;
}
