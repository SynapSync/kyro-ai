import { spawnSync, type SpawnSyncOptions, type SpawnSyncReturns } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { KyroCoreError } from '../core/errors';
import { isInteractiveTerminal } from '../core/tty';
import { readPackageVersion } from '../help';
import { isDurableKyroOnPath } from '../invocation';
import { assertWorkspaceScope } from '../options';
import { detectPackageRootMode } from '../package-root-mode';
import { PACKAGE_ROOT } from '../constants';
import { readManifest, readProjectState } from '../state';
import type { CliOptions } from '../types';
import { compareSemverLike } from './doctor';

/**
 * Friendly one-step updater (`kyro update`).
 *
 * Updating used to be two manual steps with implicit knowledge: `npx kyro-ai install` (refresh the
 * global runtime + workspace from the npm package) plus `npm i -g kyro-ai` (move the global shim).
 * Nothing reported whether an update existed, and running install without `@latest` could
 * "update" to the same stale npx cache. This verb folds the flow into one command:
 *
 *  1. Read the running CLI version and the installed runtime version (manifest).
 *  2. Ask the registry for the latest release (`npm view`, fail-soft when offline).
 *  3. Pick the lane by install mode: durable global `kyro` on PATH → `npm install -g`;
 *     npx-only users → `npx -y kyro-ai@<exact> …` (exact pin, never a floating tag).
 *  4. Confirm interactively (unless `--yes`), then run the package manager with inherited stdio
 *     so progress is visible, and finish by re-running `sync`/`install` from the FRESH package —
 *     never continuing in the old process.
 *
 * Deliberately NOT gated on `requireFullPackageFor`: the check step works from the projected
 * runtime too (often the only CLI agents have), and the mutating steps shell out to a fresh
 * full package either way. For the same reason this verb stays out of `isMutatingInvocation` in
 * app.ts — the spawned fresh CLI takes its own state-writer lock, and a parent-held lock would
 * deadlock the child. `update` itself writes no state files.
 */

export const UPDATE_PACKAGE = 'kyro-ai';
const REGISTRY_TIMEOUT_MS = 10000;
const INSTALL_TIMEOUT_MS = 120000;

/** Strict semver the registry must return before it is trusted as an install pin. */
const STRICT_SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;

export function validateTargetVersion(raw: unknown): string | null {
  return typeof raw === 'string' && STRICT_SEMVER.test(raw.trim()) ? raw.trim() : null;
}

export interface UpdateFacts {
  current: string;
  latest: string | null;
  runtimeVersion: string | null;
  hasWorkspace: boolean;
  durableGlobal: boolean;
}

export type UpdateAction =
  | 'up-to-date'
  | 'refresh-stale-runtime'
  | 'update-global'
  | 'update-npx'
  | 'offline-retry-latest';

export interface UpdatePlan {
  facts: UpdateFacts;
  action: UpdateAction;
  /** Exact version pin, or the 'latest' tag when the registry check failed. */
  target: string;
  behind: boolean;
  steps: string[];
  summary: string;
}

/**
 * Pure: no I/O. Decide what `kyro update` should do from the gathered facts.
 * Unit-tested in scripts/check-update.mjs (no network in tests).
 */
export function buildUpdatePlan(facts: UpdateFacts): UpdatePlan {
  const { current, latest, runtimeVersion, hasWorkspace, durableGlobal } = facts;
  const pinned = validateTargetVersion(latest);
  const cmp = pinned ? compareSemverLike(pinned, current) : null;
  const behind = cmp !== null && cmp > 0;

  if (behind && pinned) {
    const target = pinned;
    if (durableGlobal) {
      const followUp = hasWorkspace
        ? 'sync the current workspace from the fresh global package'
        : 'refresh the global runtime (no workspace state in this directory)';
      return {
        facts,
        action: 'update-global',
        target,
        behind,
        steps: [`npm install -g ${UPDATE_PACKAGE}@${target}`, followUp],
        summary: `update available: ${current} → ${target} (global install detected)`,
      };
    }
    const refresh = hasWorkspace ? 'sync --scope workspace' : 'install --scope workspace --no-init-workspace';
    return {
      facts,
      action: 'update-npx',
      target,
      behind,
      steps: [`npx -y ${UPDATE_PACKAGE}@${target} ${refresh}`],
      summary: `update available: ${current} → ${target} (npx lane; no durable global kyro on PATH)`,
    };
  }

  if (!behind && runtimeVersion && compareSemverLike(runtimeVersion, current) === -1) {
    return {
      facts,
      action: 'refresh-stale-runtime',
      target: current,
      behind,
      steps: ['sync the current workspace from this package (no download needed)'],
      summary: `CLI is current (${current}) but the installed runtime is older (${runtimeVersion})`,
    };
  }

  if (!behind && pinned) {
    return {
      facts,
      action: 'up-to-date',
      target: current,
      behind,
      steps: [],
      summary: `kyro ${current} is the latest release (registry: ${pinned})`,
    };
  }

  // Registry unreachable or unparsable: proceed against the floating tag so an explicit
  // `kyro update` still attempts the refresh (npm/npx report network errors themselves).
  const followUp = hasWorkspace ? 'sync --scope workspace' : 'install --scope workspace --no-init-workspace';
  const via = durableGlobal ? `npm install -g ${UPDATE_PACKAGE}@latest` : `npx -y ${UPDATE_PACKAGE}@latest ${followUp}`;
  return {
    facts,
    action: 'offline-retry-latest',
    target: 'latest',
    behind: false,
    steps: [via],
    summary: `registry unreachable (running ${current}); will retry against the @latest tag`,
  };
}

