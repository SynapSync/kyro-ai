import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  renameSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { validateSprintFile } from '../dist/cli/artifacts/schema.js';
import { configureCreator, isolatedGitEnv, seedLegacyWork } from './work-author-fixtures.mjs';
const cli = resolve('dist/cli.js');
const roots = [];
const workspace = () => {
  const root = mkdtempSync(join(tmpdir(), 'kyro-work-doctor-'));
  roots.push(root);
  mkdirSync(join(root, '.agents/kyro'), { recursive: true });
  writeFileSync(join(root, '.agents/kyro/project.json'), JSON.stringify({ schemaVersion: 4, artifactRoot: '.agents/kyro/scopes', conventions: [] }));
  writeFileSync(join(root, '.agents/kyro/local.json'), JSON.stringify({ schemaVersion: 4, activeScope: null, installedAdapters: [] }));
  return root;
};
const run = (root, ...args) => spawnSync(process.execPath, [cli, ...args, '--json'], { cwd: root, env: isolatedGitEnv(), encoding: 'utf8' });
const doctorLines = (root) => {
  const result = run(root, 'doctor', '--artifacts');
  assert(result.stdout, result.stderr);
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.ok, true, result.stdout);
  assert(Array.isArray(envelope.data.output));
  return envelope.data.output;
};
const workChecks = (root) => doctorLines(root).filter((line) => /^\[(?:PASS|FAIL|WARN)\] Work /.test(line));
const createWork = (root) => {
  writeFileSync(join(root, 'brief.md'), '# Doctor fixture\n\nDeliver a verifiable result through the Work CLI.\n');
  const result = run(root, 'work', 'create', '--id', 'example', '--from', 'brief.md');
  assert.equal(result.status, 0, result.stdout || result.stderr);
};
const forgeScope = (root) => {
  const destination = join(root, '.agents/kyro/scopes/organic-work');
  mkdirSync(destination, { recursive: true });
  // Complete standalone scope fixture; never read checkout-owned managed state.
  const sprint = {
    schemaVersion: 4, scope: 'organic-work', title: 'Doctor fixture', status: 'planning',
    objective: 'Audit an isolated Forge and Work workspace.', successCriteria: ['Artifacts are readable.'],
    spec: { requirements: [{ id: 'R1', statement: 'Artifacts must be readable.', priority: 'must', rationale: 'Audit fixture.' }], nonGoals: [], openQuestions: [], scenarios: [] },
    clarifications: [], conventions: [], adrs: [],
    roadmap: { plannedSprintCount: 1, sizingRationale: 'One fixture.', sprints: [{ n: 1, slug: 'fixture', title: 'Fixture', state: 'planned' }] },
    ledger: [], previousSprint: null, activeSprint: null, debt: [],
    handoff: { nextAction: 'plan_sprint', nextTaskId: null, blockers: [], note: 'Fixture ready.', lastUpdated: '2026-09-26' },
  };
  assert.deepEqual(validateSprintFile(sprint), []);
  writeFileSync(join(destination, 'sprint.json'), JSON.stringify(sprint, null, 2) + '\n');
};
const snapshot = (root, withForge = false) => {
  const paths = ['.agents/kyro/project.json', '.agents/kyro/local.json', ...(withForge ? ['.agents/kyro/scopes/organic-work/sprint.json'] : [])];
  return paths.map((path) => [path, readFileSync(join(root, path))]);
};
const unchanged = (root, before) => {
  for (const [path, bytes] of before) assert.deepEqual(readFileSync(join(root, path)), bytes, `${path} must remain byte-identical`);
};
const expectRootFailure = (root, pattern) => {
  const output = doctorLines(root);
  const lines = output.filter((line) => /^\[(?:PASS|FAIL|WARN)\] Work /.test(line));
  assert.equal(lines.filter((line) => line.startsWith('[FAIL] Work root:')).length, 1, lines.join('\n'));
  assert.match(lines.find((line) => line.startsWith('[FAIL] Work root:')), pattern);
  assert(output.some((line) => line.startsWith('Remedy: Restore a real, readable Work directory')));
  assert(!lines.some((line) => line.includes('Work example promotion:')), 'unsafe roots must not report a healthy Work');
};

