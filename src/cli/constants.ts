import { resolve } from 'node:path';

export const AGENT = {
  OPENCODE: 'opencode',
  GENERIC: 'generic',
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
export const WORKFLOW_NAME = 'kyro-workflow';
export const ARTIFACT_ROOT = '.agents/sprint-forge';
export const KYRO_ROOT = '.agents/kyro-workflow';
export const KYRO_CORE_ROOT = `${KYRO_ROOT}/core`;
export const KYRO_COMMANDS_ROOT = `${KYRO_ROOT}/commands`;
export const KYRO_SKILLS_ROOT = `${KYRO_ROOT}/skills`;
export const AGENT_SKILLS_ROOT = '.agents/skills';
export const KYRO_STATE_PATH = `${ARTIFACT_ROOT}/kyro.json`;
export const KYRO_MANIFEST_PATH = `${KYRO_ROOT}/manifest.json`;
