import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
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
 * Pure: no I/O. Given whether a *durable* `kyro` is on PATH and the runtime root to fall back to,
 * produces the invocation value. `kyroRoot` is the single active runtime path, so persisted
 * invocations survive package updates without pinning historical version directories.
 *
 * Callers must not pass `true` for ephemeral package-manager bins (npx cache, etc.) — those
 * vanish after the install process exits and leave agents with a dead `kyro` string.
 */
export function buildInvocation(durableKyroOnPath: boolean, kyroRoot: string): KyroInvocation {
  if (durableKyroOnPath) {
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
