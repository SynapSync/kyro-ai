import { spawn, spawnSync, type SpawnSyncOptions, type SpawnSyncReturns } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { KyroCoreError } from '../core/errors';
import { isInteractiveTerminal } from '../core/tty';
import { readPackageVersion } from '../help';
import { classifyGlobalKyroOwnership, resolveKyroCommandPath, type GlobalKyroOwnership } from '../invocation';
import { assertWorkspaceScope } from '../options';
import { readManifest, readProjectState } from '../state';
import { detectPackageRootMode } from '../package-root-mode';
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
 *  3. Verify that the active `kyro` belongs to the npm global prefix before installing.
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
  ownership: GlobalKyroOwnership;
}

export type UpdateAction =
  | 'up-to-date'
  | 'refresh-stale-runtime'
  | 'blocked-runtime-ahead'
  | 'blocked-runtime-mismatch'
  | 'ahead-of-registry'
  | 'update-global'
  | 'migrate-global'
  | 'blocked-ownership'
  | 'registry-unavailable';

export interface UpdatePlan {
  facts: UpdateFacts;
  action: UpdateAction;
  /** Exact version pin; never a floating tag. */
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
  const { current, latest, runtimeVersion, hasWorkspace, ownership } = facts;
  const pinned = validateTargetVersion(latest);
  const cmp = pinned ? compareSemverLike(pinned, current) : null;
  const behind = cmp !== null && cmp > 0;

  if (ownership === 'missing') {
    return {
      facts, action: 'migrate-global', target: pinned ?? current, behind,
      steps: ['npm install -g kyro-ai', 'kyro install --scope workspace --init-workspace (if this workspace is not initialized)'],
      summary: 'No global kyro command is visible on PATH; install the npm package globally, then rerun kyro update.',
    };
  }
  if (ownership !== 'npm-owned') {
    return {
      facts, action: 'blocked-ownership', target: pinned ?? current, behind, steps: [],
      summary: ownership === 'foreign'
        ? 'The active kyro command belongs to another manager or npm prefix; align PATH with the npm global prefix before updating.'
        : 'Cannot verify that the active kyro command belongs to this npm global installation; inspect npm prefix -g, npm root -g, and PATH.',
    };
  }
  if (!pinned) {
    return {
      facts, action: 'registry-unavailable', target: current, behind: false, steps: [],
      summary: `Cannot verify the latest kyro-ai version from npm (running ${current}); retry when the registry is available.`,
    };
  }

  const runtimeTarget = behind ? pinned : current;
  const runtimeComparison = runtimeVersion ? compareSemverLike(runtimeVersion, runtimeTarget) : null;
  if (runtimeVersion && (runtimeComparison === null || (runtimeComparison === 0 && runtimeVersion !== runtimeTarget))) {
    return {
      facts, action: 'blocked-runtime-mismatch', target: runtimeTarget, behind,
      steps: [],
      summary: `Installed runtime ${runtimeVersion} differs from the verified npm package target ${runtimeTarget}; inspect the installation before refreshing it.`,
    };
  }

  // A projected runtime from a newer package may contain state/schema changes. Never
  // replace it with an older global package, even when the registry offers an update.
  if (runtimeComparison === 1) {
    return {
      facts, action: 'blocked-runtime-ahead', target: runtimeTarget, behind,
      steps: [],
      summary: `Installed runtime ${runtimeVersion} is newer than the verified npm package target ${runtimeTarget}; inspect the installation before refreshing it.`,
    };
  }

  if (behind && pinned) {
    const target = pinned;
    const followUp = hasWorkspace
      ? 'sync the current workspace from the fresh global package'
      : 'refresh the global runtime (no workspace state in this directory)';
    return {
      facts,
      action: 'update-global',
      target,
      behind,
      steps: [`npm install -g ${UPDATE_PACKAGE}@${target}`, followUp],
      summary: `update available: ${current} → ${target} (verified npm global install)`,
    };
  }

  if (!behind && (!runtimeVersion || compareSemverLike(runtimeVersion, current) === -1)) {
    return {
      facts,
      action: 'refresh-stale-runtime',
      target: current,
      behind,
      steps: [hasWorkspace
        ? 'sync the current workspace from the verified npm global package (no download needed)'
        : 'refresh the global runtime from the verified npm global package (no workspace state in this directory)'],
      summary: `Npm global kyro is ${current}, but the installed runtime is ${runtimeVersion ?? 'missing'}; refresh it from the verified package.`,
    };
  }

