import { AGENT, AGENT_SKILLS_ROOT, KYRO_ROOT } from '../constants';
import { workspaceFileExists } from '../fs';
import type { AdapterDefinition } from './registry-types';
import type { CheckResult } from '../types';
import { addCommandSkillProjection, buildCommandSkillManagedFiles } from './command-skills';

export const standardAgentsAdapter: AdapterDefinition = {
  agent: AGENT.STANDARD,
  displayName: 'Standard .agents',
  status: 'implemented',
  buildProjection: addCommandSkillProjection,
  buildManagedFiles: buildCommandSkillManagedFiles,
  buildManagedBlocks() {
    return [];
  },
  buildInstalledAdapter(scope, installedAt) {
    return {
      agent: AGENT.STANDARD,
      scope,
      installedAt,
      corePath: KYRO_ROOT,
      commandsPath: AGENT_SKILLS_ROOT,
      skillsPath: AGENT_SKILLS_ROOT,
    };
  },
  doctor(manifest) {
    if (!manifest?.adapters.some((adapter) => adapter.agent === AGENT.STANDARD)) {
      return { status: 'warn', name: 'Standard .agents adapter', detail: 'not installed in this workspace' };
    }
    return checkCommandProjection('Standard .agents adapter');
  },
};

export function checkCommandProjection(name: string): CheckResult {
  const missing = buildCommandSkillManagedFiles().filter((file) => !workspaceFileExists(file));
  if (missing.length > 0) {
    return { status: 'fail', name, detail: `missing ${missing.join(', ')}`, remedy: 'Run kyro sync.' };
  }
  return { status: 'pass', name, detail: 'projected Kyro command skills present' };
}
