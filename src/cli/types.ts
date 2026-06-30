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

/** A scope entry in kyro.json.scopes[] — always an object, never a bare string (v3 drift). */
export interface KyroScopeEntry {
  id: string;
  title: string;
  status: 'planning' | 'active' | 'blocked' | 'completed';
}

export interface KyroProjectState {
  schemaVersion: 4;
  artifactRoot: string;
  scopes: KyroScopeEntry[];
  activeScope: string | null;
  runtimeVersion: string;
  runtimePath: string;
  installedAdapters: KyroInstalledAdapter[];
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

export interface Task {
  id: string;
  title: string;
  description: string;
  files_to_touch: string[];
  context: string;
  acceptance_criteria: string[];
  depends_on: string[];
  status: TaskStatus;
  evidence: unknown | null;
  verdict: unknown | null;
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
  kyroScope: string | null;
  task: string | null;
  json: boolean;
  purgeAdapterAssets: boolean;
  prune: boolean;
}

export type ContextPackMode = 'scope' | 'task';

export type BudgetClassId = 'brief' | 'execute' | 'review' | 'close';

export type ReasoningTier = 'light' | 'standard' | 'deep';

export interface BudgetClassDefinition {
  maxContextTokens: number;
  reasoningTier: ReasoningTier;
  guidance: string;
}

export type BudgetManifest = Record<BudgetClassId, BudgetClassDefinition>;

export interface OperationPlan {
  action: 'write' | 'copy' | 'mkdir' | 'remove' | 'rmdir-if-empty' | 'upsert-block' | 'remove-block' | 'symlink' | 'merge-json' | 'remove-json-key';
  path: string;
  source?: string;
  content?: string;
  blockName?: string;
  jsonPath?: string;
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

export interface ContextPackOutput {
  schemaVersion: 4;
  packMode: ContextPackMode;
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
  handoffNote: string | null;
  blockers: string[];
  conventions: ContextPackConvention[];
  warnings: string[];
  estimatedTokens: number;
  budgetClass: BudgetClassId;
  reasoningTier: ReasoningTier;
  maxContextTokens: number;
  budgetGuidance: string;
}
