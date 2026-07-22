#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repo = resolve(fileURLToPath(import.meta.url), '../..');
const cli = resolve(repo, 'dist/cli.js');
const fixtures = resolve(repo, 'fixtures/evals');
const tempIds = ['harness-malformed-case', 'harness-failing-case'];

function run(args) {
  return spawnSync(process.execPath, [cli, 'eval', ...args], { cwd: repo, encoding: 'utf-8' });
}

function assert(condition, message) {
  if (!condition) {
    console.error(`ERROR: ${message}`);
    process.exit(1);
  }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function baseState(dir) {
  writeJson(resolve(dir, 'state/.agents/kyro/kyro.json'), {
    schemaVersion: 4,
    artifactRoot: '.agents/kyro/scopes',
    scopes: [{ id: 'demo', title: 'Demo', status: 'active' }],
    activeScope: 'demo',
    runtimePath: '~/.agents/kyro/current',
    installedAdapters: [],
  });
  writeJson(resolve(dir, 'state/.agents/kyro/scopes/demo/sprint.json'), {
    schemaVersion: 4,
    scope: 'demo',
    title: 'Demo',
    status: 'active',
    objective: 'Demo objective',
    successCriteria: ['Demo works.'],
    clarifications: [],
    conventions: [],
    roadmap: { plannedSprintCount: 1, sizingRationale: 'One sprint.', sprints: [{ n: 1, slug: 'demo', title: 'Demo', state: 'active' }] },
    ledger: [],
    previousSprint: null,
    activeSprint: null,
    debt: [],
    handoff: { nextAction: 'done', nextTaskId: null, blockers: [], note: '', lastUpdated: '2026-07-02' },
  });
}

for (const id of tempIds) rmSync(resolve(fixtures, id), { recursive: true, force: true });
try {
  const list = run(['--list']);
  assert(list.status === 0 && list.stdout.includes('route-init'), '--list should include route-init');

  const filtered = run(['--case', 'route-init', '--json']);
  const filteredReport = JSON.parse(filtered.stdout);
  assert(filtered.status === 0 && filteredReport.selected === 1 && filteredReport.cases?.[0]?.id === 'route-init', '--case should select exactly route-init');

  const malformedDir = resolve(fixtures, 'harness-malformed-case');
  mkdirSync(malformedDir, { recursive: true });
  writeJson(resolve(malformedDir, 'case.json'), { evalCaseSchemaVersion: 1, id: 'wrong-id' });
  const malformed = run(['--case', 'harness-malformed-case', '--json']);
  assert(malformed.status === 2 && malformed.stdout.includes('Malformed eval case'), 'malformed manifest should exit 2');
  rmSync(malformedDir, { recursive: true, force: true });

  const failingDir = resolve(fixtures, 'harness-failing-case');
  baseState(failingDir);
  writeJson(resolve(failingDir, 'case.json'), {
    evalCaseSchemaVersion: 1,
    id: 'harness-failing-case',
    title: 'Harness failing expectation',
    kind: 'replay',
    tags: ['harness'],
    agents: ['any'],
    scope: 'demo',
    steps: [{ run: ['doctor', '--artifacts', '--kyro-scope', 'demo'], expect: { exitCode: 99 } }],
    expectFinalState: false,
  });
  const failing = run(['--case', 'harness-failing-case', '--json']);
  const failingReport = JSON.parse(failing.stdout);
  assert(failing.status === 1 && failingReport.failed === 1, 'failing expectation should exit 1');
  rmSync(failingDir, { recursive: true, force: true });

  const { normalizeSprintJson, deepEqualNormalized } = await import(`file://${resolve(repo, 'dist/cli/eval/normalize.js')}`);
  const normalized = normalizeSprintJson({ handoff: { lastUpdated: '2026-07-02' }, path: '/tmp/sandbox/file' }, '/tmp/sandbox');
  assert(deepEqualNormalized(normalized, { handoff: { lastUpdated: '<NORMALIZED>' }, path: '<SANDBOX>/file' }), 'normalizer should mask dates and sandbox paths');

  console.log('check:eval-harness — harness behavior checks passed');
} finally {
  for (const id of tempIds) rmSync(resolve(fixtures, id), { recursive: true, force: true });
}
