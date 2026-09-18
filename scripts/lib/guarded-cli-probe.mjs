import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, relative, resolve } from 'node:path';

const sandboxPrefix = resolve(tmpdir(), 'kyro-change-current-work-');

/** Creates the only roots accepted by runGuardedCliProbe. */
export function createGuardedProbeRoot(label = 'fixture') {
  return mkdtempSync(`${sandboxPrefix}${label}-`);
}

/**
 * Runs a mutating CLI probe only in a fresh temporary sandbox and only with an explicitly supplied
 * checkout CLI. This deliberately does not alter cwd, HOME, or KYRO_WORKSPACE: fixtures own their
 * isolated directory layout instead of redirecting the real workspace.
 */
export function runGuardedCliProbe({ root, cli, expectedCli, args, timeout = 20_000 }) {
  const resolvedRoot = resolve(root);
  const resolvedCli = resolve(cli);
  if (!isAbsolute(cli) || !isAbsolute(root)) throw new Error('guarded CLI probe requires absolute root and CLI paths');
  if (expectedCli && resolvedCli !== resolve(expectedCli)) {
    throw new Error(`guarded CLI probe rejected a CLI outside the selected checkout: ${resolvedCli}`);
  }
  if (!resolvedRoot.startsWith(sandboxPrefix) || resolvedRoot === sandboxPrefix) {
    throw new Error(`guarded CLI probe rejected non-fixture root: ${resolvedRoot}`);
  }
  if (!resolvedCli.endsWith('/dist/cli.js')) throw new Error(`guarded CLI probe requires this checkout dist/cli.js: ${resolvedCli}`);
  if (!Array.isArray(args) || args.length === 0) throw new Error('guarded CLI probe requires CLI arguments');
  return spawnSync(process.execPath, [resolvedCli, ...args], { cwd: resolvedRoot, encoding: 'utf8', timeout });
}

export function removeGuardedProbeRoot(root) {
  const resolvedRoot = resolve(root);
  if (resolvedRoot.startsWith(sandboxPrefix) && resolvedRoot !== sandboxPrefix) {
    rmSync(resolvedRoot, { recursive: true, force: true });
  }
}
