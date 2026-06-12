import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { AGENT, COMMAND_NAMES, AGENT_SKILLS_ROOT, ARTIFACT_ROOT, KYRO_MANIFEST_PATH, KYRO_STATE_PATH, PACKAGE_ROOT, WORKSPACE_ROOT } from '../constants';
import { readJsonFromPackage, readPackageText, workspaceFileExists } from '../fs';
import { readPackageVersion } from '../help';
import { readManifest, readProjectState } from '../state';
import type { CheckResult } from '../types';

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
    checkWorkspaceCore(),
    checkOpenCodeProjection(),
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
      name: 'workspace state',
      detail: `${KYRO_STATE_PATH} not found`,
      remedy: 'Run kyro install --agent opencode --scope workspace.',
    };
  }
  if (state.schemaVersion !== 1 || state.artifactRoot !== ARTIFACT_ROOT || !Array.isArray(state.scopes)) {
    return { status: 'fail', name: 'workspace state', detail: `${KYRO_STATE_PATH} has invalid shape` };
  }
  return { status: 'pass', name: 'workspace state', detail: `${KYRO_STATE_PATH} is valid` };
}

function checkWorkspaceCore(): CheckResult {
  const manifest = readManifest();
  if (!manifest) {
    return {
      status: 'warn',
      name: 'workspace core',
      detail: `${KYRO_MANIFEST_PATH} not found`,
      remedy: 'Run kyro install.',
    };
  }
  const missing = manifest.managedFiles.filter((file) => !workspaceFileExists(file));
  if (missing.length > 0) {
    return {
      status: 'fail',
      name: 'workspace core',
      detail: `missing managed files: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '...' : ''}`,
      remedy: 'Run kyro sync.',
    };
  }
  return { status: 'pass', name: 'workspace core', detail: `${manifest.managedFiles.length} managed files present` };
}

function checkOpenCodeProjection(): CheckResult {
  const manifest = readManifest();
  if (!manifest?.adapters.some((adapter) => adapter.agent === AGENT.OPENCODE)) {
    return { status: 'warn', name: 'OpenCode adapter', detail: 'not installed in this workspace' };
  }
  const missing = COMMAND_NAMES
    .map((command) => `${AGENT_SKILLS_ROOT}/kyro-${command}/SKILL.md`)
    .filter((file) => !workspaceFileExists(file));
  if (missing.length > 0) {
    return { status: 'fail', name: 'OpenCode adapter', detail: `missing ${missing.join(', ')}`, remedy: 'Run kyro sync --agent opencode.' };
  }
  return { status: 'pass', name: 'OpenCode adapter', detail: 'projected Kyro command skills present' };
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
