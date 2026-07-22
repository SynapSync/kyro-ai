/**
 * Layered project state foundation (team-project-state Sprint 1–2).
 * Covers: merge precedence, no-write-on-read, monolito migration, write targeting,
 * shared/local schema validators, scope set-active local-only when layers exist,
 * and status/context-pack bootstrap remedies without creating project state files.
 */
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const repo = resolve(new URL('..', import.meta.url).pathname);
const require = createRequire(import.meta.url);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function clearDistCache() {
  const distRoot = join(repo, 'dist');
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(distRoot)) delete require.cache[key];
  }
}

function withWorkspace(prefix, callback) {
  const cwd = mkdtempSync(join(tmpdir(), prefix));
  const previousCwd = process.cwd();
  const previousHome = process.env.HOME;
  try {
    process.chdir(cwd);
    process.env.HOME = join(cwd, '.home');
    clearDistCache();
    return callback(cwd);
  } finally {
    process.chdir(previousCwd);
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    clearDistCache();
    rmSync(cwd, { recursive: true, force: true });
  }
}

function loadState() {
  return require(join(repo, 'dist/cli/state.js'));
}

function loadConstants() {
  return require(join(repo, 'dist/cli/constants.js'));
}

function loadSchema() {
  return require(join(repo, 'dist/cli/artifacts/schema.js'));
}

function principle() {
  return {
    id: 'p-quality',
    rule: 'Prefer evidence over claims',
    severity: 'strong',
    rationale: 'Team constitution test fixture',
  };
}

function monolitoFixture() {
  return {
    schemaVersion: 4,
    artifactRoot: '.agents/kyro/scopes',
    scopes: [
      { id: 'alpha', title: 'Alpha', status: 'active' },
      { id: 'beta', title: 'Beta', status: 'planning' },
    ],
    activeScope: 'alpha',
    runtimePath: '~/.agents/kyro/current',
    installedAdapters: [
      {
        agent: 'standard',
        scope: 'workspace',
        installedAt: '2026-01-01T00:00:00.000Z',
        corePath: '~/.agents/kyro/current/core',
      },
    ],
    principles: [principle()],
    kyroInvocation: 'must-not-persist',
  };
}

function listKyroFiles(cwd) {
  const dir = join(cwd, '.agents', 'kyro');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).sort();
}

