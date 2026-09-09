import { execFileSync, type ExecFileSyncOptions } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { KYRO_ROOT } from './constants';
import { readManifest } from './state';

/** Mustache-style token substituted in projected markdown at install/sync time. See design.md §5. */
export const KYRO_CLI_PLACEHOLDER = '{{KYRO_CLI}}';

export interface KyroInvocation {
  /** Full shell-invocable string, e.g. "kyro" or "node ~/.agents/kyro/current/dist/cli.js". */
  raw: string;
  command: string;
  args: string[];
}

/**
 * Pure: no I/O (besides the defaulted platform probe). Given whether a *durable* `kyro` is on
 * PATH and the runtime root to fall back to, produces the invocation value. `kyroRoot` is the
 * single active runtime path, so persisted invocations survive package updates without pinning
 * historical version directories.
 *
 * Callers must not pass `true` for ephemeral package-manager bins (npx cache, etc.) — those
 * vanish after the install process exits and leave agents with a dead `kyro` string.
 *
 * Windows note: npm on win32 installs `.cmd`/`.ps1` shims, not a real `kyro.exe`. Node's spawn
 * without `shell: true` ignores PATHEXT, so `spawnSync("kyro")` always fails with ENOENT, and
 * spawning `kyro.cmd` directly is blocked since CVE-2024-27980 (EINVAL on Node >= 18.20 / 20.12
 * / 22). A bare `"kyro"` manifest value can therefore never be self-spawned by doctor on
 * Windows, even on a healthy global install. Persist the `node <runtime>/dist/cli.js` form on
 * win32 instead — it works in shells and via execFileSync alike.
 */
export function buildInvocation(
  durableKyroOnPath: boolean,
  kyroRoot: string,
  platform: NodeJS.Platform = process.platform,
): KyroInvocation {
  if (durableKyroOnPath && platform !== 'win32') {
    return { raw: 'kyro', command: 'kyro', args: [] };
  }
  const cliPath = `${kyroRoot}/dist/cli.js`;
  return { raw: `node ${cliPath}`, command: 'node', args: [cliPath] };
}

/**
 * True when a resolved binary path is only available for the life of a package-manager
 * one-shot (npx / dlx cache), not as a permanent install. Pure: no I/O.
 *
 * `npx kyro-ai install` puts `…/.npm/_npx/…/node_modules/.bin/kyro` on PATH for the child
 * process only. Treating that as durable caused install to persist `kyroInvocation: "kyro"`,
 * which then failed for agents after npx exited.
 */
export function isEphemeralPackageManagerPath(resolvedPath: string): boolean {
  const normalized = resolvedPath.replace(/\\/g, '/').toLowerCase();
  // npm/npx execution cache (primary field failure)
  if (normalized.includes('/_npx/')) return true;
  if (normalized.includes('/.npm/_npx/')) return true;
  // yarn dlx
  if (normalized.includes('/.yarn/berry/npx/')) return true;
  if (normalized.includes('/.yarn/dlx/')) return true;
  // pnpm dlx
  if (normalized.includes('/.pnpm-store/v3/tmp/dlx-')) return true;
  if (normalized.includes('/.local/share/pnpm/dlx/')) return true;
  return false;
}

/**
 * Resolve `kyro` on PATH to an absolute path, or null if missing / unresolvable.
 * Infra probe — isolated so pure helpers stay unit-testable.
 */
