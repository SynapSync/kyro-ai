import { lstatSync, readFileSync, readlinkSync, readdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { AGENT, AGENT_SKILLS_ROOT, KYRO_ROOT } from '../constants';
import { KyroCoreError } from '../core/errors';
import { addLinkDirectoryPlan, resolveManagedPath } from '../fs';
import { FULL_PACKAGE_SYNC_REMEDY } from '../package-root-mode';
import { readManifest } from '../state';
import type { AdapterDefinition } from './registry-types';
import { addCommandSkillProjection, buildCommandSkillManagedFiles, buildCommandSkillManagedFilesForRoot, normalizeEol, parseSkillRuntimeVersion } from './command-skills';
import { detectFromPaths } from './detection';
import { checkCommandProjection } from './standard';

export const CLAUDE_SKILLS_ROOT = '~/.claude/skills';

const managedFiles = (): string[] => buildCommandSkillManagedFilesForRoot(CLAUDE_SKILLS_ROOT);

export const claudeAdapter: AdapterDefinition = {
  agent: AGENT.CLAUDE,
  displayName: 'Claude Code',
  status: 'implemented',
  capabilities() {
    return ['command-skills', 'filesystem-detect'];
  },
  paths(homeDir) {
    return { globalConfigDir: `${homeDir}/.claude`, skillsDir: `${homeDir}/.claude/skills` };
  },
  detect(context) {
    return detectFromPaths(AGENT.CLAUDE, 'claude', this.paths(context.homeDir), context, 'Claude Code adapter');
  },
  systemPromptStrategy() {
    return 'none';
  },
  mcpStrategy() {
    return 'none';
  },
  buildProjection(plan) {
    const previous = readManifest();
    // Claude-only installs still need the canonical source before linking it.
    addCommandSkillProjection(plan);
    for (const file of managedFiles()) {
      const path = file.slice(0, -'/SKILL.md'.length);
      const beginning = plan.length;
      addLinkDirectoryPlan(plan, `${AGENT_SKILLS_ROOT}/${path.split('/').at(-1)}`, path);
      const operation = plan[beginning];
      if (!operation) continue;
      operation.guard = 'claude-skill';
      operation.allowExistingManagedSkill = previous?.adapters.some((adapter) => adapter.agent === AGENT.CLAUDE)
        && (previous.managedFiles.includes(file) || previous.managedFiles.includes(path));
    }
  },
  buildRemoval() {},
  buildMcpProjection() {},
  buildMcpRemoval() {},
  buildManagedFiles() {
    // Enumerate the directory before its legacy file path: purge must unlink
    // it before any file removal could follow it into the canonical source.
    // Retain file declarations so legacy manifests do not prune through links.
    return [...managedFiles().map((file) => file.slice(0, -'/SKILL.md'.length)), ...managedFiles(), ...buildCommandSkillManagedFiles()];
  },
  buildManagedBlocks() {
    return [];
  },
  buildInstalledAdapter(scope, installedAt) {
    return {
      agent: AGENT.CLAUDE,
      scope,
      installedAt,
      corePath: KYRO_ROOT,
      commandsPath: CLAUDE_SKILLS_ROOT,
      skillsPath: CLAUDE_SKILLS_ROOT,
    };
  },
  doctor(manifest) {
    const check = checkCommandProjection('Claude Code adapter', manifest?.packageVersion, CLAUDE_SKILLS_ROOT);
    // Keep the ownership guard stricter than metadata alone, including sibling files.
    for (const file of managedFiles()) {
      try { assertSafeClaudeSkillWrite(file, true); }
      catch (error) { return { ...check, status: 'fail', detail: `${check.detail}; ${String(error)}`, remedy: FULL_PACKAGE_SYNC_REMEDY }; }
    }
    if (check.status !== 'pass') return check;
    if (legacyClaudePluginDetected()) {
      return {
        status: 'warn',
        name: 'Claude Code adapter',
        detail: `${check.detail}; a legacy Kyro Claude plugin may also be installed`,
        remedy: 'Disable or uninstall the old Kyro plugin using Claude Code after verifying the new /kyro-* skills. Kyro will not edit Claude plugin settings.',
      };
    }
    return check;
  },
};

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

export function legacyClaudePluginDetected(): boolean {
  const path = resolve(homedir(), '.claude/plugins/installed_plugins.json');
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.size > 1024 * 1024) return false;
    const document = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    return JSON.stringify(document).toLowerCase().includes('kyro-ai');
  } catch {
    return false;
  }
}

