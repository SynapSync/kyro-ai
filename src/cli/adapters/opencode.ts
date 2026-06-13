import { AGENT, AGENT_SKILLS_ROOT, KYRO_ROOT } from '../constants';
import { workspaceFileExists } from '../fs';
import type { AdapterDefinition } from './registry-types';
import type { CheckResult } from '../types';
import { addCommandSkillProjection, buildCommandSkillManagedFiles } from './command-skills';

export const openCodeAdapter: AdapterDefinition = {
  agent: AGENT.OPENCODE,
  displayName: 'OpenCode',
  status: 'implemented',
  buildProjection: addCommandSkillProjection,
  buildManagedFiles: buildCommandSkillManagedFiles,
  buildManagedBlocks() {
    return [];
  },
  buildInstalledAdapter(scope, installedAt) {
    return {
      agent: AGENT.OPENCODE,
      scope,
      installedAt,
      corePath: KYRO_ROOT,
      commandsPath: AGENT_SKILLS_ROOT,
      skillsPath: AGENT_SKILLS_ROOT,
    };
  },
  doctor(manifest) {
    if (!manifest?.adapters.some((adapter) => adapter.agent === AGENT.OPENCODE)) {
      return { status: 'warn', name: 'OpenCode adapter', detail: 'not installed in this workspace' };
    }
    return checkCommandProjection('OpenCode adapter');
  },
};

export function checkCommandProjection(name: string): CheckResult {
  const missing = buildCommandSkillManagedFiles().filter((file) => !workspaceFileExists(file));
  if (missing.length > 0) {
    return { status: 'fail', name, detail: `missing ${missing.join(', ')}`, remedy: 'Run kyro sync.' };
  }
  return { status: 'pass', name, detail: 'projected Kyro command skills present' };
}
