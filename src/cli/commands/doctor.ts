import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { ARTIFACT_ROOT, COMMAND_NAMES, KYRO_GLOBAL_ROOT, KYRO_MANIFEST_PATH, KYRO_STATE_PATH, PACKAGE_ROOT } from '../constants';
import { getPersistedKyroInvocation, isEphemeralPackageManagerPath, resolveKyroBinaryPath } from '../invocation';
import { managedPathExists, readJsonFromPackage, readPackageText, resolveManagedPath } from '../fs';
import { readPackageVersion } from '../help';
import { readManifest, readProjectState } from '../state';
import { KyroCoreError } from '../core/errors';
import { ADAPTERS, getAdapterDefinition } from '../adapters/registry';
import { guardEnforcement } from '../adapters/registry-types';
import { getCommandSkillPath, parseSkillRuntimeVersion } from '../adapters/command-skills';
import { GUARDED_OPERATIONS, guardedOperationLevel, makerCheckerPolicy } from '../core/policy';
import { detectPackageRootMode, FULL_PACKAGE_INSTALL_REMEDY, FULL_PACKAGE_SYNC_REMEDY } from '../package-root-mode';
import { runTokenAuditChecks } from './token-audit';
import { listScopes, unregisteredScopeFolders } from '../core/scopes';
import { emitTraceEvent, readTrace } from '../core/trace';
import { runArtifactAuditChecks } from './artifact-doctor';
import type { Agent, CheckResult, CliOptions } from '../types';

const PROJECT_STATE_INSTALL_REMEDY = FULL_PACKAGE_INSTALL_REMEDY;
const GLOBAL_RUNTIME_INSTALL_REMEDY = FULL_PACKAGE_INSTALL_REMEDY;
const GLOBAL_RUNTIME_SYNC_REMEDY = FULL_PACKAGE_SYNC_REMEDY;
const CLI_INVOCATION_REMEDY =
  'Re-run once: npx kyro-ai install --scope workspace --yes (or npx kyro-ai sync) from the full npm package so ~/.agents/kyro/current/manifest.json.kyroInvocation is refreshed (global for all workspaces). Agents should use that form (often `node ~/.agents/kyro/current/dist/cli.js`), not a bare `kyro` that only existed during npx.';

export function doctor(options?: Pick<CliOptions, 'tokens' | 'artifacts' | 'adapters' | 'trace' | 'kyroScope'>): void {
  const checks = runDoctorChecks(options?.tokens ?? false, options?.artifacts ?? false, options?.adapters ?? false, options?.trace ?? false, options?.kyroScope ?? null);
  let failed = false;

  for (const check of checks) {
    const icon = check.status === 'pass' ? 'PASS' : check.status === 'warn' ? 'WARN' : 'FAIL';
    console.log(`[${icon}] ${check.name}: ${check.detail}`);
    if (check.remedy) console.log(`       Remedy: ${check.remedy}`);
    if (check.status === 'fail') failed = true;
  }

  if (failed) process.exit(1);
}

