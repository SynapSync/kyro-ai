import { homedir } from 'node:os';
import { ADAPTERS, getAdapterDefinition } from '../adapters/registry';
import type { AdapterDefinition } from '../adapters/registry-types';
import type { CliOptions } from '../types';

export function detect(options: Pick<CliOptions, 'agents' | 'json'>): void {
  const adapters = selectedAdapters(options.agents);
  const results = adapters.map((adapter) => {
    const detection = adapter.detect({ homeDir: homedir(), envPath: process.env.PATH ?? '' });
    return {
      agent: adapter.agent,
      displayName: adapter.displayName,
      status: adapter.status,
      installed: detection.installed,
      binaryPath: detection.binaryPath,
      configFound: detection.configFound,
      configPath: detection.configPath,
      capabilities: adapter.capabilities(),
      systemPromptStrategy: adapter.systemPromptStrategy(),
      mcpStrategy: adapter.mcpStrategy(),
      detail: detection.detail,
    };
  });

  if (options.json) {
    console.log(JSON.stringify({ adapters: results }, null, 2));
    return;
  }

  for (const result of results) {
    const state = result.installed ? 'detected' : 'not-detected';
    const capabilityText = result.capabilities.length > 0 ? result.capabilities.join(',') : 'none';
    console.log(`[${state}] ${result.agent}: status=${result.status}; config=${result.configPath ?? 'none'}; binary=${result.binaryPath ?? 'not-found'}; capabilities=${capabilityText}; systemPromptStrategy=${result.systemPromptStrategy}; mcpStrategy=${result.mcpStrategy}`);
  }
}

function selectedAdapters(agents: CliOptions['agents']): AdapterDefinition[] {
  if (agents.length === 0) return ADAPTERS;
  return agents.map((agent) => getAdapterDefinition(agent));
}
