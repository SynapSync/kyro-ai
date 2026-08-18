/**
 * Install/sync rehydrates on-disk scope folders into layered project state
 * (project.json scopes[] + local.json personal overlay).
 * Covers the multi-dev pattern: scopes + project.json committed, local.json gitignored.
 */
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repo = resolve(new URL('..', import.meta.url).pathname);
const require = createRequire(import.meta.url);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function createWorkspace(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

function clearDistCache() {
  const distRoot = join(repo, 'dist');
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(distRoot)) delete require.cache[key];
  }
}

function withWorkspace(prefix, callback) {
  const cwd = createWorkspace(prefix);
  const previousCwd = process.cwd();
  const previousHome = process.env.HOME;
  try {
    process.chdir(cwd);
    process.env.HOME = join(cwd, '.home');
    clearDistCache();
    return callback(cwd);
  } finally {
    process.chdir(previousCwd);
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    clearDistCache();
    rmSync(cwd, { recursive: true, force: true });
  }
}

function captureLogs(callback) {
  const logs = [];
  const originalLog = console.log;
  try {
    console.log = (...args) => logs.push(args.join(' '));
    callback();
  } finally {
    console.log = originalLog;
  }
  return `${logs.join('\n')}\n`;
}

function cliOptions(overrides = {}) {
  return {
    agents: [],
    scope: 'workspace',
    dryRun: false,
    yes: true,
    help: false,
    tokens: false,
    artifacts: false,
    adapters: false,
    kyroScope: null,
    json: false,
    purgeAdapterAssets: false,
    prune: false,
    initWorkspace: false,
    noInitWorkspace: false,
    trace: false,
    task: null,
    verbosity: 'detailed',
    verbose: false,
    keepSandbox: false,
    ...overrides,
  };
}

/** Minimal valid v4 sprint.json for title/status derivation. */
function minimalSprint(scope, title, { active = false } = {}) {
  return {
    schemaVersion: 4,
    scope,
    title,
    status: active ? 'active' : 'planning',
    objective: 'Test objective',
    successCriteria: ['Done'],
    clarifications: [],
    conventions: [],
    adrs: [],
    roadmap: {
      plannedSprintCount: 1,
      sizingRationale: 'One sprint.',
      sprints: [{ n: 1, slug: 's1', title: 'Sprint 1', state: active ? 'active' : 'planned' }],
    },
    ledger: [],
    previousSprint: null,
    activeSprint: active
      ? {
          n: 1,
          slug: 's1',
          title: 'Sprint 1',
          objective: 'Ship',
          status: 'planned',
          phases: [
            {
              id: 'P1',
              title: 'Phase',
              objective: 'Work',
              status: 'pending',
              tasks: [
                {
                  id: 'T1.1',
                  title: 'Task',
                  description: 'Do it',
                  acceptance: ['ok'],
                  status: 'pending',
                  evidence: null,
                  verdict: null,
                },
              ],
            },
          ],
          emergentTasks: [],
          definitionOfDone: ['shipped'],
        }
      : null,
    debt: [],
    handoff: {
      nextAction: active ? 'execute_task' : 'plan_sprint',
      nextTaskId: active ? 'T1.1' : null,
      blockers: [],
      note: '',
      lastUpdated: '2026-07-21',
    },
  };
}

function writeScope(cwd, scope, sprint) {
  const dir = join(cwd, '.agents', 'kyro', 'scopes', scope);
  mkdirSync(dir, { recursive: true });
  if (sprint !== undefined) {
    writeFileSync(join(dir, 'sprint.json'), `${JSON.stringify(sprint, null, 2)}\n`, 'utf-8');
  }
}

function kyroDir(cwd) {
  return join(cwd, '.agents', 'kyro');
}