export function runDoctorChecks(includeTokenAudit: boolean, includeArtifactAudit: boolean, includeAdapterInventory: boolean, includeTraceSummary: boolean, kyroScope: string | null): CheckResult[] {
  const rootMode = detectPackageRootMode();
  const packagingChecks =
    rootMode === 'full-package'
      ? [checkPackageVersionSync(), checkPackageAssets(), checkClaudePlugin()]
      : rootMode === 'projected-runtime'
        ? [checkProjectedRuntimeRoot(), checkProjectedRuntimeShape()]
        : [checkUnknownRoot()];

  const checks = [
    ...packagingChecks,
    checkProjectState(),
    checkUnregisteredScopes(),
    checkGlobalRuntime(),
    checkCliInvocation(),
    checkSkillRuntimeSkew(),
    ...checkAdapterProjections(),
  ];

  if (includeTokenAudit) {
    if (rootMode !== 'full-package') {
      checks.push({
        status: 'fail',
        name: 'token audit',
        detail: `token/context budget audit requires a verified full npm package layout; current CLI root mode is ${rootMode}`,
        remedy: 'Run doctor --tokens via npx kyro-ai (or a verified full-package CLI), not a projected or unrecognized CLI root.',
      });
    } else {
      checks.push(...runTokenAuditChecks());
    }
  }
  if (includeArtifactAudit) {
    const artifactChecks = runArtifactAuditChecks({ kyroScope });
    checks.push(...artifactChecks);
    if (kyroScope) {
      emitTraceEvent({
        v: 1,
        ts: new Date().toISOString(),
        scope: kyroScope,
        type: 'validation_result',
        source: 'doctor',
        blocking: artifactChecks.some((check) => check.status === 'fail'),
        findingCount: artifactChecks.filter((check) => check.status !== 'pass').length,
        codes: artifactChecks.filter((check) => check.status !== 'pass').map((check) => check.name),
      });
    }
  }
  if (includeAdapterInventory) checks.push(...checkAdapterInventory());
  if (includeTraceSummary) checks.push(...checkTraceSummary(kyroScope));
  return checks;
}

/** Honest PASS so agents/humans see packaging checks are N/A on the projected runtime. */
function checkProjectedRuntimeRoot(): CheckResult {
  return {
    status: 'pass',
    name: 'CLI root',
    detail: 'projected runtime (package packaging checks skipped)',
  };
}

/** Unknown roots are never allowed to inherit full-package checks or operations. */
function checkUnknownRoot(): CheckResult {
  return {
    status: 'fail',
    name: 'CLI root',
    detail: 'unrecognized or corrupt layout (package packaging checks skipped)',
    remedy: FULL_PACKAGE_INSTALL_REMEDY,
  };
}

/** Light shape check of the projected runtime tree agents actually load. */
function checkProjectedRuntimeShape(): CheckResult {
  const required = [
    'dist/cli.js',
    'package.json',
    'config.json',
    'manifest.json',
    'KYRO.md',
    'core/agents/orchestrator.md',
    'core/WORKFLOW.yaml',
    'commands/forge.md',
    'skills/sprint-forge/SKILL.md',
  ];
  const missing = required.filter((file) => !existsSync(resolve(PACKAGE_ROOT, file)));
  if (missing.length > 0) {
    return {
      status: 'fail',
      name: 'runtime packaging parity',
      detail: `missing ${missing.join(', ')}`,
      remedy: FULL_PACKAGE_INSTALL_REMEDY,
    };
  }
  return {
    status: 'pass',
    name: 'runtime packaging parity',
    detail: 'projected runtime shape is complete',
  };
}