try {
  const forgeOnly = workspace();
  forgeScope(forgeOnly);
  const forgeBefore = snapshot(forgeOnly, true);
  assert.equal(workChecks(forgeOnly).length, 0, 'a genuinely absent Work root must add no Work check');
  unchanged(forgeOnly, forgeBefore);

  const workOnly = workspace();
  createWork(workOnly);
  const workBefore = snapshot(workOnly);
  assert(workChecks(workOnly).some((line) => line.startsWith('[PASS] Work example promotion:')), 'Work-only workspace must be audited');
  assert(doctorLines(workOnly).some((line) => line.startsWith('[WARN] artifact scopes: no scopes found')));

  const workRoot = join(workOnly, '.agents/kyro/work');
  const savedRoot = join(workOnly, 'saved-work');
  const empty = join(workOnly, 'empty');
  mkdirSync(empty);
  renameSync(workRoot, savedRoot);
  symlinkSync(empty, workRoot);
  expectRootFailure(workOnly, /symbolic link/);
  const status = run(workOnly, 'work', 'status', '--work', 'example');
  assert.notEqual(status.status, 0, 'Work status must reject the unsafe root');
  assert.equal(JSON.parse(status.stdout).error.code, 'INVALID_INPUT');
  rmSync(workRoot);
  writeFileSync(workRoot, 'not a directory\n');
  expectRootFailure(workOnly, /not a directory/);
  rmSync(workRoot);
  renameSync(savedRoot, workRoot);
  assert(workChecks(workOnly).some((line) => line.startsWith('[PASS] Work example promotion:')), 'restored Work root must be healthy');

  chmodSync(workRoot, 0o000);
  try {
    let listingDenied = false;
    try { readdirSync(workRoot); } catch { listingDenied = true; }
    if (listingDenied) expectRootFailure(workOnly, /cannot safely list/);
  } finally {
    chmodSync(workRoot, 0o700);
  }
  unchanged(workOnly, workBefore);

  const workAndForge = workspace();
  forgeScope(workAndForge);
  createWork(workAndForge);
  const bothBefore = snapshot(workAndForge, true);
  assert(workChecks(workAndForge).some((line) => line.startsWith('[PASS] Work example promotion:')), 'Work must be audited alongside Forge');
  const bothRoot = join(workAndForge, '.agents/kyro/work');
  renameSync(bothRoot, join(workAndForge, 'saved-work'));
  symlinkSync(join(workAndForge, 'empty'), bothRoot);
  expectRootFailure(workAndForge, /symbolic link/);
  unchanged(workAndForge, bothBefore);

  // Authored and fixed historical documents remain read-only under doctor.
  const authored = workspace();
  configureCreator(authored, 'Doctor creator', 'doctor@example.test');
  createWork(authored);
  const authoredPath = join(authored, '.agents/kyro/work/example/work.json');
  const authoredBytes = readFileSync(authoredPath);
  assert(workChecks(authored).some((line) => line.startsWith('[PASS] Work example promotion:')));
  assert.deepEqual(readFileSync(authoredPath), authoredBytes);
  const malformed = JSON.parse(authoredBytes); malformed.author = null;
  writeFileSync(authoredPath, JSON.stringify(malformed));
  assert(workChecks(authored).some((line) => line.startsWith('[FAIL] Work example promotion:') && line.includes('author')));
  assert.equal(readFileSync(authoredPath, 'utf8'), JSON.stringify(malformed));
  const historical = workspace();
  writeFileSync(join(historical, 'brief.md'), '# Historical Work\n\nPreserve a historical outcome.\n');
  seedLegacyWork(historical, 'example');
  configureCreator(historical, 'Later identity', 'later@example.test');
  const historicalPath = join(historical, '.agents/kyro/work/example/work.json');
  const legacyArgs = (verb, ...extra) => [verb, '--work', 'example', ...extra];
  const unchangedReads = () => {
    const bytes = readFileSync(historicalPath);
    assert(workChecks(historical).some((line) => line.startsWith('[PASS] Work example promotion:')));
    for (const verb of ['status', 'context-pack']) {
      const result = run(historical, 'work', ...legacyArgs(verb));
      assert.equal(result.status, 0, result.stdout || result.stderr);
      assert.equal(Object.hasOwn(JSON.parse(result.stdout).data.work, 'author'), false);
    }
    assert.deepEqual(readFileSync(historicalPath), bytes);
    assert.equal(Object.hasOwn(JSON.parse(bytes), 'author'), false);
  };
  unchangedReads();
  const plan = { tasks: [{ id: 'W1', title: 'Historical task', description: 'Deliver the historical task.', context: '', filesToTouch: [], acceptanceCriteria: ['Task transfers.'], dependsOn: [] }] };
  writeFileSync(join(historical, 'plan.json'), JSON.stringify(plan));
  const mutate = (...args) => { const result = run(historical, 'work', ...args); assert.equal(result.status, 0, result.stdout || result.stderr); unchangedReads(); };
  mutate(...legacyArgs('plan', '--from', 'plan.json', '--expect-revision', '1'));
  mutate(...legacyArgs('close', '--outcome', 'stopped', '--reason', 'Historical stop.', '--by', 'Closer', '--expect-revision', '2', '--yes'));
  mutate(...legacyArgs('promote', '--to-scope', 'historical-scope', '--by', 'Promoter', '--expect-revision', '3', '--yes'));

  const unsafeAncestor = workspace();
  createWork(unsafeAncestor);
  const ancestor = join(unsafeAncestor, '.agents/kyro');
  renameSync(ancestor, join(unsafeAncestor, 'saved-kyro'));
  symlinkSync(join(unsafeAncestor, 'saved-kyro'), ancestor);
  const ancestorDoctor = run(unsafeAncestor, 'doctor', '--artifacts');
  assert.notEqual(ancestorDoctor.status, 0, 'an unsafe managed-path ancestor must fail doctor');
  const ancestorEnvelope = JSON.parse(ancestorDoctor.stdout);
  assert.equal(ancestorEnvelope.ok, false);
  assert.equal(ancestorEnvelope.error.code, 'INVALID_INPUT');
  assert.match(ancestorEnvelope.error.message, /symbolic link/);

  console.log('Work artifact doctor root discovery, Work-only, unsafe-path, and Forge-isolation fixtures passed.');
} finally {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
}
