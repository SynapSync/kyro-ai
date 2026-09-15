#!/usr/bin/env node
// Active-plan changes are prepared read-only and atomically committed with invalidation.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const repo = resolve(fileURLToPath(import.meta.url), '../..');
const cli = join(repo, 'dist/cli.js');
const roots = [];
const scope = 'demo';
const sprintPath = (r) => join(r, '.agents/kyro/scopes/demo/sprint.json');
const read = (r) => JSON.parse(readFileSync(sprintPath(r), 'utf8'));
const save = (r, s) => writeFileSync(sprintPath(r), JSON.stringify(s, null, 2));
const task = (r, id = 'T1.1') => read(r).activeSprint.phases[0].tasks.find((t) => t.id === id);
const run = (r, args, extra = {}) => spawnSync(process.execPath, [cli, ...args], { cwd: r, env: { ...process.env, HOME: join(r, '.home'), ...extra }, encoding: 'utf8', timeout: 20000 });
function ok(r, args) { const p = run(r, args); assert.equal(p.status, 0, p.stdout + p.stderr); return p; }
function data(p) { return JSON.parse(p.stdout).data; }
function tree(root, dir = root) {
  return readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap((e) => e.isDirectory()
    ? tree(root, join(dir, e.name)) : [[join(dir, e.name).slice(root.length), readFileSync(join(dir, e.name), 'base64')]]);
}
function sandbox() {
  const r = mkdtempSync(join(tmpdir(), 'kyro-active-plan-')); roots.push(r);
  cpSync(join(repo, 'fixtures/evals/route-review-task/state'), r, { recursive: true });
  mkdirSync(join(r, '.home'));
  const s = read(r);
  const first = s.activeSprint.phases[0].tasks[0]; first.scenario_refs = ['S1'];
  const second = structuredClone(first); second.id = 'T1.2'; second.depends_on = ['T1.1']; second.scenario_refs = ['S2'];
  const third = structuredClone(first); third.id = 'T1.3'; third.depends_on = []; third.scenario_refs = ['S3'];
  s.activeSprint.phases[0].tasks.push(second, third);
  s.spec = { requirements: [{ id: 'R1', statement: 'First behavior' }, { id: 'R2', statement: 'Other behavior' }], scenarios: [
    { id: 'S1', requirement: 'R1', given: 'input', when: 'first action', then: 'first result' },
    { id: 'S2', requirement: 'R1', given: 'first result', when: 'dependent action', then: 'second result' },
    { id: 'S3', requirement: 'R2', given: 'other input', when: 'other action', then: 'other result' },
  ], nonGoals: ['Do not change historical work'], openQuestions: [] };
  s.handoff.nextAction = 'execute_task'; save(r, s); return r;
}
function input(r, patch = {}) {
  const s = read(r), active = s.activeSprint ?? { n: 1, slug: 'demo-sprint' };
  const value = { sprint: { n: active.n, slug: active.slug }, reason: 'Correct the active task contract', tasks: [{ id: 'T1.1', context: 'Updated active implementation context' }], ...patch };
  const file = join(r, 'active-input.json'); writeFileSync(file, JSON.stringify(value)); return file;
}
const base = (file) => ['plan', '--update-active', '--kyro-scope', scope, '--from', file];
function preview(r, file) { return data(ok(r, [...base(file), '--dry-run', '--json'])); }
function apply(r, file, digest) { return data(ok(r, [...base(file), '--digest', digest, '--yes', '--json'])); }
function refuse(r, args, code) {
  const before = tree(r); const p = run(r, [...args, '--json']);
  assert.equal(p.status, 1, p.stdout + p.stderr);
  if (code) assert.equal(JSON.parse(p.stdout).error?.code, code, p.stdout + p.stderr);
  assert.deepEqual(tree(r), before, 'refusal changed workspace files');
}
function finish(r, id) {
  // Fixture check really performed; this is not evidence for a product implementation.
  const current = task(r, id); assert(current.acceptance_criteria.length > 0);
  ok(r, ['record-evidence', id, '--kyro-scope', scope, '--summary', 'Fixture contract checked', '--validation', 'Node assert: fixture acceptance criteria are non-empty', '--notes', 'Existing QA obligation, if any, remains unchanged']);
  ok(r, ['review', id, '--kyro-scope', scope, '--verdict', 'pass', '--yes']);
}
let checks = 0;
function check(label, fn) { fn(); checks++; console.log(`  ok ${label}`); }
try {
  check('pending/in-progress edits; zero-write preview; exact diff; no new certification', () => {
    const r = sandbox(); const s = read(r); s.activeSprint.phases[0].tasks[0].status = 'in_progress'; s.activeSprint.phases[0].status = 'active'; s.activeSprint.status = 'executing'; save(r, s);
    const file = input(r, { tasks: [{ id: 'T1.1', context: 'Changed context' }, { id: 'T1.3', acceptance_criteria: ['New criterion'] }] });
    const before = tree(r); const p = preview(r, file); assert.deepEqual(tree(r), before); assert.equal(preview(r, file).digest, p.digest);
    assert(p.changes.some((c) => c.field === 'acceptance_criteria' && c.before[0] === 'Validation passes.'));
    apply(r, file, p.digest); const next = read(r);
    assert.equal(task(r).status, 'in_progress'); assert.equal(task(r, 'T1.3').status, 'pending');
    for (const key of ['ledger', 'debt', 'roadmap', 'previousSprint', 'spec']) assert.deepEqual(next[key], s[key]);
    assert.equal(next.certifications, undefined); assert.equal(task(r).verdict, null);
    const after = tree(r); const noop = preview(r, file); assert.equal(noop.changes.length, 0); assert.equal(apply(r, file, noop.digest).outcome, 'noop'); assert.deepEqual(tree(r), after);
  });
  check('done/pass → same-ID rework; transitive invalidation; unrelated evidence preserved', () => {
    const r = sandbox(), initial = read(r);
    const downstream = structuredClone(task(r, 'T1.2')); downstream.id = 'T1.4'; downstream.depends_on = ['T1.2'];
    initial.activeSprint.phases[0].tasks.push(downstream); save(r, initial);
    for (const id of ['T1.1', 'T1.2', 'T1.3', 'T1.4']) finish(r, id);
    const before = read(r), untouched = task(r, 'T1.3'); const file = input(r), p = preview(r, file);
    assert.deepEqual(p.affectedTaskIds, ['T1.1', 'T1.2', 'T1.4']); assert.deepEqual(p.invalidatedTaskIds, ['T1.1', 'T1.2', 'T1.4']);
    apply(r, file, p.digest); assert.equal(task(r).status, 'pending'); assert.equal(task(r).verdict, null);
    assert.deepEqual(task(r).evidence, before.activeSprint.phases[0].tasks[0].evidence); assert.deepEqual(task(r, 'T1.3'), untouched);
    const close = run(r, ['close-sprint', '--kyro-scope', scope, '--dry-run']); assert.equal(close.status, 1);
    finish(r, 'T1.1'); finish(r, 'T1.2'); finish(r, 'T1.4'); ok(r, ['analyze', '--kyro-scope', scope]);
    assert.equal(read(r).handoff.nextAction, 'qa_or_close'); assert.equal(read(r).activeSprint.phases[0].tasks.length, 4);
  });
  check('active update preserves the existing next executable route over an affected dependent', () => {
    const r = sandbox(), file = input(r, { tasks: [{ id: 'T1.2', context: 'Dependent correction' }] });
    const p = preview(r, file);
    assert.equal(p.changes.some((c) => c.target === 'handoff' && c.field === 'nextTaskId'), false);
    apply(r, file, p.digest); assert.equal(read(r).handoff.nextTaskId, 'T1.1');
  });
  check('active emergent tasks keep membership, identity and unrelated custom fields', () => {
    const r = sandbox(), s = read(r), emergent = structuredClone(task(r));
    emergent.id = 'E1'; emergent.customMetadata = { original: true };
    s.activeSprint.emergentTasks.push(emergent); save(r, s);
    const file = input(r, { tasks: [{ id: 'E1', context: 'Correct emergent definition' }] });
    apply(r, file, preview(r, file).digest);
    const updated = read(r).activeSprint.emergentTasks;
    assert.equal(updated.length, 1); assert.equal(updated[0].id, 'E1'); assert.equal(updated[0].context, 'Correct emergent definition');
    assert.deepEqual(updated[0].customMetadata, emergent.customMetadata);
    assert.deepEqual(read(r).activeSprint.phases[0].tasks, s.activeSprint.phases[0].tasks);
  });
  check('shared active requirement/scenario consumers invalidate; new definitions supported', () => {
    const r = sandbox(); for (const id of ['T1.1', 'T1.2', 'T1.3']) finish(r, id);
    const file = input(r, { tasks: [], requirements: [{ id: 'R1', statement: 'Revised requirement' }] });
    const p = preview(r, file); assert.deepEqual(p.affectedTaskIds, ['T1.1', 'T1.2']); apply(r, file, p.digest);
    const addition = input(r, { tasks: [{ id: 'T1.1', scenario_refs: ['S4'] }], requirements: [{ id: 'R3', statement: 'New active requirement' }], scenarios: [{ id: 'S4', requirement: 'R3', given: 'input', when: 'action', then: 'new result' }] });
    apply(r, addition, preview(r, addition).digest); assert.equal(read(r).spec.requirements.length, 3);
  });
  check('strict input/ref/DAG validation and unchanged default plan semantics', () => {
    for (const patch of [
      { tasks: [{ id: 'T1.1', status: 'done' }] }, { tasks: [{ id: 'T1.1', verdict: null }] },
      { tasks: [{ id: 'T1.1', context: 42 }] }, { tasks: [{ id: 'T1.1', acceptance_criteria: [] }] },
      { tasks: [{ id: 'T1.1', context: 'a' }, { id: 'T1.1', context: 'b' }] },
      { tasks: [{ id: 'T9.9', context: 'unknown' }] }, { tasks: [{ id: 'T1.1', depends_on: ['missing'] }] },
      { tasks: [{ id: 'T1.1', depends_on: ['T1.2'] }] }, { tasks: [{ id: 'T1.1', scenario_refs: ['missing'] }] },
      { scenarios: [{ id: 'S4', requirement: 'missing', given: 'a', when: 'b', then: 'c' }] },
      { ledger: [] }, { reason: ' ' }, { scope: 'another' }, { sprint: { n: 99, slug: 'old' } },
      { scenarios: [{ id: 'S1', requirement: 'R2', given: 'a', when: 'b', then: 'c' }] },
    ]) { const r = sandbox(); const file = input(r, patch); refuse(r, [...base(file), '--dry-run']); }
    const r = sandbox(), file = input(r); refuse(r, ['plan', '--kyro-scope', scope, '--from', file, '--dry-run'], 'SPRINT_ALREADY_ACTIVE');
    refuse(r, [...base(file)], 'CONFIRMATION_REQUIRED'); refuse(r, [...base(file), '--dry-run', '--yes'], 'INVALID_INPUT');
  });
  check('spec references without a spec still fail at the central analysis boundary', () => {
    const r = sandbox(), s = read(r); delete s.spec;
    for (const t of s.activeSprint.phases[0].tasks) t.scenario_refs = [];
    save(r, s);
    const file = input(r, { tasks: [{ id: 'T1.1', scenario_refs: ['missing'] }] });
    refuse(r, [...base(file), '--dry-run'], 'BLOCKING_FINDINGS');
  });
  check('stale previews cannot overwrite task, input or project policy changes', () => {
    const r = sandbox(), file = input(r), p = preview(r, file);
    ok(r, ['record-evidence', 'T1.3', '--kyro-scope', scope, '--summary', 'Concurrent fixture check', '--validation', 'fixture checked']);
    refuse(r, [...base(file), '--digest', p.digest, '--yes']);
    finish(r, 'T1.3'); const fresh = preview(r, file); input(r, { reason: 'Different request' }); refuse(r, [...base(file), '--digest', fresh.digest, '--yes'], 'STATE_DIVERGED');
    const newer = preview(r, file); writeFileSync(join(r, '.agents/kyro/policy.json'), JSON.stringify({ policyVersion: 1, operations: {}, allow: [], maker_checker: { requireSeparateChecker: true } }));
    refuse(r, [...base(file), '--digest', newer.digest, '--yes'], 'STATE_DIVERGED');
  });
  check('closed/shipped/archived tasks immutable; active successor does not rewrite old spec', () => {
    const r = sandbox(); for (const id of ['T1.1', 'T1.2', 'T1.3']) finish(r, id);
    ok(r, ['close-sprint', '--kyro-scope', scope, '--outcome', 'shipped', '--yes']);
    const archives = tree(r, join(r, '.agents/kyro/scopes/demo/archive'));
    refuse(r, [...base(input(r)), '--dry-run'], 'NO_ACTIVE_SPRINT');
    const plan = { sprint: { n: 2, slug: 'next', title: 'Next', objective: 'Current work' }, phases: [{ id: 'P2', title: 'Next', objective: 'Next', tasks: [{ id: 'T2.1', title: 'Current task', description: 'Current work', files_to_touch: [], context: 'New context', acceptance_criteria: ['Works'], depends_on: [], scenario_refs: ['S1'] }] }], definitionOfDone: ['Reviewed'], scenarios: [] };
    const nextFile = join(r, 'next.json'); writeFileSync(nextFile, JSON.stringify(plan)); ok(r, ['plan', '--kyro-scope', scope, '--from', nextFile]);
    const file = input(r, { tasks: [{ id: 'T2.1', context: 'Updated current context' }] }); apply(r, file, preview(r, file).digest);
    assert.deepEqual(tree(r, join(r, '.agents/kyro/scopes/demo/archive')), archives);
    refuse(r, [...base(input(r, { tasks: [{ id: 'T1.1', context: 'Historical edit' }] })), '--dry-run'], 'TASK_NOT_FOUND');
    refuse(r, [...base(input(r, { tasks: [], scenarios: [{ id: 'S1', requirement: 'R1', given: 'new', when: 'action', then: 'result' }] })), '--dry-run'], 'CHECKPOINT_CONFLICT');
    refuse(r, [...base(input(r, { tasks: [], requirements: [{ id: 'R1', statement: 'Historical rewrite' }] })), '--dry-run'], 'CHECKPOINT_CONFLICT');
    // A legacy ledger has weaker mapping proof: task-only work is allowed, shared rewrites are not.
    const legacy = read(r); delete legacy.ledger[0].checkpoint; save(r, legacy);
    preview(r, input(r, { tasks: [{ id: 'T2.1', context: 'Legacy active correction' }] }));
    refuse(r, [...base(input(r, { tasks: [], requirements: [{ id: 'R1', statement: 'Unknown historical mapping' }] })), '--dry-run'], 'CHECKPOINT_CONFLICT');
    const snapshot = join(r, '.agents/kyro/scopes/demo', legacy.ledger[0].snapshot);
    writeFileSync(snapshot, 'null');
    refuse(r, [...base(input(r, { tasks: [{ id: 'T2.1', context: 'Corrupt history correction' }] })), '--dry-run'], 'CHECKPOINT_CORRUPT');
  });
  check('completed/retired parent denied, prepared close denied', () => {
    for (const terminal of ['completed', 'retired']) {
      const r = sandbox(); const s = read(r); s.status = terminal; save(r, s); refuse(r, [...base(input(r)), '--dry-run']);
    }
    const r = sandbox(); for (const id of ['T1.1', 'T1.2', 'T1.3']) finish(r, id);
    const failed = run(r, ['close-sprint', '--kyro-scope', scope, '--yes'], { KYRO_TEST_CLOSE_FAIL_AFTER: 'checkpoint' }); assert.equal(failed.status, 1);
    refuse(r, [...base(input(r)), '--dry-run'], 'CHECKPOINT_CONFLICT');
  });
  check('disposed task definition does not reopen execution', () => {
    const r = sandbox(); ok(r, ['record-evidence', 'T1.3', '--kyro-scope', scope, '--summary', 'Fixture cancellation', '--validation', 'Fixture cancellation requested', '--disposition', 'cancelled', '--reason', 'Fixture decision']);
    const before = task(r, 'T1.3'); const file = input(r, { tasks: [{ id: 'T1.3', context: 'Clarify why cancelled' }] }); apply(r, file, preview(r, file).digest);
    assert.deepEqual(task(r, 'T1.3').disposition, before.disposition); assert.deepEqual(task(r, 'T1.3').evidence, before.evidence);
  });
  check('live stale review blocks analyze/close; context and status agree; no stale digest noop', () => {
    const r = sandbox(); for (const id of ['T1.1', 'T1.2', 'T1.3']) finish(r, id);
    const old = task(r).verdict;
    ok(r, ['record-evidence', 'T1.1', '--kyro-scope', scope, '--summary', 'New fixture evidence', '--validation', 'fixture changed']);
    const analyzed = run(r, ['analyze', '--kyro-scope', scope]); assert.equal(analyzed.status, 1); assert.match(analyzed.stdout, /stale/);
    const pack = data(ok(r, ['context-pack', '--kyro-scope', scope, '--task', 'T1.1', '--json'])); assert.equal(pack.nextTaskReview.hasPassVerdict, false); assert(pack.reviewPending.includes('T1.1'));
    const report = data(ok(r, ['status', 'full', '--kyro-scope', scope, '--json'])); assert(report.reviewDebt.some((t) => t.id === 'T1.1'));
    assert.equal(run(r, ['close-sprint', '--kyro-scope', scope, '--dry-run']).status, 1);
    refuse(r, ['review', 'T1.1', '--kyro-scope', scope, '--verdict', 'pass', '--digest', old.requestDigest, '--yes'], 'REVIEW_REQUEST_DIVERGED');
    ok(r, ['review', 'T1.1', '--kyro-scope', scope, '--verdict', 'pass', '--yes']); ok(r, ['analyze', '--kyro-scope', scope]);
  });
  check('completed scope is immutable and reopening the scope does not resurrect its tasks', () => {
    const r = sandbox(); for (const id of ['T1.1', 'T1.2', 'T1.3']) finish(r, id);
    ok(r, ['close-sprint', '--kyro-scope', scope, '--outcome', 'completed', '--yes']);
    ok(r, ['scope', 'complete', '--kyro-scope', scope, '--yes']);
    refuse(r, [...base(input(r)), '--dry-run'], 'NOT_READY_TO_PLAN');
    ok(r, ['scope', 'reopen', '--kyro-scope', scope, '--reason', 'New work only', '--yes']);
    refuse(r, [...base(input(r)), '--dry-run'], 'NO_ACTIVE_SPRINT');
  });
  check('atomic replacement failure cannot leave changed contract with old approval', () => {
    for (const afterRename of [false, true]) {
      const r = sandbox(); for (const id of ['T1.1', 'T1.2', 'T1.3']) finish(r, id);
      const file = input(r), p = preview(r, file);
      const fault = join(r, 'fault.cjs');
      writeFileSync(fault, `const fs=require('node:fs');const rename=fs.renameSync;fs.renameSync=function(a,b){if(String(b).endsWith('/scopes/demo/sprint.json')){${afterRename ? 'rename(a,b);' : ''}throw Object.assign(new Error('injected rename boundary'),{code:'EIO'});}return rename(a,b);};`);
      const before = tree(r);
      const result = spawnSync(process.execPath, ['--require', fault, cli, ...base(file), '--digest', p.digest, '--yes', '--json'], { cwd: r, env: { ...process.env, HOME: join(r, '.home') }, encoding: 'utf8', timeout: 20000 });
      assert.equal(result.status, 1, result.stdout + result.stderr); assert.equal(JSON.parse(result.stdout).ok, false);
      if (!afterRename) assert.deepEqual(tree(r), before);
      else { assert.equal(task(r).status, 'pending'); assert.equal(task(r).verdict, null); assert.equal(task(r).context, 'Updated active implementation context'); assert.equal(preview(r, file).changes.length, 0); }
    }
  });
  check('unsafe live path is rejected without changing symlink target', () => {
    const r = sandbox(); const target = join(r, 'outside.json'); cpSync(sprintPath(r), target); rmSync(sprintPath(r)); symlinkSync(target, sprintPath(r));
    refuse(r, [...base(input(r)), '--dry-run'], 'INVALID_INPUT');
  });
  // Two real processes race one approved base; the state-writer lease serializes the re-read.
  {
    const r = sandbox(), file = input(r), p = preview(r, file);
    const launch = () => new Promise((resolveRun, reject) => {
      const child = spawn(process.execPath, [cli, ...base(file), '--digest', p.digest, '--yes', '--json'], { cwd: r, env: { ...process.env, HOME: join(r, '.home') }, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '', stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk; }); child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('error', reject); child.on('close', (code) => resolveRun({ code, stdout, stderr }));
    });
    const results = await Promise.all([launch(), launch()]);
    assert.deepEqual(results.map((r) => r.code).sort(), [0, 1], JSON.stringify(results));
    assert.equal(JSON.parse(results.find((r) => r.code === 1).stdout).error.code, 'STATE_DIVERGED');
    assert.equal(existsSync(join(r, '.kyro-state-writer.lock')), false);
    checks++; console.log('  ok concurrent apply processes: one winner, one stale-preview refusal');
  }
} finally { for (const r of roots) rmSync(r, { recursive: true, force: true }); }
console.log(`check:active-plan — ${checks} active-edit, freshness and immutable-history groups passed`);