function checkTraceSummary(kyroScope: string | null): CheckResult[] {
  const scopes = kyroScope ? [{ id: kyroScope }] : listScopes().scopes;
  if (scopes.length === 0) return [{ status: 'warn', name: 'trace summary', detail: 'no scopes found' }];
  return scopes.map((entry) => {
    const trace = readTrace(entry.id);
    const counts = new Map<string, number>();
    for (const event of trace.events) counts.set(event.type, (counts.get(event.type) ?? 0) + 1);
    const last = trace.events.at(-1)?.ts ?? 'none';
    const byType = [...counts.entries()].map(([type, count]) => `${type}=${count}`).join(', ') || 'none';
    return {
      status: 'pass',
      name: `trace: ${entry.id}`,
      detail: `events=${trace.events.length}; byType=${byType}; last=${last}${trace.skipped > 0 ? `; skipped=${trace.skipped}` : ''}`,
    };
  });
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
  const required = ['agents/orchestrator.md', 'commands/forge.md', 'commands/status.md', 'skills/sprint-forge/SKILL.md', 'skills/qa-review/SKILL.md'];
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
      remedy: PROJECT_STATE_INSTALL_REMEDY,
    };
  }
  const missing: string[] = [];
  if (state.artifactRoot !== ARTIFACT_ROOT) missing.push('artifactRoot');
  if (!Array.isArray(state.scopes)) missing.push('scopes');
  if (typeof state.runtimePath !== 'string') missing.push('runtimePath');
  if (!Array.isArray(state.installedAdapters)) missing.push('installedAdapters');

  if (state.schemaVersion !== 4 || missing.length > 0) {
    // schemaVersion wrong/absent or fields missing — an incomplete file (e.g. hand-written by an
    // agent that never ran kyro install). install/sync repopulates the fields, preserving scopes.
    const gaps = [...(state.schemaVersion !== 4 ? ['schemaVersion'] : []), ...missing];
    return {
      status: 'fail',
      name: 'project state',
      detail: `${KYRO_STATE_PATH} is incomplete (missing/invalid: ${gaps.join(', ')})`,
      remedy: `${PROJECT_STATE_INSTALL_REMEDY} Scopes are preserved.`,
    };
  }
  return { status: 'pass', name: 'project state', detail: `${KYRO_STATE_PATH} is valid` };
}

/** Advisory: scope folders on disk that never made it into the local registry (e.g. gitignored kyro.json). */
function checkUnregisteredScopes(): CheckResult {
  const state = readProjectState();
  if (!state || !Array.isArray(state.scopes)) {
    return {
      status: 'pass',
      name: 'scope registry',
      detail: 'skipped (no project state)',
    };
  }
  const missing = unregisteredScopeFolders(state);
  if (missing.length === 0) {
    return {
      status: 'pass',
      name: 'scope registry',
      detail: 'all on-disk scopes are registered in kyro.json',
    };
  }
  return {
    status: 'warn',
    name: 'scope registry',
    detail: `${missing.length} scope folder(s) on disk missing from kyro.json.scopes[]: ${missing.sort().join(', ')}`,
    remedy: 'Run: npx kyro-ai install --init-workspace (or npx kyro-ai sync) to register existing scopes. Then kyro scope set-active <scope> --yes if needed.',
  };
}

function checkGlobalRuntime(): CheckResult {
  const manifest = readManifest();
  if (!manifest) {
    return {
      status: 'warn',
      name: 'global runtime',
      detail: `${KYRO_MANIFEST_PATH} not found`,
      remedy: GLOBAL_RUNTIME_INSTALL_REMEDY,
    };
  }
  const runtimeFiles = manifest.managedFiles.filter((file) => file.startsWith(`${KYRO_GLOBAL_ROOT}/`));
  const missing = runtimeFiles.filter((file) => !managedPathExists(file));
  if (missing.length > 0) {
    return {
      status: 'fail',
      name: 'global runtime',
      detail: `missing managed files: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '...' : ''}`,
      remedy: GLOBAL_RUNTIME_SYNC_REMEDY,
    };
  }
  return { status: 'pass', name: 'global runtime', detail: `${runtimeFiles.length} runtime files present` };
}

/** Expand a leading `~` to the user's home dir; execFileSync does no shell expansion. */
function expandHome(segment: string): string {
  return segment === '~' || segment.startsWith('~/') ? homedir() + segment.slice(1) : segment;
}

