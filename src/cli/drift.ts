import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { KYRO_GLOBAL_ROOT } from './constants';
import { resolveManagedPath } from './fs';
import { readManifest } from './state';
import type { KyroManifest, OperationPlan } from './types';

export interface DriftReport {
  currentVersion: string;
  staleVersions: StaleVersion[];
  orphanedFiles: string[];
  preservedSharedConfig: string[];
}

export interface StaleVersion {
  version: string;
  path: string;
}

export function analyzeDrift(currentVersion: string, currentManagedFiles: string[]): DriftReport {
  const oldManifest = readManifest();
  const staleVersions = detectStaleVersions(currentVersion);
  const orphaned = oldManifest ? detectOrphanedFiles(oldManifest, currentManagedFiles) : { prunable: [], preservedSharedConfig: [] };

  return {
    currentVersion,
    staleVersions,
    orphanedFiles: orphaned.prunable,
    preservedSharedConfig: orphaned.preservedSharedConfig,
  };
}

export function managedFilesFromInstallPlan(plan: OperationPlan[]): string[] {
  const manifestWrite = plan.find((operation) => operation.action === 'write' && operation.path.includes('/manifest.json') && operation.content);
  if (!manifestWrite?.content) return [];
  const manifest = JSON.parse(manifestWrite.content) as KyroManifest;
  return manifest.managedFiles;
}

export function hasDrift(report: DriftReport): boolean {
  return report.staleVersions.length > 0 || report.orphanedFiles.length > 0 || report.preservedSharedConfig.length > 0;
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
  if (report.preservedSharedConfig.length > 0) {
    console.log(`  Shared config preserved: ${report.preservedSharedConfig.length} file(s) listed by old manifests but not pruned`);
    for (const file of report.preservedSharedConfig.slice(0, 5)) {
      console.log(`    - ${file}`);
    }
    if (report.preservedSharedConfig.length > 5) {
      console.log(`    ... and ${report.preservedSharedConfig.length - 5} more`);
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

function detectOrphanedFiles(oldManifest: KyroManifest, currentManagedFiles: string[]): { prunable: string[]; preservedSharedConfig: string[] } {
  const currentSet = new Set(currentManagedFiles);
  const prunable: string[] = [];
  const preservedSharedConfig: string[] = [];

  for (const file of oldManifest.managedFiles) {
    if (currentSet.has(file)) continue;
    if (isPrunableOrphanFile(file)) {
      prunable.push(file);
    } else if (isSharedConfigFile(file)) {
      preservedSharedConfig.push(file);
    }
  }

  return { prunable, preservedSharedConfig };
}

function isPrunableOrphanFile(file: string): boolean {
  return file.startsWith('~/.agents/skills/kyro-')
    || file.startsWith('~/.config/opencode/skills/kyro-')
    || file.startsWith('~/.config/opencode/commands/kyro/');
}

function isSharedConfigFile(file: string): boolean {
  return file === '~/.config/opencode/opencode.json';
}