/** Effective layered state (shared + local), matching readProjectState merge rules. */
function readEffectiveState(cwd) {
  const root = kyroDir(cwd);
  const projectPath = join(root, 'project.json');
  const localPath = join(root, 'local.json');
  const monolitoPath = join(root, 'kyro.json');
  const hasLayers = existsSync(projectPath) || existsSync(localPath);
  if (hasLayers) {
    const shared = existsSync(projectPath)
      ? JSON.parse(readFileSync(projectPath, 'utf-8'))
      : { schemaVersion: 4, artifactRoot: '.agents/kyro/scopes', scopes: [] };
    const local = existsSync(localPath)
      ? JSON.parse(readFileSync(localPath, 'utf-8'))
      : { schemaVersion: 4, activeScope: null, installedAdapters: [] };
    return {
      schemaVersion: 4,
      artifactRoot: shared.artifactRoot ?? '.agents/kyro/scopes',
      scopes: Array.isArray(shared.scopes) ? shared.scopes : [],
      activeScope: local.activeScope ?? null,
      runtimePath: local.runtimePath ?? '~/.agents/kyro/current',
      installedAdapters: Array.isArray(local.installedAdapters) ? local.installedAdapters : [],
      ...(shared.principles !== undefined ? { principles: shared.principles } : {}),
      ...(shared.team !== undefined ? { team: shared.team } : {}),
    };
  }
  if (existsSync(monolitoPath)) {
    return JSON.parse(readFileSync(monolitoPath, 'utf-8'));
  }
  throw new Error(`No layered or monolito project state under ${root}`);
}

function assertLayeredInstall(cwd, label) {
  const root = kyroDir(cwd);
  assert(existsSync(join(root, 'project.json')), `${label}: project.json must exist after install`);
  assert(existsSync(join(root, 'local.json')), `${label}: local.json must exist after install`);
  assert(!existsSync(join(root, 'kyro.json')), `${label}: live kyro.json must not remain as SoT after install`);
  const gitignorePath = join(root, '.gitignore');
  assert(existsSync(gitignorePath), `${label}: .agents/kyro/.gitignore must exist`);
  const gitignore = readFileSync(gitignorePath, 'utf-8');
  assert(gitignore.includes('local.json'), `${label}: gitignore must list local.json`);
  assert(gitignore.includes('kyro.json'), `${label}: gitignore must list kyro.json`);
  assert(!/^project\.json\s*$/m.test(gitignore), `${label}: gitignore must not ignore project.json`);
  assert(!/^scopes\/?\s*$/m.test(gitignore), `${label}: gitignore must not ignore scopes/`);
}

// --- prompt helper (no TTY) ---
{
  clearDistCache();
  const { formatWorkspaceInitPrompt } = require(join(repo, 'dist/cli/core/scopes.js'));
  const empty = formatWorkspaceInitPrompt([]);
  assert(empty === 'Initialize Kyro in this workspace? [y/N] ', 'prompt: empty should stay short');
  const multi = formatWorkspaceInitPrompt(['zeta', 'alpha']);
  assert(multi.includes('Found 2 existing scope(s) on disk: alpha, zeta'), 'prompt: should list sorted scopes');
  assert(multi.includes('activeScope left unset if more than one'), 'prompt: should mention multi-scope activeScope rule');
  assert(multi.includes('Initialize? [y/N] '), 'prompt: should end with confirm');
}

