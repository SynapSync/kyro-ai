import { lstatSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { AGENT, KYRO_ROOT } from '../constants';
import { KyroCoreError } from '../core/errors';
import { resolveManagedPath } from '../fs';
import { FULL_PACKAGE_SYNC_REMEDY } from '../package-root-mode';
import { readManifest } from '../state';
import type { AdapterDefinition } from './registry-types';
import { addCommandSkillProjectionToRoot, buildCommandSkillManagedFilesForRoot, parseSkillRuntimeVersion } from './command-skills';
import { detectFromPaths } from './detection';

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
    const beginning = plan.length;
    const previous = readManifest();
    addCommandSkillProjectionToRoot(plan, CLAUDE_SKILLS_ROOT);
    for (const operation of plan.slice(beginning)) {
      operation.guard = 'claude-skill';
      operation.allowExistingManagedSkill = previous?.adapters.some((adapter) => adapter.agent === AGENT.CLAUDE)
        && previous.managedFiles.includes(operation.path);
    }
  },
  buildRemoval() {},
  buildMcpProjection() {},
  buildMcpRemoval() {},
  buildManagedFiles: managedFiles,
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
    if (!manifest?.adapters.some((adapter) => adapter.agent === AGENT.CLAUDE)) {
      return { status: 'warn', name: 'Claude Code adapter', detail: 'not installed in this workspace' };
    }
    const missing: string[] = [];
    const stale: string[] = [];
    for (const file of managedFiles()) {
      try {
        assertSafeClaudeSkillWrite(file, true);
        const target = resolveManagedPath(file);
        const stat = lstatSync(target);
        if (!stat.isFile() || stat.isSymbolicLink()) {
          stale.push(file);
          continue;
        }
        const body = readFileSync(target, 'utf8');
        const name = file.split('/').at(-2);
        if (!name || !body.includes(`name: ${name}\n`) || parseSkillRuntimeVersion(body) !== manifest.packageVersion) {
          stale.push(file);
        }
      } catch (error: unknown) {
        if (isNotFound(error)) missing.push(file);
        else stale.push(file);
      }
    }
    if (missing.length || stale.length) {
      return {
        status: 'fail',
        name: 'Claude Code adapter',
        detail: `missing ${missing.join(', ') || 'none'}; invalid or stale ${stale.join(', ') || 'none'}`,
        remedy: FULL_PACKAGE_SYNC_REMEDY,
      };
    }
    if (legacyClaudePluginDetected()) {
      return {
        status: 'warn',
        name: 'Claude Code adapter',
        detail: 'CLI-managed skills are healthy, but a legacy Kyro Claude plugin may also be installed',
        remedy: 'Disable or uninstall the old Kyro plugin using Claude Code after verifying the new /kyro-* skills. Kyro will not edit Claude plugin settings.',
      };
    }
    return { status: 'pass', name: 'Claude Code adapter', detail: 'seven router skills and the full executor skill match the runtime' };
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
  if (!managedFiles().includes(managedPath)) {
    throw new KyroCoreError('INVALID_INPUT', `Not a Claude skill projection: ${managedPath}.`, 'Use a Kyro-owned Claude skill path.');
  }
  const home = homedir();
  for (const ancestor of [resolve(home, '.claude'), resolve(home, '.claude/skills'), resolveManagedPath(managedPath).replace(/\/SKILL\.md$/, '')]) {
    const stat = lstatIfPresent(ancestor);
    if (stat && !stat.isDirectory()) {
      throw new KyroCoreError('INVALID_INPUT', `Unsafe Claude skill directory: ${ancestor}.`, 'Replace the symlink or non-directory with a real directory; Kyro will not follow it.');
    }
  }
  const target = resolveManagedPath(managedPath);
  const stat = lstatIfPresent(target);
  if (!stat) return;
  if (!allowExisting) {
    throw new KyroCoreError('INVALID_INPUT', `Foreign Claude skill target: ${managedPath}.`, 'Move the existing file aside; the previous Kyro manifest did not own it.');
  }
  if (!stat.isFile()) {
    throw new KyroCoreError('INVALID_INPUT', `Unsafe Claude skill target: ${managedPath}.`, 'Move the symlink or non-file aside; Kyro will not overwrite it.');
  }
  const body = readFileSync(target, 'utf8');
  const name = managedPath.split('/').at(-2);
  if (!name || !body.includes(`name: ${name}\n`) || !parseSkillRuntimeVersion(body)) {
    throw new KyroCoreError('INVALID_INPUT', `Foreign Claude skill target: ${managedPath}.`, 'Move the foreign file aside before installing the Claude adapter.');
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
