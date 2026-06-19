import { homedir } from 'node:os';
import { getAdapterDefinition } from '../adapters/registry';
import type { AdapterDefinition, DetectionResult } from '../adapters/registry-types';
import type { Agent, OperationPlan } from '../types';

export interface AdapterPreflightResult {
  adapter: AdapterDefinition;
  detection: DetectionResult;
  managedFiles: string[];
  managedBlocks: string[];
}

export function runAdapterPreflight(command: 'install' | 'sync', agents: Agent[]): AdapterPreflightResult[] {
  const results = agents.map((agent) => {
    const adapter = getAdapterDefinition(agent);
    return {
      adapter,
      detection: adapter.detect({ homeDir: homedir(), envPath: process.env.PATH ?? '' }),
      managedFiles: adapter.buildManagedFiles(),
      managedBlocks: adapter.buildManagedBlocks(),
    };
  });

  printAdapterPreflight(command, results);
  assertPreflightInstallable(results);
  return results;
}

function printAdapterPreflight(command: 'install' | 'sync', results: AdapterPreflightResult[]): void {
  console.log(`Adapter preflight (${command})`);
  for (const result of results) {
    const capabilityText = result.adapter.capabilities().length > 0 ? result.adapter.capabilities().join(',') : 'none';
    const detectionText = result.detection.installed ? 'detected' : 'not-detected';
    const nativeTargets = describeNativeTargets(result);
    console.log(`- ${result.adapter.agent}: status=${result.adapter.status}; detection=${detectionText}; config=${result.detection.configPath ?? 'none'}; binary=${result.detection.binaryPath ?? 'not-found'}; capabilities=${capabilityText}; nativeTargets=${nativeTargets}`);
  }
}

function assertPreflightInstallable(results: AdapterPreflightResult[]): void {
  const planned = results.filter((result) => result.adapter.status === 'planned');
  if (planned.length > 0) {
    throw new Error(`Agent adapter not implemented yet: ${planned.map((result) => result.adapter.agent).join(', ')}. Planned adapters are visible in detect/preflight but cannot be installed until their native projection is implemented.`);
  }
}

function describeNativeTargets(result: AdapterPreflightResult): string {
  const targets: string[] = [];
  if (result.managedFiles.length > 0) targets.push(`${result.managedFiles.length} files`);
  if (result.managedBlocks.length > 0) targets.push(`${result.managedBlocks.length} blocks`);
  if (targets.length === 0) return 'none';
  return targets.join(', ');
}

export function summarizePlanTargets(plan: OperationPlan[]): string {
  const paths = new Set(plan.map((operation) => operation.path));
  return `${plan.length} operations across ${paths.size} targets`;
}
