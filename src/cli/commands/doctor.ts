import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import {
  ARTIFACT_ROOT,
  COMMAND_NAMES,
  KYRO_GLOBAL_ROOT,
  KYRO_MANIFEST_PATH,
  KYRO_STATE_PATH,
  LOCAL_STATE_PATH,
  PACKAGE_ROOT,
  PROJECT_STATE_PATH,
} from '../constants';
import { getPersistedKyroInvocation, isEphemeralPackageManagerPath, resolveKyroBinaryPath } from '../invocation';
import { managedPathExists, readJsonFromPackage, readPackageText, resolveManagedPath } from '../fs';
import { readPackageVersion } from '../help';
import {
  formatBootstrapRemedy,
  hasLayeredProjectStateOnDisk,
  hasMonolitoProjectStateOnDisk,
  hasPersistedProjectStateOnDisk,
  PROJECT_STATE_BOOTSTRAP_REMEDY,
  readLocalProjectState,
  readManifest,
  readMonolitoProjectState,
  readProjectState,
  readSharedProjectState,
} from '../state';
import { KyroCoreError } from '../core/errors';
import { TOOL_OWNED_VERBS } from '../core/capabilities';
import { ADAPTERS, getAdapterDefinition } from '../adapters/registry';
import { guardEnforcement } from '../adapters/registry-types';
import { getCommandSkillPath, getFullSkillPath, PROJECTED_FULL_SKILLS, parseSkillRuntimeVersion } from '../adapters/command-skills';
import { GUARDED_OPERATIONS, guardedOperationLevel, makerCheckerPolicy } from '../core/policy';
import { detectPackageRootMode, FULL_PACKAGE_INSTALL_REMEDY, FULL_PACKAGE_SYNC_REMEDY } from '../package-root-mode';
import {
  validateLocalProjectStateShape,
  validateProjectStateShape,
  validateSharedProjectStateShape,
  type ValidationIssue,
} from '../artifacts/schema';
import { runTokenAuditChecks } from './token-audit';
import { listScopes, unregisteredScopeFolders } from '../core/scopes';
import { listForeignScopeDirectories } from '../artifacts/scopes';
import { emitTraceEvent, readTrace } from '../core/trace';
import { runArtifactAuditChecks } from './artifact-doctor';
import { diagnoseKyroGitTrackability } from '../core/git-trackability';
import type { Agent, CheckResult, CliOptions } from '../types';

const PROJECT_STATE_INSTALL_REMEDY = PROJECT_STATE_BOOTSTRAP_REMEDY;
const GLOBAL_RUNTIME_INSTALL_REMEDY = FULL_PACKAGE_INSTALL_REMEDY;
const GLOBAL_RUNTIME_SYNC_REMEDY = FULL_PACKAGE_SYNC_REMEDY;
const MONOLITO_MIGRATE_REMEDY =
  'Run: npx kyro-ai install --init-workspace --yes (or npx kyro-ai sync) to migrate leftover kyro.json into project.json + local.json and archive the monolito.';
const PRINCIPLES_ON_LOCAL_REMEDY =
  'Move principles to .agents/kyro/project.json (shared team constitution) and remove them from local.json, then re-run install/sync if needed.';
const TEAM_MIN_PACKAGE_REMEDY =
  'Upgrade Kyro to at least the team minPackageVersion (npx kyro-ai@latest install / sync from the full npm package).';
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

  if (failed) process.exitCode = 1;
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
    ...checkProjectState(),
    diagnoseKyroGitTrackability(),
    checkUnregisteredScopes(),
    ...(kyroScope ? [] : checkForeignScopeDirectories()),
    checkTeamMinPackageVersion(),
    checkGlobalRuntime(),
    checkCliInvocation(),
    checkCliCapabilities(),
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
  const required = ['agents/orchestrator.md', 'commands/forge.md', 'commands/status.md', 'internal/skills/sprint-forge/SKILL.md', 'internal/skills/qa-review/SKILL.md'];
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

/**
 * Layered project-state health (R7): effective façade + per-layer shapes + monolito leftover WARN.
 * Read-only — never creates project.json / local.json / kyro.json (D7a).
 */
