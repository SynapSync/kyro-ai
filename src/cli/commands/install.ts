import { printReconciliation, reconcileAdapters } from '../adapters/reconcile';
import { withMachineAdapterRegistryLock } from '../adapters/machine-registry';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { listRegistrableScopeDirectories } from '../artifacts/scopes';
import { buildInstallPlan, buildRuntimeInstallPlan } from '../install-plan';
import { applyPlan, printPlan } from '../fs';
import { assertWorkspaceScope } from '../options';
import { legacyScopeCacheWarnings, readProjectState } from '../state';
import { formatWorkspaceInitPrompt } from '../core/scopes';
import { KyroCoreError } from '../core/errors';
import { isInteractiveTerminal } from '../core/tty';
import { KYRO_ROOT, LOCAL_STATE_PATH, PROJECT_STATE_PATH, SCOPE } from '../constants';
import { requireFullPackageFor } from '../package-root-mode';
import type { Agent, CliOptions, OperationProjectionResult } from '../types';
import { runAdapterPreflight, summarizePlanTargets } from './preflight';
import { analyzeDrift, buildPrunePlan, hasDrift, hasPrunableDrift, managedFilesFromInstallPlan, printDriftReport, printPrunePlan } from '../drift';
import { readPackageVersion } from '../help';
import { withStateWriterLock, withStateWriterLockAsync } from '../pipeline/state-writer-lock';

export function install(options: CliOptions): void | Promise<void> {
  requireFullPackageFor('install');
  assertWorkspaceScope(options.scope);
  const agents = options.agents;

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
  if (!options.dryRun) return withMachineAdapterRegistryLock(() => runInstallPlanUnlocked(options, agents, packageVersion, shouldInitializeWorkspace));
  runInstallPlanUnlocked(options, agents, packageVersion, shouldInitializeWorkspace);
}

function runInstallPlanUnlocked(options: CliOptions, agents: Agent[], packageVersion: string, shouldInitializeWorkspace: boolean): void {
  runAdapterPreflight('install', reconcileAdapters(agents, options.integrations).desired);
  const warnings = shouldInitializeWorkspace ? legacyScopeCacheWarnings() : [];
  const plan = shouldInitializeWorkspace ? buildInstallPlan(agents, options.scope, new Map(), options.integrations) : buildRuntimeInstallPlan(options.scope, agents, options.integrations);
  console.log(`Plan summary: ${summarizePlanTargets(plan)}`);
  if (!shouldInitializeWorkspace && options.dryRun) {
    console.log('Workspace: skipped');
  }
  if (options.dryRun || options.trace || options.verbose) {
    printPlan('Install plan', plan);
  }

  if (options.dryRun) {
    console.log('Dry run complete. No files changed.');
    printReconciliation(plan);
    printLegacyScopeWarnings(warnings, true);
    return;
  }

  const projections = applyPlan(plan);
  printProjections(projections);
  printReconciliation(plan, projections);
  console.log('Kyro has been installed.');
  console.log(`Version: ${packageVersion}`);
  if (shouldInitializeWorkspace) {
    console.log(`State: ${PROJECT_STATE_PATH} + ${LOCAL_STATE_PATH}`);
  } else {
    console.log('Workspace: skipped');
  }
  console.log(`Runtime: ${KYRO_ROOT}/`);
  printLegacyScopeWarnings(warnings);
}

export function sync(options: CliOptions): void {
  if (options.dryRun) return syncUnlocked(options);
  withStateWriterLock(() => withMachineAdapterRegistryLock(() => syncUnlocked(options)));
}

function syncUnlocked(options: CliOptions): void {
  requireFullPackageFor('sync');
  assertWorkspaceScope(options.scope);
  const state = readProjectState();
  if (!state) {
    throw new KyroCoreError('INVALID_INPUT', 'Kyro is not installed in this workspace.', 'Run kyro install --init-workspace.');
  }
  const agents = options.agents;
  const unique = reconcileAdapters(agents, options.integrations).desired;
  runAdapterPreflight('sync', unique);

  const currentVersion = readPackageVersion();
  const warnings = legacyScopeCacheWarnings();
  const plan = buildInstallPlan(agents, SCOPE.WORKSPACE, new Map(), options.integrations);
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
    printReconciliation(plan);
    printLegacyScopeWarnings(warnings, true);
    return;
  }
  const projections = applyPlan(plan);
  printProjections(projections);
  printReconciliation(plan, projections);
  console.log(`Kyro synced for: ${unique.join(', ')}`);
  printLegacyScopeWarnings(warnings);
}

function printProjections(projections: OperationProjectionResult[]): void {
  for (const result of projections) {
    console.log(`- ${result.path}: projection=${result.projection} <= ${result.source}`);
  }
}

function printLegacyScopeWarnings(warnings: readonly string[], preview = false): void {
  if (warnings.length === 0 || process.env.KYRO_UPDATE_DEFER_SCOPE_WARNINGS === '1') return;
  console.warn(`WARNING: ${warnings.length} legacy scope issue(s) ${preview ? 'would remain after the runtime refresh' : 'remain after the runtime refresh'}:`);
  for (const warning of warnings) console.warn(`  - ${warning}`);
  console.warn(preview
    ? 'No files changed. Sync will remove project.json.scopes[]; scope files will remain unchanged.'
    : 'Legacy scopes[] was removed without creating a legacy-migrations backup. Scope files remain unchanged; inspect them with kyro doctor --artifacts.');
}

function shouldInstallWorkspace(options: CliOptions, hasWorkspaceState: boolean): boolean | Promise<boolean> {
  if (hasWorkspaceState) return true;
  if (options.noInitWorkspace) return false;
  if (options.initWorkspace) return true;
  if (options.dryRun) return false;
  if (!isInteractiveTerminal()) return false;
  return confirmWorkspaceInit();
}

async function confirmWorkspaceInit(): Promise<boolean> {
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(formatWorkspaceInitPrompt(listRegistrableScopeDirectories()));
    return answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes';
  } finally {
    rl.close();
  }
}
