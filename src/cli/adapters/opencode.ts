import { AGENT_SKILLS_ROOT, COMMAND_NAMES, KYRO_COMMANDS_ROOT, KYRO_ROOT, ARTIFACT_ROOT } from '../constants';
import type { KyroCommandName, OperationPlan } from '../types';

export function addOpenCodeProjection(plan: OperationPlan[]): void {
  for (const command of COMMAND_NAMES) {
    plan.push({
      action: 'write',
      path: `${AGENT_SKILLS_ROOT}/kyro-${command}/SKILL.md`,
      content: buildCommandSkill(command),
    });
  }
}

export function buildOpenCodeManagedFiles(): string[] {
  return COMMAND_NAMES.map((command) => `${AGENT_SKILLS_ROOT}/kyro-${command}/SKILL.md`);
}

function buildCommandSkill(command: KyroCommandName): string {
  const title = command === 'wrap-up' ? 'Kyro Wrap-Up' : `Kyro ${capitalize(command)}`;
  const description = getCommandDescription(command);
  return `---\nname: kyro-${command}\ndescription: ${description}\nlicense: Apache-2.0\nmetadata:\n  author: synapsync\n  version: "1.0"\n  scope: [root]\n---\n\n# ${title}\n\nUse this skill when the user invokes the Kyro ${command} workflow.\n\n## Execution\n\n1. Read \`${KYRO_COMMANDS_ROOT}/${command}.md\`.\n2. Read required core assets from \`${KYRO_ROOT}/\` only when the command asks for them.\n3. Persist Kyro workflow artifacts under \`${ARTIFACT_ROOT}/{scope}/\`.\n4. Do not ask the user to describe this command in natural language; this skill is the command projection for agents that discover \`.agents/skills/\`.\n\n## Source of Truth\n\nThe managed Kyro core lives in \`${KYRO_ROOT}/\`. Do not duplicate lifecycle logic in this projected skill.\n`;
}

function getCommandDescription(command: KyroCommandName): string {
  if (command === 'forge') return 'Run the Kyro forge workflow through the installed workspace harness';
  if (command === 'status') return 'Show Kyro project status through the installed workspace harness';
  return 'Close the Kyro session through the installed workspace harness';
}

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}
