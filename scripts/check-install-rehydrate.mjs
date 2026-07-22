/**
 * Install/sync rehydrates on-disk scope folders into kyro.json.scopes[].
 * Covers the multi-dev pattern: scopes committed, kyro.json gitignored.
 */
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

function readState(cwd) {
  return JSON.parse(readFileSync(join(cwd, '.agents', 'kyro', 'kyro.json'), 'utf-8'));
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
  writeScope(cwd, 'empty-folder'); // no sprint.json

  captureLogs(() => install(cliOptions({ agents: [standard], initWorkspace: true })));
  const state = readState(cwd);
  assert(Array.isArray(state.scopes), 'multi: scopes array present');
  assert(state.scopes.length === 3, `multi: expected 3 scopes, got ${state.scopes.length}`);
  assert(state.activeScope === null, 'multi: activeScope must stay null with multiple scopes');

  const byId = Object.fromEntries(state.scopes.map((s) => [s.id, s]));
  assert(byId['oauth-impl'].title === 'OAuth Implementation', 'multi: title from sprint.json');
  assert(byId['oauth-impl'].status === 'active', 'multi: status derived from active sprint');
  assert(byId['ui-redesign'].title === 'UI Redesign', 'multi: second title from sprint.json');
  assert(byId['ui-redesign'].status === 'planning', 'multi: planning when no active sprint');
  assert(byId['empty-folder'].title === 'empty-folder', 'multi: folder without sprint uses id as title');
  assert(byId['empty-folder'].status === 'planning', 'multi: folder without sprint defaults to planning');

  // Doctor should pass registry check after rehydrate
  const checks = runDoctorChecks(false, false, false, false, null);
  const registry = checks.find((c) => c.name === 'scope registry');
  assert(registry?.status === 'pass', `multi: doctor registry should pass, got ${registry?.status}: ${registry?.detail}`);
});

// --- single-scope sets activeScope ---
withWorkspace('kyro-rehydrate-single-', (cwd) => {
  const { parseAgent } = require(join(repo, 'dist/cli/options.js'));
  const { install } = require(join(repo, 'dist/cli/commands/install.js'));
  const standard = parseAgent('standard');

  writeScope(cwd, 'solo-scope', minimalSprint('solo-scope', 'Solo Scope'));
  captureLogs(() => install(cliOptions({ agents: [standard], initWorkspace: true })));
  const state = readState(cwd);
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

  // Seed kyro.json with empty scopes + a principle + one hand-registered entry with custom title
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
  let state = readState(cwd);
  const known = state.scopes.find((s) => s.id === 'known');
  assert(known?.title === 'Custom Title Keep Me', 'preserve: must not clobber existing title');
  assert(known?.status === 'blocked', 'preserve: must not clobber existing status');
  assert(state.activeScope === 'known', 'preserve: must not clobber activeScope');
  assert(state.principles?.[0]?.id === 'p1', 'preserve: principles kept');
  assert(state.scopes.some((s) => s.id === 'orphan' && s.title === 'Orphan On Disk'), 'preserve: orphan folder registered');

  // Explicit empty scopes[] then sync rehydrates without dropping activeScope if still set — rewrite empty
  state.scopes = [];
  writeFileSync(join(cwd, '.agents', 'kyro', 'kyro.json'), `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
  captureLogs(() => sync(cliOptions({ agents: [standard] })));
  state = readState(cwd);
  assert(state.scopes.map((s) => s.id).sort().join(',') === 'known,orphan', 'sync: rehydrates both folders');
  assert(state.activeScope === 'known', 'sync: keeps existing activeScope');
});

// --- no-init-workspace does not create kyro.json even with scopes on disk ---
withWorkspace('kyro-rehydrate-no-init-', (cwd) => {
  const { parseAgent } = require(join(repo, 'dist/cli/options.js'));
  const { install } = require(join(repo, 'dist/cli/commands/install.js'));
  const standard = parseAgent('standard');

  writeScope(cwd, 'ghost', minimalSprint('ghost', 'Ghost'));
  captureLogs(() => install(cliOptions({ agents: [standard], noInitWorkspace: true })));
  assert(!existsSync(join(cwd, '.agents', 'kyro', 'kyro.json')), 'no-init: must not write kyro.json');
});

// --- doctor warns when registry lags disk ---
withWorkspace('kyro-rehydrate-doctor-', (cwd) => {
  const { parseAgent } = require(join(repo, 'dist/cli/options.js'));
  const { install } = require(join(repo, 'dist/cli/commands/install.js'));
  const { runDoctorChecks } = require(join(repo, 'dist/cli/commands/doctor.js'));
  const standard = parseAgent('standard');

  captureLogs(() => install(cliOptions({ agents: [standard], initWorkspace: true })));
  writeScope(cwd, 'late-arrival', minimalSprint('late-arrival', 'Late'));

  const checks = runDoctorChecks(false, false, false, false, null);
  const registry = checks.find((c) => c.name === 'scope registry');
  assert(registry?.status === 'warn', `doctor: expected warn, got ${registry?.status}`);
  assert(registry?.detail?.includes('late-arrival'), 'doctor: detail names missing folder');
  assert(registry?.remedy?.includes('install'), 'doctor: remedy mentions install/sync');
});

console.log('Install rehydrate checks passed');
