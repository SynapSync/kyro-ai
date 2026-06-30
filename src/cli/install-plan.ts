import {
  AGENT_SKILLS_ROOT,
  ARTIFACT_ROOT,
  KYRO_COMMANDS_ROOT,
  KYRO_CORE_ROOT,
  KYRO_MANIFEST_PATH,
  KYRO_ROOT,
  KYRO_SKILLS_ROOT,
  KYRO_STATE_PATH,
  WORKFLOW_NAME,
  getKyroRuntimeRoot,
} from './constants';
import { getAdapterDefinition, getInstalledAdapterDefinitions } from './adapters/registry';
import { addCopyDirectoryPlan, addCopyFilePlan, listRelativeFiles } from './fs';
import { readPackageVersion } from './help';
import { readProjectState } from './state';
import type { Agent, InstallScope, KyroManifest, KyroProjectState, OperationPlan } from './types';

export function buildInstallPlan(agents: Agent[], scope: InstallScope): OperationPlan[] {
  const now = new Date().toISOString();
  const packageVersion = readPackageVersion();
  const runtimeRoot = getKyroRuntimeRoot(packageVersion);
  const state = mergeProjectState(agents, scope, now, packageVersion);
  const manifestAgents = state.installedAdapters.map((adapter) => adapter.agent);
  const adapters = state.installedAdapters;
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
  };

  const plan: OperationPlan[] = [
    { action: 'mkdir', path: ARTIFACT_ROOT },
    { action: 'write', path: KYRO_STATE_PATH, content: `${JSON.stringify(state, null, 2)}\n` },
    { action: 'mkdir', path: runtimeRoot },
    { action: 'write', path: `${runtimeRoot}/manifest.json`, content: `${JSON.stringify(manifest, null, 2)}\n` },
    { action: 'write', path: `${runtimeRoot}/KYRO.md`, content: buildKyroBootstrap(runtimeRoot) },
  ];

  addCopyDirectoryPlan(plan, 'agents', `${runtimeRoot}/core/agents`);
  addCopyDirectoryPlan(plan, 'commands', `${runtimeRoot}/commands`);
  addCopyDirectoryPlan(plan, 'skills', `${runtimeRoot}/skills`);
  addCopyFilePlan(plan, 'config.json', `${runtimeRoot}/core/config.json`);
  addCopyFilePlan(plan, 'WORKFLOW.yaml', `${runtimeRoot}/core/WORKFLOW.yaml`);
  plan.push({ action: 'symlink', path: KYRO_ROOT, source: runtimeRoot });

  for (const adapter of getInstalledAdapterDefinitions(manifestAgents)) {
    adapter.buildProjection(plan);
  }

  return plan;
}

function mergeProjectState(agents: Agent[], scope: InstallScope, installedAt: string, runtimeVersion: string): KyroProjectState {
  const existing = readProjectState();
  const base: KyroProjectState = existing ?? {
    schemaVersion: 4,
    artifactRoot: ARTIFACT_ROOT,
    scopes: [],
    activeScope: null,
    runtimeVersion,
    runtimePath: KYRO_ROOT,
    installedAdapters: [],
  };

  const adaptersByAgent = new Map<Agent, KyroProjectState['installedAdapters'][number]>();
  for (const adapter of base.installedAdapters) {
    adaptersByAgent.set(adapter.agent, adapter);
  }

  for (const agent of agents) {
    adaptersByAgent.set(agent, getAdapterDefinition(agent).buildInstalledAdapter(scope, installedAt));
  }

  return {
    schemaVersion: 4,
    artifactRoot: ARTIFACT_ROOT,
    scopes: [...base.scopes],
    activeScope: base.activeScope,
    runtimeVersion,
    runtimePath: KYRO_ROOT,
    installedAdapters: [...adaptersByAgent.values()].sort((a, b) => a.agent.localeCompare(b.agent)),
  };
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
  files.push(...listRelativeFiles('skills').map((file) => `${runtimeRoot}/skills/${file}`));

  for (const adapter of getInstalledAdapterDefinitions(agents)) {
    files.push(...adapter.buildManagedFiles());
  }

  return [...new Set(files)].sort();
}

function buildKyroBootstrap(runtimeRoot: string): string {
  return `# Kyro Global Runtime\n\nThis directory is managed by Kyro.\n\n- Runtime version path: \`${runtimeRoot}/\`\n- Current runtime: \`${KYRO_ROOT}/\`\n- Core assets: \`${KYRO_CORE_ROOT}/\`\n- Commands: \`${KYRO_COMMANDS_ROOT}/\`\n- Skills: \`${KYRO_SKILLS_ROOT}/\`\n- Global command skills: \`${AGENT_SKILLS_ROOT}/\`\n- Project state: \`${KYRO_STATE_PATH}\` in the active project\n\nUse installed global command skills when available. Do not require users to invoke Kyro workflows through natural-language fallbacks unless the host agent has no native command or skill mechanism.\n`;
}

function buildManagedBlocks(agents: Agent[]): string[] {
  const blocks: string[] = [];
  for (const adapter of getInstalledAdapterDefinitions(agents)) {
    blocks.push(...adapter.buildManagedBlocks());
  }
  return [...new Set(blocks)].sort();
}
