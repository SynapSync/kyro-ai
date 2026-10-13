import { KYRO_STATE_PATH, LOCAL_STATE_PATH, PROJECT_STATE_PATH, MACHINE_ADAPTER_REGISTRY_PATH } from '../constants';
import { readMachineAdapterRegistry, registerMachineAdapterPlan, withMachineAdapterRegistryLock } from '../adapters/machine-registry';
import { getInstallableAdapters } from '../adapters/registry';
import { setCliMachineResult } from '../core/cli-envelope';
import { withStateWriterLock } from '../pipeline/state-writer-lock';
import { assertRealRemovalParents, buildMachineRemovalPlan } from './adapters';
import { getInstalledAdapterDefinitions } from '../adapters/registry';
import { applyPlan, printPlan } from '../fs';
import { assertWorkspaceScope } from '../options';
import {
  hasLayeredProjectStateOnDisk,
  hasMonolitoProjectStateOnDisk,
  readProjectState,
  sanitizeLocalForWrite,
  sanitizeSharedForWrite,
  splitMonolitoToLayers,
} from '../state';
import type { CliOptions, OperationPlan } from '../types';

export function uninstall(options: CliOptions & { machine?: boolean }): void {
  if (options.machine) { uninstallMachine(options); return; }
  assertWorkspaceScope(options.scope);
  const state = readProjectState();
  if (!state) {
    console.log('Kyro is not installed in this workspace. No changes made.');
    return;
  }

  const nextState = { ...state, installedAdapters: [] };
  const plan: OperationPlan[] = [];
  // Only workspace-local instruction blocks belong to workspace uninstall.
  // Machine links, canonical files, and home integrations survive even legacy purge.
  for (const adapter of getInstalledAdapterDefinitions(state.installedAdapters.map((installedAdapter) => installedAdapter.agent))) {
    const removal: OperationPlan[] = [];
    adapter.buildRemoval(removal);
    plan.push(...removal.filter((operation) => !operation.path.startsWith('~/')));
  }

  // Clear installedAdapters on the correct layer; never recreate monolito when layers exist.
  if (hasLayeredProjectStateOnDisk() || !hasMonolitoProjectStateOnDisk()) {
    const { shared, local } = splitMonolitoToLayers(nextState);
    plan.push({
      action: 'write',
      path: PROJECT_STATE_PATH,
      content: `${JSON.stringify(sanitizeSharedForWrite(shared), null, 2)}\n`,
    });
    plan.push({
      action: 'write',
      path: LOCAL_STATE_PATH,
      content: `${JSON.stringify(sanitizeLocalForWrite(local), null, 2)}\n`,
    });
  } else {
    plan.push({ action: 'write', path: KYRO_STATE_PATH, content: `${JSON.stringify(nextState, null, 2)}\n` });
  }

  printPlan('Uninstall plan', plan);
  printUninstallSummary(plan, options.purgeAdapterAssets);

  if (options.dryRun) {
    console.log('Dry run complete. No files changed.');
    return;
  }

  applyPlan(plan);
  console.log('Kyro project bootstrap removed.');
  console.log('Machine projections and integrations were preserved. Use kyro uninstall --machine to remove them.');
  const preservedState = hasLayeredProjectStateOnDisk() || !hasMonolitoProjectStateOnDisk()
    ? `${PROJECT_STATE_PATH} + ${LOCAL_STATE_PATH}`
    : KYRO_STATE_PATH;
  console.log(`Note: ${preservedState}, scope artifacts, and global runtime were preserved.`);
}

function uninstallMachine(options: CliOptions): void {
  assertRealRemovalParents(MACHINE_ADAPTER_REGISTRY_PATH);
  const run = (): void => {
    readMachineAdapterRegistry(); // Validate before touching any owned path.
    assertRealRemovalParents(MACHINE_ADAPTER_REGISTRY_PATH);
    const plan = buildMachineRemovalPlan(getInstallableAdapters().map((adapter) => adapter.agent), true);
    registerMachineAdapterPlan(plan, { schemaVersion: 1, adapters: [] });
    // The registry is removed by the same transactional plan, under its machine lock.
    plan.push({ action: 'remove', path: MACHINE_ADAPTER_REGISTRY_PATH });
    printPlan('Machine uninstall plan', plan);
    if (!options.dryRun) applyPlan(plan);
    setCliMachineResult(options.dryRun ? 'preview' : 'applied', { machine: true, dryRun: options.dryRun, affectedFiles: plan.map((operation) => operation.path) });
    console.log(options.dryRun ? 'Dry run complete. No files changed.' : 'Kyro-owned canonical skills, machine projections, integrations, and adapter registry removed. Global runtime and workspace state preserved.');
  };
  if (options.dryRun) run();
  else withStateWriterLock(() => withMachineAdapterRegistryLock(run));
}

function printUninstallSummary(plan: OperationPlan[], purgeAdapterAssets: boolean): void {
  const overlays = plan.filter((operation) => operation.action === 'remove-block' || operation.action === 'remove-json-key').length;
  const files = plan.filter((operation) => operation.action === 'remove').length;
  const directories = plan.filter((operation) => operation.action === 'rmdir-if-empty').length;
  console.log(`Uninstall summary: overlays=${overlays}; purgedFiles=${files}; emptyDirs=${directories}; purgeAdapterAssets=${purgeAdapterAssets ? 'yes' : 'no'}`);
}
