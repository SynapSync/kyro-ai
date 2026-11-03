import { execFileSync } from 'node:child_process';
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, writeSync } from 'node:fs';
import type { BigIntStats } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { STATE_WRITER_LOCK } from '../pipeline/state-writer-lock';

export interface GitTrackabilityDiagnostic {
  status: 'pass' | 'warn' | 'fail';
  name: string;
  detail: string;
  remedy?: string;
}

const GIT_TIMEOUT_MS = 10_000;
const UNSUPPORTED_PATH = /[\u0000-\u001f\u007f\u0085\u2028\u2029]/;

const ROOT_NEGATIONS = '!/.agents/\n!/.agents/kyro/\n!/.agents/kyro/.gitignore\n!/.agents/kyro/project.json\n!/.agents/kyro/scopes/';

/** Read-only Git diagnosis. Install/sync deliberately never writes a consumer's root .gitignore. */
export function diagnoseKyroGitTrackability(cwd = process.cwd()): GitTrackabilityDiagnostic {
  const workspace = discoverGitWorkspace(cwd);
  if (workspace === 'unknown') return gitDiscoveryWarning('Git trackability');
  if (workspace === 'outside') {
    return { status: 'pass', name: 'Git trackability', detail: 'workspace is not a Git repository (check skipped)' };
  }

  const projectIgnored = isIgnored(cwd, '.agents/kyro/project.json');
  const scopesIgnored = isIgnored(cwd, '.agents/kyro/scopes/__kyro_trackability_probe__/sprint.json');
  if (projectIgnored || scopesIgnored) {
    const targets = [projectIgnored ? 'project.json' : null, scopesIgnored ? 'scopes/**' : null].filter(Boolean).join(', ');
    return {
      status: 'fail',
      name: 'Git trackability',
      detail: `shared Kyro state is ignored: ${targets}`,
      remedy: `Add these negations to the workspace root .gitignore, then commit the shared state:\n${ROOT_NEGATIONS}`,
    };
  }

  if (isIgnored(cwd, '.agents/kyro/.gitignore')) {
    return {
      status: 'warn',
      name: 'Git trackability',
      detail: '.agents/kyro/.gitignore is ignored; project.json and scopes/** remain trackable',
      remedy: `Add this exact negation to the workspace root .gitignore:\n!/.agents/kyro/.gitignore`,
    };
  }

  return { status: 'pass', name: 'Git trackability', detail: 'project.json, scopes/**, and .agents/kyro/.gitignore are trackable' };
}

/** All Git subprocesses are bounded and use argument arrays, never a shell. */
function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'],
    timeout: GIT_TIMEOUT_MS, maxBuffer: 1024 * 1024, env: { ...process.env, LC_ALL: 'C' },
  }).replace(/\r?\n$/, '');
}

function discoverGitWorkspace(cwd: string): 'git' | 'outside' | 'unknown' {
  try {
    const inside = git(cwd, ['rev-parse', '--is-inside-work-tree']);
    return inside === 'true' ? 'git' : inside === 'false' ? 'outside' : 'unknown';
  } catch (error: unknown) {
    const failure = error as { status?: number; stderr?: string; code?: string; signal?: string };
    // Only Git's explicit non-repository response is a confirmed skip. Spawn failures,
    // timeouts, unsafe ownership, and malformed repository metadata must remain visible.
    return !failure.code && !failure.signal && failure.status === 128
      && /fatal: not a git repository/i.test(String(failure.stderr)) ? 'outside' : 'unknown';
  }
}

function gitDiscoveryWarning(name: string): GitTrackabilityDiagnostic {
  return { status: 'warn', name, detail: 'Git workspace discovery failed or timed out',
    remedy: 'Ensure git is available on PATH and can inspect this workspace, then re-run kyro doctor.' };
}

function isIgnored(cwd: string, path: string, strict = false): boolean {
  try {
    git(cwd, ['check-ignore', '-q', '--no-index', '--', path]);
    return true;
  } catch (error: unknown) {
    const status = (error as { status?: number }).status;
    if (strict && status !== 1) throw error;
    return status !== 1;
  }
}

class ExcludeSafetyError extends Error {}
interface StateWriterExclude { path: string; root: string; pattern: string }