function checkProjectState(): CheckResult[] {
  const results: CheckResult[] = [];

  if (!hasPersistedProjectStateOnDisk()) {
    results.push({
      status: 'warn',
      name: 'project state',
      detail: 'No project state on disk (expected project.json + local.json, or legacy kyro.json)',
      remedy: formatBootstrapRemedy(),
    });
    return results;
  }

  const layered = hasLayeredProjectStateOnDisk();
  const monolito = hasMonolitoProjectStateOnDisk();
  const sharedRaw = readSharedProjectState();
  const localRaw = readLocalProjectState();

  if (sharedRaw !== null) {
    const sharedIssues = validateSharedProjectStateShape(sharedRaw, PROJECT_STATE_PATH);
    if (sharedIssues.length > 0) {
      results.push({
        status: 'fail',
        name: 'project.json',
        detail: formatValidationIssues(sharedIssues),
        remedy: `${PROJECT_STATE_INSTALL_REMEDY} Or fix shared fields (never store activeScope on project.json).`,
      });
    } else {
      results.push({ status: 'pass', name: 'project.json', detail: `${PROJECT_STATE_PATH} shape is valid` });
    }
  }

  if (localRaw !== null) {
    const localIssues = validateLocalProjectStateShape(localRaw, LOCAL_STATE_PATH);
    if (localIssues.length > 0) {
      results.push({
        status: 'fail',
        name: 'local.json',
        detail: formatValidationIssues(localIssues),
        remedy: `${PROJECT_STATE_INSTALL_REMEDY} Or fix local fields (principles/team belong on project.json).`,
      });
    } else {
      results.push({ status: 'pass', name: 'local.json', detail: `${LOCAL_STATE_PATH} shape is valid` });
    }
  }

  // Principles stranded only on local (malformed overlay / bad hand-edit) — team constitution must be shared.
  const localRecord = localRaw as unknown as Record<string, unknown> | null;
  const localPrinciples = localRecord && Array.isArray(localRecord.principles) ? localRecord.principles : null;
  if (localPrinciples && localPrinciples.length > 0) {
    const sharedPrinciples = sharedRaw && Array.isArray(sharedRaw.principles) ? sharedRaw.principles : [];
    if (sharedPrinciples.length === 0) {
      results.push({
        status: 'warn',
        name: 'principles placement',
        detail: 'principles appear on local.json but not on project.json (team constitution must be shared)',
        remedy: PRINCIPLES_ON_LOCAL_REMEDY,
      });
    }
  }

  if (layered && monolito) {
    results.push({
      status: 'warn',
      name: 'legacy monolito',
      detail: `${KYRO_STATE_PATH} still present alongside layered project state (dual-read leftover)`,
      remedy: MONOLITO_MIGRATE_REMEDY,
    });
  } else if (!layered && monolito) {
    const monoRaw = readMonolitoProjectState();
    if (monoRaw) {
      const monoIssues = validateProjectStateShape(monoRaw, KYRO_STATE_PATH);
      if (monoIssues.length > 0) {
        results.push({
          status: 'fail',
          name: 'project state',
          detail: `${KYRO_STATE_PATH} is incomplete (${formatValidationIssues(monoIssues)})`,
          remedy: `${PROJECT_STATE_INSTALL_REMEDY} Scopes are preserved when migrating to layers.`,
        });
        // Incomplete monolito: do not report a green effective façade (defaults may mask holes).
        return results;
      }
      results.push({
        status: 'pass',
        name: 'kyro.json',
        detail: `${KYRO_STATE_PATH} dual-read shape is valid (prefer project.json + local.json)`,
      });
    }
  }

  // Layer shape failures are already reported; still evaluate effective façade when readable.
  const layerShapeFailed = results.some(
    (check) => (check.name === 'project.json' || check.name === 'local.json') && check.status === 'fail',
  );

  const state = readProjectState();
  if (!state) {
    results.push({
      status: 'fail',
      name: 'project state',
      detail: 'Persisted state files exist but effective project state could not be resolved',
      remedy: PROJECT_STATE_INSTALL_REMEDY,
    });
    return results;
  }

  const missing: string[] = [];
  if (state.artifactRoot !== ARTIFACT_ROOT) missing.push('artifactRoot');
  if (!Array.isArray(state.scopes)) missing.push('scopes');
  if (typeof state.runtimePath !== 'string') missing.push('runtimePath');
  if (!Array.isArray(state.installedAdapters)) missing.push('installedAdapters');

  if (state.schemaVersion !== 4 || missing.length > 0) {
    const gaps = [...(state.schemaVersion !== 4 ? ['schemaVersion'] : []), ...missing];
    results.push({
      status: 'fail',
      name: 'project state',
      detail: `effective project state is incomplete (missing/invalid: ${gaps.join(', ')})`,
      remedy: `${PROJECT_STATE_INSTALL_REMEDY} Scopes are preserved.`,
    });
    return results;
  }

  if (layerShapeFailed) {
    results.push({
      status: 'fail',
      name: 'project state',
      detail: 'effective project state readable but one or more layer files failed shape validation',
      remedy: PROJECT_STATE_INSTALL_REMEDY,
    });
    return results;
  }

  const source = layered
    ? monolito
      ? 'layered (+ leftover monolito)'
      : 'layered (project.json + local.json)'
    : 'legacy monolito (kyro.json dual-read)';
  results.push({
    status: 'pass',
    name: 'project state',
    detail: `effective project state is valid (${source})`,
  });
  return results;
}