  if (pinned !== current) {
    return {
      facts, action: 'ahead-of-registry', target: current, behind: false, steps: [],
      summary: `Npm global kyro ${current} differs from the registry version ${pinned}; no verified newer update is available.`,
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

  throw new KyroCoreError(
    'INTERNAL',
    'Unable to determine a safe update plan from the verified installation state.',
    'Run kyro doctor --artifacts and report the CLI, runtime, and registry versions.',
  );
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
 * Run npm cross-platform. On win32 it is a `.cmd` shim: a direct spawn fails with ENOENT
 * (PATHEXT is ignored without a shell) or EINVAL (direct `.cmd` spawn blocked since
 * CVE-2024-27980), so route through the shell. All arguments are operator-safe (constant package
 * name, validated semver, fixed flags), so shell routing adds no injection surface.
 */
export function runPackageManager(
  bin: 'npm',
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

/** Stream install progress while retaining recent stderr for an actionable failure. */
export function installGlobalPackage(target: string): Promise<PackageManagerResult> {
  const args = ['install', '-g', `${UPDATE_PACKAGE}@${target}`];
  return new Promise((resolve) => {
    const child = process.platform === 'win32'
      ? spawn(['npm', ...args.map(quoteWinArg)].join(' '), {
        shell: true, stdio: ['inherit', 'pipe', 'pipe'], timeout: INSTALL_TIMEOUT_MS,
      })
      : spawn('npm', args, { stdio: ['inherit', 'pipe', 'pipe'], timeout: INSTALL_TIMEOUT_MS });
    let stderr = '';
    let spawnError: string | null = null;
    child.stdout?.on('data', (chunk: Buffer) => process.stdout.write(chunk));
    child.stderr?.on('data', (chunk: Buffer) => {
      process.stderr.write(chunk);
      stderr = (stderr + chunk.toString()).slice(-8192);
    });
    child.on('error', (error) => { spawnError = String(error); });
    child.on('close', (status) => resolve({ status, stdout: '', stderr, spawnError }));
  });
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

/** Read-only probe of the npm prefix/root and the effective command on PATH. */
export function probeGlobalKyroOwnership(): GlobalKyroOwnership {
  const commandPath = resolveKyroCommandPath();
  if (!commandPath) return 'missing';
  const prefix = runPackageManager('npm', ['prefix', '-g'], { timeout: REGISTRY_TIMEOUT_MS });
  const root = runPackageManager('npm', ['root', '-g'], { timeout: REGISTRY_TIMEOUT_MS });
  let realPath: string | null = null;
  let shimContents: string | null = null;
  try {
    realPath = realpathSync(commandPath);
    if (process.platform === 'win32') shimContents = readFileSync(commandPath, 'utf8');
  } catch {
    // An unreadable command cannot establish npm ownership.
  }
  return classifyGlobalKyroOwnership({
    commandPath,
    npmPrefix: prefix.status === 0 && !prefix.spawnError ? prefix.stdout.trim() : null,
    npmRoot: root.status === 0 && !root.spawnError ? root.stdout.trim() : null,
    realPath,
    shimContents,
  });
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

export interface GlobalPackageSnapshot {
  cliJs: string;
  version: string;
}

/** Read the package npm actually installed, never the running projected/old process. */
export function readFreshGlobalPackage(): GlobalPackageSnapshot | null {
  const cliJs = resolveFreshGlobalCli();
  if (!cliJs) return null;
  const packageRoot = dirname(dirname(cliJs));
  if (detectPackageRootMode(packageRoot) !== 'full-package') return null;
  try {
    const value: unknown = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
    if (typeof value !== 'object' || value === null || !('version' in value)) return null;
    const version = validateTargetVersion(value.version);
    return version ? { cliJs, version } : null;
  } catch {
    return null;
  }
}

export type UpdateConsistency = 'consistent' | 'package-missing' | 'package-version' | 'command-ownership' | 'command-version' | 'runtime-version';

/** Pure final gate: success requires one exact version across all three surfaces. */
export function assessUpdateConsistency(input: {
  target: string;
  packageVersion: string | null;
  ownership: GlobalKyroOwnership;
  commandVersion: string | null;
  runtimeVersion: string | null;
}): UpdateConsistency {
  if (!input.packageVersion) return 'package-missing';
  if (input.packageVersion !== input.target) return 'package-version';
  if (input.ownership !== 'npm-owned') return 'command-ownership';
  if (input.commandVersion !== input.target) return 'command-version';
  if (input.runtimeVersion !== input.target) return 'runtime-version';
  return 'consistent';
}

/** Execute the shell-visible command to detect PATH shadowing or stale shims. */
export function readVisibleKyroVersion(): string | null {
  const commandPath = resolveKyroCommandPath();
  if (!commandPath) return null;
  const result = process.platform === 'win32'
    ? spawnSync(`${quoteWinArg(commandPath)} --version`, { shell: true, encoding: 'utf8', timeout: REGISTRY_TIMEOUT_MS })
    : spawnSync(commandPath, ['--version'], { encoding: 'utf8', timeout: REGISTRY_TIMEOUT_MS });
  if (result.error || result.status !== 0) return null;
  return validateTargetVersion(result.stdout.trim());
}

function verifyUpdate(target: string, fresh: GlobalPackageSnapshot | null): void {
  const status = assessUpdateConsistency({
    target,
    packageVersion: fresh?.version ?? null,
    ownership: probeGlobalKyroOwnership(),
    commandVersion: readVisibleKyroVersion(),
    runtimeVersion: readManifest()?.packageVersion ?? null,
  });
  if (status === 'consistent') return;
  const packageChanged = fresh?.version === target;
  const remedy = packageChanged && fresh
    ? `The package is installed at ${fresh.cliJs}. Check PATH, then finish with: node "${fresh.cliJs}" sync --scope workspace (or install --scope workspace --no-init-workspace outside a workspace).`
    : `Inspect npm root -g and reinstall the target with: npm install -g kyro-ai@${target}.`;
  throw new KyroCoreError(
    'INTERNAL',
    `Update incomplete (${status}); ${packageChanged ? 'the package changed, but the command/runtime is not verified' : 'the target package is not verified'}.`,
    remedy,
  );
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
export function refreshFromCli(cliJs: string, hasWorkspace: boolean, verbose: boolean): void {
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
      `The npm package is present, but runtime refresh is incomplete. Finish with: node "${cliJs}" ${args.join(' ')}.`,
    );
  }
}

export async function runUpdate(options: CliOptions): Promise<void> {
  assertWorkspaceScope(options.scope);
  const ownership = probeGlobalKyroOwnership();
  let current: string;
  if (ownership === 'npm-owned') {
    const globalPackage = readFreshGlobalPackage();
    if (!globalPackage) {
      throw new KyroCoreError(
        'INTERNAL',
        'The npm global kyro-ai package is incomplete; its version cannot be verified.',
        'Inspect npm root -g and repair the installation with npm install -g kyro-ai, then rerun kyro update.',
      );
    }
    const visibleVersion = readVisibleKyroVersion();
    if (visibleVersion !== globalPackage.version) {
      throw new KyroCoreError(
        'INTERNAL',
        `The visible kyro command reports ${visibleVersion ?? 'no verifiable version'}, but the npm global package is ${globalPackage.version}.`,
        `The package is at ${globalPackage.cliJs}. Inspect the npm shim and PATH, then repair the global command before rerunning kyro update.`,
      );
    }
    current = globalPackage.version;
  } else {
    current = readPackageVersion();
  }
  const manifest = readManifest();
  const facts: UpdateFacts = {
    current,
    latest: queryRegistryLatest(),
    runtimeVersion: typeof manifest?.packageVersion === 'string' ? manifest.packageVersion : null,
    hasWorkspace: readProjectState() !== null,
    ownership,
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

  if (plan.action === 'blocked-runtime-ahead' || plan.action === 'blocked-runtime-mismatch') {
    throw new KyroCoreError('INTERNAL', plan.summary, 'Inspect the projected runtime and npm global package before choosing a version; Kyro will not downgrade the runtime automatically.');
  }
  if (plan.action === 'migrate-global' || plan.action === 'blocked-ownership' || plan.action === 'registry-unavailable' || plan.action === 'ahead-of-registry') {
    printPlan(plan);
    return;
  }

  if (plan.action === 'up-to-date') {
    printPlan(plan);
    return;
  }

  if (plan.action === 'refresh-stale-runtime') {
    printPlan(plan);
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
    const fresh = readFreshGlobalPackage();
    if (!fresh || fresh.version !== current) {
      throw new KyroCoreError('INTERNAL', 'The npm global package is incomplete or differs from the expected version.', `Reinstall with npm install -g kyro-ai@${current}.`);
    }
    refreshFromCli(fresh.cliJs, facts.hasWorkspace, options.verbose);
    verifyUpdate(current, fresh);
    console.log(`Runtime refreshed from kyro ${current}.`);
    return;
  }

  // Install the exact registry version using the verified npm global installation.
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
    const installed = await installGlobalPackage(plan.target);
    if (installed.spawnError || installed.status !== 0) {
      throwInstallFailed(installed.spawnError ?? `exit code ${String(installed.status)}`, installed.stderr);
    }
    const fresh = readFreshGlobalPackage();
    if (!fresh || fresh.version !== plan.target) verifyUpdate(plan.target, fresh);
    refreshFromCli(fresh!.cliJs, facts.hasWorkspace, options.verbose);
    verifyUpdate(plan.target, fresh);
    console.log(`Updated kyro ${current} → ${plan.target}.`);
    return;
  }

}
