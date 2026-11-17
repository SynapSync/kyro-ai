/**
 * Shared sandbox helpers for check scripts.
 *
 * Every check builds a throwaway workspace, runs `dist/cli.js` inside it, and removes it. Doing that
 * the same way everywhere is what lets `scripts/run-checks.mjs` run checks side by side:
 *
 *   - `createSandbox` makes a unique directory with `mkdtemp` (never a name built from `Date.now()`
 *     alone) under `os.tmpdir()`, which the runner points at a per-step directory.
 *   - the sandbox has its own HOME, so the CLI never reads or writes the real `~/.agents`, and its
 *     own npm cache, so concurrent checks never share one.
 *   - `runCli` always runs the repository's `dist/cli.js` with that HOME unless told otherwise.
 *
 * Existing scripts keep their own helpers; migrate one only when you already have to touch it.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Absolute path of the repository root. */
export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Absolute path of the built CLI every check drives. */
export const cliPath = join(repoRoot, 'dist/cli.js');

/**
 * Environment for a child process that must not touch the real home directory or npm cache.
 * @param {string} home directory to use as HOME / USERPROFILE
 * @param {string} [root] directory that owns the npm cache (defaults to `home`)
 * @param {Record<string, string | undefined>} [extra] overrides applied last
 */
export function isolatedEnv(home, root = home, extra = {}) {
  return {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    npm_config_cache: join(root, 'npm-cache'),
    ...extra,
  };
}

/**
 * Create a unique sandbox.
 * @param {string} prefix short name, e.g. `kyro-capabilities`
 * @returns {{ root: string, home: string, env: (extra?: Record<string, string | undefined>) => NodeJS.ProcessEnv, run: typeof runCli, cleanup: () => void }}
 */
export function createSandbox(prefix) {
  const root = mkdtempSync(join(tmpdir(), `${prefix}-`));
  const home = join(root, '.home');
  mkdirSync(home, { recursive: true });
  const env = (extra = {}) => isolatedEnv(home, root, extra);
  return {
    root,
    home,
    env,
    run: (args, options = {}) => runCli(args, { cwd: root, ...options, env: { ...env(), ...options.env } }),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

/**
 * Run `node dist/cli.js <args>` and return the `spawnSync` result (utf-8, never throws on a
 * non-zero exit). `env` is merged over the current environment; HOME defaults to `<cwd>/.home`
 * so a forgotten `env` cannot reach the real home directory.
 * @param {string[]} args
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv, input?: string, timeout?: number }} [options]
 */
export function runCli(args, { cwd = process.cwd(), env = {}, input, timeout } = {}) {
  const home = env.HOME ?? join(cwd, '.home');
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    input,
    timeout,
    encoding: 'utf-8',
    env: { ...process.env, HOME: home, USERPROFILE: home, ...env },
  });
}
