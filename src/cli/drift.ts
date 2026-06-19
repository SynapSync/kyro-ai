import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { GLOBAL_AGENTS_ROOT, getKyroRuntimeRoot, KYRO_GLOBAL_ROOT, KYRO_MANIFEST_PATH } from './constants';
import { getInstalledAdapterDefinitions } from './adapters/registry';
import { managedPathExists, resolveManagedPath } from './fs';
import { readManifest } from './state';
import type { Agent, KyroManifest, OperationPlan } from './types';

export interface DriftReport {
  currentVersion: string;
  staleVersions: StaleVersion[];
  orphanedFiles: string[];
}

export interface StaleVersion {
  version: string;
  path: string;
}

export function analyzeDrift(agents: Agent[], currentVersion: string): DriftReport {
  const oldManifest = readManifest();
  const staleVersions = detectStaleVersions(currentVersion);
  const orphanedFiles = oldManifest ? detectOrphanedFiles(oldManifest, agents) : [];

  return { currentVersion, staleVersions, orphanedFiles };
}

export function hasDrift(report: DriftReport): boolean {
  return report.staleVersions.length > 0 || report.orphanedFiles.length > 0;
}

export function printDriftReport(report: DriftReport): void {
  if (!hasDrift(report)) return;

  console.log('Drift analysis:');
  if (report.staleVersions.length > 0) {
    console.log(`  Stale runtime versions (use --prune to clean):`);
    for (const stale of report.staleVersions) {
      console.log(`    - ${stale.version} at ${stale.path}`);
    }
  }
  if (report.orphanedFiles.length > 0) {
    console.log(`  Orphaned managed files: ${report.orphanedFiles.length} file(s) no longer declared by adapters`);
    for (const file of report.orphanedFiles.slice(0, 5)) {
      console.log(`    - ${file}`);
    }
    if (report.orphanedFiles.length > 5) {
      console.log(`    ... and ${report.orphanedFiles.length - 5} more`);
    }
  }
}

export function buildPrunePlan(report: DriftReport): OperationPlan[] {
  const plan: OperationPlan[] = [];

  for (const stale of report.staleVersions) {
    plan.push({ action: 'remove', path: stale.path });
  }

  const dirsToClean = new Set<string>();
  for (const file of report.orphanedFiles) {
    plan.push({ action: 'remove', path: file });
    const parent = dirname(file);
    if (parent !== '.' && parent !== '/') {
      dirsToClean.add(parent);
    }
  }

  for (const directory of [...dirsToClean].sort((a, b) => b.length - a.length)) {
    plan.push({ action: 'rmdir-if-empty', path: directory });
  }

  return plan;
}

export function printPrunePlan(plan: OperationPlan[]): void {
  if (plan.length === 0) return;
  console.log('Prune plan:');
  for (const operation of plan) {
    console.log(`- ${operation.action} ${operation.path}`);
  }
}

function detectStaleVersions(currentVersion: string): StaleVersion[] {
  const versionsDir = resolveManagedPath(`${KYRO_GLOBAL_ROOT}/versions`);
  if (!existsSync(versionsDir)) return [];

  const entries = readdirSync(versionsDir).filter((entry) => {
    const fullPath = `${versionsDir}/${entry}`;
    try {
      return statSync(fullPath).isDirectory() && entry !== currentVersion;
    } catch {
      return false;
    }
  });

  return entries.map((version) => ({
    version,
    path: `${KYRO_GLOBAL_ROOT}/versions/${version}`,
  })).sort((a, b) => b.version.localeCompare(a.version));
}

function detectOrphanedFiles(oldManifest: KyroManifest, agents: Agent[]): string[] {
  const currentManaged = getCurrentManagedFiles(agents);
  const currentSet = new Set(currentManaged);

  return oldManifest.managedFiles.filter((file) => !currentSet.has(file));
}

function getCurrentManagedFiles(agents: Agent[]): string[] {
  const files: string[] = [];
  for (const adapter of getInstalledAdapterDefinitions(agents)) {
    files.push(...adapter.buildManagedFiles());
    files.push(...adapter.buildManagedBlocks().map((block) => block.split('#')[0]));
  }
  return [...new Set(files)].sort();
}
