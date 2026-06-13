import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ARTIFACT_ROOT, KYRO_MANIFEST_PATH, KYRO_STATE_PATH, PACKAGE_ROOT } from '../constants';
import { managedPathExists, readJsonFromPackage, readPackageText, workspaceFileExists } from '../fs';
import { readPackageVersion } from '../help';
import { readManifest, readProjectState } from '../state';
import { getAdapterDefinition } from '../adapters/registry';
import type { Agent, CheckResult } from '../types';

export function doctor(): void {
  const checks = runDoctorChecks();
  let failed = false;

  for (const check of checks) {
    const icon = check.status === 'pass' ? 'PASS' : check.status === 'warn' ? 'WARN' : 'FAIL';
    console.log(`[${icon}] ${check.name}: ${check.detail}`);
    if (check.remedy) console.log(`       Remedy: ${check.remedy}`);
    if (check.status === 'fail') failed = true;
  }

  if (failed) process.exit(1);
}

function runDoctorChecks(): CheckResult[] {
  return [
    checkPackageVersionSync(),
    checkPackageAssets(),
    checkClaudePlugin(),
    checkProjectState(),
    checkGlobalRuntime(),
    ...checkAdapterProjections(),
  ];
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
  if (
    state.schemaVersion !== 1
    || state.artifactRoot !== ARTIFACT_ROOT
    || !Array.isArray(state.scopes)
    || typeof state.runtimeVersion !== 'string'
    || typeof state.runtimePath !== 'string'
  ) {
    return { status: 'fail', name: 'project state', detail: `${KYRO_STATE_PATH} has invalid shape` };
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
  const missing = manifest.managedFiles.filter((file) => !managedPathExists(file));
  if (missing.length > 0) {
    return {
      status: 'fail',
      name: 'global runtime',
      detail: `missing managed files: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '...' : ''}`,
      remedy: 'Run kyro sync.',
    };
  }
  return { status: 'pass', name: 'global runtime', detail: `${manifest.managedFiles.length} managed files present` };
}

function checkAdapterProjections(): CheckResult[] {
  const state = readProjectState();
  const manifest = readManifest();
  if (!state) return [];

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

function readYamlVersion(file: string): string {
  const text = readPackageText(file);
  const match = text.match(/^version:\s*["']?([^"'\n]+)["']?$/m);
  if (!match) throw new Error(`Could not parse version from ${file}`);
  return match[1];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
