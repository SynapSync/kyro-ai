import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PACKAGE_ROOT } from './constants';
import { KyroCoreError } from './core/errors';

/** Whether the CLI's PACKAGE_ROOT is the full npm package or a projected agent runtime. */
export type PackageRootMode = 'full-package' | 'projected-runtime';

/**
 * Detect whether `root` is the full kyro-ai npm package layout or an installed
 * projected runtime (`~/.agents/kyro/current` and test HOMEs).
 *
 * Projected runtimes ship `manifest.json` + `dist/cli.js` but place the
 * orchestrator under `core/agents/` (no root `agents/orchestrator.md`).
 * Do not match on path strings — tests use temp HOME directories.
 */
export function detectPackageRootMode(root: string = PACKAGE_ROOT): PackageRootMode {
  const hasManifest = existsSync(resolve(root, 'manifest.json'));
  const hasDistCli = existsSync(resolve(root, 'dist/cli.js'));
  const hasRootOrchestrator = existsSync(resolve(root, 'agents/orchestrator.md'));
  if (hasManifest && hasDistCli && !hasRootOrchestrator) {
    return 'projected-runtime';
  }
  return 'full-package';
}

export function isProjectedRuntimeRoot(root: string = PACKAGE_ROOT): boolean {
  return detectPackageRootMode(root) === 'projected-runtime';
}

/** Shared remedy for install/sync (and similar) when the CLI root is the projected runtime. */
export const FULL_PACKAGE_INSTALL_REMEDY =
  'Run: npx kyro-ai install --scope workspace --yes  (or: npm i -g kyro-ai && kyro install …). Use the full npm package, not node ~/.agents/kyro/current/dist/cli.js.';

/**
 * Throw when install/sync (or any op that must read the full package tree) is
 * invoked from the projected runtime CLI.
 */
export function requireFullPackageFor(operation: 'install' | 'sync'): void {
  if (!isProjectedRuntimeRoot()) return;
  throw new KyroCoreError(
    'INVALID_INPUT',
    `${operation} must run from the full kyro-ai npm package, not the projected runtime CLI.`,
    FULL_PACKAGE_INSTALL_REMEDY,
  );
}
