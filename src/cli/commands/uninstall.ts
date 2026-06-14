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
  const plan: OperationPlan[] = getInstalledAdapterDefinitions(state.installedAdapters.map((adapter) => adapter.agent))
    .flatMap((adapter) => adapter.buildManagedBlocks())
    .map((blockRef) => {
      const [path, blockName] = blockRef.split('#');
      return { action: 'remove-block' as const, path, blockName };
    });

  plan.push({ action: 'write', path: KYRO_STATE_PATH, content: `${JSON.stringify(nextState, null, 2)}\n` });

  printPlan('Uninstall plan', plan);

  if (options.dryRun) {
    console.log('Dry run complete. No files changed.');
    return;
  }

  applyPlan(plan);
  console.log('Kyro project bootstrap removed.');
  console.log(`Note: ${KYRO_STATE_PATH}, scope artifacts, global runtime, and global command skills were preserved.`);
}
