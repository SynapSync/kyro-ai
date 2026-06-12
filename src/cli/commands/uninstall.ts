import { KYRO_ROOT, KYRO_STATE_PATH } from '../constants';
import { applyPlan, printPlan } from '../fs';
import { assertWorkspaceScope } from '../options';
import { readManifest } from '../state';
import type { CliOptions, OperationPlan } from '../types';

export function uninstall(options: CliOptions): void {
  assertWorkspaceScope(options.scope);
  const manifest = readManifest();
  if (!manifest) {
    console.log('Kyro is not installed in this workspace. No changes made.');
    return;
  }

  const plan: OperationPlan[] = [...manifest.managedFiles]
    .sort((a, b) => b.length - a.length)
    .map((filePath) => ({ action: 'remove', path: filePath }));

  plan.push({ action: 'remove', path: KYRO_ROOT });
  printPlan('Uninstall plan', plan);

  if (options.dryRun) {
    console.log('Dry run complete. No files changed.');
    return;
  }

  applyPlan(plan);
  console.log('Kyro managed workspace files removed.');
  console.log(`Note: ${KYRO_STATE_PATH} is preserved so scope history is not lost.`);
}
