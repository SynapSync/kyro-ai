import { homedir } from 'node:os';
import { AGENT, AGENT_SKILLS_ROOT, ARTIFACT_ROOT, KYRO_ROOT } from '../constants';
import { hasManagedBlock } from '../fs';
import { resolveKyroInvocation } from '../invocation';
import { addCommandSkillProjection, buildCommandSkillManagedFiles } from './command-skills';
import { checkCommandProjection } from './standard';
import type { AdapterDefinition } from './registry-types';
import { detectFromPaths } from './detection';

const AGENTS_PATH = 'AGENTS.md';
const KYRO_AGENTS_BLOCK = 'agents-md';
const CODEX_MCP_CONFIG_PATH = '~/.codex/config.toml';
const KYRO_MCP_BLOCK = 'mcp-server-kyro';

export const codexAdapter: AdapterDefinition = {
  agent: AGENT.CODEX,
  displayName: 'Codex',
  status: 'implemented',
  capabilities() {
    return ['command-skills', 'workspace-agents-block', 'filesystem-detect', 'system-prompt', 'mcp'];
  },
  paths(homeDir) {
    return {
      globalConfigDir: `${homeDir}/.codex`,
      systemPromptPath: `${homeDir}/.codex/AGENTS.md`,
      skillsDir: `${homeDir}/.codex/skills`,
      mcpConfigPath: `${homeDir}/.codex/config.toml`,
    };
  },
  detect(context) {
    return detectFromPaths(AGENT.CODEX, 'codex', this.paths(context.homeDir), context, 'Codex adapter');
  },
  systemPromptStrategy() {
    return 'managed-block';
  },
  mcpStrategy() {
    return 'toml-file';
  },
  buildProjection(plan) {
    addCommandSkillProjection(plan);
    plan.push({
      action: 'upsert-block',
      path: AGENTS_PATH,
      blockName: KYRO_AGENTS_BLOCK,
      content: buildAgentsBlock(),
    });
  },
  buildRemoval(plan) {
    plan.push({ action: 'remove-block', path: AGENTS_PATH, blockName: KYRO_AGENTS_BLOCK });
  },
  buildMcpProjection(plan) {
    // Emit the resolved runnable invocation, not a bare `kyro`: when no `kyro` binary is on
    // PATH the command becomes `node {runtimeRoot}/dist/cli.js` so the MCP server still starts.
    // Codex spawns this command itself (not via a shell), so a literal `~` in the args would NOT
    // expand — expand it to an absolute path here (this TOML is written into the user's own
    // ~/.codex/config.toml, so an absolute home path is correct and machine-appropriate).
    const invocation = resolveKyroInvocation();
    const command = expandHome(invocation.command);
    const args = [...invocation.args.map(expandHome), 'mcp', 'serve'];
    plan.push({
      action: 'upsert-block',
      path: CODEX_MCP_CONFIG_PATH,
      blockName: KYRO_MCP_BLOCK,
      commentStyle: 'hash',
      content: `[mcp_servers.kyro]\ncommand = ${JSON.stringify(command)}\nargs = ${JSON.stringify(args)}`,
    });
  },
  buildMcpRemoval(plan) {
    plan.push({ action: 'remove-block', path: CODEX_MCP_CONFIG_PATH, blockName: KYRO_MCP_BLOCK, commentStyle: 'hash' });
  },
  buildManagedFiles() {
    return buildCommandSkillManagedFiles();
  },
  buildManagedBlocks() {
    return [`${AGENTS_PATH}#${KYRO_AGENTS_BLOCK}`, `${CODEX_MCP_CONFIG_PATH}#${KYRO_MCP_BLOCK}`];
  },
  buildInstalledAdapter(scope, installedAt) {
    return {
      agent: AGENT.CODEX,
      scope,
      installedAt,
      corePath: KYRO_ROOT,
      commandsPath: AGENT_SKILLS_ROOT,
      skillsPath: AGENT_SKILLS_ROOT,
    };
  },
  doctor(manifest) {
    if (!manifest?.adapters.some((adapter) => adapter.agent === AGENT.CODEX)) {
      return { status: 'warn', name: 'Codex adapter', detail: 'not installed in this workspace' };
    }
    const commandCheck = checkCommandProjection('Codex adapter');
    if (commandCheck.status !== 'pass') return commandCheck;
    if (!hasManagedBlock(AGENTS_PATH, KYRO_AGENTS_BLOCK)) {
      return { status: 'fail', name: 'Codex adapter', detail: `missing Kyro block in ${AGENTS_PATH}`, remedy: 'Run kyro sync --agent codex.' };
    }
    return { status: 'pass', name: 'Codex adapter', detail: 'projected Kyro command skills and root AGENTS.md block present' };
  },
};

/** Expand a leading `~` to the user's home dir; codex spawns the MCP command without a shell. */
function expandHome(segment: string): string {
  return segment === '~' || segment.startsWith('~/') ? homedir() + segment.slice(1) : segment;
}

function buildAgentsBlock(): string {
  return `## Kyro AI\n\nUse installed Kyro command skills: \`kyro-forge\`, \`kyro-status\`, \`kyro-wrap-up\`, \`kyro-task-context\`, \`kyro-idea\`.\n\nRuntime: \`${KYRO_ROOT}/\`\nProject state: \`.agents/kyro/kyro.json\`\nArtifacts: \`${ARTIFACT_ROOT}/{scope}/\`\nSkills: \`${AGENT_SKILLS_ROOT}/kyro-*\`\n\nLoad command routers only when a Kyro skill is invoked. Do not load full Kyro docs unless the router asks for them. Preserve non-Kyro content; Kyro owns only this marked block.\n`;
}