/** Quote one argv element for `cmd.exe` when spawning through a shell on Windows. */
export function quoteWinArg(value: string): string {
  return /[\s"<>|&^]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export interface PackageManagerResult {
  status: number | null;
  stdout: string;
  stderr: string;
  spawnError: string | null;
}

/**
 * Run npm/npx cross-platform. On win32 both are `.cmd` shims: a direct spawn fails with ENOENT
 * (PATHEXT is ignored without a shell) or EINVAL (direct `.cmd` spawn blocked since
 * CVE-2024-27980), so route through the shell. All arguments are operator-safe (constant package
 * name, validated semver, fixed flags), so shell routing adds no injection surface.
 */
export function runPackageManager(
  bin: 'npm' | 'npx',
  args: string[],
  options: { timeout?: number; stdio?: SpawnSyncOptions['stdio'] } = {},
): PackageManagerResult {
  const timeout = options.timeout ?? INSTALL_TIMEOUT_MS;
  const stdio = options.stdio ?? 'pipe';
  let raw: SpawnSyncReturns<string>;
  if (process.platform === 'win32') {
    const line = [bin, ...args.map(quoteWinArg)].join(' ');
    raw = spawnSync(line, { shell: true, encoding: 'utf8', timeout, stdio });
  } else {
    raw = spawnSync(bin, args, { encoding: 'utf8', timeout, stdio });
  }
  return {
    status: raw.status,
    stdout: typeof raw.stdout === 'string' ? raw.stdout : '',
    stderr: typeof raw.stderr === 'string' ? raw.stderr : '',
    spawnError: raw.error ? String(raw.error) : null,
  };
}

/** Ask the registry for the latest release. Fail-soft: null when offline or unparsable. */
export function queryRegistryLatest(): string | null {
  try {
    const result = runPackageManager('npm', ['view', UPDATE_PACKAGE, 'version', '--json'], {
      timeout: REGISTRY_TIMEOUT_MS,
    });
    if (result.spawnError || result.status !== 0) return null;
    return validateTargetVersion(JSON.parse(result.stdout.trim()));
  } catch {
    return null;
  }
}

/** Locate the fresh global CLI entrypoint after `npm install -g` (null when absent). */
export function resolveFreshGlobalCli(): string | null {
  try {
    const result = runPackageManager('npm', ['root', '-g'], { timeout: REGISTRY_TIMEOUT_MS });
    if (result.spawnError || result.status !== 0) return null;
    const cliJs = join(result.stdout.trim(), UPDATE_PACKAGE, 'dist', 'cli.js');
    return existsSync(cliJs) ? cliJs : null;
  } catch {
    return null;
  }
}

function currentCliJs(): string {
  return join(PACKAGE_ROOT, 'dist', 'cli.js');
}

function printPlan(plan: UpdatePlan): void {
  console.log(plan.summary);
  if (plan.facts.runtimeVersion) console.log(`Installed runtime: ${plan.facts.runtimeVersion}`);
  if (plan.steps.length > 0) {
    console.log('Planned steps:');
    for (const step of plan.steps) console.log(`  - ${step}`);
  }
}

async function confirmUpdate(plan: UpdatePlan): Promise<boolean> {
  const rl = createInterface({ input, output });
  try {
    console.log(plan.summary);
    for (const step of plan.steps) console.log(`  - ${step}`);
    const answer = await rl.question(`Update kyro ${plan.facts.current} → ${plan.target}? [y/N] `);
    return answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes';
  } finally {
    rl.close();
  }
}

function throwInstallFailed(detail: string, stderr: string): never {
  if (/EACCES|EPERM|permission denied/i.test(`${detail} ${stderr}`)) {
    throw new KyroCoreError(
      'INTERNAL',
      `Package install failed on permissions: ${detail}`,
      'Re-run with elevated rights (e.g. sudo), or install to a user-owned prefix (npm config set prefix ~/.npm-global) and re-run kyro update.',
    );
  }
  throw new KyroCoreError('INTERNAL', `Package install failed: ${detail}`, 'Check network access and re-run kyro update.');
}

/**
 * Refresh the current workspace (or runtime-only when there is none) from a CLI entrypoint,
 * with inherited stdio so progress is visible. Propagates the child exit code.
 */
function refreshFromCli(cliJs: string, hasWorkspace: boolean, verbose: boolean): void {
  const args = hasWorkspace
    ? ['sync', '--scope', 'workspace']
    : ['install', '--scope', 'workspace', '--no-init-workspace'];
  if (verbose) args.push('--verbose');
  const child = spawnSync(process.execPath, [cliJs, ...args], { stdio: 'inherit' });
  if (child.status !== 0 || child.error) {
    const detail = child.error ? String(child.error) : `exit code ${String(child.status)}`;
    throw new KyroCoreError(
      'INTERNAL',
      `Workspace refresh failed: ${detail}`,
      `The package update succeeded; finish manually with: node ${cliJs} ${args.join(' ')}.`,
    );
  }
}

export async function runUpdate(options: CliOptions): Promise<void> {
  assertWorkspaceScope(options.scope);
  const current = readPackageVersion();
  const manifest = readManifest();
  const facts: UpdateFacts = {
    current,
    latest: queryRegistryLatest(),
    runtimeVersion: typeof manifest?.packageVersion === 'string' ? manifest.packageVersion : null,
    hasWorkspace: readProjectState() !== null,
    durableGlobal: isDurableKyroOnPath(),
  };
  const plan = buildUpdatePlan(facts);

  if (options.check) {
    printPlan(plan);
    return;
  }
  if (options.dryRun) {
    console.log(`Kyro update ${current} (dry run; no changes made)`);
    printPlan(plan);
    return;
  }

  if (plan.action === 'up-to-date') {
    printPlan(plan);
    if (manifest === null) {
      console.log('No installed runtime found; run kyro install --init-workspace to set one up.');
    }
    return;
  }

  if (plan.action === 'refresh-stale-runtime') {
    printPlan(plan);
    if (detectPackageRootMode() !== 'full-package') {
      console.log('This CLI is the projected runtime, which cannot refresh itself.');
      console.log(`Run from the full package: npx ${UPDATE_PACKAGE}@${current} sync --scope workspace`);
      return;
    }
    if (!options.yes) {
      if (!isInteractiveTerminal()) {
        throw new KyroCoreError(
          'INVALID_INPUT',
          'Confirmation required but this terminal is not interactive.',
          'Re-run with --yes.',
        );
      }
      if (!(await confirmUpdate(plan))) {
        console.log('Update cancelled.');
        return;
      }
    }
    refreshFromCli(currentCliJs(), facts.hasWorkspace, options.verbose);
    console.log(`Runtime refreshed from kyro ${current}.`);
    return;
  }

  // update-global / update-npx / offline-retry-latest: a download is (probably) needed.
  if (!options.yes) {
    if (!isInteractiveTerminal()) {
      throw new KyroCoreError(
        'INVALID_INPUT',
        'Confirmation required but this terminal is not interactive.',
        'Re-run with --yes.',
      );
    }
    if (!(await confirmUpdate(plan))) {
      console.log('Update cancelled.');
      return;
    }
  }

  if (plan.action === 'update-global') {
    const installed = runPackageManager('npm', ['install', '-g', `${UPDATE_PACKAGE}@${plan.target}`], {
      stdio: 'inherit',
    });
    if (installed.spawnError || installed.status !== 0) {
      throwInstallFailed(installed.spawnError ?? `exit code ${String(installed.status)}`, installed.stderr);
    }
    const freshCli = resolveFreshGlobalCli();
    if (!freshCli) {
      console.log(`Global package updated to ${plan.target}, but the fresh CLI was not found under the global root.`);
      console.log(`Finish manually: kyro sync --scope workspace (or npx ${UPDATE_PACKAGE}@${plan.target} sync --scope workspace).`);
      return;
    }
    refreshFromCli(freshCli, facts.hasWorkspace, options.verbose);
    console.log(`Updated kyro ${current} → ${plan.target}.`);
    return;
  }

  // update-npx / offline-retry-latest without a durable global: one npx shot does it all.
  const refreshArgs = facts.hasWorkspace
    ? ['sync', '--scope', 'workspace']
    : ['install', '--scope', 'workspace', '--no-init-workspace'];
  if (options.verbose) refreshArgs.push('--verbose');
  const ran = runPackageManager('npx', ['-y', `${UPDATE_PACKAGE}@${plan.target}`, ...refreshArgs], {
    stdio: 'inherit',
  });
  if (ran.spawnError || ran.status !== 0) {
    throwInstallFailed(ran.spawnError ?? `exit code ${String(ran.status)}`, ran.stderr);
  }
  console.log(`Updated kyro ${current} → ${plan.target}.`);
}
