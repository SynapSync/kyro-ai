import { AGENT } from '../constants';
import type { Agent } from '../types';
import { codexAdapter } from './codex';
import { detectFromPaths } from './detection';
import { openCodeAdapter } from './opencode';
import { standardAgentsAdapter } from './standard';
import type { AdapterDefinition, AdapterPaths, MCPStrategy, SystemPromptStrategy } from './registry-types';

const plannedAdapter = (
  agent: Agent,
  displayName: string,
  buildPaths: (homeDir: string) => AdapterPaths,
  systemPromptStrategy: SystemPromptStrategy,
  mcpStrategy: MCPStrategy,
  binaryName: string | null,
): AdapterDefinition => ({
  agent,
  displayName,
  status: 'planned',
  capabilities() {
    return [];
  },
  paths(homeDir) {
    return buildPaths(homeDir);
  },
  detect(context) {
    return detectFromPaths(agent, binaryName, buildPaths(context.homeDir), context, `${displayName} adapter is planned`);
  },
  systemPromptStrategy() {
    return systemPromptStrategy;
  },
  mcpStrategy() {
    return mcpStrategy;
  },
  buildProjection() {},
  buildRemoval() {},
  buildManagedFiles() {
    return [];
  },
  buildManagedBlocks() {
    return [];
  },
  buildInstalledAdapter(scope, installedAt) {
    return { agent, scope, installedAt, corePath: '~/.agents/kyro/current' };
  },
  doctor() {
    return { status: 'warn', name: `${displayName} adapter`, detail: 'planned but not implemented yet' };
  },
});

export const ADAPTERS: AdapterDefinition[] = [
  standardAgentsAdapter,
  openCodeAdapter,
  codexAdapter,
  plannedAdapter(
    AGENT.CLAUDE,
    'Claude plugin',
    (homeDir) => ({
      globalConfigDir: `${homeDir}/.claude`,
      systemPromptPath: `${homeDir}/.claude/CLAUDE.md`,
      skillsDir: `${homeDir}/.claude/skills`,
      commandsDir: `${homeDir}/.claude/commands`,
      settingsPath: `${homeDir}/.claude/settings.json`,
      mcpConfigPath: `${homeDir}/.claude/mcp`,
      subAgentsDir: `${homeDir}/.claude/agents`,
      outputStylesDir: `${homeDir}/.claude/output-styles`,
    }),
    'managed-block',
    'separate-files',
    'claude',
  ),
  plannedAdapter(
    AGENT.CURSOR,
    'Cursor',
    (homeDir) => ({
      globalConfigDir: `${homeDir}/.cursor`,
      systemPromptPath: `${homeDir}/.cursor/rules/kyro-ai.mdc`,
      skillsDir: `${homeDir}/.cursor/skills`,
      mcpConfigPath: `${homeDir}/.cursor/mcp.json`,
    }),
    'instructions-file',
    'mcp-json-file',
    null,
  ),
];

export function getAdapterDefinition(agent: Agent): AdapterDefinition {
  const definition = ADAPTERS.find((adapter) => adapter.agent === agent);
  if (!definition) throw new Error(`Unknown adapter: ${agent}`);
  return definition;
}

export function getInstallableAdapters(): AdapterDefinition[] {
  return ADAPTERS.filter((adapter) => adapter.status === 'implemented');
}

export function getInstalledAdapterDefinitions(agents: Agent[]): AdapterDefinition[] {
  return agents.map((agent) => getAdapterDefinition(agent));
}
