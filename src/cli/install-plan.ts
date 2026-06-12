import { AGENT, AGENT_SKILLS_ROOT, ARTIFACT_ROOT, KYRO_COMMANDS_ROOT, KYRO_CORE_ROOT, KYRO_MANIFEST_PATH, KYRO_ROOT, KYRO_SKILLS_ROOT, KYRO_STATE_PATH, SCOPE, WORKFLOW_NAME } from './constants';
import { addGenericProjection, buildGenericManagedFiles } from './adapters/generic';
import { addOpenCodeProjection, buildOpenCodeManagedFiles } from './adapters/opencode';
import { addCopyDirectoryPlan, addCopyFilePlan, listRelativeFiles } from './fs';
import { readPackageVersion } from './help';
import { readProjectState } from './state';
import type { Agent, InstallScope, KyroInstalledAdapter, KyroManifest, KyroProjectState, OperationPlan } from './types';

export function buildInstallPlan(agents: Agent[], scope: InstallScope): OperationPlan[] {
  const now = new Date().toISOString();
  const packageVersion = readPackageVersion();
  const state = mergeProjectState(agents, scope, now);
  const adapters = state.installedAdapters.filter((adapter) => agents.includes(adapter.agent));
  const managedFiles = buildManagedFiles(agents);
  const manifest: KyroManifest = {
    schemaVersion: 1,
    packageName: WORKFLOW_NAME,
    packageVersion,
    installedAt: now,
    installScope: scope,
    managedFiles,
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

  if (agents.includes(AGENT.OPENCODE)) {
    addOpenCodeProjection(plan);
  }
  if (agents.includes(AGENT.GENERIC)) {
    addGenericProjection(plan);
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

  const adaptersByAgent = new Map<Agent, KyroInstalledAdapter>();
  for (const adapter of base.installedAdapters) {
    adaptersByAgent.set(adapter.agent, adapter);
  }

  for (const agent of agents) {
    adaptersByAgent.set(agent, buildInstalledAdapter(agent, scope, installedAt));
  }

  return {
    schemaVersion: 1,
    artifactRoot: ARTIFACT_ROOT,
    scopes: [...base.scopes],
    activeScope: base.activeScope,
    installedAdapters: [...adaptersByAgent.values()].sort((a, b) => a.agent.localeCompare(b.agent)),
  };
}

function buildInstalledAdapter(agent: Agent, scope: InstallScope, installedAt: string): KyroInstalledAdapter {
  const base: KyroInstalledAdapter = {
    agent,
    scope,
    installedAt,
    corePath: KYRO_ROOT,
  };

  if (agent === AGENT.OPENCODE) {
    return {
      ...base,
      commandsPath: AGENT_SKILLS_ROOT,
      skillsPath: AGENT_SKILLS_ROOT,
    };
  }

  return base;
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

  if (agents.includes(AGENT.OPENCODE)) {
    files.push(...buildOpenCodeManagedFiles());
  }

  if (agents.includes(AGENT.GENERIC)) {
    files.push(...buildGenericManagedFiles());
  }

  return [...new Set(files)].sort();
}

function buildKyroBootstrap(): string {
  return `# Kyro Workspace Harness\n\nThis directory is managed by Kyro.\n\n- Core assets: \`${KYRO_CORE_ROOT}/\`\n- Commands: \`${KYRO_COMMANDS_ROOT}/\`\n- Skills: \`${KYRO_SKILLS_ROOT}/\`\n- Project state: \`${KYRO_STATE_PATH}\`\n\nUse installed agent commands/skills when available. Do not require users to invoke Kyro workflows through natural-language fallbacks unless the host agent has no native command or skill mechanism.\n`;
}
