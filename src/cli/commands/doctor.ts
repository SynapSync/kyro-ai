import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ARTIFACT_ROOT, KYRO_GLOBAL_ROOT, KYRO_MANIFEST_PATH, KYRO_STATE_PATH, PACKAGE_ROOT } from '../constants';
import { managedPathExists, readJsonFromPackage, readPackageText } from '../fs';
import { readPackageVersion } from '../help';
import { readManifest, readProjectState } from '../state';
import { ADAPTERS, getAdapterDefinition } from '../adapters/registry';
import { runTokenAuditChecks } from './token-audit';
import { runArtifactAuditChecks } from './artifact-doctor';
import type { Agent, CheckResult, CliOptions } from '../types';

export function doctor(options?: Pick<CliOptions, 'tokens' | 'artifacts' | 'adapters' | 'kyroScope'>): void {
  const checks = runDoctorChecks(options?.tokens ?? false, options?.artifacts ?? false, options?.adapters ?? false, options?.kyroScope ?? null);
  let failed = false;

  for (const check of checks) {
    const icon = check.status === 'pass' ? 'PASS' : check.status === 'warn' ? 'WARN' : 'FAIL';
    console.log(`[${icon}] ${check.name}: ${check.detail}`);
    if (check.remedy) console.log(`       Remedy: ${check.remedy}`);
    if (check.status === 'fail') failed = true;
  }

  if (failed) process.exit(1);
}

function runDoctorChecks(includeTokenAudit: boolean, includeArtifactAudit: boolean, includeAdapterInventory: boolean, kyroScope: string | null): CheckResult[] {
  const checks = [
    checkPackageVersionSync(),
    checkPackageAssets(),
    checkClaudePlugin(),
    checkProjectState(),
    checkGlobalRuntime(),
    ...checkAdapterProjections(),
  ];

  if (includeTokenAudit) checks.push(...runTokenAuditChecks());
  if (includeArtifactAudit) checks.push(...runArtifactAuditChecks({ kyroScope }));
  if (includeAdapterInventory) checks.push(...checkAdapterInventory());
  return checks;
}

function checkPackageVersionSync(): CheckResult {
  try {
    const pkgVersion = readPackageVersion();
    const pluginVersion = readJsonFromPackage<{ version: string }>('.claude-plugin/plugin.json').version;
    const workflowVersion = readYamlVersion('WORKFLOW.yaml');
    if (pkgVersion !== pluginVersion || pkgVersion !== workflowVersion) {
      return {
        status: 'fail',
        name: 'package versions',
        detail: `package=${pkgVersion}, plugin=${pluginVersion}, workflow=${workflowVersion}`,
        remedy: 'Run npm run check:versions and align version fields.',
      };
    }
    return { status: 'pass', name: 'package versions', detail: `all versions match ${pkgVersion}` };
  } catch (error: unknown) {
    return { status: 'fail', name: 'package versions', detail: errorMessage(error) };
  }
}

function checkPackageAssets(): CheckResult {
  const required = ['agents/orchestrator.md', 'commands/forge.md', 'commands/status.md', 'commands/wrap-up.md', 'skills/sprint-forge/SKILL.md', 'skills/qa-review/SKILL.md'];
  const missing = required.filter((file) => !existsSync(resolve(PACKAGE_ROOT, file)));
  if (missing.length > 0) {
    return { status: 'fail', name: 'package assets', detail: `missing ${missing.join(', ')}` };
  }
  return { status: 'pass', name: 'package assets', detail: 'required Kyro assets exist' };
}

function checkClaudePlugin(): CheckResult {
  const pluginPath = resolve(PACKAGE_ROOT, '.claude-plugin/plugin.json');
  if (!existsSync(pluginPath)) {
    return { status: 'fail', name: 'Claude plugin adapter', detail: '.claude-plugin/plugin.json missing' };
  }
  return { status: 'pass', name: 'Claude plugin adapter', detail: 'first-class adapter assets present' };
}

