import { AGENT, AGENT_SKILLS_ROOT, ARTIFACT_ROOT, KYRO_ROOT } from '../constants';
import { hasManagedBlock } from '../fs';
import { addCommandSkillProjection, buildCommandSkillManagedFiles } from './command-skills';
import { checkCommandProjection } from './standard';
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
  return `## Kyro AI\n\nUse installed Kyro command skills: \`kyro-forge\`, \`kyro-status\`, \`kyro-wrap-up\`.\n\nRuntime: \`${KYRO_ROOT}/\`\nProject state: \`.agents/kyro/kyro.json\`\nArtifacts: \`${ARTIFACT_ROOT}/{scope}/\`\nSkills: \`${AGENT_SKILLS_ROOT}/kyro-*\`\n\nLoad command routers only when a Kyro skill is invoked. Do not load full Kyro docs unless the router asks for them. Preserve non-Kyro content; Kyro owns only this marked block.\n`;
}
