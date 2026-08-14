import { existsSync, readFileSync } from 'node:fs';
import {
  AGENT_SKILLS_ROOT,
  ARTIFACT_ROOT,
  KYRO_COMMANDS_ROOT,
  KYRO_CORE_ROOT,
  KYRO_LEGACY_VERSIONS_ROOT,
  KYRO_MANIFEST_PATH,
  KYRO_PROJECT_ROOT,
  KYRO_ROOT,
  KYRO_SKILLS_ROOT,
  KYRO_STATE_PATH,
  LOCAL_STATE_PATH,
  PROJECT_STATE_PATH,
  WORKFLOW_NAME,
} from './constants';
import { getAdapterDefinition, getInstalledAdapterDefinitions } from './adapters/registry';
import { addCopyDirectoryPlan, addCopyFilePlan, listRelativeFiles, resolveManagedPath } from './fs';
import { readPackageVersion } from './help';
import { KYRO_CLI_PLACEHOLDER, resolveKyroInvocation } from './invocation';
import { rehydrateScopesFromDisk } from './core/scopes';
import {
  hasMonolitoProjectStateOnDisk,
  KYRO_STATE_MIGRATED_PATH,
  readProjectState,
  sanitizeLocalForWrite,
  collectUnnormalizableState,
  sanitizeSharedForWrite,
  splitMonolitoToLayers,
} from './state';
import type { Agent, InstallScope, KyroManifest, KyroProjectState, OperationPlan } from './types';

/** Project-local gitignore under `.agents/kyro/` (never the consumer repo root). */
export const KYRO_PROJECT_GITIGNORE_PATH = `${KYRO_PROJECT_ROOT}/.gitignore`;

/**
 * Required ignore entries for personal/machine files under `.agents/kyro/`.
 * Must never include `project.json` or `scopes/`.
 */
export const KYRO_PROJECT_GITIGNORE_ENTRIES = [
  'local.json',
  'kyro.json',
  'kyro.json.migrated',
  '.kyro-state-writer.lock',
  '.kyro-state-writer.lock/',
] as const;

export function buildInstallPlan(agents: Agent[], scope: InstallScope): OperationPlan[] {
  return buildInstallPlanForMode(agents, scope, { includeWorkspace: true });
}

export function buildRuntimeInstallPlan(scope: InstallScope): OperationPlan[] {
  return buildInstallPlanForMode([], scope, { includeWorkspace: false });
}

