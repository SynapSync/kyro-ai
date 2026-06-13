import { AGENT } from '../constants';
import type { Agent } from '../types';
import { codexAdapter } from './codex';
import { openCodeAdapter } from './opencode';
import { standardAgentsAdapter } from './standard';
import type { AdapterDefinition } from './registry-types';

const plannedAdapter = (agent: Agent, displayName: string): AdapterDefinition => ({
  agent,
  displayName,
  status: 'planned',
  buildProjection() {},
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
  plannedAdapter(AGENT.CLAUDE, 'Claude plugin'),
  plannedAdapter(AGENT.CURSOR, 'Cursor'),
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