// --- multi-scope rehydrate on fresh init ---
withWorkspace('kyro-rehydrate-multi-', (cwd) => {
  const { parseAgent } = require(join(repo, 'dist/cli/options.js'));
  const { install, sync } = require(join(repo, 'dist/cli/commands/install.js'));
  const { runDoctorChecks } = require(join(repo, 'dist/cli/commands/doctor.js'));
  const standard = parseAgent('standard');

  writeScope(cwd, 'oauth-impl', minimalSprint('oauth-impl', 'OAuth Implementation', { active: true }));
  writeScope(cwd, 'ui-redesign', minimalSprint('ui-redesign', 'UI Redesign'));
  // A directory with no sprint.json and no Kyro artifacts is not a scope. Registering it used to
  // mint a fabricated `planning` entry, which is how a stray folder became permanent project state.
  writeScope(cwd, 'empty-folder'); // foreign: no sprint.json, no archive

  captureLogs(() => install(cliOptions({ agents: [standard], initWorkspace: true })));
  assertLayeredInstall(cwd, 'multi');
  const state = readEffectiveState(cwd);
  assert(Array.isArray(state.scopes), 'multi: scopes array present');
  assert(state.scopes.length === 2, `multi: expected 2 scopes, got ${state.scopes.length}`);
  assert(state.activeScope === null, 'multi: activeScope must stay null with multiple scopes');

  const byId = Object.fromEntries(state.scopes.map((s) => [s.id, s]));
  assert(byId['oauth-impl'].title === 'OAuth Implementation', 'multi: title from sprint.json');
  assert(byId['oauth-impl'].status === 'active', 'multi: status derived from active sprint');
  assert(byId['ui-redesign'].title === 'UI Redesign', 'multi: second title from sprint.json');
  assert(byId['ui-redesign'].status === 'planning', 'multi: planning when no active sprint');
  assert(byId['empty-folder'] === undefined, 'multi: a foreign directory must never be registered as a scope');

  // Doctor should pass registry check after rehydrate
  const checks = runDoctorChecks(false, false, false, false, null);
  const registry = checks.find((c) => c.name === 'scope registry');
  assert(registry?.status === 'pass', `multi: doctor registry should pass, got ${registry?.status}: ${registry?.detail}`);

  // Re-install is idempotent for gitignore required lines
  const gitignoreBefore = readFileSync(join(kyroDir(cwd), '.gitignore'), 'utf-8');
  writeFileSync(join(kyroDir(cwd), '.gitignore'), `${gitignoreBefore}# custom keep\n`, 'utf-8');
  captureLogs(() => install(cliOptions({ agents: [standard] })));
  const gitignoreAfter = readFileSync(join(kyroDir(cwd), '.gitignore'), 'utf-8');
  assert(gitignoreAfter.includes('# custom keep'), 'multi: re-install must not drop custom gitignore lines');
  assert(gitignoreAfter.includes('local.json'), 'multi: re-install keeps local.json ignore');
});

// --- valid sprint with an unsafe managed ancestor never rehydrates ---
withWorkspace('kyro-rehydrate-unsafe-', (cwd) => {
  const { parseAgent } = require(join(repo, 'dist/cli/options.js'));
  const { install, sync } = require(join(repo, 'dist/cli/commands/install.js'));
  const standard = parseAgent('standard');
  writeScope(cwd, 'safe-scope', minimalSprint('safe-scope', 'Safe Scope'));
  writeScope(cwd, 'unsafe-valid', minimalSprint('unsafe-valid', 'Unsafe Valid'));
  const unsafeArchiveTarget = join(cwd, 'unsafe-archive-target');
  mkdirSync(unsafeArchiveTarget, { recursive: true });
  symlinkSync(unsafeArchiveTarget, join(kyroDir(cwd), 'scopes', 'unsafe-valid', 'archive'));

  captureLogs(() => install(cliOptions({ agents: [standard], initWorkspace: true })));
  assert(
    !readEffectiveState(cwd).scopes.some((entry) => entry.id === 'unsafe-valid'),
    'unsafe: install must not register a valid sprint whose managed archive is a symlink',
  );
  captureLogs(() => sync(cliOptions({ agents: [standard] })));
  assert(
    !readEffectiveState(cwd).scopes.some((entry) => entry.id === 'unsafe-valid'),
    'unsafe: sync must not register a valid sprint whose managed archive is a symlink',
  );
});

// --- single-scope sets activeScope ---
withWorkspace('kyro-rehydrate-single-', (cwd) => {
  const { parseAgent } = require(join(repo, 'dist/cli/options.js'));
  const { install } = require(join(repo, 'dist/cli/commands/install.js'));
  const standard = parseAgent('standard');

  writeScope(cwd, 'solo-scope', minimalSprint('solo-scope', 'Solo Scope'));
  captureLogs(() => install(cliOptions({ agents: [standard], initWorkspace: true })));
  assertLayeredInstall(cwd, 'single');
  const state = readEffectiveState(cwd);
  assert(state.scopes.length === 1, 'single: one scope registered');
  assert(state.activeScope === 'solo-scope', 'single: activeScope auto-set when only one scope');
  assert(state.scopes[0].title === 'Solo Scope', 'single: title preserved from sprint');
});

