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

export const COMMAND_NAMES = ['forge', 'status', 'task-context', 'idea', 'qa', 'scope-retire'] as const;

export const PACKAGE_ROOT = resolve(__dirname, '../..');
export const WORKSPACE_ROOT = process.cwd();
export const WORKFLOW_NAME = 'kyro-ai';
export const KYRO_PROJECT_ROOT = '.agents/kyro';
export const ARTIFACT_ROOT = `${KYRO_PROJECT_ROOT}/scopes`;
/**
 * Shared (team-owned) project state — safe to commit.
 * Holds principles, optional team policy, and non-personal registry metadata.
 * Must never store activeScope (see KyroSharedProjectState ownership table).
 */
export const PROJECT_STATE_PATH = `${KYRO_PROJECT_ROOT}/project.json`;
/**
 * Local (personal/machine) overlay — gitignored under `.agents/kyro/`.
 * Holds activeScope and installedAdapters.
 */
export const LOCAL_STATE_PATH = `${KYRO_PROJECT_ROOT}/local.json`;
/**
 * Legacy monolito project state (pre-layered). Dual-read during migration window;
 * new writers must not target this path once layers exist.
 * @deprecated Prefer PROJECT_STATE_PATH + LOCAL_STATE_PATH; kept for dual-read/migrate.
 */
export const KYRO_STATE_PATH = `${KYRO_PROJECT_ROOT}/kyro.json`;
/** Paths involved in layered project-state resolution (shared, local, legacy monolito). */
export const PROJECT_STATE_LAYER_PATHS = [PROJECT_STATE_PATH, LOCAL_STATE_PATH, KYRO_STATE_PATH] as const;
export const GLOBAL_AGENTS_ROOT = '~/.agents';
export const KYRO_GLOBAL_ROOT = `${GLOBAL_AGENTS_ROOT}/kyro`;
export const KYRO_ROOT = `${KYRO_GLOBAL_ROOT}/current`;
export const KYRO_LEGACY_VERSIONS_ROOT = `${KYRO_GLOBAL_ROOT}/versions`;
export const KYRO_CORE_ROOT = `${KYRO_ROOT}/core`;
export const KYRO_COMMANDS_ROOT = `${KYRO_ROOT}/commands`;
export const KYRO_SKILLS_ROOT = `${KYRO_ROOT}/skills`;
export const AGENT_SKILLS_ROOT = `${GLOBAL_AGENTS_ROOT}/skills`;
export const KYRO_MANIFEST_PATH = `${KYRO_ROOT}/manifest.json`;