/**
 * Advisory: directories under scopes/ that hold no Kyro artifacts. They are ignored everywhere else,
 * so without this the user has no way to learn why their folder never shows up as a scope. Only
 * reported by a global run — a scoped Doctor must not be polluted with findings about other paths.
 */
function checkForeignScopeDirectories(): CheckResult[] {
  const foreign = listForeignScopeDirectories();
  if (foreign.length === 0) return [];
  const names = foreign.map((entry) => entry.id).sort();
  const unsafe = foreign
    .filter((entry) => entry.issues.length > 0)
    .map((entry) => `${entry.id} (${[...new Set(entry.issues.map((issue) => issue.level))].join(', ')})`)
    .sort();
  const unsafeDetail = unsafe.length > 0
    ? ` Unsafe managed-path entries were not followed: ${unsafe.join(', ')}.`
    : '';
  return [{
    status: 'warn',
    name: 'scope directories',
    detail: `${names.length} namespace entr(y|ies) under ${ARTIFACT_ROOT} are not Kyro scopes and were ignored: ${names.join(', ')}.${unsafeDetail}`,
    remedy: `Move them out of ${ARTIFACT_ROOT} if they do not belong there. Kyro never reads, writes, or registers them.`,
  }];
}

/** Advisory: scope folders on disk that never made it into the project registry. */
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
      detail: 'all on-disk scopes are registered in project state',
    };
  }
  return {
    status: 'warn',
    name: 'scope registry',
    detail: `${missing.length} scope folder(s) on disk missing from project state scopes[]: ${missing.sort().join(', ')}`,
    remedy: formatBootstrapRemedy(
      `${missing.length} on-disk scope(s) not registered in project state: ${missing.sort().join(', ')}`,
    ),
  };
}

/**
 * Optional team policy (R10 / D6): WARN when runtime package is older than shared minPackageVersion.
 * Non-blocking by default — never fails solely for this check.
 */
function checkTeamMinPackageVersion(): CheckResult {
  const state = readProjectState();
  const minRaw = state?.team?.minPackageVersion;
  if (typeof minRaw !== 'string' || !minRaw.trim()) {
    return {
      status: 'pass',
      name: 'team minPackageVersion',
      detail: 'not set (no package floor)',
    };
  }
  const minVersion = minRaw.trim();
  let runtimeVersion: string;
  try {
    runtimeVersion = readPackageVersion();
  } catch (error: unknown) {
    return {
      status: 'warn',
      name: 'team minPackageVersion',
      detail: `team requires >= ${minVersion} but runtime package version is unknown (${errorMessage(error)})`,
      remedy: TEAM_MIN_PACKAGE_REMEDY,
    };
  }

  const cmp = compareSemverLike(runtimeVersion, minVersion);
  if (cmp === null) {
    return {
      status: 'warn',
      name: 'team minPackageVersion',
      detail: `could not compare runtime ${runtimeVersion} to team minPackageVersion ${minVersion}`,
      remedy: TEAM_MIN_PACKAGE_REMEDY,
    };
  }
  if (cmp < 0) {
    return {
      status: 'warn',
      name: 'team minPackageVersion',
      detail: `runtime ${runtimeVersion} is older than team minPackageVersion ${minVersion}`,
      remedy: TEAM_MIN_PACKAGE_REMEDY,
    };
  }
  return {
    status: 'pass',
    name: 'team minPackageVersion',
    detail: `runtime ${runtimeVersion} meets team minPackageVersion ${minVersion}`,
  };
}

/** Compare dotted numeric versions (optional prerelease suffix ignored for floor checks). Returns -1/0/1 or null if unparsable. */
export function compareSemverLike(left: string, right: string): number | null {
  const a = parseVersionCore(left);
  const b = parseVersionCore(right);
  if (!a || !b) return null;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const lv = a[i] ?? 0;
    const rv = b[i] ?? 0;
    if (lv < rv) return -1;
    if (lv > rv) return 1;
  }
  return 0;
}

function parseVersionCore(raw: string): number[] | null {
  const core = raw.trim().replace(/^v/i, '').split(/[-+]/)[0] ?? '';
  if (!core || !/^\d+(\.\d+)*$/.test(core)) return null;
  return core.split('.').map((part) => Number(part));
}