/** Called by the operation executor immediately before a Claude skill write. */
export function assertSafeClaudeSkillWrite(managedPath: string, allowExisting: boolean): void {
  assertSafeLinkedSkillWrite(managedPath, allowExisting, CLAUDE_SKILLS_ROOT, 'Claude');
}

/** Shared ownership guard for links to canonical command skills. */
export function assertSafeLinkedSkillWrite(managedPath: string, allowExisting: boolean, root: string, nameOfAdapter: string): void {
  const file = buildCommandSkillManagedFilesForRoot(root).find((file) => file === managedPath || file.slice(0, -'/SKILL.md'.length) === managedPath);
  if (!file) {
    throw new KyroCoreError('INVALID_INPUT', `Not a ${nameOfAdapter} skill projection: ${managedPath}.`, `Use a Kyro-owned ${nameOfAdapter} skill path.`);
  }
  for (const ancestor of [resolveManagedPath(root.slice(0, -'/skills'.length)), resolveManagedPath(root)]) {
    const stat = lstatIfPresent(ancestor);
    if (stat && !stat.isDirectory()) {
      throw new KyroCoreError('INVALID_INPUT', `Unsafe ${nameOfAdapter} skill directory: ${ancestor}.`, 'Replace the symlink or non-directory with a real directory; Kyro will not follow it.');
    }
  }
  const target = resolveManagedPath(file);
  const skillDir = dirname(target);
  const name = file.split('/').at(-2)!;
  const directoryStat = lstatIfPresent(skillDir);
  if (directoryStat?.isSymbolicLink()) {
    const canonical = resolveManagedPath(`${AGENT_SKILLS_ROOT}/${name}`);
    try {
      if (!lstatSync(canonical).isDirectory() || realpathSync(skillDir) !== realpathSync(canonical)) {
        throw new Error('non-canonical target');
      }
    } catch {
      throw new KyroCoreError('INVALID_INPUT', `Unsafe ${nameOfAdapter} skill directory: ${skillDir} -> ${readlinkSync(skillDir)}; expected ${canonical}.`, 'Move the foreign or dangling link aside; Kyro accepts only the canonical directory of the same skill name.');
    }
    const stat = lstatIfPresent(target);
    if (stat && !stat.isFile()) {
      throw new KyroCoreError('INVALID_INPUT', `Unsafe ${nameOfAdapter} skill target: ${target}.`, 'Move the symlink or non-file aside; Kyro will not overwrite it.');
    }
    return;
  }
  if (directoryStat && !directoryStat.isDirectory()) {
    throw new KyroCoreError('INVALID_INPUT', `Unsafe ${nameOfAdapter} skill directory: ${skillDir}.`, `Move the foreign file aside before installing the ${nameOfAdapter} adapter.`);
  }
  if (directoryStat) {
    if (!allowExisting) {
      throw new KyroCoreError('INVALID_INPUT', `Foreign ${nameOfAdapter} skill target: ${managedPath}.`, 'Move the existing directory aside; the previous Kyro manifest did not own it.');
    }
    if (readdirSync(skillDir).some((entry) => entry !== 'SKILL.md')) {
      throw new KyroCoreError('INVALID_INPUT', `Foreign ${nameOfAdapter} skill target: ${skillDir}.`, 'Move the directory aside; it contains files not owned by the Kyro skill projection.');
    }
  }
  const stat = lstatIfPresent(target);
  if (!stat) return;
  if (!allowExisting) {
    throw new KyroCoreError('INVALID_INPUT', `Foreign ${nameOfAdapter} skill target: ${managedPath}.`, 'Move the existing file aside; the previous Kyro manifest did not own it.');
  }
  if (!stat.isFile()) {
    throw new KyroCoreError('INVALID_INPUT', `Unsafe ${nameOfAdapter} skill target: ${managedPath}.`, 'Move the symlink or non-file aside; Kyro will not overwrite it.');
  }
  const body = normalizeEol(readFileSync(target, 'utf8'));
  if (!name || !body.includes(`name: ${name}\n`) || !parseSkillRuntimeVersion(body)) {
    throw new KyroCoreError('INVALID_INPUT', `Foreign ${nameOfAdapter} skill target: ${managedPath}.`, `Move the foreign file aside before installing the ${nameOfAdapter} adapter.`);
  }
}

function lstatIfPresent(path: string): ReturnType<typeof lstatSync> | null {
  try {
    return lstatSync(path);
  } catch (error: unknown) {
    if (isNotFound(error)) return null;
    throw error;
  }
}