// --- existing registry entries not clobbered; empty scopes[] refilled on sync ---
withWorkspace('kyro-rehydrate-preserve-', (cwd) => {
  const { parseAgent } = require(join(repo, 'dist/cli/options.js'));
  const { install, sync } = require(join(repo, 'dist/cli/commands/install.js'));
  const standard = parseAgent('standard');

  writeScope(cwd, 'known', minimalSprint('known', 'Known From Disk'));
  writeScope(cwd, 'orphan', minimalSprint('orphan', 'Orphan On Disk'));

  // Seed legacy monolito with a principle + one hand-registered entry with custom title.
  // Install must migrate to layers without field loss.
  mkdirSync(join(cwd, '.agents', 'kyro'), { recursive: true });
  writeFileSync(
    join(cwd, '.agents', 'kyro', 'kyro.json'),
    `${JSON.stringify(
      {
        schemaVersion: 4,
        artifactRoot: '.agents/kyro/scopes',
        scopes: [{ id: 'known', title: 'Custom Title Keep Me', status: 'blocked' }],
        activeScope: 'known',
        runtimePath: '~/.agents/kyro/current',
        installedAdapters: [],
        principles: [{ id: 'p1', rule: 'Ship tests', severity: 'strong', rationale: 'quality' }],
      },
      null,
      2,
    )}\n`,
    'utf-8',
  );

  captureLogs(() => install(cliOptions({ agents: [standard] })));
  assertLayeredInstall(cwd, 'preserve');
  assert(
    existsSync(join(cwd, '.agents', 'kyro', 'kyro.json.migrated')),
    'preserve: monolito must be archived to kyro.json.migrated',
  );
  let state = readEffectiveState(cwd);
  const known = state.scopes.find((s) => s.id === 'known');
  assert(known?.title === 'Custom Title Keep Me', 'preserve: must not clobber existing title');
  assert(known?.status === 'blocked', 'preserve: must not clobber existing status');
  assert(state.activeScope === 'known', 'preserve: must not clobber activeScope');
  assert(state.principles?.[0]?.id === 'p1', 'preserve: principles kept on shared layer');
  assert(state.scopes.some((s) => s.id === 'orphan' && s.title === 'Orphan On Disk'), 'preserve: orphan folder registered');

  // Empty shared scopes[] then sync rehydrates without dropping activeScope.
  const projectPath = join(cwd, '.agents', 'kyro', 'project.json');
  const project = JSON.parse(readFileSync(projectPath, 'utf-8'));
  project.scopes = [];
  writeFileSync(projectPath, `${JSON.stringify(project, null, 2)}\n`, 'utf-8');
  captureLogs(() => sync(cliOptions({ agents: [standard] })));
  state = readEffectiveState(cwd);
  assert(state.scopes.map((s) => s.id).sort().join(',') === 'known,orphan', 'sync: rehydrates both folders');
  assert(state.activeScope === 'known', 'sync: keeps existing activeScope');
  assert(state.principles?.[0]?.id === 'p1', 'sync: principles remain on shared layer');
});

// --- no-init-workspace does not create kyro.json even with scopes on disk ---
withWorkspace('kyro-rehydrate-no-init-', (cwd) => {
  const { parseAgent } = require(join(repo, 'dist/cli/options.js'));
  const { install } = require(join(repo, 'dist/cli/commands/install.js'));
  const standard = parseAgent('standard');

  writeScope(cwd, 'ghost', minimalSprint('ghost', 'Ghost'));
  captureLogs(() => install(cliOptions({ agents: [standard], noInitWorkspace: true })));
  assert(!existsSync(join(cwd, '.agents', 'kyro', 'kyro.json')), 'no-init: must not write kyro.json');
  assert(!existsSync(join(cwd, '.agents', 'kyro', 'project.json')), 'no-init: must not write project.json');
  assert(!existsSync(join(cwd, '.agents', 'kyro', 'local.json')), 'no-init: must not write local.json');
});

