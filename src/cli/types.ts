import type { AGENT, COMMAND_NAMES, SCOPE } from './constants';

export type Agent = (typeof AGENT)[keyof typeof AGENT];
export type InstallScope = (typeof SCOPE)[keyof typeof SCOPE];
export type KyroCommandName = (typeof COMMAND_NAMES)[number];

export interface KyroInstalledAdapter {
  agent: Agent;
  scope: InstallScope;
  installedAt: string;
  corePath: string;
  commandsPath?: string;
  skillsPath?: string;
}

export interface KyroProjectState {
  schemaVersion: 1;
  artifactRoot: string;
  scopes: string[];
  activeScope: string | null;
  runtimeVersion: string;
  runtimePath: string;
  installedAdapters: KyroInstalledAdapter[];
}

export interface KyroManifest {
  schemaVersion: 1;
  packageName: string;
  packageVersion: string;
  installedAt: string;
  installScope: InstallScope;
  managedFiles: string[];
  managedBlocks: string[];
  adapters: KyroInstalledAdapter[];
}

export interface CliOptions {
  agents: Agent[];
  scope: InstallScope;
  dryRun: boolean;
  yes: boolean;
  help: boolean;
  tokens: boolean;
}

export interface OperationPlan {
  action: 'write' | 'copy' | 'mkdir' | 'remove' | 'upsert-block' | 'remove-block' | 'symlink';
  path: string;
  source?: string;
  content?: string;
  blockName?: string;
}

export interface CheckResult {
  status: 'pass' | 'warn' | 'fail';
  name: string;
  detail: string;
  remedy?: string;
}
