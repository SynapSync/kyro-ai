import type { AdrStatus } from './vocabularies';
import type {
  AdrLinks,
  TaskStatus,
  TaskExecutionInfo,
  ScopeRetirement,
  ScopeCompletion,
  SpecRequirement,
  SpecScenario,
  HandoffBlocker,
} from './sprint-model';
import type { ContextPackMode, PackVerbosity, BudgetClassId, ReasoningTier } from './cli-runtime';

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

/** Compact reopen evidence for the pack: enough to see the scope was completed and why it reopened. */
export interface ContextPackReopen {
  reopenedAt: string;
  completedAt: string;
  reason: string;
}

export interface ContextPackExecutionSummary {
  readyTaskIds: string[];
  awaitingReviewTaskIds: string[];
  waitingOnDependencyTaskIds: string[];
  blockedTasks: TaskExecutionInfo[];
}

/** One focused validation rule from `.agents/kyro/validation.json`. */
export interface ValidationTaskRule {
  id: string;
  paths: string[];
  commands: string[];
}

/** Optional project-owned validation map (`.agents/kyro/validation.json`). */
export interface ValidationMap {
  validationVersion: 1;
  task: ValidationTaskRule[];
  fallback: string[];
  /** Required at every sprint close, respected verbatim. */
  close: string[];
  /** Aggregate suite; runs at the integration boundary, and at close only when escalated. */
  integration: string[];
  /** Declared mechanism that runs `integration` (e.g. a CI job), or null. Kyro does not verify it. */
  integrationBoundary: string | null;
  /** Minimum deterministic high-impact paths; a sprint touching one adds `integration` to close. */
  escalate: string[];
}

export type SprintValidationFileSource = 'task' | 'evidence' | 'disposed-evidence' | 'reconciled';

export interface SprintValidationFile {
  path: string;
  source: SprintValidationFileSource;
}

/**
 * Proportional close validation for the active sprint. `commands` are configured and executable;
 * `evidenceCandidates` are raw evidence lines for the agent to interpret, never commands. `escalated`
 * only means an `escalate` pattern matched — false is not a low-risk claim.
 */
export interface SprintValidation {
  files: SprintValidationFile[];
  commands: string[];
  matchedRules: string[];
  uncoveredFiles: string[];
  evidenceCandidates: Array<{ taskId: string; entries: string[] }>;
  escalated: boolean;
  escalatedBy: string[];
  escalationUnconfigured: boolean;
  integration: string[];
  integrationBoundary: string | null;
}

/**
 * Validation tiers surfaced on every pack: focused task commands for `taskFiles`, and the aggregate
 * close commands that run once per sprint. `source: 'none'` when the project has no (valid) map.
 * `uncoveredFiles` are task files no rule matched ("no rule", never "validated").
 */
export interface ContextPackValidation {
  source: 'validation.json' | 'none';
  task: string[];
  matchedRules: string[];
  uncoveredFiles: string[];
  close: string[];
  /** Scope packs with an active sprint: proportional close validation; otherwise null. */
  sprint: SprintValidation | null;
  issues: string[];
}

export interface ContextPackOutput {
  schemaVersion: 4;
  packMode: ContextPackMode;
  verbosity: PackVerbosity;
  scope: string;
  status: string | null;
  objective: string | null;
  retirement: ScopeRetirement | null;
  /** Live explicit completion, if the scope is currently completed. Never implied by roadmap state. */
  completion: ScopeCompletion | null;
  /** Compact, append-only record of completions that were reopened. Empty on scopes never reopened. */
  reopenHistory: ContextPackReopen[];
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
  /** Scope requirements not traced by the task's scenarios (task packs only); the scope pack lists them. */
  omittedRequirementIds: string[];
  specNonGoals: string[];
  specOpenQuestions: string[];
  taskScenarios: SpecScenario[];
  handoffNote: string | null;
  blockers: Array<string | HandoffBlocker>;
  /** Dependency-aware, read-only routing state for the active sprint. */
  execution: ContextPackExecutionSummary;
  /** Computed state of the selected task, if task pack mode is active. */
  taskExecution: TaskExecutionInfo | null;
  reviewPending: string[];
  nextTaskReview: NextTaskReview | null;
  conventions: ContextPackConvention[];
  adrs: ContextPackAdr[];
  /** Copy-paste CLI argv for the current nextAction (+ common preflight). */
  cliRecipes: ContextPackCliRecipe[];
  /** Focused task validation and once-per-sprint close validation. */
  validation: ContextPackValidation;
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