// --- clone-like: scopes on disk only, init creates layers and registers scopes ---
withWorkspace('kyro-rehydrate-clone-', (cwd) => {
  const { parseAgent } = require(join(repo, 'dist/cli/options.js'));
  const { install } = require(join(repo, 'dist/cli/commands/install.js'));
  const standard = parseAgent('standard');

  writeScope(cwd, 'from-clone', minimalSprint('from-clone', 'From Clone', { active: true }));
  assert(!existsSync(join(cwd, '.agents', 'kyro', 'project.json')), 'clone: no layers before install');
  captureLogs(() => install(cliOptions({ agents: [standard], initWorkspace: true })));
  assertLayeredInstall(cwd, 'clone');
  const state = readEffectiveState(cwd);
  assert(state.scopes.some((s) => s.id === 'from-clone'), 'clone: scope registered from disk');
  assert(state.activeScope === 'from-clone', 'clone: single-scope auto-activeScope');
});

// --- doctor warns when registry lags disk ---
withWorkspace('kyro-rehydrate-doctor-', (cwd) => {
  const { parseAgent } = require(join(repo, 'dist/cli/options.js'));
  const { install } = require(join(repo, 'dist/cli/commands/install.js'));
  const { runDoctorChecks } = require(join(repo, 'dist/cli/commands/doctor.js'));
  const standard = parseAgent('standard');

  captureLogs(() => install(cliOptions({ agents: [standard], initWorkspace: true })));
  assertLayeredInstall(cwd, 'doctor');
  writeScope(cwd, 'late-arrival', minimalSprint('late-arrival', 'Late'));

  const checks = runDoctorChecks(false, false, false, false, null);
  const registry = checks.find((c) => c.name === 'scope registry');
  assert(registry?.status === 'warn', `doctor: expected warn, got ${registry?.status}`);
  assert(registry?.detail?.includes('late-arrival'), 'doctor: detail names missing folder');
  assert(registry?.remedy?.includes('install'), 'doctor: remedy mentions install/sync');
});

// --- doctor FAILS (not warns) when a projected full skill has no runtimeVersion pin ---
// Full skills only ever shipped WITH a pin, so an unpinned file at that managed path is foreign or
// hand-edited content shadowing the projected skill. That is how an old kyro-sprint-executor draft
// with no capability handshake and no close gate ran unnoticed, so it must not be a dismissible warn.
withWorkspace('kyro-rehydrate-skill-pin-', (cwd) => {
  const { parseAgent } = require(join(repo, 'dist/cli/options.js'));
  const { install } = require(join(repo, 'dist/cli/commands/install.js'));
  const { runDoctorChecks } = require(join(repo, 'dist/cli/commands/doctor.js'));
  const standard = parseAgent('standard');

  captureLogs(() => install(cliOptions({ agents: [standard], initWorkspace: true })));

  const skillPath = join(cwd, '.home', '.agents', 'skills', 'kyro-sprint-executor', 'SKILL.md');
  const projected = readFileSync(skillPath, 'utf-8');
  assert(/^\s*runtimeVersion: "/m.test(projected), 'skill pin: install should project a runtimeVersion pin');
  assert(
    runDoctorChecks(false, false, false, false, null).find((c) => c.name === 'skill/runtime version')?.status === 'pass',
    'skill pin: a freshly projected skill should pass the skew check',
  );

  writeFileSync(skillPath, projected.replace(/^\s*runtimeVersion: "[^"\n]*"\n/m, ''), 'utf-8');
  const skew = runDoctorChecks(false, false, false, false, null).find((c) => c.name === 'skill/runtime version');
  assert(skew?.status === 'fail', `skill pin: unpinned full skill should FAIL, got ${skew?.status}`);
  assert(skew?.detail?.includes('kyro-sprint-executor'), 'skill pin: detail should name the offending skill');
  assert(skew?.remedy, 'skill pin: a failing skew check must carry a remedy');
});

console.log('Install rehydrate checks passed');
