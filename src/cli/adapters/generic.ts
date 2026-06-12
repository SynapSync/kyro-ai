import { ARTIFACT_ROOT, KYRO_COMMANDS_ROOT, KYRO_ROOT } from '../constants';
import type { OperationPlan } from '../types';

export function addGenericProjection(plan: OperationPlan[]): void {
  plan.push({
    action: 'write',
    path: `${KYRO_ROOT}/generic/KYRO.md`,
    content: buildGenericBootstrap(),
  });
}

export function buildGenericManagedFiles(): string[] {
  return [`${KYRO_ROOT}/generic/KYRO.md`];
}

function buildGenericBootstrap(): string {
  return `# Kyro Generic Adapter\n\nUse Kyro assets from \`${KYRO_ROOT}/\`.\n\nPreferred intents:\n- forge: read \`${KYRO_COMMANDS_ROOT}/forge.md\`\n- status: read \`${KYRO_COMMANDS_ROOT}/status.md\`\n- wrap-up: read \`${KYRO_COMMANDS_ROOT}/wrap-up.md\`\n\nPersist workflow artifacts under \`${ARTIFACT_ROOT}/{scope}/\`.\n`;
}
