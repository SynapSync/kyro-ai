import { resolve } from 'node:path';

export const AGENT = {
  STANDARD: 'standard',
  OPENCODE: 'opencode',
  CLAUDE: 'claude',
  CODEX: 'codex',
  CURSOR: 'cursor',
} as const;

export const SCOPE = {
  WORKSPACE: 'workspace',
  GLOBAL: 'global',
} as const;

export const COMMAND_NAMES = ['forge', 'status', 'wrap-up'] as const;

export const PACKAGE_ROOT = resolve(__dirname, '../..');
export const WORKSPACE_ROOT = process.cwd();
export const WORKFLOW_NAME = 'kyro-ai';
export const KYRO_PROJECT_ROOT = '.agents/kyro';
export const ARTIFACT_ROOT = `${KYRO_PROJECT_ROOT}/scopes`;
export const KYRO_STATE_PATH = `${KYRO_PROJECT_ROOT}/kyro.json`;
export const GLOBAL_AGENTS_ROOT = '~/.agents';
export const KYRO_GLOBAL_ROOT = `${GLOBAL_AGENTS_ROOT}/kyro`;
export const KYRO_ROOT = `${KYRO_GLOBAL_ROOT}/current`;
export const KYRO_CORE_ROOT = `${KYRO_ROOT}/core`;
export const KYRO_COMMANDS_ROOT = `${KYRO_ROOT}/commands`;
export const KYRO_SKILLS_ROOT = `${KYRO_ROOT}/skills`;
export const AGENT_SKILLS_ROOT = `${GLOBAL_AGENTS_ROOT}/skills`;
export const KYRO_MANIFEST_PATH = `${KYRO_ROOT}/manifest.json`;

export function getKyroRuntimeRoot(version: string): string {
  return `${KYRO_GLOBAL_ROOT}/versions/${version}`;
}
