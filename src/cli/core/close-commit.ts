import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

/**
 * Opt-in sprint close commit (R8–R11). Commits exactly the changed files a close wrote and
 * nothing else: other staged or unstaged changes stay as they were (`git commit --only`).
 * Never pushes, amends, skips hooks, or disables signing. Never throws: every outcome is a
 * result, and a failure never affects the close that already happened.
 */

export interface CloseCommitRequest {
  /** Workspace root; close paths are relative to it. */
  cwd?: string;
  /** Paths written by the close transaction. */
  paths: string[];
  scope: string;
  sprintN: number;
  title: string;
}

export type CloseCommitStatus = 'committed' | 'skipped' | 'failed';

export interface CloseCommitResult {
  status: CloseCommitStatus;
  sha?: string;
  /** Committed paths, relative to the workspace root. */
  paths?: string[];
  reason?: string;
  /** Exact command to finish the commit by hand when the result is not `committed`. */
  manualCommand?: string;
}

const GIT_TIMEOUT_MS = 10_000;
/** Commit hooks may run project tooling; allow them more time than plumbing calls. */
const COMMIT_TIMEOUT_MS = 120_000;
const IN_PROGRESS = [
  ['MERGE_HEAD', 'merge'],
  ['CHERRY_PICK_HEAD', 'cherry-pick'],
  ['REVERT_HEAD', 'revert'],
  ['REBASE_HEAD', 'rebase'],
  ['rebase-merge', 'rebase'],
  ['rebase-apply', 'rebase or am'],
] as const;

interface GitRun {
  ok: boolean;
  stdout: string;
  stderr: string;
}

function git(cwd: string, args: string[], options: { input?: string; timeout?: number } = {}): GitRun {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf-8',
    input: options.input,
    stdio: [options.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    timeout: options.timeout ?? GIT_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
  });
  return { ok: result.status === 0 && !result.error, stdout: result.stdout ?? '', stderr: result.stderr ?? String(result.error ?? '') };
}

/** Single-line subject; trailers in their own final paragraph. */
export function closeCommitMessage(scope: string, sprintN: number, title: string): string {
  const oneLine = title.replace(/\s+/g, ' ').trim();
  return `chore(kyro): close ${scope} sprint ${sprintN} — ${oneLine}\n\nKyro-Scope: ${scope}\nKyro-Sprint: ${sprintN}\n`;
}