function checkCliInvocation(): CheckResult {
  const remedy = CLI_INVOCATION_REMEDY;
  try {
    const manifest = readManifest();
    if (!manifest) {
      // No manifest → no installed runtime. checkGlobalRuntime already reports this as a
      // warning. Don't live-probe — the projected path won't exist yet.
      return { status: 'warn', name: 'CLI invocation', detail: `${KYRO_MANIFEST_PATH} not found`, remedy };
    }
    // Global manifest is SoT (project kyro.json never consulted). Live resolve only if the
    // field is missing on a legacy manifest.
    const raw = getPersistedKyroInvocation();
    // Bare `kyro` is only safe when PATH still resolves to a durable (non-npx) binary.
    // A stale install from `npx kyro-ai install` often leaves kyroInvocation="kyro" after the
    // temporary npx bin is gone — fail closed with a re-sync remedy.
    if (raw.trim() === 'kyro') {
      const resolved = resolveKyroBinaryPath();
      if (!resolved) {
        return {
          status: 'fail',
          name: 'CLI invocation',
          detail: 'global manifest kyroInvocation is bare "kyro" but no durable kyro binary is on PATH',
          remedy,
        };
      }
      if (isEphemeralPackageManagerPath(resolved)) {
        return {
          status: 'fail',
          name: 'CLI invocation',
          detail: `global manifest kyroInvocation is bare "kyro" but resolves to ephemeral package-manager path: ${resolved}`,
          remedy,
        };
      }
    }
    // The invocation is a shell string (e.g. `node ~/.agents/kyro/current/dist/cli.js`), not a
    // bare binary — split into command + args and expand `~` before exec, which does neither.
    const [command, ...args] = raw.trim().split(/\s+/).map(expandHome);
    execFileSync(command, [...args, '--version'], { stdio: 'ignore', timeout: 5000 });
    // Always surface the canonical agent entrypoint in the PASS line so hosts without `kyro` on
    // PATH still see how to invoke the harness (post-mortem #2 F1).
    return {
      status: 'pass',
      name: 'CLI invocation',
      detail: `canonical agent entrypoint: ${raw} (--version runs). Prefer this form over bare \`kyro\` when PATH is empty.`,
    };
  } catch (error: unknown) {
    return { status: 'fail', name: 'CLI invocation', detail: errorMessage(error), remedy };
  }
}

/**
 * WARN when projected host skill stubs lag the global runtime package version (post-mortem #2 F2).
 * Stubs without runtimeVersion are treated as pre-pin legacy → WARN with reinstall remedy.
 */
function checkSkillRuntimeSkew(): CheckResult {
  const manifest = readManifest();
  const runtimeVersion = typeof manifest?.packageVersion === 'string' && manifest.packageVersion.trim()
    ? manifest.packageVersion.trim()
    : null;
  if (!runtimeVersion) {
    return {
      status: 'warn',
      name: 'skill/runtime version',
      detail: 'global runtime packageVersion unknown; cannot compare projected skill stubs',
      remedy: GLOBAL_RUNTIME_INSTALL_REMEDY,
    };
  }

  const mismatched: string[] = [];
  const missingPin: string[] = [];
  const missingFile: string[] = [];

  for (const command of COMMAND_NAMES) {
    const managed = getCommandSkillPath(command);
    let absolute: string;
    try {
      absolute = resolveManagedPath(managed);
    } catch {
      missingFile.push(`kyro-${command}`);
      continue;
    }
    if (!existsSync(absolute)) {
      missingFile.push(`kyro-${command}`);
      continue;
    }
    let body: string;
    try {
      body = readFileSync(absolute, 'utf-8');
    } catch {
      missingFile.push(`kyro-${command}`);
      continue;
    }
    const pinned = parseSkillRuntimeVersion(body);
    if (!pinned) {
      missingPin.push(`kyro-${command}`);
      continue;
    }
    if (pinned !== runtimeVersion) {
      mismatched.push(`kyro-${command}@${pinned}`);
    }
  }

  if (missingFile.length > 0) {
    return {
      status: 'warn',
      name: 'skill/runtime version',
      detail: `projected skill stub(s) missing: ${missingFile.join(', ')} (runtime ${runtimeVersion})`,
      remedy: GLOBAL_RUNTIME_SYNC_REMEDY,
    };
  }
  if (mismatched.length > 0) {
    return {
      status: 'warn',
      name: 'skill/runtime version',
      detail: `skill stub runtimeVersion skew vs runtime ${runtimeVersion}: ${mismatched.join(', ')}`,
      remedy: GLOBAL_RUNTIME_SYNC_REMEDY,
    };
  }
  if (missingPin.length > 0) {
    return {
      status: 'warn',
      name: 'skill/runtime version',
      detail: `skill stub(s) lack runtimeVersion pin (re-sync to align with runtime ${runtimeVersion}): ${missingPin.join(', ')}`,
      remedy: GLOBAL_RUNTIME_SYNC_REMEDY,
    };
  }
  return {
    status: 'pass',
    name: 'skill/runtime version',
    detail: `projected skill stubs match runtime ${runtimeVersion}`,
  };
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
        remedy: FULL_PACKAGE_SYNC_REMEDY,
      };
    }
  });
}

