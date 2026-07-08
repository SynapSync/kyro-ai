import type { AGENT, COMMAND_NAMES, SCOPE } from './constants';

export type Agent = (typeof AGENT)[keyof typeof AGENT];
export type InstallScope = (typeof SCOPE)[keyof typeof SCOPE];
export type KyroCommandName = (typeof COMMAND_NAMES)[number];

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
  status: 'planning' | 'active' | 'blocked' | 'completed';
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

export interface KyroProjectState {
  schemaVersion: 4;
  artifactRoot: string;
  scopes: KyroScopeEntry[];
  activeScope: string | null;
  runtimeVersion: string;
  runtimePath: string;
  installedAdapters: KyroInstalledAdapter[];
  /** Optional project-level principles (v4.1+). Absent in pre-4.1 files. */
  principles?: Principle[];
  /** Resolved CLI invocation (v4.2+). Absent in pre-4.2 files until the next install/sync. */
  kyroInvocation?: string;
}

// --- v4 sprint.json model (single source of truth per scope) ---

export type NextAction =
  | 'init'
  | 'clarify'
  | 'plan_sprint'
  | 'execute_task'
  | 'review_task'
  | 'close_sprint'
  | 'wrap_up';

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
  recommendations?: string[];
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

export interface Handoff {
  nextAction: NextAction;
  nextTaskId: string | null;
  blockers: string[];
  note: string;
  lastUpdated: string;
}

export interface SprintFile {
  schemaVersion: 4;
  scope: string;
  title: string;
  status: string;
  objective: string;
  /** Technology-agnostic, measurable outcomes for the scope (the WHAT/WHY layer). */
  successCriteria: string[];
  /** Optional minimal spec layer for Requirement → Scenario → Task traceability. */
  spec?: Spec;
  /** Resolved ambiguities, appended one per accepted clarify answer. */
  clarifications: Clarification[];
  conventions: Convention[];
  roadmap: Roadmap;
  ledger: LedgerEntry[];
  previousSprint: unknown | null;
  activeSprint: ActiveSprint | null;
  debt: Debt[];
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
  purgeAdapterAssets: boolean;
  prune: boolean;
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

export type GuardedOperation = 'close_sprint' | 'repair_scope' | 'scope_set_active' | 'clear_active_sprint' | 'delete_archive' | 'review_task';
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

export interface NextTaskReview {
  taskId: string;
  status: TaskStatus;
  hasPassVerdict: boolean;
  checkerFindings: string[];
}

export interface ContextPackOutput {
  schemaVersion: 4;
  packMode: ContextPackMode;
  verbosity: PackVerbosity;
  scope: string;
  status: string | null;
  objective: string | null;
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
  warnings: string[];
  estimatedTokens: number;
  routing: { modes: string[] };
  budgetClass: BudgetClassId;
  reasoningTier: ReasoningTier;
  maxContextTokens: number;
  budgetGuidance: string;
}
