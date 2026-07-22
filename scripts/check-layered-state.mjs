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

console.log('check-layered-state: all assertions passed');