function checkAdapterInventory(): CheckResult[] {
  return [...ADAPTERS.map((adapter): CheckResult => {
    const managedFiles = adapter.buildManagedFiles();
    const managedBlocks = adapter.buildManagedBlocks();
    const capabilities = adapter.capabilities();
    const paths = adapter.paths('~');
    const nativePaths = Object.values(paths).filter(Boolean).length;
    const enforcement = GUARDED_OPERATIONS.map((op) => {
      const level = guardedOperationLevel(op);
      const tier = guardEnforcement(capabilities, op);
      const surfaces = capabilities.includes('mcp') ? 'cli,mcp' : 'cli';
      return `${op}:${tier}(${level};${surfaces})`;
    }).join(',');
    const detail = [
      `status=${adapter.status}`,
      `managedFiles=${managedFiles.length}`,
      `managedBlocks=${managedBlocks.length}`,
      `nativePaths=${nativePaths}`,
      `systemPromptStrategy=${adapter.systemPromptStrategy()}`,
      `mcpConfigStrategy=${adapter.mcpStrategy()}`,
      capabilities.includes('mcp') ? 'mcpServer=kyro mcp serve' : 'mcpServer=none',
      `capabilities=${capabilities.length > 0 ? capabilities.join(',') : 'none'}`,
      `guardrails=${enforcement}`,
    ].join('; ');

    if (adapter.status === 'planned') {
      return { status: 'warn', name: `adapter inventory: ${adapter.agent}`, detail };
    }

    return { status: 'pass', name: `adapter inventory: ${adapter.agent}`, detail };
  }), checkMakerCheckerBoundary(), checkSpecTraceability()];
}

function checkMakerCheckerBoundary(): CheckResult {
  const separateCheckerTier = makerCheckerPolicy().requireSeparateChecker ? 'enforced' : 'advisory';
  return {
    status: 'pass',
    name: 'maker/checker boundary',
    detail: [
      'evidence-present-on-done=enforced',
      'criteria-coverage-on-pass=enforced',
      'principle-gate-on-pass=enforced',
      'verdict-not-before-evidence=enforced',
      `separate-checker=${separateCheckerTier}`,
      'criterion-actually-met=advisory',
    ].join('; '),
  };
}

function checkSpecTraceability(): CheckResult {
  return {
    status: 'pass',
    name: 'spec traceability',
    detail: [
      'requirement-ref-integrity=enforced(analyze HIGH)',
      'scenario-ref-integrity=enforced(analyze HIGH)',
      'duplicate-id=enforced(analyze MEDIUM)',
      'requirement-coverage=surfaced(analyze MEDIUM)',
      'scenario-coverage=surfaced(analyze MEDIUM)',
      'open-questions-drained=surfaced(analyze MEDIUM)',
      'requirement-actually-validated=advisory',
      'task-implements-scenario=advisory',
    ].join('; '),
  };
}

function readYamlVersion(file: string): string {
  const text = readPackageText(file);
  const match = text.match(/^version:\s*["']?([^"'\n]+)["']?$/m);
  if (!match) throw new KyroCoreError('INTERNAL', `Could not parse version from ${file}`);
  return match[1];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
