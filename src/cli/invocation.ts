import { execFileSync } from 'node:child_process';
import { KYRO_ROOT } from './constants';

/** Mustache-style token substituted in projected markdown at install/sync time. See design.md §5. */
export const KYRO_CLI_PLACEHOLDER = '{{KYRO_CLI}}';

export interface KyroInvocation {
  /** Full shell-invocable string, e.g. "kyro" or "node ~/.agents/kyro/current/dist/cli.js". */
  raw: string;
  command: string;
  args: string[];
}

/**
 * Pure: no I/O. Given whether `kyro` resolves on PATH and the runtime root to fall back to,
 * produces the invocation value. `kyroRoot` should be the `current` symlink path (never a
 * pinned `versions/{v}` path) so persisted invocations survive version bumps.
 */
export function buildInvocation(kyroOnPath: boolean, kyroRoot: string): KyroInvocation {
  if (kyroOnPath) {
    return { raw: 'kyro', command: 'kyro', args: [] };
  }
  const cliPath = `${kyroRoot}/dist/cli.js`;
  return { raw: `node ${cliPath}`, command: 'node', args: [cliPath] };
}

/**
 * Infra probe — the only side effect in this module. Isolated so `buildInvocation` stays
 * testable without a real PATH. Swallows all errors and defaults to `false` (safe fallback:
 * the node form always works once dist/ is projected).
 */
export function isKyroOnPath(): boolean {
  try {
    if (process.platform === 'win32') {
      execFileSync('where', ['kyro'], { stdio: 'ignore' });
    } else {
      execFileSync('/bin/sh', ['-c', 'command -v kyro'], { stdio: 'ignore' });
    }
    return true;
  } catch {
    return false;
  }
}

export function resolveKyroInvocation(): KyroInvocation {
  return buildInvocation(isKyroOnPath(), KYRO_ROOT);
}
