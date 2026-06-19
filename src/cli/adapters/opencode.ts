import { AGENT, ARTIFACT_ROOT, COMMAND_NAMES, KYRO_COMMANDS_ROOT, KYRO_ROOT } from '../constants';
import type { AdapterDefinition } from './registry-types';
import { addCommandSkillProjectionToRoot, buildCommandSkillManagedFilesForRoot } from './command-skills';
import { managedPathExists } from '../fs';
import { detectFromPaths } from './detection';
import type { CheckResult, KyroCommandName, OperationPlan } from '../types';

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
    if (!manifest?.adapters.some((adapter) => adapter.agent === AGENT.OPENCODE)) {
      return { status: 'warn', name: 'OpenCode adapter', detail: 'not installed in this workspace' };
    }
    return checkOpenCodeProjection();
  },
};

function addOpenCodeProjection(plan: OperationPlan[]): void {
  addCommandSkillProjectionToRoot(plan, OPENCODE_SKILLS_ROOT);
  for (const command of COMMAND_NAMES) {
    plan.push({
      action: 'write',
      path: `${OPENCODE_COMMANDS_ROOT}/kyro/${command}.md`,
      content: buildOpenCodeCommand(command),
    });
  }
  plan.push({
    action: 'merge-json',
    path: OPENCODE_SETTINGS_PATH,
    content: JSON.stringify(buildOpenCodeSettingsOverlay()),
  });
}

function removeOpenCodeProjection(plan: OperationPlan[]): void {
  plan.push({ action: 'remove-json-key', path: OPENCODE_SETTINGS_PATH, jsonPath: `agent.${KYRO_OPENCODE_AGENT}` });
}

function buildOpenCodeManagedFiles(): string[] {
  return [
    ...buildCommandSkillManagedFilesForRoot(OPENCODE_SKILLS_ROOT),
    ...COMMAND_NAMES.map((command) => `${OPENCODE_COMMANDS_ROOT}/kyro/${command}.md`),
  ];
}

function buildOpenCodeCommand(command: KyroCommandName): string {
  const description = command === 'forge'
    ? 'Run the Kyro forge workflow'
    : command === 'status'
      ? 'Show Kyro project status'
      : 'Close the Kyro session';
  return `---\ndescription: ${description}\n---\n\nLoad \`${OPENCODE_SKILLS_ROOT}/kyro-${command}/SKILL.md\` and follow it. The skill must read \`${KYRO_COMMANDS_ROOT}/${command}.md\` first, then load only the routed Kyro mode/helper files.\n\nRuntime: \`${KYRO_ROOT}/\`\nArtifacts: \`${ARTIFACT_ROOT}/{scope}/\`\n\nDo not inline the full Kyro workflow or ask the user to restate it.\n`;
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
    `Read ${KYRO_COMMANDS_ROOT}/{forge,status,wrap-up}.md first, then load only the routed Kyro mode/helper files.`,
    `Runtime: ${KYRO_ROOT}/`,
    `Artifacts: ${ARTIFACT_ROOT}/{scope}/`,
    'Do not inline the full Kyro workflow or overwrite non-Kyro OpenCode configuration.',
  ].join('\n');
}

function checkOpenCodeProjection(): CheckResult {
  const missing = buildOpenCodeManagedFiles().filter((file) => !managedPathExists(file));
  if (missing.length > 0) {
    return { status: 'fail', name: 'OpenCode adapter', detail: `missing ${missing.join(', ')}`, remedy: 'Run kyro sync --agent opencode.' };
  }
  return { status: 'pass', name: 'OpenCode adapter', detail: 'native OpenCode skills and slash commands present' };
}
