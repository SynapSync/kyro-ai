import type { AGENT, COMMAND_NAMES, SCOPE } from '../constants';
import type { KyroScopeEntryStatus } from './vocabularies';
import type { ScopeRetirement, ScopeCompletion, ScopeReopenRecord, Convention } from './sprint-model';

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

export interface MachineAdapterEntry {
  agent: Agent;
  state: 'enabled' | 'disabled';
  projection: 'link' | 'copy' | null;
  integrations: boolean;
  updatedAt: string;
}

export interface MachineAdapterRegistry {
  schemaVersion: 1;
  adapters: MachineAdapterEntry[];
}

/** Effective scope view derived from its sprint.json. */
export interface KyroScopeEntry {
  id: string;
  title: string;
  status: KyroScopeEntryStatus;
  /** Tool-owned terminal transition metadata. Absent on scopes that remain in the work lifecycle. */
  retirement?: ScopeRetirement;
  /** Tool-owned explicit completion metadata. Distinct from retirement and mutually exclusive with it. */
  completion?: ScopeCompletion;
  /** Append-only record of completions that were explicitly reopened. Never rewritten or pruned. */
  completionHistory?: ScopeReopenRecord[];
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
 * | scopes             | derived from sprint.json      | Valid matching per-scope files define effective entries |
 * | activeScope        | **local only**                | Never on shared (git thrash) |
 * | installedAdapters  | **machine registry**          | Local records are legacy read-only |
 * | execution          | **local only**                | Personal delegation opt-in (L1); default off |
 * | runtimePath        | effective default / local     | Informational; not a git conflict surface |
 * | kyroInvocation     | **neither** (global only)     | `~/.agents/kyro/current/manifest.json` |
 *
 * Effective façade = merge(shared, local) + scope entries derived from disk.
 * Legacy monolito `.agents/kyro/kyro.json` dual-reads into the same effective shape.
 */

/** Committed shared project file shape (`.agents/kyro/project.json`). Never includes activeScope. */
export interface KyroSharedProjectState {
  schemaVersion: 4;
  artifactRoot: string;
  /** Read only for legacy layered files; new writes omit it. */
  scopes?: KyroScopeEntry[];
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
  /** Legacy read-only input; new install/sync writes omit this field. */
  installedAdapters?: KyroInstalledAdapter[];
  /** Optional informational runtime path; defaults to global current when absent. */
  runtimePath?: string;
  /** Optional personal execution preferences (delegation opt-in). */
  execution?: ExecutionPreferences;
  /** Optional personal git preferences. */
  git?: LocalGitPreferences;
}

export interface LocalGitPreferences {
  /** When true, a confirmed sprint close commits exactly the files the close wrote. Default false. */
  commitOnSprintClose?: boolean;
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
  /** Personal local-only preferences carried through the effective state so rewrites keep them. */
  execution?: ExecutionPreferences;
  git?: LocalGitPreferences;
  // kyroInvocation is intentionally NOT project state. Authoritative value lives on the
  // global runtime manifest (~/.agents/kyro/current/manifest.json). Install/sync strip any
  // legacy project-local copy so multi-workspace fleets cannot drift.
}
