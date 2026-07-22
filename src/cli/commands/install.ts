import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { listScopeFolders } from '../artifacts/scopes';
import { buildInstallPlan, buildRuntimeInstallPlan } from '../install-plan';
import { applyPlan, printPlan } from '../fs';
import { assertWorkspaceScope, uniqueAgents } from '../options';
import { readProjectState } from '../state';
import { formatWorkspaceInitPrompt } from '../core/scopes';
import { KyroCoreError } from '../core/errors';
import { AGENT, KYRO_ROOT, KYRO_STATE_PATH, SCOPE } from '../constants';
import { requireFullPackageFor } from '../package-root-mode';
import type { Agent, CliOptions } from '../types';
import { runAdapterPreflight, summarizePlanTargets } from './preflight';
import { analyzeDrift, buildPrunePlan, hasDrift, hasPrunableDrift, managedFilesFromInstallPlan, printDriftReport, printPrunePlan } from '../drift';
import { readPackageVersion } from '../help';
import { withStateWriterLock, withStateWriterLockAsync } from '../pipeline/state-writer-lock';

export function install(options: CliOptions): void | Promise<void> {
  requireFullPackageFor('install');
  assertWorkspaceScope(options.scope);
  const agents = options.agents.length > 0 ? options.agents : [AGENT.STANDARD];
  runAdapterPreflight('install', agents);

  const packageVersion = readPackageVersion();
  const existingState = readProjectState();
  const workspaceDecision = shouldInstallWorkspace(options, existingState !== null);
  if (workspaceDecision instanceof Promise) {
    return workspaceDecision.then((shouldInitializeWorkspace) => withStateWriterLockAsync(() => {
      // State may have changed while the prompt was open. Existing workspaces are always refreshed.
      runInstallPlan(options, agents, packageVersion, readProjectState() !== null || shouldInitializeWorkspace);
    }));
  }
  if (options.dryRun) runInstallPlan(options, agents, packageVersion, workspaceDecision);
  else withStateWriterLock(() => runInstallPlan(options, agents, packageVersion, readProjectState() !== null || workspaceDecision));
}

function runInstallPlan(
  options: CliOptions,
  agents: Agent[],
  packageVersion: string,
  shouldInitializeWorkspace: boolean,
): void {
  const plan = shouldInitializeWorkspace ? buildInstallPlan(agents, options.scope) : buildRuntimeInstallPlan(options.scope);
  console.log(`Plan summary: ${summarizePlanTargets(plan)}`);
  if (!shouldInitializeWorkspace && options.dryRun) {
    console.log('Workspace: skipped');
  }
  if (options.dryRun || options.trace || options.verbose) {
    printPlan('Install plan', plan);
  }

  if (options.dryRun) {
    console.log('Dry run complete. No files changed.');
    return;
  }

  applyPlan(plan);
  console.log('Kyro has been installed.');
  console.log(`Version: ${packageVersion}`);
  if (shouldInitializeWorkspace) {
    console.log(`State: ${KYRO_STATE_PATH}`);
  } else {
    console.log('Workspace: skipped');
  }
  console.log(`Runtime: ${KYRO_ROOT}/`);
}

export function sync(options: CliOptions): void {
  requireFullPackageFor('sync');
  assertWorkspaceScope(options.scope);
  const state = readProjectState();
  if (!state) {
    throw new KyroCoreError('INVALID_INPUT', 'Kyro is not installed in this workspace.', 'Run kyro install --init-workspace.');
  }
  const agents = options.agents.length > 0 ? options.agents : (state.installedAdapters ?? []).map((adapter) => adapter.agent);
  const unique = uniqueAgents(agents);
  runAdapterPreflight('sync', unique);

  const currentVersion = readPackageVersion();
  const plan = buildInstallPlan(unique, SCOPE.WORKSPACE);
  const drift = analyzeDrift(currentVersion, managedFilesFromInstallPlan(plan));
  console.log(`Plan summary: ${summarizePlanTargets(plan)}`);
  if (options.dryRun || options.trace || options.verbose) {
    printPlan('Sync plan', plan);
  }

  if (hasDrift(drift)) {
    printDriftReport(drift);
    if (options.prune) {
      const prunePlan = buildPrunePlan(drift);
      if (prunePlan.length > 0) {
        printPrunePlan(prunePlan);
        plan.push(...prunePlan);
      } else {
        console.log('  No prunable drift found. Shared config was preserved.');
      }
    } else if (hasPrunableDrift(drift)) {
      console.log('  Tip: run with --prune to clean obsolete adapter-owned files.');
    }
  }

  if (options.dryRun) {
    console.log('Dry run complete. No files changed.');
    return;
  }
  applyPlan(plan);
  console.log(`Kyro synced for: ${unique.join(', ')}`);
}

function shouldInstallWorkspace(options: CliOptions, hasWorkspaceState: boolean): boolean | Promise<boolean> {
  if (hasWorkspaceState) return true;
  if (options.noInitWorkspace) return false;
  if (options.initWorkspace) return true;
  if (options.dryRun) return false;
  if (!isInteractiveTerminal()) return false;
  return confirmWorkspaceInit();
}

function isInteractiveTerminal(): boolean {
  return input.isTTY === true && output.isTTY === true;
}

async function confirmWorkspaceInit(): Promise<boolean> {
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(formatWorkspaceInitPrompt(listScopeFolders()));
    return answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes';
  } finally {
    rl.close();
  }
}
