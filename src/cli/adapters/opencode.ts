import { AGENT, AGENT_SKILLS_ROOT, ARTIFACT_ROOT, COMMAND_NAMES, KYRO_COMMANDS_ROOT, KYRO_ROOT } from '../constants';
import type { AdapterDefinition } from './registry-types';
import { addCommandSkillProjection, buildCommandSkillManagedFilesForRoot, getCommandDescription } from './command-skills';
import { addLinkDirectoryPlan, managedPathExists, resolveManagedPath } from '../fs';
import { lstatSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { KyroCoreError } from '../core/errors';
import { assertSafeLinkedSkillWrite } from './claude';
import { detectFromPaths } from './detection';
import type { CheckResult, KyroCommandName, OperationPlan } from '../types';
import { readManifest } from '../state';
import { FULL_PACKAGE_SYNC_REMEDY } from '../package-root-mode';
import { checkCommandProjection } from './standard';

const OPENCODE_SKILLS_ROOT = '~/.config/opencode/skills';
const OPENCODE_COMMANDS_ROOT = '~/.config/opencode/commands';
const OPENCODE_SETTINGS_PATH = '~/.config/opencode/opencode.json';
const KYRO_OPENCODE_AGENT = 'kyro-orchestrator';

export const openCodeAdapter: AdapterDefinition = {
  agent: AGENT.OPENCODE,
  displayName: 'OpenCode',
  status: 'implemented',
  capabilities() {
    return ['command-skills', 'filesystem-detect', 'system-prompt', 'slash-commands'];
  },
  paths(homeDir) {
    return {
      globalConfigDir: `${homeDir}/.config/opencode`,
      systemPromptPath: `${homeDir}/.config/opencode/AGENTS.md`,
      skillsDir: `${homeDir}/.config/opencode/skills`,
      commandsDir: `${homeDir}/.config/opencode/commands`,
      settingsPath: `${homeDir}/.config/opencode/opencode.json`,
      mcpConfigPath: `${homeDir}/.config/opencode/opencode.json`,
    };
  },
  detect(context) {
    return detectFromPaths(AGENT.OPENCODE, 'opencode', this.paths(context.homeDir), context, 'OpenCode adapter');
  },
  systemPromptStrategy() {
    return 'json-agent-overlay';
  },
  mcpStrategy() {
    return 'none';
  },
  buildProjection: addOpenCodeProjection,
  buildRemoval: removeOpenCodeProjection,
  buildMcpProjection() {},
  buildMcpRemoval() {},
  buildManagedFiles: buildOpenCodeManagedFiles,
  buildManagedBlocks() {
    return [`${OPENCODE_SETTINGS_PATH}#agent.${KYRO_OPENCODE_AGENT}`];
  },
  buildInstalledAdapter(scope, installedAt) {
    return {
      agent: AGENT.OPENCODE,
      scope,
      installedAt,
      corePath: KYRO_ROOT,
      commandsPath: OPENCODE_COMMANDS_ROOT,
      skillsPath: OPENCODE_SKILLS_ROOT,
    };
  },
  doctor(manifest) {
    return checkOpenCodeProjection(manifest?.packageVersion);
  },
};

function addOpenCodeProjection(plan: OperationPlan[], options?: { integrations: boolean; includeWorkspace: boolean }): void {
  addCommandSkillProjection(plan);
  const previous = readManifest();
  for (const file of buildCommandSkillManagedFilesForRoot(OPENCODE_SKILLS_ROOT)) {
    const path = file.slice(0, -'/SKILL.md'.length);
    addLinkDirectoryPlan(plan, `${AGENT_SKILLS_ROOT}/${path.split('/').at(-1)}`, path);
    const operation = plan.find((operation) => operation.path === path)!;
    operation.guard = 'opencode-skill';
    operation.allowExistingManagedSkill = previous?.adapters.some((adapter) => adapter.agent === AGENT.OPENCODE)
      && (previous.managedFiles.includes(file) || previous.managedFiles.includes(path));
  }
  for (const command of COMMAND_NAMES) {
    const path = `${OPENCODE_COMMANDS_ROOT}/kyro/${command}.md`;
    plan.push({
      action: 'write',
      path,
      content: buildOpenCodeCommand(command),
      guard: 'opencode-command',
      allowExistingManagedSkill: previous?.adapters.some((adapter) => adapter.agent === AGENT.OPENCODE)
        && previous.managedFiles.includes(path),
    });
  }
  if (!options?.integrations) return;
  plan.push({
    action: 'merge-json',
    path: OPENCODE_SETTINGS_PATH,
    content: JSON.stringify(buildOpenCodeSettingsOverlay()),
  });
}

/** Native commands must be real, manifest-owned files; never follow a link. */
export function assertSafeOpenCodeCommandWrite(managedPath: string, allowExisting: boolean): void {
  if (!COMMAND_NAMES.some((command) => managedPath === `${OPENCODE_COMMANDS_ROOT}/kyro/${command}.md`)) {
    throw new KyroCoreError('INVALID_INPUT', `Not an OpenCode command projection: ${managedPath}.`);
  }
  const target = resolveManagedPath(managedPath);
  assertRealOpenCodeDirectories(dirname(target));
  const stat = openCodeStatIfPresent(target);
  if (stat && (!stat.isFile() || !allowExisting)) {
    throw new KyroCoreError('INVALID_INPUT', `Unsafe or foreign OpenCode command target: ${target}.`, 'Move the existing path aside; Kyro writes only real files owned by the previous manifest.');
  }
}

export function assertSafeOpenCodeSkillWrite(managedPath: string, allowExisting: boolean): void {
  assertRealOpenCodeDirectories(resolveManagedPath(OPENCODE_SKILLS_ROOT));
  const directory = managedPath.endsWith('/SKILL.md') ? dirname(resolveManagedPath(managedPath)) : resolveManagedPath(managedPath);
  if (!allowExisting && openCodeStatIfPresent(directory)) {
    throw new KyroCoreError('INVALID_INPUT', `Foreign OpenCode skill target: ${directory}.`, 'Move the existing path aside; the previous manifest did not own it.');
  }
  assertSafeLinkedSkillWrite(managedPath, allowExisting, OPENCODE_SKILLS_ROOT, 'OpenCode');
}

function assertRealOpenCodeDirectories(directory: string): void {
  const home = resolveManagedPath('~');
  for (let current = directory; current !== home; current = dirname(current)) {
    const stat = openCodeStatIfPresent(current);
    if (stat && !stat.isDirectory()) {
      throw new KyroCoreError('INVALID_INPUT', `Unsafe OpenCode directory: ${current}.`, 'Move the symlink or non-directory aside; Kyro will not follow it.');
    }
  }
}

function openCodeStatIfPresent(path: string): ReturnType<typeof lstatSync> | null {
  try { return lstatSync(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function removeOpenCodeProjection(plan: OperationPlan[]): void {
  plan.push({ action: 'remove-json-key', path: OPENCODE_SETTINGS_PATH, jsonPath: `agent.${KYRO_OPENCODE_AGENT}` });
}

function buildOpenCodeManagedFiles(): string[] {
  // Own only native links and commands; their canonical targets belong to the machine.
  return [
    ...buildCommandSkillManagedFilesForRoot(OPENCODE_SKILLS_ROOT).map((file) => file.slice(0, -'/SKILL.md'.length)),
    ...buildCommandSkillManagedFilesForRoot(OPENCODE_SKILLS_ROOT),
    ...COMMAND_NAMES.map((command) => `${OPENCODE_COMMANDS_ROOT}/kyro/${command}.md`),
  ];
}

function buildOpenCodeCommand(command: KyroCommandName): string {
  // check:seedbed treats this native command copy as a discovery contract.
  const description = command === 'idea'
    ? 'Mature a rough or mature idea into an execution-ready plan before starting a scope'
    : getCommandDescription(command);
  return `---\ndescription: ${JSON.stringify(description)}\n---\n\nLoad \`${OPENCODE_SKILLS_ROOT}/kyro-${command}/SKILL.md\` and follow it. The skill must read \`${KYRO_COMMANDS_ROOT}/${command}.md\` first, then load only the routed Kyro mode/helper files.\n\nRuntime: \`${KYRO_ROOT}/\`\nArtifacts: \`${ARTIFACT_ROOT}/{scope}/\`\n\nDo not inline the full Kyro workflow or ask the user to restate it.\n`;
}

function buildOpenCodeSettingsOverlay(): Record<string, unknown> {
  return {
    agent: {
      [KYRO_OPENCODE_AGENT]: {
        mode: 'primary',
        prompt: buildOpenCodeAgentPrompt(),
      },
    },
  };
}

function buildOpenCodeAgentPrompt(): string {
  return [
    'You are the Kyro workflow orchestrator inside OpenCode.',
    `Use native OpenCode commands in ${OPENCODE_COMMANDS_ROOT}/kyro/ and skills in ${OPENCODE_SKILLS_ROOT}/kyro-*.`,
    `Read ${KYRO_COMMANDS_ROOT}/{forge,status,task-context,idea,work}.md only for the explicitly invoked command, then load only its routed files.`,
    `Runtime: ${KYRO_ROOT}/`,
    `Artifacts: ${ARTIFACT_ROOT}/{scope}/`,
    'Do not inline the full Kyro workflow or overwrite non-Kyro OpenCode configuration.',
  ].join('\n');
}

function checkOpenCodeProjection(runtimeVersion?: string): CheckResult {
  const check = checkCommandProjection('OpenCode adapter', runtimeVersion, OPENCODE_SKILLS_ROOT);
  for (const file of buildCommandSkillManagedFilesForRoot(OPENCODE_SKILLS_ROOT)) {
    try { assertSafeOpenCodeSkillWrite(file, true); }
    catch (error) { return { ...check, status: 'fail', detail: `${check.detail}; ${String(error)}`, remedy: FULL_PACKAGE_SYNC_REMEDY }; }
  }
  for (const command of COMMAND_NAMES) {
    const path = `${OPENCODE_COMMANDS_ROOT}/kyro/${command}.md`;
    try {
      assertSafeOpenCodeCommandWrite(path, true);
      if (managedPathExists(path) && !readFileSync(resolveManagedPath(path)).equals(Buffer.from(buildOpenCodeCommand(command), 'utf8'))) {
        throw new Error(`Native OpenCode command content mismatch: ${resolveManagedPath(path)}.`);
      }
    }
    catch (error) { return { ...check, status: 'fail', detail: `${check.detail}; ${String(error)}`, remedy: FULL_PACKAGE_SYNC_REMEDY }; }
  }
  if (check.status !== 'pass') return check;
  const missing = buildOpenCodeManagedFiles().filter((file) => !managedPathExists(file));
  if (missing.length > 0) {
    return { ...check, status: 'fail', detail: `${check.detail}; missing ${missing.join(', ')}`, remedy: FULL_PACKAGE_SYNC_REMEDY };
  }
  return { ...check, detail: `${check.detail}; native OpenCode slash commands present` };
}
