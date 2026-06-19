import type { Agent, CheckResult, InstallScope, KyroInstalledAdapter, KyroManifest, OperationPlan } from '../types';

export type AdapterStatus = 'implemented' | 'planned';
export type AdapterCapability =
  | 'command-skills'
  | 'workspace-agents-block'
  | 'system-prompt'
  | 'mcp'
  | 'slash-commands'
  | 'sub-agents'
  | 'output-styles'
  | 'filesystem-detect'
  | 'auto-install';

export type SystemPromptStrategy = 'managed-block' | 'file-replace' | 'append' | 'instructions-file' | 'json-agent-overlay' | 'none';
export type MCPStrategy = 'separate-files' | 'merge-json-settings' | 'mcp-json-file' | 'toml-file' | 'yaml-merge' | 'none';

export interface AdapterPaths {
  globalConfigDir?: string;
  systemPromptPath?: string;
  skillsDir?: string;
  commandsDir?: string;
  settingsPath?: string;
  mcpConfigPath?: string;
  subAgentsDir?: string;
  outputStylesDir?: string;
}

export interface DetectionContext {
  homeDir: string;
  envPath?: string;
}

export interface DetectionResult {
  agent: Agent;
  installed: boolean;
  binaryPath: string | null;
  configFound: boolean;
  configPath: string | null;
  detail: string;
}

export interface AdapterDefinition {
  agent: Agent;
  displayName: string;
  status: AdapterStatus;
  capabilities(): AdapterCapability[];
  paths(homeDir: string): AdapterPaths;
  detect(context: DetectionContext): DetectionResult;
  systemPromptStrategy(): SystemPromptStrategy;
  mcpStrategy(): MCPStrategy;
  buildProjection(plan: OperationPlan[]): void;
  buildRemoval(plan: OperationPlan[]): void;
  buildManagedFiles(): string[];
  buildManagedBlocks(): string[];
  buildInstalledAdapter(scope: InstallScope, installedAt: string): KyroInstalledAdapter;
  doctor(manifest: KyroManifest | null): CheckResult;
}
