import type { InstallScope, KyroInstalledAdapter, Agent } from './project-state';

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
  /** Allow config integrations for explicitly selected adapters, or all desired adapters. */
  integrations?: boolean;
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
  /** context-pack only: files found by git reconciliation, added before close selection. */
  sprintFiles: string[];
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
  check: boolean;
  /** analyze only: print the read-only scenario verification matrix instead of findings. */
  matrix: boolean;
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
  action: 'write' | 'copy' | 'link' | 'mkdir' | 'remove' | 'rmdir-if-empty' | 'upsert-block' | 'remove-block' | 'merge-json' | 'remove-json-key';
  commentStyle?: 'html' | 'hash';
  path: string;
  /** `link` sources are managed directory paths, resolved like `path` (not package-relative). */
  source?: string;
  /** A plan's copy preference; KYRO_LINK_MODE=copy also forces fallback. */
  projection?: 'link' | 'copy';
  content?: string;
  blockName?: string;
  jsonPath?: string;
  /** Literal token -> value replacements applied to `copy` operations at apply time (e.g. `{{KYRO_CLI}}`). */
  substitutions?: Record<string, string>;
  /** A host-owned write guard enforced immediately before publication. */
  guard?: 'canonical-skill' | 'claude-skill' | 'opencode-skill' | 'opencode-command';
  /** Existing adapter paths may be replaced only when the previous manifest owned them. */
  allowExistingManagedSkill?: boolean;
}

export interface OperationProjectionResult {
  path: string;
  source: string;
  projection: 'link' | 'copy';
}