function posixQuote(value: string): string {
  return /^[\w./@:=-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

function powershellQuote(value: string): string {
  return /^[\w./@:=-]+$/.test(value) ? value : `'${value.replace(/'/g, "''")}'`;
}

/**
 * Exact command to finish the close commit by hand. Trailers use `--trailer` (git 2.32+) so no
 * argument embeds a newline; quoting and the separator follow the platform shell.
 */
export function buildManualCommand(paths: string[], scope: string, sprintN: number, title: string, platform: NodeJS.Platform = process.platform): string {
  const quote = platform === 'win32' ? powershellQuote : posixQuote;
  const files = paths.map(quote).join(' ');
  const subject = `chore(kyro): close ${scope} sprint ${sprintN} — ${title.replace(/\s+/g, ' ').trim()}`;
  const add = `git add -- ${files}`;
  const commit = `git commit --only -m ${quote(subject)} --trailer ${quote(`Kyro-Scope: ${scope}`)} --trailer ${quote(`Kyro-Sprint: ${sprintN}`)} -- ${files}`;
  // Windows PowerShell 5.1 has no `&&`; `;` then `if ($?)` keeps the commit conditional on the add.
  return platform === 'win32' ? `${add}; if ($?) { ${commit} }` : `${add} && ${commit}`;
}

function summarize(stderr: string): string {
  const lines = stderr.trim().split(/\r?\n/).filter(Boolean);
  const text = lines.slice(-3).join(' | ');
  return text.length > 300 ? `${text.slice(0, 297)}...` : text || 'git exited with an error';
}

export function commitCloseArtifacts(request: CloseCommitRequest): CloseCommitResult {
  try {
    return commitCloseArtifactsUnsafe(request);
  } catch (error) {
    let manualCommand: string | undefined;
    try {
      manualCommand = buildManualCommand(normalizeClosePaths(request), request.scope, request.sprintN, request.title);
    } catch {
      // Malformed inputs must not make this best-effort recovery path throw either.
    }
    return { status: 'failed', reason: `unexpected error: ${error instanceof Error ? error.message : String(error)}`, manualCommand };
  }
}

function normalizeClosePaths(request: CloseCommitRequest): string[] {
  const cwd = request.cwd ?? process.cwd();
  return [...new Set(request.paths.map((path) => (isAbsolute(path) ? relative(cwd, path) : path).split('\\').join('/')))];
}

function commitCloseArtifactsUnsafe(request: CloseCommitRequest): CloseCommitResult {
  const cwd = request.cwd ?? process.cwd();
  const paths = normalizeClosePaths(request);
  const manual = (subset: string[]): string => buildManualCommand(subset, request.scope, request.sprintN, request.title);
  const skipped = (reason: string): CloseCommitResult => ({ status: 'skipped', reason });

  if (git(cwd, ['rev-parse', '--is-inside-work-tree']).stdout.trim() !== 'true') return skipped('not a git repository, or git is unavailable');
  if (!git(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']).ok) return skipped('no commits yet');
  // Recoverable skips carry the manual command so the user can finish once the repository is ready.
  if (!git(cwd, ['symbolic-ref', '--quiet', 'HEAD']).ok) return { status: 'skipped', reason: 'detached HEAD', manualCommand: manual(paths) };
  for (const [marker, label] of IN_PROGRESS) {
    const markerPath = git(cwd, ['rev-parse', '--git-path', marker]).stdout.trim();
    if (markerPath && existsSync(resolve(cwd, markerPath))) return { status: 'skipped', reason: `${label} in progress`, manualCommand: manual(paths) };
  }
  for (const path of paths) {
    // Exit 0 means the (untracked) path is ignored and could not be added.
    if (git(cwd, ['check-ignore', '--quiet', '--', path]).ok) {
      return { status: 'skipped', reason: `Kyro state is ignored by git: ${path}`, manualCommand: manual(paths) };
    }
  }

  const status = git(cwd, ['--no-optional-locks', 'status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames', '--', ...paths]);
  if (!status.ok) return { status: 'failed', reason: summarize(status.stderr), manualCommand: manual(paths) };
  // Status paths are relative to the repository root; close paths are relative to the workspace,
  // which may be a subdirectory of the repository (monorepo).
  const prefix = git(cwd, ['rev-parse', '--show-prefix']).stdout.trim();
  const changedSet = new Set(status.stdout.split('\0')
    .filter((entry) => entry.length > 3)
    .map((entry) => entry.slice(3))
    .filter((path) => path.startsWith(prefix))
    .map((path) => path.slice(prefix.length)));
  const changed = paths.filter((path) => changedSet.has(path));
  if (changed.length === 0) return skipped('nothing to commit');

  const add = git(cwd, ['add', '--', ...changed]);
  if (!add.ok) return { status: 'failed', reason: summarize(add.stderr), manualCommand: manual(changed) };
  const commit = git(cwd, ['commit', '--only', '-F', '-', '--', ...changed], {
    input: closeCommitMessage(request.scope, request.sprintN, request.title),
    timeout: COMMIT_TIMEOUT_MS,
  });
  if (!commit.ok) return { status: 'failed', reason: summarize(commit.stderr || commit.stdout), manualCommand: manual(changed) };
  const sha = git(cwd, ['rev-parse', 'HEAD']).stdout.trim();
  return { status: 'committed', sha, paths: changed };
}
