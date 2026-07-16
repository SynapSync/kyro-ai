import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PACKAGE_ROOT } from './constants';
import { KyroCoreError } from './core/errors';

/** Whether the CLI root is a verified package, a projected runtime, or ambiguous/corrupt. */
export type PackageRootMode = 'full-package' | 'projected-runtime' | 'unknown';

/**
 * Detect whether `root` is the full kyro-ai npm package layout or an installed
 * projected runtime (`~/.agents/kyro/current` and test HOMEs).
 *
 * Full packages and projected runtimes use mutually exclusive identity markers.
 * Several projected markers are accepted so losing one or more managed files
 * does not reclassify a corrupt runtime as a package and re-enable install/sync.
 * Ambiguous or marker-less layouts are `unknown` and therefore fail closed.
 * Do not match on path strings — tests use temp HOME directories.
 */
export function detectPackageRootMode(root: string = PACKAGE_ROOT): PackageRootMode {
  const hasDistCli = existsSync(resolve(root, 'dist/cli.js'));
  const hasManifest = existsSync(resolve(root, 'manifest.json'));
  const hasRuntimeBootstrap = existsSync(resolve(root, 'KYRO.md'));
  const hasCoreOrchestrator = existsSync(resolve(root, 'core/agents/orchestrator.md'));
  const hasCoreWorkflow = existsSync(resolve(root, 'core/WORKFLOW.yaml'));
  const hasRootOrchestrator = existsSync(resolve(root, 'agents/orchestrator.md'));
  const hasProjectedMarker = hasManifest || hasRuntimeBootstrap || hasCoreOrchestrator || hasCoreWorkflow;

  if (hasDistCli && hasRootOrchestrator && !hasProjectedMarker) return 'full-package';
  if (hasDistCli && !hasRootOrchestrator && hasProjectedMarker) return 'projected-runtime';
  return 'unknown';
}

/** Shared install remedy for any CLI root that is not a verified full package. */
export const FULL_PACKAGE_INSTALL_REMEDY =
  'Run: npx kyro-ai install --scope workspace --yes  (or: npm i -g kyro-ai && kyro install …). Use the full npm package, not node ~/.agents/kyro/current/dist/cli.js.';

/** Shared sync remedy for any CLI root that is not a verified full package. */
export const FULL_PACKAGE_SYNC_REMEDY =
  'Run: npx kyro-ai sync --scope workspace  (or: npx kyro-ai install --scope workspace --yes). Use the full npm package, not node ~/.agents/kyro/current/dist/cli.js.';

/**
 * Throw when install/sync (or any op that must read the full package tree) is
 * invoked from a projected, conflicting, corrupt, or otherwise unknown root.
 */
export function requireFullPackageFor(operation: 'install' | 'sync'): void {
  const mode = detectPackageRootMode();
  if (mode === 'full-package') return;
  const source = mode === 'projected-runtime' ? 'the projected runtime CLI' : 'an unrecognized or corrupt CLI root';
  throw new KyroCoreError(
    'INVALID_INPUT',
    `${operation} must run from the full kyro-ai npm package, not ${source}.`,
    FULL_PACKAGE_INSTALL_REMEDY,
  );
}
