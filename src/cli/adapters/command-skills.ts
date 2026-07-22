import { AGENT_SKILLS_ROOT, ARTIFACT_ROOT, COMMAND_NAMES, KYRO_COMMANDS_ROOT, KYRO_ROOT } from '../constants';
import { readPackageVersion } from '../help';
import { resolveKyroInvocation } from '../invocation';
import type { KyroCommandName, OperationPlan } from '../types';

export function addCommandSkillProjection(plan: OperationPlan[]): void {
  addCommandSkillProjectionToRoot(plan, AGENT_SKILLS_ROOT);
}

export function addCommandSkillProjectionToRoot(plan: OperationPlan[], skillsRoot: string): void {
  for (const command of COMMAND_NAMES) {
    const path = getCommandSkillPathForRoot(command, skillsRoot);
    if (plan.some((operation) => operation.path === path)) {
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
  return buildCommandSkillManagedFilesForRoot(AGENT_SKILLS_ROOT);
}

export function buildCommandSkillManagedFilesForRoot(skillsRoot: string): string[] {
  return COMMAND_NAMES.map((command) => getCommandSkillPathForRoot(command, skillsRoot));
}

export function getCommandSkillPath(command: KyroCommandName): string {
  return getCommandSkillPathForRoot(command, AGENT_SKILLS_ROOT);
}

export function getCommandSkillPathForRoot(command: KyroCommandName, skillsRoot: string): string {
  return `${skillsRoot}/kyro-${command}/SKILL.md`;
}

/**
 * Projected host skill stub. Pins runtimeVersion so doctor can detect skill/runtime skew
 * (post-mortem #2 F2) and prints the durable CLI invocation so agents never rediscover it.
 */
export function buildCommandSkill(command: KyroCommandName): string {
  const title = getCommandTitle(command);
  const description = getCommandDescription(command);
  const packageVersion = readPackageVersion();
  const cli = resolveKyroInvocation().raw;
  return `---\nname: kyro-${command}\ndescription: ${description}\nlicense: Apache-2.0\nmetadata:\n  author: synapsync\n  version: "1.0"\n  runtimeVersion: "${packageVersion}"\n  scope: [root]\n---\n\n# ${title}\n\nCommand stub. Read \`${KYRO_COMMANDS_ROOT}/${command}.md\`, then load only the files that router requests.\n\nRuntime package: ${packageVersion}\nRuntime: \`${KYRO_ROOT}/\`\nCLI: \`${cli}\`\nArtifacts: \`${ARTIFACT_ROOT}/{scope}/\`\n\nAlways prefer this projected runtime over any host plugin cache path (older version trees under plugin caches are not the SoT).\n\nCLI workflow: invoke via the CLI line above (or the same form in runtime modes): \`status\`, \`doctor --artifacts\`, \`analyze\`, \`scenario add|link\`, \`record-evidence\`, \`review\`, \`repair\`, \`close-sprint\`, \`plan --from\`.\nInstall/update Kyro: only via the full npm package (\`npx kyro-ai install …\` or global \`kyro install\`). Do not treat \`${KYRO_ROOT}\` as the install source.\n\nDo not ask the user to restate this workflow in natural language.\n`;
}

/** Extract metadata.runtimeVersion from a projected skill stub body (null if absent/unparseable). */
export function parseSkillRuntimeVersion(skillMarkdown: string): string | null {
  const match = skillMarkdown.match(/^\s*runtimeVersion:\s*["']?([^"'#\n]+?)["']?\s*$/m);
  if (!match) return null;
  const value = match[1]?.trim();
  return value ? value : null;
}

function getCommandDescription(command: KyroCommandName): string {
  if (command === 'forge') return 'Run the Kyro forge workflow through the installed workspace harness';
  if (command === 'status') return 'Show Kyro project status through the installed workspace harness';
  if (command === 'idea') return 'Mature a rough or mature idea into an evidence-grounded, execution-ready pre-scope plan (optional)';
  if (command === 'qa') return 'Certify a scope\'s implementation and planning against its full specification (independent audit)';
  return 'Generate a fresh-context prompt for continuing Kyro work';
}

function getCommandTitle(command: KyroCommandName): string {
  if (command === 'task-context') return 'Kyro Task Context';
  if (command === 'idea') return 'Kyro Idea';
  if (command === 'qa') return 'Kyro QA';
  return `Kyro ${command.slice(0, 1).toUpperCase()}${command.slice(1)}`;
}