function formatValidationIssues(issues: ValidationIssue[]): string {
  return issues.map((issue) => `${issue.path}:${issue.field} ${issue.message}`).join('; ');
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
 * FAIL when the installed runtime does not expose every tool-owned verb the shipped skill assets
 * invoke. This is the capability handshake against version drift: new skill assets + old binary
 * left agents improvising hand-edits in the field. An UNKNOWN_COMMAND on `capabilities` itself
 * proves the runtime predates the handshake.
 */
function checkCliCapabilities(): CheckResult {
  const remedy = 'Installed kyro CLI predates the capability handshake or is missing verbs the skill assets require. Upgrade the kyro package and re-run kyro sync.';
  try {
    const manifest = readManifest();
    if (!manifest) {
      return { status: 'warn', name: 'CLI capabilities', detail: `${KYRO_MANIFEST_PATH} not found; no installed runtime to probe`, remedy };
    }
    const raw = getPersistedKyroInvocation();
    const [command, ...args] = raw.trim().split(/\s+/).map(expandHome);
    const stdout = execFileSync(command, [...args, 'capabilities', '--json'], { encoding: 'utf8', timeout: 5000 });
    const parsed = JSON.parse(stdout) as { schemaVersion?: unknown; ok?: unknown; data?: unknown; version?: unknown; capabilities?: unknown };
    const payload = parsed.schemaVersion === 1 && parsed.ok === true && typeof parsed.data === 'object' && parsed.data !== null
      ? parsed.data as { version?: unknown; capabilities?: unknown }
      : parsed;
    const verbs = Array.isArray(payload.capabilities) ? payload.capabilities : [];
    const missing = TOOL_OWNED_VERBS.filter((verb) => !verbs.includes(verb));
    if (missing.length > 0) {
      return { status: 'fail', name: 'CLI capabilities', detail: `installed runtime (${String(payload.version ?? 'unknown version')}) is missing tool-owned verb(s): ${missing.join(', ')}`, remedy };
    }
    return { status: 'pass', name: 'CLI capabilities', detail: `installed runtime ${String(payload.version ?? '')} exposes all ${TOOL_OWNED_VERBS.length} tool-owned verbs` };
  } catch (error: unknown) {
    return { status: 'fail', name: 'CLI capabilities', detail: errorMessage(error), remedy };
  }
}

/**
 * WARN when projected host skill stubs lag the global runtime package version (post-mortem #2 F2).
 *
 * A missing runtimeVersion pin means different things by projection kind, so the severity differs.
 * Command stubs predate the pin, so an unpinned one is legacy → WARN. Full skills
 * (PROJECTED_FULL_SKILLS) only ever shipped WITH a pin, so an unpinned file at that managed path
 * cannot be legacy — it is foreign or hand-edited content shadowing the projected skill → FAIL.
 * That is the drift that silently ran an old kyro-sprint-executor draft with no capability
 * handshake and no close gate, and it must not be dismissible as a warning.
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
  const missingPinStub: string[] = [];
  const missingPinFull: string[] = [];
  const missingFile: string[] = [];

  const projectedStubs: Array<{ label: string; managed: string; full: boolean }> = [
    ...COMMAND_NAMES.map((command) => ({ label: `kyro-${command}`, managed: getCommandSkillPath(command), full: false })),
    ...PROJECTED_FULL_SKILLS.map((skill) => ({ label: skill, managed: getFullSkillPath(skill), full: true })),
  ];

  for (const { label, managed, full } of projectedStubs) {
    let absolute: string;
    try {
      absolute = resolveManagedPath(managed);
    } catch {
      missingFile.push(label);
      continue;
    }
    if (!existsSync(absolute)) {
      missingFile.push(label);
      continue;
    }
    let body: string;
    try {
      body = readFileSync(absolute, 'utf-8');
    } catch {
      missingFile.push(label);
      continue;
    }
    const pinned = parseSkillRuntimeVersion(body);
    if (!pinned) {
      (full ? missingPinFull : missingPinStub).push(label);
      continue;
    }
    if (pinned !== runtimeVersion) {
      mismatched.push(`${label}@${pinned}`);
    }
  }

  // A full skill with no pin is unmanaged content at a managed path — not lag. Report it first and
  // hard-fail, because loading it means running instructions Kyro did not project.
  if (missingPinFull.length > 0) {
    return {
      status: 'fail',
      name: 'skill/runtime version',
      detail: `projected skill(s) lack a runtimeVersion pin, so the file at the managed path is not the skill Kyro projects: ${missingPinFull.join(', ')} (runtime ${runtimeVersion})`,
      remedy: GLOBAL_RUNTIME_SYNC_REMEDY,
    };
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
  if (missingPinStub.length > 0) {
    return {
      status: 'warn',
      name: 'skill/runtime version',
      detail: `skill stub(s) lack runtimeVersion pin (re-sync to align with runtime ${runtimeVersion}): ${missingPinStub.join(', ')}`,
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
