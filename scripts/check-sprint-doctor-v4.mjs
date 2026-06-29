import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repo = resolve(new URL('..', import.meta.url).pathname);
const cli = join(repo, 'dist/cli.js');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const validKyroJson = {
  schemaVersion: 4,
  artifactRoot: '.agents/kyro/scopes',
  activeScope: 'demo',
  scopes: [{ id: 'demo', title: 'Demo', status: 'active' }],
  runtimeVersion: '4.0.0',
  runtimePath: '~/.agents/kyro/current',
  installedAdapters: [],
};

const validSprintJson = {
  schemaVersion: 4,
  scope: 'demo',
  title: 'Demo',
  status: 'active',
  objective: 'Demonstrate a valid v4 sprint file.',
  conventions: [{ id: 'c-1', rule: 'Run build before close.', tags: ['build'], addedSprint: 1 }],
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
  handoff: { nextAction: 'execute_task', nextTaskId: 'T1.1', blockers: [], note: '', lastUpdated: '2026-06-29' },
};

function makeFixture(kyroJson, sprintJson) {
  const dir = mkdtempSync(join(tmpdir(), 'kyro-v4-doctor-'));
  const scopeDir = join(dir, '.agents/kyro/scopes/demo');
  mkdirSync(scopeDir, { recursive: true });
  writeFileSync(join(dir, '.agents/kyro/kyro.json'), `${JSON.stringify(kyroJson, null, 2)}\n`);
  writeFileSync(join(scopeDir, 'sprint.json'), `${JSON.stringify(sprintJson, null, 2)}\n`);
  return dir;
}

function runDoctor(dir) {
  const result = spawnSync(process.execPath, [cli, 'doctor', '--artifacts', '--kyro-scope', 'demo'], {
    cwd: dir,
    env: { ...process.env, HOME: join(dir, '.home') },
    encoding: 'utf-8',
  });
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

function assertCase(name, kyroJson, sprintJson, expectedStatus, expectedText) {
  const dir = makeFixture(kyroJson, sprintJson);
  try {
    const { status, output } = runDoctor(dir);
    assert(status === expectedStatus, `${name}: expected exit ${expectedStatus}, got ${status}\n${output}`);
    assert(output.includes(expectedText), `${name}: expected output to include "${expectedText}"\n${output}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// 1. Valid v4 artifacts pass.
assertCase('valid', validKyroJson, validSprintJson, 0, 'Schema shapes are valid.');

// 2. kyro.json scopes as string[] (v3 drift) fails with a specific message.
assertCase(
  'string-scopes',
  { ...validKyroJson, scopes: ['demo'] },
  validSprintJson,
  1,
  'scopes[0] must be an object',
);

// 3. conventions[] as plain strings (v3 drift) fails and names the field.
assertCase(
  'string-conventions',
  validKyroJson,
  { ...validSprintJson, conventions: ['just a string'] },
  1,
  'conventions[0]',
);

// 4. Snapshot path on a ledger entry must be a string when present.
assertCase(
  'bad-snapshot',
  validKyroJson,
  {
    ...validSprintJson,
    ledger: [{ n: 1, slug: 'demo', outcome: 'shipped', closedAt: '2026-06-29', archive: 'archive/sprint-001-demo.md', snapshot: 42 }],
  },
  1,
  'ledger[0].snapshot must be a string',
);

console.log('check:sprint-doctor-v4 — all cases passed');
