import { readFileSync } from 'node:fs';
import { AGENT, AGENT_SKILLS_ROOT, KYRO_ROOT } from '../constants';
import { resolveManagedPath } from '../fs';
import { FULL_PACKAGE_SYNC_REMEDY } from '../package-root-mode';
import { buildCommandSkillManagedFiles, parseSkillRuntimeVersion } from './command-skills';
import { detectFromPaths } from './detection';
import type { AdapterDefinition } from './registry-types';

const INVOCATION_NOTE = 'Invoke /skill:kyro-work (or /skill:kyro-<name>); enableSkillCommands controls interactive command discovery; manually entered skill commands still work.';

export const piAdapter: AdapterDefinition = {
  agent: AGENT.PI,
  displayName: 'Pi',
  status: 'implemented',
  capabilities() {
    return ['command-skills', 'filesystem-detect'];
  },
  paths(homeDir) {
    return {
      globalConfigDir: `${homeDir}/.pi/agent`,
      skillsDir: `${homeDir}/.agents/skills`,
    };
  },
  detect(context) {
    return detectFromPaths(AGENT.PI, 'pi', this.paths(context.homeDir), context, 'Pi adapter');
  },
  systemPromptStrategy() {
    return 'none';
  },
  mcpStrategy() {
    return 'none';
  },
  // Pi discovers canonical skills natively. Standard owns their publication and removal.
  buildProjection() {},
  buildRemoval() {},
  buildMcpProjection() {},
  buildMcpRemoval() {},
  buildManagedFiles() {
    return [];
  },
  buildManagedBlocks() {
    return [];
  },
  buildInstalledAdapter(scope, installedAt) {
    return { agent: AGENT.PI, scope, installedAt, corePath: KYRO_ROOT, commandsPath: AGENT_SKILLS_ROOT, skillsPath: AGENT_SKILLS_ROOT };
  },
  doctor(manifest) {
    const name = 'Pi adapter';
    const runtimeVersion = manifest?.packageVersion?.trim();
    if (!runtimeVersion) {
      return { status: 'fail', name, detail: `canonical skill freshness unknown: runtime packageVersion missing. ${INVOCATION_NOTE}`, remedy: FULL_PACKAGE_SYNC_REMEDY };
    }
    const issues: string[] = [];
    for (const path of buildCommandSkillManagedFiles()) {
      try {
        const pinned = parseSkillRuntimeVersion(readFileSync(resolveManagedPath(path), 'utf8'));
        if (pinned !== runtimeVersion) issues.push(`${path}: runtimeVersion=${pinned ?? 'missing'}; expected=${runtimeVersion}`);
      } catch {
        issues.push(`${path}: missing or unreadable`);
      }
    }
    if (issues.length) {
      return { status: 'fail', name, detail: `canonical skills missing or stale: ${issues.join(', ')}. ${INVOCATION_NOTE}`, remedy: FULL_PACKAGE_SYNC_REMEDY };
    }
    return { status: 'pass', name, detail: `canonical Kyro skills current (${runtimeVersion}) at ${AGENT_SKILLS_ROOT}. ${INVOCATION_NOTE}` };
  },
};
