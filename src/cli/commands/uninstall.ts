import { KYRO_STATE_PATH } from '../constants';
import { getInstalledAdapterDefinitions } from '../adapters/registry';
import { applyPlan, printPlan } from '../fs';
import { assertWorkspaceScope } from '../options';
import { readProjectState } from '../state';
import type { CliOptions, OperationPlan } from '../types';

export function uninstall(options: CliOptions): void {
  assertWorkspaceScope(options.scope);
  const state = readProjectState();
  if (!state) {
    console.log('Kyro is not installed in this workspace. No changes made.');
    return;
  }

  const nextState = { ...state, installedAdapters: [] };
  const plan: OperationPlan[] = [];
  const purgeDirectories = new Set<string>();
  for (const adapter of getInstalledAdapterDefinitions(state.installedAdapters.map((installedAdapter) => installedAdapter.agent))) {
    adapter.buildRemoval(plan);
    if (options.purgeAdapterAssets) {
      for (const file of adapter.buildManagedFiles()) {
        plan.push({ action: 'remove', path: file });
        purgeDirectories.add(parentPath(file));
      }
    }
  }
  for (const directory of [...purgeDirectories].sort((a, b) => b.length - a.length)) {
    plan.push({ action: 'rmdir-if-empty', path: directory });
  }

  plan.push({ action: 'write', path: KYRO_STATE_PATH, content: `${JSON.stringify(nextState, null, 2)}\n` });

  printPlan('Uninstall plan', plan);
  printUninstallSummary(plan, options.purgeAdapterAssets);

  if (options.dryRun) {
    console.log('Dry run complete. No files changed.');
    return;
  }

  applyPlan(plan);
  console.log('Kyro project bootstrap removed.');
  if (options.purgeAdapterAssets) {
    console.log('Adapter-owned entrypoint files were removed.');
  } else {
    console.log('Adapter-owned entrypoint files were preserved. Use --purge-adapter-assets to remove them.');
  }
  console.log(`Note: ${KYRO_STATE_PATH}, scope artifacts, and global runtime were preserved.`);
}

function parentPath(path: string): string {
  const index = path.lastIndexOf('/');
  if (index <= 0) return path;
  return path.slice(0, index);
}

function printUninstallSummary(plan: OperationPlan[], purgeAdapterAssets: boolean): void {
  const overlays = plan.filter((operation) => operation.action === 'remove-block' || operation.action === 'remove-json-key').length;
  const files = plan.filter((operation) => operation.action === 'remove').length;
  const directories = plan.filter((operation) => operation.action === 'rmdir-if-empty').length;
  console.log(`Uninstall summary: overlays=${overlays}; purgedFiles=${files}; emptyDirs=${directories}; purgeAdapterAssets=${purgeAdapterAssets ? 'yes' : 'no'}`);
}
