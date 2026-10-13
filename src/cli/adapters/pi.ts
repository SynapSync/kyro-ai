import { AGENT, AGENT_SKILLS_ROOT, KYRO_ROOT } from '../constants';
import { checkCommandProjection } from './standard';
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
    const check = checkCommandProjection(name, manifest?.packageVersion);
    return { ...check, detail: `${check.detail}. ${INVOCATION_NOTE}` };
  },
};
