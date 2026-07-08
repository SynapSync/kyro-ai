import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { KYRO_LEGACY_VERSIONS_ROOT } from './constants';
import { resolveManagedPath } from './fs';
import { readManifest } from './state';
import type { KyroManifest, OperationPlan } from './types';

export interface DriftReport {
  currentVersion: string;
  legacyRuntimeDirs: LegacyRuntimeDir[];
  orphanedFiles: string[];
  preservedSharedConfig: string[];
}

export interface LegacyRuntimeDir {
  name: string;
  path: string;
}

export function analyzeDrift(currentVersion: string, currentManagedFiles: string[]): DriftReport {
  const oldManifest = readManifest();
  const legacyRuntimeDirs = detectLegacyRuntimeDirs();
  const orphaned = oldManifest ? detectOrphanedFiles(oldManifest, currentManagedFiles) : { prunable: [], preservedSharedConfig: [] };

  return {
    currentVersion,
    legacyRuntimeDirs,
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
  return report.legacyRuntimeDirs.length > 0 || report.orphanedFiles.length > 0 || report.preservedSharedConfig.length > 0;
}

export function hasPrunableDrift(report: DriftReport): boolean {
  return report.orphanedFiles.length > 0;
}

export function printDriftReport(report: DriftReport): void {
  if (!hasDrift(report)) return;

  console.log('Drift analysis:');
  if (report.legacyRuntimeDirs.length > 0) {
    console.log(`  Legacy versioned runtime directories (cleaned automatically by install/sync):`);
    for (const legacy of report.legacyRuntimeDirs) {
      console.log(`    - ${legacy.name} at ${legacy.path}`);
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

function detectLegacyRuntimeDirs(): LegacyRuntimeDir[] {
  const versionsDir = resolveManagedPath(KYRO_LEGACY_VERSIONS_ROOT);
  if (!existsSync(versionsDir)) return [];

  const entries = readdirSync(versionsDir).filter((entry) => {
    const fullPath = `${versionsDir}/${entry}`;
    try {
      return statSync(fullPath).isDirectory();
    } catch {
      return false;
    }
  });

  return entries.map((name) => ({
    name,
    path: `${KYRO_LEGACY_VERSIONS_ROOT}/${name}`,
  })).sort((a, b) => b.name.localeCompare(a.name));
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
