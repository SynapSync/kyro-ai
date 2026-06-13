import { AGENT, AGENT_SKILLS_ROOT, ARTIFACT_ROOT, KYRO_COMMANDS_ROOT, KYRO_ROOT } from '../constants';
import { hasManagedBlock } from '../fs';
import { addCommandSkillProjection, buildCommandSkillManagedFiles } from './command-skills';
import { checkCommandProjection } from './opencode';
import type { AdapterDefinition } from './registry-types';

const AGENTS_PATH = 'AGENTS.md';
const KYRO_AGENTS_BLOCK = 'agents-md';

export const codexAdapter: AdapterDefinition = {
  agent: AGENT.CODEX,
  displayName: 'Codex',
  status: 'implemented',
  buildProjection(plan) {
    addCommandSkillProjection(plan);
    plan.push({
      action: 'upsert-block',
      path: AGENTS_PATH,
      blockName: KYRO_AGENTS_BLOCK,
      content: buildAgentsBlock(),
    });
  },
  buildManagedFiles() {
    return buildCommandSkillManagedFiles();
  },
  buildManagedBlocks() {
    return [`${AGENTS_PATH}#${KYRO_AGENTS_BLOCK}`];
  },
  buildInstalledAdapter(scope, installedAt) {
    return {
      agent: AGENT.CODEX,
      scope,
      installedAt,
      corePath: KYRO_ROOT,
      commandsPath: AGENT_SKILLS_ROOT,
      skillsPath: AGENT_SKILLS_ROOT,
    };
  },
  doctor(manifest) {
    if (!manifest?.adapters.some((adapter) => adapter.agent === AGENT.CODEX)) {
      return { status: 'warn', name: 'Codex adapter', detail: 'not installed in this workspace' };
    }
    const commandCheck = checkCommandProjection('Codex adapter');
    if (commandCheck.status !== 'pass') return commandCheck;
    if (!hasManagedBlock(AGENTS_PATH, KYRO_AGENTS_BLOCK)) {
      return { status: 'fail', name: 'Codex adapter', detail: `missing Kyro block in ${AGENTS_PATH}`, remedy: 'Run kyro sync --agent codex.' };
    }
    return { status: 'pass', name: 'Codex adapter', detail: 'projected Kyro command skills and root AGENTS.md block present' };
  },
};

function buildAgentsBlock(): string {
  return `## Kyro AI\n\nKyro is installed in this workspace.\n\n### Rules\n\n- Prefer installed Kyro command skills from \`${AGENT_SKILLS_ROOT}/\` when invoking Kyro workflows.\n- Read command definitions from \`${KYRO_COMMANDS_ROOT}/\` only when a Kyro command skill asks for them.\n- Persist workflow artifacts under \`${ARTIFACT_ROOT}/{scope}/\`.\n- Do not ask users to describe Kyro workflows in natural language when an installed command or skill exists.\n- Preserve all non-Kyro content in this AGENTS.md file. Kyro owns only this marked block.\n\n### Core\n\nThe managed Kyro core lives in \`${KYRO_ROOT}/\`.\n`;
}
