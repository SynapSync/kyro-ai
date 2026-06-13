import { ARTIFACT_ROOT, KYRO_COMMANDS_ROOT, KYRO_CORE_ROOT, KYRO_MANIFEST_PATH, KYRO_ROOT, KYRO_SKILLS_ROOT, KYRO_STATE_PATH, WORKFLOW_NAME } from './constants';
import { getAdapterDefinition, getInstalledAdapterDefinitions } from './adapters/registry';
import { addCopyDirectoryPlan, addCopyFilePlan, listRelativeFiles } from './fs';
import { readPackageVersion } from './help';
import { readProjectState } from './state';
import type { Agent, InstallScope, KyroManifest, KyroProjectState, OperationPlan } from './types';

export function buildInstallPlan(agents: Agent[], scope: InstallScope): OperationPlan[] {
  const now = new Date().toISOString();
  const packageVersion = readPackageVersion();
  const state = mergeProjectState(agents, scope, now);
  const manifestAgents = state.installedAdapters.map((adapter) => adapter.agent);
  const adapters = state.installedAdapters;
  const managedFiles = buildManagedFiles(manifestAgents);
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
    { action: 'mkdir', path: KYRO_ROOT },
    { action: 'write', path: KYRO_MANIFEST_PATH, content: `${JSON.stringify(manifest, null, 2)}\n` },
    { action: 'write', path: `${KYRO_ROOT}/KYRO.md`, content: buildKyroBootstrap() },
  ];

  addCopyDirectoryPlan(plan, 'agents', `${KYRO_CORE_ROOT}/agents`);
  addCopyDirectoryPlan(plan, 'commands', KYRO_COMMANDS_ROOT);
  addCopyDirectoryPlan(plan, 'skills', KYRO_SKILLS_ROOT);
  addCopyFilePlan(plan, 'config.json', `${KYRO_CORE_ROOT}/config.json`);
  addCopyFilePlan(plan, 'WORKFLOW.yaml', `${KYRO_CORE_ROOT}/WORKFLOW.yaml`);

  for (const adapter of getInstalledAdapterDefinitions(manifestAgents)) {
    adapter.buildProjection(plan);
  }

  return plan;
}

function mergeProjectState(agents: Agent[], scope: InstallScope, installedAt: string): KyroProjectState {
  const existing = readProjectState();
  const base: KyroProjectState = existing ?? {
    schemaVersion: 1,
    artifactRoot: ARTIFACT_ROOT,
    scopes: [],
    activeScope: null,
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
    schemaVersion: 1,
    artifactRoot: ARTIFACT_ROOT,
    scopes: [...base.scopes],
    activeScope: base.activeScope,
    installedAdapters: [...adaptersByAgent.values()].sort((a, b) => a.agent.localeCompare(b.agent)),
  };
}

function buildManagedFiles(agents: Agent[]): string[] {
  const files = [
    KYRO_MANIFEST_PATH,
    `${KYRO_ROOT}/KYRO.md`,
    `${KYRO_CORE_ROOT}/config.json`,
    `${KYRO_CORE_ROOT}/WORKFLOW.yaml`,
  ];

  files.push(...listRelativeFiles('agents').map((file) => `${KYRO_CORE_ROOT}/agents/${file}`));
  files.push(...listRelativeFiles('commands').map((file) => `${KYRO_COMMANDS_ROOT}/${file}`));
  files.push(...listRelativeFiles('skills').map((file) => `${KYRO_SKILLS_ROOT}/${file}`));

  for (const adapter of getInstalledAdapterDefinitions(agents)) {
    files.push(...adapter.buildManagedFiles());
  }

  return [...new Set(files)].sort();
}

function buildKyroBootstrap(): string {
  return `# Kyro Workspace Harness\n\nThis directory is managed by Kyro.\n\n- Core assets: \`${KYRO_CORE_ROOT}/\`\n- Commands: \`${KYRO_COMMANDS_ROOT}/\`\n- Skills: \`${KYRO_SKILLS_ROOT}/\`\n- Project state: \`${KYRO_STATE_PATH}\`\n\nUse installed agent commands/skills when available. Do not require users to invoke Kyro workflows through natural-language fallbacks unless the host agent has no native command or skill mechanism.\n`;
}

function buildManagedBlocks(agents: Agent[]): string[] {
  const blocks: string[] = [];
  for (const adapter of getInstalledAdapterDefinitions(agents)) {
    blocks.push(...adapter.buildManagedBlocks());
  }
  return [...new Set(blocks)].sort();
}
