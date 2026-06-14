import { AGENT_SKILLS_ROOT, ARTIFACT_ROOT, COMMAND_NAMES, KYRO_COMMANDS_ROOT, KYRO_ROOT } from '../constants';
import type { KyroCommandName, OperationPlan } from '../types';

export function addCommandSkillProjection(plan: OperationPlan[]): void {
  for (const command of COMMAND_NAMES) {
    const path = getCommandSkillPath(command);
    if (plan.some((operation) => operation.action === 'write' && operation.path === path)) {
      continue;
    }
    plan.push({
      action: 'write',
      path,
      content: buildCommandSkill(command),
    });
  }
}

export function buildCommandSkillManagedFiles(): string[] {
  return COMMAND_NAMES.map((command) => getCommandSkillPath(command));
}

export function getCommandSkillPath(command: KyroCommandName): string {
  return `${AGENT_SKILLS_ROOT}/kyro-${command}/SKILL.md`;
}

function buildCommandSkill(command: KyroCommandName): string {
  const title = command === 'wrap-up' ? 'Kyro Wrap-Up' : `Kyro ${capitalize(command)}`;
  const description = getCommandDescription(command);
  return `---\nname: kyro-${command}\ndescription: ${description}\nlicense: Apache-2.0\nmetadata:\n  author: synapsync\n  version: "1.0"\n  scope: [root]\n---\n\n# ${title}\n\nCommand stub. Read \`${KYRO_COMMANDS_ROOT}/${command}.md\`, then load only the files that router requests.\n\nRuntime: \`${KYRO_ROOT}/\`\nArtifacts: \`${ARTIFACT_ROOT}/{scope}/\`\n\nDo not ask the user to restate this workflow in natural language.\n`;
}

function getCommandDescription(command: KyroCommandName): string {
  if (command === 'forge') return 'Run the Kyro forge workflow through the installed workspace harness';
  if (command === 'status') return 'Show Kyro project status through the installed workspace harness';
  return 'Close the Kyro session through the installed workspace harness';
}

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}