export function resolveKyroBinaryPath(): string | null {
  try {
    let raw: string;
    if (process.platform === 'win32') {
      raw = execFileSync('where', ['kyro'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      // `where` may list multiple matches; first wins.
      raw = raw.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? '';
    } else {
      raw = execFileSync('/bin/sh', ['-c', 'command -v kyro'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    }
    if (!raw) return null;
    try {
      return realpathSync(raw);
    } catch {
      return raw;
    }
  } catch {
    return null;
  }
}

/**
 * True only when `kyro` resolves on PATH to a non-ephemeral binary that will still exist
 * after the current process exits (global npm install, user shim, etc.).
 * Swallows all errors and defaults to `false` (safe fallback: the node form always works
 * once dist/ is projected).
 */
export function isDurableKyroOnPath(): boolean {
  const resolved = resolveKyroBinaryPath();
  if (!resolved) return false;
  return !isEphemeralPackageManagerPath(resolved);
}

/**
 * @deprecated Prefer {@link isDurableKyroOnPath}. Kept as an alias so existing call sites
 * and comments that say `isKyroOnPath` keep the durable semantics.
 */
export function isKyroOnPath(): boolean {
  return isDurableKyroOnPath();
}

export function resolveKyroInvocation(): KyroInvocation {
  return buildInvocation(isDurableKyroOnPath(), KYRO_ROOT);
}

/**
 * Authoritative CLI invocation for this machine.
 *
 * Source of truth is the global runtime manifest (`~/.agents/kyro/current/manifest.json`).
 * Falls back to a live PATH probe when the manifest is missing or has no invocation yet.
 * Never reads project `.agents/kyro/kyro.json` — that field is legacy and stripped on install/sync
 * so one workspace refresh cannot leave N other projects with a stale bare `"kyro"`.
 */
export function getPersistedKyroInvocation(): string {
  const manifest = readManifest();
  if (typeof manifest?.kyroInvocation === 'string' && manifest.kyroInvocation.trim()) {
    return manifest.kyroInvocation.trim();
  }
  return resolveKyroInvocation().raw;
}

/** Expand a leading `~` to the user's home dir; execFileSync does no shell expansion. */
export function expandInvocationHome(segment: string): string {
  return segment === '~' || segment.startsWith('~/') ? homedir() + segment.slice(1) : segment;
}

/** Split an invocation string into tokens, respecting single/double quotes (for paths with spaces). Pure. */
export function splitInvocation(raw: string): string[] {
  const parts: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(raw)) !== null) {
    parts.push(match[1] ?? match[2] ?? match[3]);
  }
  return parts;
}

/** True for legacy bare invocations (`kyro`, `kyro.cmd`, `kyro-ai`, …) with no script path. Pure. */
export function isBareKyroInvocation(raw: string): boolean {
  const first = splitInvocation(raw.trim())[0] ?? '';
  const base = first.toLowerCase().split(/[\\/]/).pop() ?? '';
  return (
    base === 'kyro' ||
    base === 'kyro.cmd' ||
    base === 'kyro.bat' ||
    base === 'kyro.ps1' ||
    base === 'kyro-ai' ||
    base === 'kyro-ai.cmd' ||
    base === 'kyro-ai.bat' ||
    base === 'kyro-ai.ps1'
  );
}

/** Absolute path to the projected runtime entrypoint (`<KYRO_ROOT>/dist/cli.js`). */
export function resolveProjectedCliJs(kyroRoot: string = KYRO_ROOT): string {
  return resolve(expandInvocationHome(kyroRoot), 'dist/cli.js');
}

export interface InvocationSpawn {
  command: string;
  args: string[];
  /** True when a legacy bare `kyro` was mapped to `node <runtime>/dist/cli.js` (win32). */
  fallbackUsed: boolean;
}

/**
 * Map a persisted invocation string to a directly-spawnable argv (no shell).
 *
 * - `node <cli.js>` → `process.execPath <cli.js>` (same runtime, no PATH lookup).
 * - bare `kyro` on win32 → `process.execPath <projected dist/cli.js>` (PATHEXT is ignored
 *   by spawn without shell, and direct `.cmd` spawn is blocked since CVE-2024-27980, so the
 *   bare form can never self-spawn on Windows even on a healthy install).
 * - everything else → split + `~`-expanded as-is (POSIX semantics unchanged).
 *
 * Pure except for the defaulted platform probe; pass `platform` explicitly in unit tests to
 * simulate Windows on POSIX CI.
 */
export function resolveInvocationSpawn(raw: string, platform: NodeJS.Platform = process.platform): InvocationSpawn {
  const parts = splitInvocation(raw.trim()).map(expandInvocationHome);
  const [command = '', ...args] = parts;
  const lower = command.toLowerCase();
  const isNode =
    lower === 'node' ||
    lower.endsWith('/node') ||
    lower.endsWith('\\node') ||
    lower === 'node.exe' ||
    lower.endsWith('/node.exe') ||
    lower.endsWith('\\node.exe');
  if (isNode) {
    return { command: process.execPath, args, fallbackUsed: false };
  }
  if (platform === 'win32' && isBareKyroInvocation(raw)) {
    return { command: process.execPath, args: [resolveProjectedCliJs(), ...args], fallbackUsed: true };
  }
  return { command, args, fallbackUsed: false };
}

/**
 * execFileSync wrapper for persisted invocations. Uses {@link resolveInvocationSpawn} so legacy
 * bare-`kyro` manifests self-spawn on Windows via the projected runtime instead of ENOENT, and
 * retries once via the projected runtime when a direct win32 spawn fails with ENOENT/EINVAL
 * (covers quoted/absolute shim spellings the static check may miss).
 */
export function execKyroInvocationSync(
  raw: string,
  extraArgs: string[],
  options: ExecFileSyncOptions & { encoding: 'utf8' },
): string;
export function execKyroInvocationSync(raw: string, extraArgs: string[], options?: ExecFileSyncOptions): Buffer;
export function execKyroInvocationSync(
  raw: string,
  extraArgs: string[],
  options?: ExecFileSyncOptions,
): string | Buffer {
  const spawn = resolveInvocationSpawn(raw);
  try {
    return execFileSync(spawn.command, [...spawn.args, ...extraArgs], options as ExecFileSyncOptions & { encoding: 'utf8' }) as string | Buffer;
  } catch (error) {
    if (process.platform === 'win32' && !spawn.fallbackUsed && isBareKyroInvocation(raw) && isMissingExecutableError(error)) {
      const cliJs = resolveProjectedCliJs();
      if (existsSync(cliJs)) {
        return execFileSync(process.execPath, [cliJs, ...spawn.args, ...extraArgs], options as ExecFileSyncOptions & { encoding: 'utf8' }) as string | Buffer;
      }
    }
    throw error;
  }
}

function isMissingExecutableError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === 'ENOENT' || code === 'EINVAL';
}