/** Resolve only Git's own info/exclude, including the common directory of linked worktrees. */
function stateWriterExclude(cwd: string): StateWriterExclude {
  const prefix = git(cwd, ['rev-parse', '--show-prefix']);
  if (UNSUPPORTED_PATH.test(cwd) || UNSUPPORTED_PATH.test(prefix)) {
    throw new ExcludeSafetyError('unsupported workspace path: control characters or line separators cannot be represented safely in Git exclude rules');
  }
  const path = resolve(cwd, git(cwd, ['rev-parse', '--git-path', 'info/exclude']));
  const roots = [resolve(cwd, git(cwd, ['rev-parse', '--absolute-git-dir'])),
    resolve(cwd, git(cwd, ['rev-parse', '--git-common-dir']))];
  const reportedRoot = roots.find((root) => resolve(root, 'info/exclude') === path);
  if (!reportedRoot) throw new ExcludeSafetyError('unsafe exclude target: outside the Git metadata directory');
  const root = realpathSync(reportedRoot);
  if (UNSUPPORTED_PATH.test(path) || UNSUPPORTED_PATH.test(root)) {
    throw new ExcludeSafetyError('unsupported workspace path: Git metadata contains control characters or line separators');
  }
  // Quote Git ignore metacharacters in directory names; only the lock suffix is a wildcard.
  const literal = `${prefix}${STATE_WRITER_LOCK}`.replace(/[\\*?\[\] #!]/g, '\\$&');
  return { path: resolve(root, 'info/exclude'), root, pattern: `/${literal}*` };
}

function entryOrAbsent(path: string): BigIntStats | null {
  try { return lstatSync(path, { bigint: true }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** Never follow an info/ directory or exclude-file link, including dangling links. */
function validateExcludeTarget(target: StateWriterExclude): BigIntStats | null {
  const root = lstatSync(target.root);
  if (!root.isDirectory() || root.isSymbolicLink()) throw new ExcludeSafetyError('unsafe exclude target: Git metadata directory was redirected');
  const info = entryOrAbsent(dirname(target.path));
  if (info && (!info.isDirectory() || info.isSymbolicLink())) {
    throw new ExcludeSafetyError('unsafe exclude target: info directory is not a regular non-symlink directory');
  }
  const entry = entryOrAbsent(target.path);
  if (entry && (!entry.isFile() || entry.isSymbolicLink() || entry.nlink !== 1n)) {
    throw new ExcludeSafetyError('unsafe exclude target: expected a regular non-symlink file with no hard-link aliases');
  }
  return entry;
}

function sameFile(a: BigIntStats, b: BigIntStats): boolean {
  return a.dev === b.dev && a.ino === b.ino;
}

/** Open without truncation or link following; verify identity before reading or writing. */
function appendExcludeRule(target: StateWriterExclude): void {
  validateExcludeTarget(target);
  if (!entryOrAbsent(dirname(target.path))) mkdirSync(dirname(target.path));
  const before = validateExcludeTarget(target);
  const flags = constants.O_RDWR | constants.O_APPEND | (constants.O_NOFOLLOW ?? 0)
    | (before ? 0 : constants.O_CREAT | constants.O_EXCL);
  const fd = openSync(target.path, flags, 0o600);
  try {
    const opened = fstatSync(fd, { bigint: true });
    const after = validateExcludeTarget(target);
    if (!opened.isFile() || opened.nlink !== 1n || !after || !sameFile(opened, after) || (before && !sameFile(before, opened))) {
      throw new ExcludeSafetyError('unsafe exclude target: file identity changed while opening');
    }
    const content = readFileSync(fd, 'utf-8');
    if (content.split(/\r?\n/).includes(target.pattern)) return;
    // Revalidate the path and descriptor immediately before the only write.
    const current = validateExcludeTarget(target);
    if (!current || !sameFile(opened, current) || !sameFile(opened, fstatSync(fd, { bigint: true }))) {
      throw new ExcludeSafetyError('unsafe exclude target: file identity changed before writing');
    }
    writeSync(fd, `${content && !content.endsWith('\n') ? '\n' : ''}${target.pattern}\n`);
  } finally { closeSync(fd); }
}

/** Best effort only: local Git metadata must never make install/sync fail. */
export function ensureStateWriterLockIgnored(cwd = process.cwd()): void {
  try {
    if (discoverGitWorkspace(cwd) !== 'git') return;
    appendExcludeRule(stateWriterExclude(cwd));
  } catch {
    // Doctor reports unsafe targets or missing ignore rules; install/sync remain nonfatal.
  }
}

export function diagnoseStateWriterLockIgnore(cwd = process.cwd()): GitTrackabilityDiagnostic {
  const name = 'State writer lock ignore';
  const workspace = discoverGitWorkspace(cwd);
  if (workspace === 'unknown') return gitDiscoveryWarning(name);
  if (workspace === 'outside') return { status: 'pass', name, detail: 'workspace is not a Git repository (check skipped)' };
  try {
    const target = stateWriterExclude(cwd);
    validateExcludeTarget(target);
    if (isIgnored(cwd, `${STATE_WRITER_LOCK}/`, true) && isIgnored(cwd, `${STATE_WRITER_LOCK}.reclaim-probe/`, true)) {
      return { status: 'pass', name, detail: 'workspace state writer lock and reclaim leftovers are ignored' };
    }
    return { status: 'warn', name, detail: `${STATE_WRITER_LOCK} or reclaim leftovers are not ignored`,
      remedy: `Run kyro sync (or kyro install); or add this exact line to ${target.path}:\n${target.pattern}` };
  } catch (error) {
    if (error instanceof ExcludeSafetyError) {
      return { status: 'warn', name, detail: error.message,
        remedy: error.message.startsWith('unsupported workspace path')
          ? 'Use a workspace path without control characters or line separators, then re-run kyro sync and kyro doctor.'
          : 'Restore info/exclude as a regular non-symlink file inside the Git metadata directory, then re-run kyro sync and kyro doctor.' };
    }
    return { status: 'warn', name, detail: 'could not inspect the workspace state writer lock ignore rule',
      remedy: 'Ensure Git metadata is accessible, run kyro sync (or kyro install), then re-run kyro doctor.' };
  }
}
