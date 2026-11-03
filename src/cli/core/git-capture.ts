import { execFileSync } from 'node:child_process';
import { STATE_WRITER_LOCK } from '../pipeline/state-writer-lock';
import type { SprintGitEnd, SprintGitStart } from '../types';

/**
 * Read-only git capture for sprint traceability. Every function returns null instead of
 * throwing: outside a repository, without git, before the first commit, or on any git error.
 * Planning and closing must never fail because of git (R4).
 */

export interface GitHead {
  /** Current branch, or null when HEAD is detached. */
  branch: string | null;
  commit: string;
}

const KYRO_DIR = '.agents/kyro/';
const GIT_TIMEOUT_MS = 10_000;

function git(cwd: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

/** HEAD commit and branch, or null when there is no repository, no commit, or git fails. */
export function readGitHead(cwd = process.cwd()): GitHead | null {
  const commit = git(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'])?.trim();
  if (!commit || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit)) return null;
  // symbolic-ref exits 1 for a detached HEAD.
  const branch = git(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD'])?.trim() || null;
  return { branch, commit };
}

/**
 * True when tracked or untracked non-ignored files outside Kyro-managed paths have uncommitted
 * changes. Kyro-managed: the workspace's `.agents/kyro/` and the state-writer lock (and its
 * reclaim leftovers) at the workspace root, held while a close runs. Null when git cannot answer.
 */
export function hasUncommittedChangesOutsideKyro(cwd = process.cwd()): boolean | null {
  const prefix = git(cwd, ['rev-parse', '--show-prefix']);
  if (prefix === null) return null;
  const workspacePrefix = prefix.trim();
  const kyroDir = `${workspacePrefix}${KYRO_DIR}`;
  // Covers the lock itself, its contents, and `.reclaim-*` leftovers from a stale-lock reclaim.
  const lockPrefix = `${workspacePrefix}${STATE_WRITER_LOCK}`;
  // --no-optional-locks: status must not refresh .git/index, so capture stays read-only.
  const status = git(cwd, ['--no-optional-locks', 'status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames']);
  if (status === null) return null;
  // Entries are "XY <path>" separated by NUL; paths are relative to the repository root.
  return status
    .split('\0')
    .filter((entry) => entry.length > 3)
    .map((entry) => entry.slice(3))
    .some((path) => !path.startsWith(kyroDir) && !path.startsWith(lockPrefix));
}

/** Why capture returned null, in the same words for plan and close output. */
export function describeMissingGitCapture(cwd = process.cwd()): string {
  if (git(cwd, ['rev-parse', '--is-inside-work-tree'])?.trim() !== 'true') return 'not a git repository, or git is unavailable';
  if (!readGitHead(cwd)) return 'no commits yet';
  return 'git status failed or timed out';
}

/** Git position for `activeSprint.git`, or null when it cannot be captured. */
export function captureSprintGitStart(cwd = process.cwd()): SprintGitStart | null {
  const head = readGitHead(cwd);
  return head ? { branch: head.branch, startCommit: head.commit } : null;
}

/** Git position for the frozen `close.git` input, or null when it cannot be captured. */
export function captureSprintGitEnd(cwd = process.cwd()): SprintGitEnd | null {
  const head = readGitHead(cwd);
  if (!head) return null;
  const dirty = hasUncommittedChangesOutsideKyro(cwd);
  if (dirty === null) return null;
  return { branch: head.branch, endCommit: head.commit, dirty };
}
