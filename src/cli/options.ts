import { AGENT, SCOPE } from './constants';
import { getAdapterDefinition, getInstallableAdapters } from './adapters/registry';
import type { Agent, CliOptions, InstallScope } from './types';

export function parseOptions(args: string[]): CliOptions {
  const agents: Agent[] = [];
  let scope: InstallScope = SCOPE.WORKSPACE;
  let dryRun = false;
  let yes = false;
  let help = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--yes' || arg === '-y') {
      yes = true;
    } else if (arg === '--help' || arg === '-h') {
      help = true;
    } else if (arg === '--agent' || arg === '--agents') {
      const value = args[i + 1];
      if (!value) throw new Error(`${arg} requires a value`);
      agents.push(...parseAgents(value));
      i += 1;
    } else if (arg.startsWith('--agent=')) {
      agents.push(...parseAgents(arg.slice('--agent='.length)));
    } else if (arg.startsWith('--agents=')) {
      agents.push(...parseAgents(arg.slice('--agents='.length)));
    } else if (arg === '--scope') {
      const value = args[i + 1];
      if (!value) throw new Error('--scope requires a value');
      scope = parseScope(value);
      i += 1;
    } else if (arg.startsWith('--scope=')) {
      scope = parseScope(arg.slice('--scope='.length));
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return {
    agents: uniqueAgents(agents),
    scope,
    dryRun,
    yes,
    help,
  };
}

export function parseAgent(value: string): Agent {
  const normalized = value.toLowerCase();
  if (normalized === 'standard' || normalized === 'agents' || normalized === '.agents' || normalized === 'default') return AGENT.STANDARD;
  if (normalized === 'opencode') return AGENT.OPENCODE;
  if (normalized === 'claude' || normalized === 'claude-code') return AGENT.CLAUDE;
  if (normalized === 'codex') return AGENT.CODEX;
  if (normalized === 'cursor') return AGENT.CURSOR;
  throw new Error(`Unsupported agent: ${value}. Supported now: ${getInstallableAdapters().map((adapter) => adapter.agent).join(', ')}. Use root AGENTS.md for cross-agent instructions; no generic adapter is installed.`);
}

export function parseScope(value: string): InstallScope {
  if (value === SCOPE.WORKSPACE) return SCOPE.WORKSPACE;
  if (value === SCOPE.GLOBAL) return SCOPE.GLOBAL;
  throw new Error(`Unsupported scope: ${value}. Use workspace or global.`);
}

export function uniqueAgents(agents: Agent[]): Agent[] {
  return [...new Set(agents)];
}

export function assertWorkspaceScope(scope: InstallScope): void {
  if (scope !== SCOPE.WORKSPACE) {
    throw new Error('Only --scope workspace is implemented in Plan B Sprint 1. Global install is planned but not active yet.');
  }
}

export function assertInstallableAgents(agents: Agent[]): void {
  const unsupported = agents.filter((agent) => getAdapterDefinition(agent).status !== 'implemented');
  if (unsupported.length > 0) {
    throw new Error(`Agent adapter not implemented yet: ${unsupported.join(', ')}. Implemented now: ${getInstallableAdapters().map((adapter) => adapter.agent).join(', ')}. Claude plugin remains first-class through .claude-plugin/.`);
  }
}

function parseAgents(value: string): Agent[] {
  return value.split(',').map((item) => parseAgent(item.trim())).filter(Boolean);
}
