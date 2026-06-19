import { buildInstallPlan } from '../install-plan';
import { applyPlan, printPlan } from '../fs';
import { assertWorkspaceScope, uniqueAgents } from '../options';
import { readProjectState } from '../state';
import { AGENT, KYRO_ROOT, KYRO_STATE_PATH, SCOPE } from '../constants';
import type { CliOptions } from '../types';
import { runAdapterPreflight, summarizePlanTargets } from './preflight';

export function install(options: CliOptions): void {
  assertWorkspaceScope(options.scope);
  const agents = options.agents.length > 0 ? options.agents : [AGENT.STANDARD];
  runAdapterPreflight('install', agents);

  const plan = buildInstallPlan(agents, options.scope);
  console.log(`Plan summary: ${summarizePlanTargets(plan)}`);
  printPlan('Install plan', plan);

  if (options.dryRun) {
    console.log('Dry run complete. No files changed.');
    return;
  }

  applyPlan(plan);
  console.log('Kyro has been installed.');
  console.log(`State: ${KYRO_STATE_PATH}`);
  console.log(`Runtime: ${KYRO_ROOT}/`);
}

export function sync(options: CliOptions): void {
  assertWorkspaceScope(options.scope);
  const state = readProjectState();
  if (!state) {
    throw new Error('Kyro is not installed in this workspace. Run kyro install first.');
  }
  const agents = options.agents.length > 0 ? options.agents : state.installedAdapters.map((adapter) => adapter.agent);
  const unique = uniqueAgents(agents);
  runAdapterPreflight('sync', unique);
  const plan = buildInstallPlan(unique, SCOPE.WORKSPACE);
  console.log(`Plan summary: ${summarizePlanTargets(plan)}`);
  printPlan('Sync plan', plan);
  if (options.dryRun) {
    console.log('Dry run complete. No files changed.');
    return;
  }
  applyPlan(plan);
  console.log(`Kyro synced for: ${unique.join(', ')}`);
}