function writeJson(cwd, relative, value) {
  const absolute = join(cwd, relative);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

function readJson(cwd, relative) {
  return JSON.parse(readFileSync(join(cwd, relative), 'utf-8'));
}

// --- validators: shared rejects activeScope; local accepts personal fields ---
{
  clearDistCache();
  const { validateSharedProjectStateShape, validateLocalProjectStateShape, validateProjectStateShape } = loadSchema();
  const sharedOk = validateSharedProjectStateShape(
    { schemaVersion: 4, artifactRoot: '.agents/kyro/scopes', scopes: [], principles: [principle()] },
    'project.json',
  );
  assert(sharedOk.length === 0, `shared valid should pass: ${JSON.stringify(sharedOk)}`);
  const sharedBad = validateSharedProjectStateShape(
    { schemaVersion: 4, artifactRoot: '.agents/kyro/scopes', scopes: [], activeScope: 'x' },
    'project.json',
  );
  assert(sharedBad.some((i) => i.field === 'activeScope'), 'shared must reject activeScope');
  const localOk = validateLocalProjectStateShape(
    { schemaVersion: 4, activeScope: null, installedAdapters: [] },
    'local.json',
  );
  assert(localOk.length === 0, `local valid should pass: ${JSON.stringify(localOk)}`);
  const localBad = validateLocalProjectStateShape(
    { schemaVersion: 4, activeScope: null, installedAdapters: [], principles: [principle()] },
    'local.json',
  );
  assert(localBad.some((i) => i.field === 'principles'), 'local must reject principles');
  const monoOk = validateProjectStateShape(monolitoFixture(), 'kyro.json');
  assert(monoOk.length === 0, `monolito shape should still validate: ${JSON.stringify(monoOk)}`);
  console.log('ok validators');
}

// --- merge precedence + no-write-on-read ---
withWorkspace('kyro-layered-merge-', (cwd) => {
  const { PROJECT_STATE_PATH, LOCAL_STATE_PATH, KYRO_STATE_PATH } = loadConstants();
  const { readProjectState, mergeProjectLayers } = loadState();

  writeJson(cwd, PROJECT_STATE_PATH, {
    schemaVersion: 4,
    artifactRoot: '.agents/kyro/scopes',
    scopes: [{ id: 'alpha', title: 'Alpha', status: 'active' }],
    principles: [principle()],
  });
  writeJson(cwd, LOCAL_STATE_PATH, {
    schemaVersion: 4,
    activeScope: 'alpha',
    installedAdapters: monolitoFixture().installedAdapters,
  });

  const before = listKyroFiles(cwd);
  const effective = readProjectState();
  const after = listKyroFiles(cwd);
  assert(JSON.stringify(before) === JSON.stringify(after), `readProjectState must not create files: ${after}`);
  assert(effective.principles?.[0]?.id === 'p-quality', 'principles must come from shared');
  assert(effective.activeScope === 'alpha', 'activeScope must come from local');
  assert(effective.scopes[0].id === 'alpha', 'scopes must come from shared');
  assert(!('kyroInvocation' in effective), 'effective must not expose kyroInvocation');

  const merged = mergeProjectLayers(
    {
      schemaVersion: 4,
      artifactRoot: '.agents/kyro/scopes',
      scopes: [],
      principles: [principle()],
    },
    { schemaVersion: 4, activeScope: 'zulu', installedAdapters: [] },
  );
  assert(merged.principles[0].id === 'p-quality' && merged.activeScope === 'zulu', 'merge precedence');

  // monolito dual-read
  rmSync(join(cwd, PROJECT_STATE_PATH), { force: true });
  rmSync(join(cwd, LOCAL_STATE_PATH), { force: true });
  writeJson(cwd, KYRO_STATE_PATH, monolitoFixture());
  const mono = readProjectState();
  assert(mono.activeScope === 'alpha', 'monolito activeScope');
  assert(mono.principles[0].id === 'p-quality', 'monolito principles');
  assert(mono.scopes.map((s) => s.id).join(',') === 'alpha,beta', 'monolito scopes');
  assert(mono.installedAdapters[0].agent === 'standard', 'monolito adapters');
  console.log('ok merge + dual-read + no-write-on-read');
});

// --- migration preserves fields ---
withWorkspace('kyro-layered-migrate-', (cwd) => {
  const { PROJECT_STATE_PATH, LOCAL_STATE_PATH, KYRO_STATE_PATH } = loadConstants();
  const {
    migrateMonolitoToLayers,
    readProjectState,
    splitMonolitoToLayers,
  } = loadState();

  writeJson(cwd, KYRO_STATE_PATH, monolitoFixture());
  const split = splitMonolitoToLayers(monolitoFixture());
  assert(!('activeScope' in split.shared), 'split shared must omit activeScope');
  assert(split.shared.principles[0].id === 'p-quality', 'split principles on shared');
  assert(split.local.activeScope === 'alpha', 'split activeScope on local');
  assert(split.local.installedAdapters[0].agent === 'standard', 'split adapters on local');
  assert(split.shared.scopes.map((s) => s.id).join(',') === 'alpha,beta', 'split scopes on shared');

  migrateMonolitoToLayers();
  const files = listKyroFiles(cwd);
  assert(files.includes('project.json'), 'migrate writes project.json');
  assert(files.includes('local.json'), 'migrate writes local.json');
  assert(!files.includes('kyro.json'), 'migrate archives monolito');
  assert(files.includes('kyro.json.migrated'), 'migrate keeps kyro.json.migrated');

  const shared = readJson(cwd, PROJECT_STATE_PATH);
  const local = readJson(cwd, LOCAL_STATE_PATH);
  assert(!('activeScope' in shared), 'disk shared has no activeScope');
  assert(!('principles' in local), 'disk local has no principles');
  assert(local.activeScope === 'alpha', 'disk local activeScope');
  assert(shared.principles[0].id === 'p-quality', 'disk shared principles');

  const effective = readProjectState();
  assert(effective.activeScope === 'alpha', 'post-migrate activeScope');
  assert(effective.principles[0].id === 'p-quality', 'post-migrate principles');
  assert(effective.scopes.length === 2, 'post-migrate scopes');
  assert(effective.installedAdapters[0].agent === 'standard', 'post-migrate adapters');
  console.log('ok migration');
});

// --- write targeting: local-only leaves shared principles byte-stable ---
withWorkspace('kyro-layered-write-', (cwd) => {
  const { PROJECT_STATE_PATH, LOCAL_STATE_PATH } = loadConstants();
  const {
    writeProjectLayers,
    writeLocalProjectState,
    writeSharedProjectState,
    readProjectState,
    updateProjectStateLayers,
  } = loadState();

  writeProjectLayers({
    shared: {
      schemaVersion: 4,
      artifactRoot: '.agents/kyro/scopes',
      scopes: [
        { id: 'alpha', title: 'Alpha', status: 'active' },
        { id: 'beta', title: 'Beta', status: 'planning' },
      ],
      principles: [principle()],
    },
    local: {
      schemaVersion: 4,
      activeScope: 'alpha',
      installedAdapters: monolitoFixture().installedAdapters,
      runtimePath: '~/.agents/kyro/current',
    },
  });

  const sharedBefore = readFileSync(join(cwd, PROJECT_STATE_PATH), 'utf-8');
  writeLocalProjectState({
    schemaVersion: 4,
    activeScope: 'beta',
    installedAdapters: monolitoFixture().installedAdapters,
    runtimePath: '~/.agents/kyro/current',
  });
  const sharedAfterLocal = readFileSync(join(cwd, PROJECT_STATE_PATH), 'utf-8');
  assert(sharedBefore === sharedAfterLocal, 'local write must not rewrite shared file');
  assert(readJson(cwd, LOCAL_STATE_PATH).activeScope === 'beta', 'local activeScope updated');
  assert(readProjectState().principles[0].id === 'p-quality', 'principles survive local write');

  writeSharedProjectState({
    schemaVersion: 4,
    artifactRoot: '.agents/kyro/scopes',
    scopes: readJson(cwd, PROJECT_STATE_PATH).scopes,
    principles: [principle()],
    activeScope: 'evil',
  });
  assert(!('activeScope' in readJson(cwd, PROJECT_STATE_PATH)), 'shared write strips activeScope');

  // updateProjectStateLayers activeScope-only must not rewrite shared
  const sharedMid = readFileSync(join(cwd, PROJECT_STATE_PATH), 'utf-8');
  updateProjectStateLayers({ activeScope: 'alpha' });
  const sharedEnd = readFileSync(join(cwd, PROJECT_STATE_PATH), 'utf-8');
  assert(sharedMid === sharedEnd, 'updateProjectStateLayers({activeScope}) must be local-only');
  assert(readJson(cwd, LOCAL_STATE_PATH).activeScope === 'alpha', 'update layers activeScope');
  console.log('ok write targeting');
});

// --- scope set-active local-only when layers exist ---
withWorkspace('kyro-layered-setactive-', (cwd) => {
  const { PROJECT_STATE_PATH, LOCAL_STATE_PATH } = loadConstants();
  const { writeProjectLayers } = loadState();
  const { runScopeCommand } = require(join(repo, 'dist/cli/commands/scope.js'));
  const { withStateWriterLock } = require(join(repo, 'dist/cli/pipeline/state-writer-lock.js'));

  writeProjectLayers({
    shared: {
      schemaVersion: 4,
      artifactRoot: '.agents/kyro/scopes',
      scopes: [
        { id: 'alpha', title: 'Alpha', status: 'active' },
        { id: 'beta', title: 'Beta', status: 'planning' },
      ],
      principles: [principle()],
    },
    local: {
      schemaVersion: 4,
      activeScope: 'alpha',
      installedAdapters: [],
    },
  });

  // Create scope dirs so set-active path resolution is happy (also in registry).
  mkdirSync(join(cwd, '.agents/kyro/scopes/alpha'), { recursive: true });
  mkdirSync(join(cwd, '.agents/kyro/scopes/beta'), { recursive: true });

  const sharedBefore = readFileSync(join(cwd, PROJECT_STATE_PATH), 'utf-8');
  withStateWriterLock(() => {
    runScopeCommand(['set-active', 'beta', '--yes']);
  });
  const sharedAfter = readFileSync(join(cwd, PROJECT_STATE_PATH), 'utf-8');
  assert(sharedBefore === sharedAfter, 'set-active must not change shared project.json when scope already registered');
  assert(readJson(cwd, LOCAL_STATE_PATH).activeScope === 'beta', 'set-active updates local activeScope');
  assert(JSON.parse(sharedAfter).principles[0].id === 'p-quality', 'principles unchanged after set-active');
  console.log('ok scope set-active local-only');
});

// --- status / context-pack: bootstrap remedy without writing project state (R5 / D7a) ---
function minimalSprint(scopeId = 'demo') {
  return {
    schemaVersion: 4,
    scope: scopeId,
    title: 'Demo',
    status: 'active',
    objective: 'Demonstrate read-only bootstrap remedy.',
    successCriteria: ['status does not write state files'],
    clarifications: [],
    conventions: [],
    adrs: [],
    roadmap: {
      plannedSprintCount: 1,
      sizingRationale: 'Single sprint.',
      sprints: [{ n: 1, slug: 'demo', title: 'Demo', state: 'active' }],
    },
    ledger: [],
    previousSprint: null,
    activeSprint: {
      n: 1,
      slug: 'demo',
      title: 'Demo',
      objective: 'Do the demo.',
      status: 'executing',
      phases: [
        {
          id: 'P1',
          title: 'Phase 1',
          objective: 'Demo phase.',
          status: 'active',
          tasks: [
            {
              id: 'T1.1',
              title: 'Demo task',
              description: 'Do a thing.',
              files_to_touch: ['a.ts'],
              context: 'context',
              acceptance_criteria: ['it works'],
              depends_on: [],
              status: 'pending',
              evidence: null,
              verdict: null,
            },
          ],
        },
      ],
      emergentTasks: [],
      definitionOfDone: ['done'],
    },
    debt: [],
    handoff: {
      nextAction: 'execute_task',
      nextTaskId: 'T1.1',
      blockers: [],
      note: '',
      lastUpdated: '2026-06-29',
    },
  };
}

function stateFilesPresent(cwd) {
  return {
    project: existsSync(join(cwd, '.agents/kyro/project.json')),
    local: existsSync(join(cwd, '.agents/kyro/local.json')),
    monolito: existsSync(join(cwd, '.agents/kyro/kyro.json')),
  };
}

withWorkspace('kyro-layered-bootstrap-readonly-', (cwd) => {
  const cli = join(repo, 'dist/cli.js');
  const scopeId = 'demo';
  writeJson(cwd, `.agents/kyro/scopes/${scopeId}/sprint.json`, minimalSprint(scopeId));

  const before = stateFilesPresent(cwd);
  assert(!before.project && !before.local && !before.monolito, 'fixture must start with no project state files');

  const env = { ...process.env, HOME: join(cwd, '.home'), KYRO_TRACE: '0' };

  const status = spawnSync(
    process.execPath,
    [cli, 'status', '--kyro-scope', scopeId, '--json'],
    { cwd, env, encoding: 'utf-8' },
  );
  assert(status.status === 0, `status should exit 0: ${status.stderr || status.stdout}`);
  const statusReport = JSON.parse(status.stdout);
  assert(
    typeof statusReport.bootstrapRemedy === 'string' && statusReport.bootstrapRemedy.includes('install --init-workspace'),
    `status must include bootstrap remedy: ${status.stdout}`,
  );
  const afterStatus = stateFilesPresent(cwd);
  assert(!afterStatus.project && !afterStatus.local && !afterStatus.monolito, 'status must not create project state files');

  const pack = spawnSync(
    process.execPath,
    [cli, 'context-pack', '--kyro-scope', scopeId, '--json'],
    { cwd, env, encoding: 'utf-8' },
  );
  assert(pack.status === 0, `context-pack should exit 0: ${pack.stderr || pack.stdout}`);
  const packReport = JSON.parse(pack.stdout);
  assert(
    Array.isArray(packReport.warnings)
      && packReport.warnings.some((w) => typeof w === 'string' && w.includes('install --init-workspace')),
    `context-pack must warn with bootstrap remedy: ${pack.stdout}`,
  );
  const afterPack = stateFilesPresent(cwd);
  assert(!afterPack.project && !afterPack.local && !afterPack.monolito, 'context-pack must not create project state files');

  // Unit helper: formatBootstrapRemedy / detect with unregistered scopes when layers exist
  const {
    detectProjectStateBootstrapNeed,
    formatBootstrapRemedy,
    writeProjectLayers,
  } = loadState();
  assert(
    formatBootstrapRemedy('missing layers').includes('install --init-workspace'),
    'formatBootstrapRemedy must mention install',
  );
  writeProjectLayers({
    shared: {
      schemaVersion: 4,
      artifactRoot: '.agents/kyro/scopes',
      scopes: [],
    },
    local: { schemaVersion: 4, activeScope: null, installedAdapters: [] },
  });
  const unregisteredHint = detectProjectStateBootstrapNeed([scopeId]);
  assert(
    unregisteredHint && unregisteredHint.includes(scopeId) && unregisteredHint.includes('install --init-workspace'),
    `unregistered scopes must yield remedy: ${unregisteredHint}`,
  );
  const healthy = detectProjectStateBootstrapNeed([]);
  assert(healthy === null, 'registered/empty unregistered list with layers present → no remedy');

  console.log('ok status/context-pack bootstrap no-write + remedy');
});

// --- doctor: layered health, monolito leftover WARN, missing-state bootstrap, minPackageVersion (R7/R10) ---
function loadDoctor() {
  return require(join(repo, 'dist/cli/commands/doctor.js'));
}

withWorkspace('kyro-layered-doctor-healthy-', (cwd) => {
  const { writeProjectLayers } = loadState();
  const { runDoctorChecks, compareSemverLike } = loadDoctor();

  writeProjectLayers({
    shared: {
      schemaVersion: 4,
      artifactRoot: '.agents/kyro/scopes',
      scopes: [{ id: 'alpha', title: 'Alpha', status: 'active' }],
      principles: [principle()],
    },
    local: {
      schemaVersion: 4,
      activeScope: 'alpha',
      installedAdapters: monolitoFixture().installedAdapters,
      runtimePath: '~/.agents/kyro/current',
    },
  });

  const before = stateFilesPresent(cwd);
  const checks = runDoctorChecks(false, false, false, false, null);
  const after = stateFilesPresent(cwd);
  assert(
    before.project === after.project && before.local === after.local && before.monolito === after.monolito,
    'doctor must not create or remove project state files',
  );

  const projectState = checks.find((c) => c.name === 'project state');
  assert(projectState?.status === 'pass', `healthy layered project state must pass: ${JSON.stringify(projectState)}`);
  assert(
    typeof projectState.detail === 'string' && projectState.detail.includes('layered'),
    `healthy detail should mention layered: ${projectState.detail}`,
  );
  assert(
    checks.some((c) => c.name === 'project.json' && c.status === 'pass'),
    'healthy workspace must pass project.json shape',
  );
  assert(
    checks.some((c) => c.name === 'local.json' && c.status === 'pass'),
    'healthy workspace must pass local.json shape',
  );
  assert(
    !checks.some((c) => c.name === 'legacy monolito' && c.status === 'warn'),
    'healthy layered-only workspace must not warn about monolito leftover',
  );
  assert(
    !checks.some((c) => c.status === 'fail' && (c.name === 'project state' || c.name === 'project.json' || c.name === 'local.json')),
    `no layered-state fails on healthy workspace: ${JSON.stringify(checks.filter((c) => c.status === 'fail'))}`,
  );

  assert(compareSemverLike('4.34.0', '4.34.0') === 0, 'semver equal');
  assert(compareSemverLike('4.33.0', '4.34.0') === -1, 'semver older');
  assert(compareSemverLike('5.0.0', '4.34.0') === 1, 'semver newer');
  console.log('ok doctor healthy layered');
});

withWorkspace('kyro-layered-doctor-monolito-leftover-', (cwd) => {
  const { writeProjectLayers } = loadState();
  const { KYRO_STATE_PATH } = loadConstants();
  const { runDoctorChecks } = loadDoctor();

  writeProjectLayers({
    shared: {
      schemaVersion: 4,
      artifactRoot: '.agents/kyro/scopes',
      scopes: [{ id: 'alpha', title: 'Alpha', status: 'active' }],
    },
    local: {
      schemaVersion: 4,
      activeScope: 'alpha',
      installedAdapters: [],
      runtimePath: '~/.agents/kyro/current',
    },
  });
  writeJson(cwd, KYRO_STATE_PATH, monolitoFixture());

  const checks = runDoctorChecks(false, false, false, false, null);
  const leftover = checks.find((c) => c.name === 'legacy monolito');
  assert(leftover?.status === 'warn', `monolito leftover must WARN: ${JSON.stringify(leftover)}`);
  assert(
    typeof leftover.detail === 'string' && leftover.detail.includes('kyro.json'),
    `leftover detail mentions kyro.json: ${leftover.detail}`,
  );
  assert(
    typeof leftover.remedy === 'string' && leftover.remedy.includes('install'),
    `leftover remedy actionable: ${leftover.remedy}`,
  );
  // WARN only — must not fail solely for leftover monolito
  assert(leftover.status !== 'fail', 'monolito leftover must not FAIL');
  console.log('ok doctor monolito leftover WARN');
});

withWorkspace('kyro-layered-doctor-missing-', (cwd) => {
  const { runDoctorChecks } = loadDoctor();
  const before = stateFilesPresent(cwd);
  assert(!before.project && !before.local && !before.monolito, 'fixture starts empty');

  const checks = runDoctorChecks(false, false, false, false, null);
  const after = stateFilesPresent(cwd);
  assert(!after.project && !after.local && !after.monolito, 'doctor must not create project state when missing');

  const projectState = checks.find((c) => c.name === 'project state');
  assert(projectState?.status === 'warn', `missing state must WARN: ${JSON.stringify(projectState)}`);
  assert(
    typeof projectState.detail === 'string'
      && (projectState.detail.includes('project.json') || projectState.detail.includes('No project state')),
    `missing detail mentions layered paths: ${projectState.detail}`,
  );
  assert(
    typeof projectState.remedy === 'string'
      && projectState.remedy.includes('install')
      && projectState.remedy.includes('project.json'),
    `missing remedy must mention layered install, not only kyro.json: ${projectState.remedy}`,
  );
  assert(
    !projectState.detail.includes('kyro.json not found') || projectState.detail.includes('project.json'),
    'must not be monolito-only messaging',
  );
  console.log('ok doctor missing-state bootstrap remedy');
});

withWorkspace('kyro-layered-doctor-minpkg-', (cwd) => {
  const { writeProjectLayers } = loadState();
  const { runDoctorChecks } = loadDoctor();
  const { readPackageVersion } = require(join(repo, 'dist/cli/help.js'));
  const runtime = readPackageVersion();

  writeProjectLayers({
    shared: {
      schemaVersion: 4,
      artifactRoot: '.agents/kyro/scopes',
      scopes: [],
      team: { minPackageVersion: '99.0.0' },
    },
    local: {
      schemaVersion: 4,
      activeScope: null,
      installedAdapters: [],
      runtimePath: '~/.agents/kyro/current',
    },
  });

  const checks = runDoctorChecks(false, false, false, false, null);
  const minCheck = checks.find((c) => c.name === 'team minPackageVersion');
  assert(minCheck?.status === 'warn', `minPackageVersion must WARN when runtime older: ${JSON.stringify(minCheck)}`);
  assert(
    typeof minCheck.detail === 'string' && minCheck.detail.includes(runtime) && minCheck.detail.includes('99.0.0'),
    `detail must include versions: ${minCheck.detail}`,
  );
  assert(
    typeof minCheck.remedy === 'string' && minCheck.remedy.toLowerCase().includes('upgrade'),
    `remedy should recommend upgrade: ${minCheck.remedy}`,
  );
  // Non-blocking: doctor exit is driven by fail status only
  assert(minCheck.status === 'warn', 'minPackageVersion must not FAIL by default');
  assert(
    !checks.some((c) => c.name === 'team minPackageVersion' && c.status === 'fail'),
    'no fail for minPackageVersion',
  );

  // When floor is met, PASS
  writeProjectLayers({
    shared: {
      schemaVersion: 4,
      artifactRoot: '.agents/kyro/scopes',
      scopes: [],
      team: { minPackageVersion: '0.0.1' },
    },
    local: {
      schemaVersion: 4,
      activeScope: null,
      installedAdapters: [],
      runtimePath: '~/.agents/kyro/current',
    },
  });
  const okChecks = runDoctorChecks(false, false, false, false, null);
  const okMin = okChecks.find((c) => c.name === 'team minPackageVersion');
  assert(okMin?.status === 'pass', `minPackageVersion must PASS when met: ${JSON.stringify(okMin)}`);
  console.log('ok doctor minPackageVersion WARN');
});

console.log('check-layered-state: all assertions passed');
