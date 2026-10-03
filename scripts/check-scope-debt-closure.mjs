#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const repo = resolve(fileURLToPath(import.meta.url), '../..');
const cli = join(repo, 'dist/cli.js');
const fixture = join(repo, 'fixtures/evals/close-sprint-happy/state');
const { sha256 } = createRequire(import.meta.url)(join(repo, 'dist/cli/core/digest.js'));
const roots = [];
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
const save = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
const sprintPath = (root) => join(root, '.agents/kyro/scopes/demo/sprint.json');
const sprint = (root) => json(sprintPath(root));
const complete = (...args) => ['scope', 'complete', '--kyro-scope', 'demo', ...args];
function run(root, args, expected = 0, env = {}) {
  const result = spawnSync(process.execPath, [cli, ...args, '--json'], { cwd: root, encoding: 'utf8', env: { ...process.env, HOME: join(root, '.home'), KYRO_TRACE: '0', OPENSSL_CONF: '/dev/null', ...env } });
  if (result.error) throw result.error;
  assert.equal(result.status, expected, `${args.join(' ')}: ${result.stdout}${result.stderr}`);
  return JSON.parse(result.stdout);
}
function workspace(beforeCloseAction) {
  const root = mkdtempSync(join(tmpdir(), 'kyro-scope-debt-'));
  roots.push(root);
  cpSync(fixture, root, { recursive: true });
  mkdirSync(join(root, '.home'), { recursive: true });
  run(root, ['debt', 'add', '--title', 'Owner-controlled follow-up', '--priority', 'low', '--kyro-scope', 'demo']);
  if (beforeCloseAction) run(root, ['debt', beforeCloseAction, 'debt-1', ...(beforeCloseAction === 'defer' ? ['--target', '2', '--note', 'Owner deferred before close.'] : []), '--kyro-scope', 'demo']);
  run(root, ['close-sprint', '--kyro-scope', 'demo', '--outcome', 'shipped', '--yes']);
  return root;
}
function immutable(root) {
  const archive = join(root, '.agents/kyro/scopes/demo/archive');
  return Object.fromEntries(readdirSync(archive).filter((name) => /\.(json|md)$/.test(name)).map((name) => [name, readFileSync(join(archive, name), 'utf8')]));
}
function managed(root) {
  const snapshot = {};
  function walk(path) { for (const item of readdirSync(path, { withFileTypes: true })) { const child = join(path, item.name); if (item.isDirectory()) walk(child); else snapshot[child.slice(root.length)] = readFileSync(child, 'utf8'); } }
  walk(join(root, '.agents/kyro'));
  return snapshot;
}
function rejectWithoutWrites(root, args, code) {
  const before = managed(root);
  const result = run(root, args, 1);
  if (code) assert.equal(result.error.code, code, JSON.stringify(result));
  assert.deepEqual(managed(root), before, 'rejected request changed managed state');
}
function preview(root, args) {
  const before = managed(root);
  const result = run(root, complete(...args, '--dry-run'));
  assert.deepEqual(managed(root), before, 'preview must be read-only');
  const digest = result.data.output.join('\n').match(/Plan digest: ([a-f0-9]{64})/)[1];
  return digest;
}
function healthy(root) {
  const inspect = run(root, ['scope', 'inspect', 'demo']);
  assert(!inspect.data.output.some((line) => line.includes('[FAIL]')), JSON.stringify(inspect));
  const status = run(root, ['status', '--kyro-scope', 'demo']);
  assert.notEqual(status.data.verification?.state, 'diverged', JSON.stringify(status));
  const repair = run(root, ['repair', 'integrity', 'prepare', '--kyro-scope', 'demo']);
  assert.deepEqual(repair.data.blockers, [], JSON.stringify(repair));
}
try {
  for (const action of ['resolve', 'defer']) {
    const beforeClose = workspace(action);
    run(beforeClose, complete('--yes'));
    healthy(beforeClose);
    assert.equal(action === 'defer' ? 'deferred' : 'resolved', sprint(beforeClose).debt[0].status);
  }
  // Official post-close commands are replayable, including completion/reopen between records.
  const root = workspace();
  const original = immutable(root);
  run(root, ['debt', 'defer', 'debt-1', '--target', '2', '--note', 'Owner deferred this work.', '--kyro-scope', 'demo']);
  run(root, ['debt', 'resolve', 'debt-1', '--note', 'No longer needed.', '--kyro-scope', 'demo']);
  assert.equal(sprint(root).remediations.length, 2);
  healthy(root);
  run(root, complete('--yes'));
  healthy(root);
  const interruptedDebt = workspace();
  const resolveDebt = ['debt', 'resolve', 'debt-1', '--note', 'Close the follow-up.', '--kyro-scope', 'demo'];
  run(interruptedDebt, resolveDebt, 1, { KYRO_TEST_REMEDIATION_FAIL_AFTER: 'record' });
  assert.equal(sprint(interruptedDebt).remediations?.length ?? 0, 0);
  rejectWithoutWrites(interruptedDebt, ['debt', 'defer', 'debt-1', '--target', '2', '--note', 'Different decision.', '--kyro-scope', 'demo']);
  run(interruptedDebt, resolveDebt);
  assert.equal(sprint(interruptedDebt).remediations.length, 1);
  run(interruptedDebt, complete('--yes'));
  healthy(interruptedDebt);
  rejectWithoutWrites(root, ['debt', 'add', '--title', 'Frozen', '--priority', 'low', '--kyro-scope', 'demo'], 'SCOPE_COMPLETED');
  run(root, ['scope', 'reopen', '--kyro-scope', 'demo', '--reason', 'Further work authorized.', '--yes']);
  run(root, ['debt', 'add', '--title', 'Accepted risk', '--priority', 'high', '--kyro-scope', 'demo']);
  run(root, ['debt', 'start', 'debt-2', '--kyro-scope', 'demo']);
  run(root, ['debt', 'escalate', 'debt-2', '--priority', 'critical', '--kyro-scope', 'demo']);
  rejectWithoutWrites(root, complete('--yes'), 'NOT_READY_TO_COMPLETE');
  const acceptance = ['--accept-open-debt', '--reason', 'Owner accepts the remaining risk.'];
  const digest = preview(root, acceptance);
  run(root, complete(...acceptance, '--expect-digest', digest, '--yes'));
  assert.equal(sprint(root).debt[1].status, 'in_progress');
  assert.equal(sprint(root).completion.debtAcceptance.items[0].id, 'debt-2');
  const status = run(root, ['status', '--kyro-scope', 'demo']);
  assert.equal(status.data.completion.debtAcceptance.reason, acceptance[2]);
  healthy(root);
  assert.deepEqual(immutable(root), original);
  rejectWithoutWrites(root, ['debt', 'resolve', 'debt-2', '--kyro-scope', 'demo'], 'SCOPE_COMPLETED');
  run(root, ['scope', 'reopen', '--kyro-scope', 'demo', '--reason', 'Resolve accepted debt.', '--yes']);
  run(root, ['debt', 'resolve', 'debt-2', '--kyro-scope', 'demo']);
  run(root, complete('--yes'));
  healthy(root);


  // A later sprint seals the existing history prefix; only its subsequent suffix is replayed.
  run(root, ['scope', 'reopen', '--kyro-scope', 'demo', '--reason', 'Authorize a real second sprint.', '--yes']);
  const secondPlan = join(root, 'second-plan.json');
  save(secondPlan, { sprint: { n: 2, slug: 'follow-up', title: 'Follow-up', objective: 'Authorized follow-up.' }, phases: [{ id: 'P2', title: 'Follow-up', objective: 'Follow-up.', tasks: [{ id: 'T2.1', title: 'Follow-up task', description: 'Check the follow-up.', files_to_touch: ['src/demo.ts'], context: 'Owner-authorized work.', acceptance_criteria: ['Follow-up checked.'], depends_on: [], scenario_refs: [] }] }], definitionOfDone: ['Follow-up checked.'], scenarios: [] });
  run(root, ['plan', '--from', secondPlan, '--kyro-scope', 'demo']);
  rejectWithoutWrites(root, complete('--accept-open-debt', '--reconcile-debt', '--reason', 'Cannot skip active work.', '--dry-run'), 'NOT_READY_TO_COMPLETE');
  healthy(root);
  run(root, ['record-evidence', 'T2.1', '--summary', 'Owner discarded the follow-up.', '--validation', 'Explicit owner decision.', '--disposition', 'cancelled', '--reason', 'Owner explicitly discarded follow-up.', '--kyro-scope', 'demo']);
  run(root, ['close-sprint', '--kyro-scope', 'demo', '--outcome', 'partial', '--yes']);
  const sealedArchive = immutable(root);
  run(root, ['debt', 'add', '--title', 'Second-sprint decision', '--priority', 'low', '--kyro-scope', 'demo']);
  run(root, ['debt', 'resolve', 'debt-3', '--kyro-scope', 'demo']);
  run(root, complete('--yes'));
  healthy(root);
  assert.deepEqual(immutable(root), sealedArchive);
  for (const [name, bytes] of Object.entries(original)) assert.equal(sealedArchive[name], bytes);

  // Reproduce the old CLI's unrecorded defer/resolve; reconcile and complete in one resumable request.
  const legacy = workspace();
  const archive = immutable(legacy);
  const changed = sprint(legacy);
  changed.debt[0] = { ...changed.debt[0], status: 'resolved', targetSprint: 2, note: 'Owner no longer needs this work.' };
  save(sprintPath(legacy), changed);
  rejectWithoutWrites(legacy, complete('--yes'), 'DIVERGED');
  const repair = run(legacy, ['repair', 'integrity', 'prepare', '--kyro-scope', 'demo']);
  assert(repair.data.blockers.some((item) => item.summary.includes('debt') && item.summary.includes('--reconcile-debt')));
  const recovery = ['--reconcile-debt', '--reason', 'Confirm the observed debt decision.'];
  rejectWithoutWrites(legacy, complete('--reconcile-debt', '--dry-run'), 'INVALID_INPUT');
  rejectWithoutWrites(legacy, complete('--accept-open-debt', '--dry-run'), 'INVALID_INPUT');
  rejectWithoutWrites(legacy, complete(...recovery, '--yes'), 'INVALID_INPUT');
  const stale = preview(legacy, recovery);
  const newer = sprint(legacy); newer.debt[0].note += ' Updated.'; save(sprintPath(legacy), newer);
  rejectWithoutWrites(legacy, complete(...recovery, '--expect-digest', stale, '--yes'), 'STATE_DIVERGED');
  const approved = preview(legacy, recovery);
  const apply = complete(...recovery, '--expect-digest', approved, '--yes');
  run(legacy, apply, 1, { KYRO_TEST_REMEDIATION_FAIL_AFTER: 'record' });
  assert.equal(sprint(legacy).remediations?.length ?? 0, 0);
  rejectWithoutWrites(legacy, complete('--reconcile-debt', '--reason', 'Different authorization.', '--expect-digest', approved, '--yes'));
  run(legacy, apply, 1, { KYRO_TEST_COMPLETE_FAIL_AFTER: 'reconciliation' });
  assert.equal(sprint(legacy).remediations.length, 1);
  run(legacy, apply, 1, { KYRO_TEST_COMPLETE_FAIL_AFTER: 'sprint' });
  const frozenCompletion = sprint(legacy).completion;
  run(legacy, apply);
  run(legacy, apply);
  assert.deepEqual(sprint(legacy).completion, frozenCompletion);
  assert.equal(sprint(legacy).remediations.length, 1);
  healthy(legacy);
  assert.deepEqual(immutable(legacy), archive);

  // Recovery and debt acceptance are independent, and neither hides unrelated drift.
  const pending = workspace();
  const live = sprint(pending); live.debt[0].status = 'in_progress'; save(sprintPath(pending), live);
  rejectWithoutWrites(pending, complete(...recovery, '--dry-run'), 'NOT_READY_TO_COMPLETE');
  const combined = [...recovery, '--accept-open-debt'];
  const combinedDigest = preview(pending, combined);
  run(pending, complete(...combined, '--expect-digest', combinedDigest, '--yes'));
  healthy(pending);
  const tamperedCompletion = sprint(pending);
  tamperedCompletion.debt[0].note = 'Unrecorded edit after completion';
  save(sprintPath(pending), tamperedCompletion);
  rejectWithoutWrites(pending, complete(...combined, '--expect-digest', combinedDigest, '--yes'), 'DIVERGED');
  const addition = workspace();
  const added = sprint(addition);
  added.debt[0].status = 'resolved';
  added.debt.push({ id: 'debt-2', title: 'Canonical unrecorded addition', origin: 1, priority: 'critical', status: 'open', targetSprint: null, note: '' });
  save(sprintPath(addition), added);
  const additionDigest = preview(addition, combined);
  run(addition, complete(...combined, '--expect-digest', additionDigest, '--yes'));
  assert.equal(sprint(addition).completion.debtAcceptance.items[0].id, 'debt-2');
  healthy(addition);
  const reordered = workspace();
  run(reordered, ['debt', 'add', '--title', 'Second tracked debt', '--priority', 'low', '--kyro-scope', 'demo']);
  const swapped = sprint(reordered); swapped.debt.reverse(); save(sprintPath(reordered), swapped);
  rejectWithoutWrites(reordered, complete(...combined, '--dry-run'), 'DIVERGED');
  for (const mutation of ['title', 'origin', 'objective', 'delete', 'checkpoint']) {
    const bad = workspace();
    const data = sprint(bad);
    data.debt[0].status = 'resolved';
    if (mutation === 'title') data.debt[0].title = 'Changed identity metadata';
    if (mutation === 'origin') data.debt[0].origin = 2;
    if (mutation === 'objective') data.objective = 'Unrelated drift';
    if (mutation === 'delete') data.debt = [];
    save(sprintPath(bad), data);
    if (mutation === 'checkpoint') {
      const path = join(bad, '.agents/kyro/scopes/demo/archive', Object.keys(immutable(bad)).find((name) => name.endsWith('.checkpoint.json')));
      const checkpoint = json(path); checkpoint.createdAt = '2020-01-01T00:00:00Z'; save(path, checkpoint);
    }
    rejectWithoutWrites(bad, complete(...combined, '--dry-run'));
  }
  // A freshly recomputed external commitment cannot authorize a forged v5 transition.
  const mixedDrift = workspace();
  const mixed = sprint(mixedDrift);
  mixed.debt[0].status = 'resolved';
  mixed.conventions.push({ id: 'C1', rule: 'Observed convention after close.', tags: ['fixture'], addedSprint: 1 });
  save(sprintPath(mixedDrift), mixed);
  const mixedRepair = run(mixedDrift, ['repair', 'integrity', 'prepare', '--kyro-scope', 'demo']);
  assert(mixedRepair.data.blockers.some((item) => item.summary.includes('debt')), 'a supported convention append must not hide unexplained debt drift');
  for (const mutation of ['collection', 'action', 'base', 'checkpoint-precondition']) {
    const bad = workspace();
    run(bad, ['debt', 'resolve', 'debt-1', '--kyro-scope', 'demo']);
    const recordPath = join(bad, '.agents/kyro/scopes/demo/archive/remediations/remediation-001.json');
    const record = json(recordPath);
    if (mutation === 'collection') record.operations[0].expectedDebtCollectionSha256 = 'a'.repeat(64);
    if (mutation === 'action') record.operations[0].action = 'start';
    if (mutation === 'base') record.base.stateSha256 = 'b'.repeat(64);
    if (mutation === 'checkpoint-precondition') record.base.checkpoints = [];
    save(recordPath, record);
    const data = sprint(bad); data.remediations[0].commitment = sha256(record); save(sprintPath(bad), data);
    rejectWithoutWrites(bad, complete(...combined, '--dry-run'), 'DIVERGED');
    const status = run(bad, ['status', '--kyro-scope', 'demo']);
    assert.equal(status.data.verification.state, 'diverged');
  }
  console.log('Scope debt closure checks passed: post-close transitions, acceptance, recovery, replay, frozen completion, stale inputs and immutable history.');
} finally {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
}