function buildInstallPlanForMode(
  agents: Agent[],
  scope: InstallScope,
  options: { includeWorkspace: boolean },
): OperationPlan[] {
  const now = new Date().toISOString();
  const packageVersion = readPackageVersion();
  const runtimeRoot = KYRO_ROOT;
  // Probed once per install/sync (durable kyro only; ephemeral npx bins are rejected — see invocation.ts).
  // Projected markdown is static, so the invocation must be known at copy time.
  // SoT is the global runtime manifest only — never project kyro.json (avoids multi-workspace drift).
  const kyroInvocation = resolveKyroInvocation().raw;
  const state = options.includeWorkspace ? mergeProjectState(agents, scope, now) : null;
  const manifestAgents = state?.installedAdapters.map((adapter) => adapter.agent) ?? [];
  const adapters = state?.installedAdapters ?? [];
  const managedFiles = buildManagedFiles(manifestAgents, runtimeRoot);
  const managedBlocks = buildManagedBlocks(manifestAgents);
  const manifest: KyroManifest = {
    schemaVersion: 1,
    packageName: WORKFLOW_NAME,
    packageVersion,
    installedAt: now,
    installScope: scope,
    managedFiles,
    managedBlocks,
    adapters,
    kyroInvocation,
  };

  const plan: OperationPlan[] = [
    // Single-active runtime: replace the active runtime directory on every install/sync so
    // re-installs are idempotent and untracked files from older package layouts cannot accumulate.
    { action: 'remove', path: runtimeRoot },
    { action: 'mkdir', path: runtimeRoot },
    { action: 'write', path: `${runtimeRoot}/manifest.json`, content: `${JSON.stringify(manifest, null, 2)}\n` },
    { action: 'write', path: `${runtimeRoot}/KYRO.md`, content: buildKyroBootstrap(packageVersion, runtimeRoot) },
  ];

  if (state) {
    const { shared, local } = splitMonolitoToLayers(state);
    // Never let content vanish under a success message. Aliases from hand-authored state are mapped
    // by the clone helpers; whatever still has no recoverable text is named here so the user can
    // restore it, instead of finding a hollow `{ id }` entry later.
    const unnormalizable = collectUnnormalizableState(shared);
    if (unnormalizable.length > 0) {
      console.warn(
        `WARNING: ${unnormalizable.length} project.json entr${unnormalizable.length === 1 ? 'y has' : 'ies have'} no recoverable text and will be written incomplete:`,
      );
      for (const entry of unnormalizable) console.warn(`  - ${entry}`);
      console.warn('  Restore the missing text in .agents/kyro/project.json, then re-run kyro doctor.');
    }
    const workspaceOps: OperationPlan[] = [
      { action: 'mkdir', path: KYRO_PROJECT_ROOT },
      { action: 'mkdir', path: ARTIFACT_ROOT },
      {
        action: 'write',
        path: PROJECT_STATE_PATH,
        content: `${JSON.stringify(sanitizeSharedForWrite(shared), null, 2)}\n`,
      },
      {
        action: 'write',
        path: LOCAL_STATE_PATH,
        content: `${JSON.stringify(sanitizeLocalForWrite(local), null, 2)}\n`,
      },
      {
        action: 'write',
        path: KYRO_PROJECT_GITIGNORE_PATH,
        content: buildKyroProjectGitignore(readExistingKyroProjectGitignore()),
      },
    ];
    // Archive live monolito so dual-read prefers layers and writers stop targeting kyro.json.
    if (hasMonolitoProjectStateOnDisk()) {
      const monolitoRaw = readMonolitoFileRaw();
      if (monolitoRaw !== null) {
        workspaceOps.push({ action: 'write', path: KYRO_STATE_MIGRATED_PATH, content: monolitoRaw });
      }
      workspaceOps.push({ action: 'remove', path: KYRO_STATE_PATH });
    }
    plan.unshift(...workspaceOps);
  }

  // Markdown-bearing copies carry the {{KYRO_CLI}} substitution map (design.md §5.3) so every
  // projected occurrence resolves to the runnable invocation. Most command routers reference only
  // slash commands; the human-gated scope-retire router intentionally invokes the CLI directly.
  const substitutions = { [KYRO_CLI_PLACEHOLDER]: kyroInvocation };
  addCopyDirectoryPlan(plan, 'agents', `${runtimeRoot}/core/agents`, substitutions);
  addCopyDirectoryPlan(plan, 'commands', `${runtimeRoot}/commands`, substitutions);
  addCopyDirectoryPlan(plan, 'internal/skills', `${runtimeRoot}/skills`, substitutions);
  addCopyFilePlan(plan, 'config.json', `${runtimeRoot}/core/config.json`);
  addCopyFilePlan(plan, 'WORKFLOW.yaml', `${runtimeRoot}/core/WORKFLOW.yaml`);

  // Bundle the CLI itself plus root-layout parity mirrors so PACKAGE_ROOT-relative
  // reads (readPackageVersion, loadBudgetManifest) resolve identically when the
  // projected CLI runs from runtimeRoot. See design.md §3 for the asset-parity audit.
  addCopyDirectoryPlan(plan, 'dist', `${runtimeRoot}/dist`);
  addCopyFilePlan(plan, 'package.json', `${runtimeRoot}/package.json`);
  addCopyFilePlan(plan, 'config.json', `${runtimeRoot}/config.json`);
  // Clean the retired multi-version runtime root. Kyro now keeps only one active runtime.
  plan.push({ action: 'remove', path: KYRO_LEGACY_VERSIONS_ROOT });

  if (state) {
    for (const adapter of getInstalledAdapterDefinitions(manifestAgents)) {
      adapter.buildProjection(plan);
      if (adapter.capabilities().includes('mcp')) adapter.buildMcpProjection(plan);
    }
  }

  return plan;
}

function mergeProjectState(
  agents: Agent[],
  scope: InstallScope,
  installedAt: string,
): KyroProjectState {
  const existing = readProjectState();
  const defaults: KyroProjectState = {
    schemaVersion: 4,
    artifactRoot: ARTIFACT_ROOT,
    scopes: [],
    activeScope: null,
    runtimePath: KYRO_ROOT,
    installedAdapters: [],
  };
  // Merge over defaults so an incomplete kyro.json (e.g. hand-written by an agent that never ran
  // kyro install) is REPAIRED instead of crashing. Arrays are normalized before we iterate them.
  const base: KyroProjectState = { ...defaults, ...(existing ?? {}) };
  // runtimeVersion / kyroInvocation were project-local snapshots of global singleton runtime
  // metadata and could become stale whenever another workspace replaced ~/.agents/kyro/current.
  // Keep legacy files readable, but canonicalize on install/sync:
  // - packageVersion lives in current/manifest.json only
  // - kyroInvocation lives in current/manifest.json only (see getPersistedKyroInvocation)
  delete (base as KyroProjectState & { runtimeVersion?: unknown }).runtimeVersion;
  delete (base as KyroProjectState & { kyroInvocation?: unknown }).kyroInvocation;
  if (!Array.isArray(base.scopes)) base.scopes = [];
  if (!Array.isArray(base.installedAdapters)) base.installedAdapters = [];

  const adaptersByAgent = new Map<Agent, KyroProjectState['installedAdapters'][number]>();
  for (const adapter of base.installedAdapters) {
    adaptersByAgent.set(adapter.agent, adapter);
  }

  for (const agent of agents) {
    adaptersByAgent.set(agent, getAdapterDefinition(agent).buildInstalledAdapter(scope, installedAt));
  }

  // Register scope folders already on disk (common when local overlay is gitignored but scopes/ is shared).
  // Existing scopes[] entries are preserved; activeScope is only auto-set when null and exactly one scope.
  return rehydrateScopesFromDisk({
    ...base,
    schemaVersion: 4,
    artifactRoot: ARTIFACT_ROOT,
    scopes: [...base.scopes],
    activeScope: base.activeScope,
    runtimePath: KYRO_ROOT,
    installedAdapters: [...adaptersByAgent.values()].sort((a, b) => a.agent.localeCompare(b.agent)),
  });
}

