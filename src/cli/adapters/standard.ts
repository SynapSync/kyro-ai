import { AGENT, AGENT_SKILLS_ROOT, KYRO_ROOT } from '../constants';
import { lstatSync, readFileSync, readlinkSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { resolveManagedPath } from '../fs';
import type { AdapterDefinition } from './registry-types';
import type { CheckResult } from '../types';
import { addCommandSkillProjection, buildCommandSkillManagedFiles, buildCommandSkillManagedFilesForRoot, normalizeEol, parseSkillRuntimeVersion } from './command-skills';
import { detectFromPaths } from './detection';
import { FULL_PACKAGE_SYNC_REMEDY } from '../package-root-mode';

export const standardAgentsAdapter: AdapterDefinition = {
  agent: AGENT.STANDARD,
  displayName: 'Standard .agents',
  status: 'implemented',
  capabilities() {
    return ['command-skills'];
  },
  paths(homeDir) {
    return {
      globalConfigDir: `${homeDir}/.agents`,
      skillsDir: `${homeDir}/.agents/skills`,
    };
  },
  detect(context) {
    const paths = this.paths(context.homeDir);
    const result = detectFromPaths(AGENT.STANDARD, null, paths, context, 'standard .agents compatibility adapter');
    return {
      ...result,
      detail: `config=${result.configPath ?? 'none'}; binary=none; compatibility=always-available`,
    };
  },
  systemPromptStrategy() {
    return 'none';
  },
  mcpStrategy() {
    return 'none';
  },
  buildProjection: addCommandSkillProjection,
  buildRemoval() {},
  buildMcpProjection() {},
  buildMcpRemoval() {},
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
    return checkCommandProjection('Standard .agents adapter', manifest?.packageVersion);
  },
};

/** Read-only health check: inspect links before following them and verify every version pin. */
export function checkCommandProjection(name: string, runtimeVersion?: string, root = AGENT_SKILLS_ROOT): CheckResult {
  const files = buildCommandSkillManagedFilesForRoot(root);
  const missing: string[] = [];
  const invalid: string[] = [];
  const modes = new Set<string>();
  for (const file of files) {
    const target = resolveManagedPath(file);
    const skillDir = dirname(target);
    try {
      // A symlink in a parent directory must not hide a foreign projection tree.
      for (let parent = dirname(skillDir); parent !== homedir(); parent = dirname(parent)) {
        const stat = projectionStat(parent);
        if (stat && !stat.isDirectory()) throw new Error(`unsafe parent ${parent}`);
        if (dirname(parent) === parent) break;
      }
      const directory = projectionStat(skillDir);
      if (!directory) { missing.push(file); continue; }
      if (directory.isSymbolicLink()) {
        modes.add('link');
        const canonical = resolveManagedPath(`${AGENT_SKILLS_ROOT}/${file.split('/').at(-2)}`);
        if (root === AGENT_SKILLS_ROOT || resolve(dirname(skillDir), readlinkSync(skillDir)) !== canonical
          || !projectionStat(canonical)?.isDirectory() || realpathSync(skillDir) !== realpathSync(canonical)) {
          throw new Error(`dangling or non-canonical link ${skillDir} -> ${readlinkSync(skillDir)}; expected ${canonical}`);
        }
      } else {
        modes.add(root === AGENT_SKILLS_ROOT ? 'canonical' : 'copy');
        if (!directory.isDirectory()) throw new Error(`non-directory ${skillDir}`);
      }
      const stat = projectionStat(target);
      if (!stat) { missing.push(file); continue; }
      if (!stat.isFile()) throw new Error('skill must be a regular file');
      const body = normalizeEol(readFileSync(target, 'utf8'));
      const pinned = parseSkillRuntimeVersion(body);
      if (!body.includes(`name: ${file.split('/').at(-2)}\n`) || !runtimeVersion?.trim() || pinned !== runtimeVersion.trim()) {
        throw new Error(`runtimeVersion=${pinned ?? 'missing'}; expected=${runtimeVersion?.trim() || 'unknown'}`);
      }
    } catch (error) {
      invalid.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const projection = modes.size > 1 ? 'mixed' : [...modes][0] ?? 'none';
  const detail = `projection=${projection}; missing ${missing.join(', ') || 'none'}; invalid or stale ${invalid.join(', ') || 'none'}`;
  if (invalid.length || (missing.length && missing.length !== files.length)) {
    return { status: 'fail', name, detail, remedy: FULL_PACKAGE_SYNC_REMEDY };
  }
  if (missing.length) return { status: 'warn', name, detail, remedy: FULL_PACKAGE_SYNC_REMEDY };
  return { status: 'pass', name, detail: `projection=${projection}; all Kyro command skills match runtime ${runtimeVersion}` };
}

function projectionStat(path: string): ReturnType<typeof lstatSync> | null {
  try { return lstatSync(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