function checkProjectState(): CheckResult {
  const state = readProjectState();
  if (!state) {
    return {
      status: 'warn',
      name: 'project state',
      detail: `${KYRO_STATE_PATH} not found`,
      remedy: 'Run kyro install --scope workspace.',
    };
  }
  const missing: string[] = [];
  if (state.artifactRoot !== ARTIFACT_ROOT) missing.push('artifactRoot');
  if (!Array.isArray(state.scopes)) missing.push('scopes');
  if (typeof state.runtimeVersion !== 'string') missing.push('runtimeVersion');
  if (typeof state.runtimePath !== 'string') missing.push('runtimePath');
  if (!Array.isArray(state.installedAdapters)) missing.push('installedAdapters');

  if (state.schemaVersion !== 4 || missing.length > 0) {
    // schemaVersion wrong/absent or fields missing — an incomplete file (e.g. hand-written by an
    // agent that never ran kyro install). install/sync repopulates the fields, preserving scopes.
    const gaps = [...(state.schemaVersion !== 4 ? ['schemaVersion'] : []), ...missing];
    return { status: 'fail', name: 'project state', detail: `${KYRO_STATE_PATH} is incomplete (missing/invalid: ${gaps.join(', ')})`, remedy: 'Run kyro install --scope workspace to repopulate the required fields (scopes are preserved).' };
  }
  return { status: 'pass', name: 'project state', detail: `${KYRO_STATE_PATH} is valid` };
}

function checkGlobalRuntime(): CheckResult {
  const manifest = readManifest();
  if (!manifest) {
    return {
      status: 'warn',
      name: 'global runtime',
      detail: `${KYRO_MANIFEST_PATH} not found`,
      remedy: 'Run kyro install.',
    };
  }
  const runtimeFiles = manifest.managedFiles.filter((file) => file.startsWith(`${KYRO_GLOBAL_ROOT}/`));
  const missing = runtimeFiles.filter((file) => !managedPathExists(file));
  if (missing.length > 0) {
    return {
      status: 'fail',
      name: 'global runtime',
      detail: `missing managed files: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '...' : ''}`,
      remedy: 'Run kyro sync.',
    };
  }
  return { status: 'pass', name: 'global runtime', detail: `${runtimeFiles.length} runtime files present` };
}

function checkAdapterProjections(): CheckResult[] {
  const state = readProjectState();
  const manifest = readManifest();
  // An incomplete kyro.json (missing installedAdapters) is reported by checkProjectState — do not
  // crash the whole diagnostic here. A diagnostic must survive exactly the data it diagnoses.
  if (!state || !Array.isArray(state.installedAdapters)) return [];

  return state.installedAdapters.map((installedAdapter) => {
    try {
      return getAdapterDefinition(installedAdapter.agent as Agent).doctor(manifest ? { ...manifest, adapters: state.installedAdapters } : null);
    } catch (error: unknown) {
      return {
        status: 'fail',
        name: `${installedAdapter.agent} adapter`,
        detail: errorMessage(error),
        remedy: 'Run kyro sync or reinstall the adapter.',
      };
    }
  });
}

function checkAdapterInventory(): CheckResult[] {
  return ADAPTERS.map((adapter) => {
    const managedFiles = adapter.buildManagedFiles();
    const managedBlocks = adapter.buildManagedBlocks();
    const capabilities = adapter.capabilities();
    const paths = adapter.paths('~');
    const nativePaths = Object.values(paths).filter(Boolean).length;
    const detail = [
      `status=${adapter.status}`,
      `managedFiles=${managedFiles.length}`,
      `managedBlocks=${managedBlocks.length}`,
      `nativePaths=${nativePaths}`,
      `systemPromptStrategy=${adapter.systemPromptStrategy()}`,
      `mcpStrategy=${adapter.mcpStrategy()}`,
      `capabilities=${capabilities.length > 0 ? capabilities.join(',') : 'none'}`,
    ].join('; ');

    if (adapter.status === 'planned') {
      return { status: 'warn', name: `adapter inventory: ${adapter.agent}`, detail };
    }

    return { status: 'pass', name: `adapter inventory: ${adapter.agent}`, detail };
  });
}

function readYamlVersion(file: string): string {
  const text = readPackageText(file);
  const match = text.match(/^version:\s*["']?([^"'\n]+)["']?$/m);
  if (!match) throw new Error(`Could not parse version from ${file}`);
  return match[1];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