/**
 * Idempotent `.agents/kyro/.gitignore` content: preserves existing lines, ensures required
 * personal/machine ignore entries, and never adds `project.json` or `scopes/`.
 */
export function buildKyroProjectGitignore(existingContent: string | null | undefined): string {
  const header =
    '# Kyro — personal/machine overlay and local locks (do not commit).\n'
    + '# Keep project.json and scopes/ trackable for multi-dev clones.';
  const raw = typeof existingContent === 'string' ? existingContent : '';
  const lines = raw.length > 0 ? raw.replace(/\s+$/, '').split(/\r?\n/) : [header, ''];
  const present = new Set(
    lines
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#')),
  );
  for (const entry of KYRO_PROJECT_GITIGNORE_ENTRIES) {
    if (!present.has(entry)) {
      lines.push(entry);
      present.add(entry);
    }
  }
  let content = lines.join('\n');
  if (!content.endsWith('\n')) content += '\n';
  return content;
}

function readExistingKyroProjectGitignore(): string | null {
  const absolute = resolveManagedPath(KYRO_PROJECT_GITIGNORE_PATH);
  if (!existsSync(absolute)) return null;
  return readFileSync(absolute, 'utf-8');
}

function readMonolitoFileRaw(): string | null {
  const absolute = resolveManagedPath(KYRO_STATE_PATH);
  if (!existsSync(absolute)) return null;
  return readFileSync(absolute, 'utf-8');
}

function buildManagedFiles(agents: Agent[], runtimeRoot: string): string[] {
  const files = [
    KYRO_MANIFEST_PATH,
    `${runtimeRoot}/manifest.json`,
    `${runtimeRoot}/KYRO.md`,
    `${runtimeRoot}/core/config.json`,
    `${runtimeRoot}/core/WORKFLOW.yaml`,
  ];

  files.push(...listRelativeFiles('agents').map((file) => `${runtimeRoot}/core/agents/${file}`));
  files.push(...listRelativeFiles('commands').map((file) => `${runtimeRoot}/commands/${file}`));
  files.push(...listRelativeFiles('internal/skills').map((file) => `${runtimeRoot}/skills/${file}`));
  files.push(...listRelativeFiles('dist').map((file) => `${runtimeRoot}/dist/${file}`));
  files.push(`${runtimeRoot}/package.json`, `${runtimeRoot}/config.json`);

  for (const adapter of getInstalledAdapterDefinitions(agents)) {
    files.push(...adapter.buildManagedFiles());
  }

  return [...new Set(files)].sort();
}

function buildKyroBootstrap(packageVersion: string, runtimeRoot: string): string {
  return `# Kyro Global Runtime\n\nThis directory is managed by Kyro.\n\n- Package version: \`${packageVersion}\`\n- Runtime path: \`${runtimeRoot}/\`\n- Core assets: \`${KYRO_CORE_ROOT}/\`\n- Commands: \`${KYRO_COMMANDS_ROOT}/\`\n- Skills: \`${KYRO_SKILLS_ROOT}/\`\n- Global command skills: \`${AGENT_SKILLS_ROOT}/\`\n- Project state: \`${PROJECT_STATE_PATH}\` (shared) + \`${LOCAL_STATE_PATH}\` (local) in the active project\n- Legacy monolito \`${KYRO_STATE_PATH}\` is dual-read only during migration\n\nUse installed global command skills when available. Do not require users to invoke Kyro workflows through natural-language fallbacks unless the host agent has no native command or skill mechanism.\n`;
}

function buildManagedBlocks(agents: Agent[]): string[] {
  const blocks: string[] = [];
  for (const adapter of getInstalledAdapterDefinitions(agents)) {
    blocks.push(...adapter.buildManagedBlocks());
  }
  return [...new Set(blocks)].sort();
}
