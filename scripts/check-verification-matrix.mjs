#!/usr/bin/env node
// analyze --matrix is a read-only display: levels from stored data only, tolerant history, zero writes, no gate.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const repo = resolve(fileURLToPath(import.meta.url), '../..');
const cli = join(repo, 'dist/cli.js');
const roots = [];
const scope = 'demo';
const NOTE = 'Verdict recorded ≠ independent review: maker/checker identity is self-declared and not verified by Kyro.';
const scopeDir = (r) => join(r, '.agents/kyro/scopes/demo');
const sprintPath = (r) => join(scopeDir(r), 'sprint.json');
const read = (r) => JSON.parse(readFileSync(sprintPath(r), 'utf8'));
const save = (r, s) => writeFileSync(sprintPath(r), JSON.stringify(s, null, 2));
const run = (r, args) => spawnSync(process.execPath, [cli, ...args], { cwd: r, env: { ...process.env, HOME: join(r, '.home') }, encoding: 'utf8', timeout: 20000 });
function ok(r, args) { const p = run(r, args); assert.equal(p.status, 0, p.stdout + p.stderr); return p; }
function tree(root, dir = root) {
  return readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap((e) => e.isDirectory()
    ? tree(root, join(dir, e.name)) : [[join(dir, e.name).slice(root.length), readFileSync(join(dir, e.name), 'base64')]]);
}
/** Runs text and JSON matrix, asserts exit 0 and a byte-identical workspace (including HOME), returns JSON data. */
function matrix(r) {
  const before = tree(r);
  const text = ok(r, ['analyze', '--matrix', '--kyro-scope', scope]).stdout;
  const json = JSON.parse(ok(r, ['analyze', '--matrix', '--kyro-scope', scope, '--json']).stdout);
  assert.deepEqual(tree(r), before, 'analyze --matrix changed workspace files');
  assert.equal(json.ok, true); assert.equal(json.command, 'analyze'); assert.equal(json.phase, 'result');
  return { text, data: json.data };
}
const row = (m, id) => m.data.scenarios.find((s) => s.id === id);
function sandbox(scenarioIds, taskRefs) {
  const r = mkdtempSync(join(tmpdir(), 'kyro-matrix-')); roots.push(r);
  cpSync(join(repo, 'fixtures/evals/route-review-task/state'), r, { recursive: true });
  mkdirSync(join(r, '.home'));
  const s = read(r), first = s.activeSprint.phases[0].tasks[0];
  s.activeSprint.phases[0].tasks = Object.entries(taskRefs).map(([id, refs]) => ({ ...structuredClone(first), id, depends_on: [], scenario_refs: refs }));
  s.spec = { requirements: [{ id: 'R1', statement: 'First' }, { id: 'R2', statement: 'Second' }], scenarios: scenarioIds.map((id, i) => ({ id, requirement: i % 2 ? 'R2' : 'R1', given: 'g', when: 'w', then: 't' })), nonGoals: [], openQuestions: [] };
  s.handoff.nextAction = 'execute_task'; s.handoff.nextTaskId = Object.keys(taskRefs)[0]; save(r, s); return r;
}
/** Plans an open sprint 2 whose single task T2.1 references `refs`. */
function planNextSprint(r, refs) {
  const plan = { sprint: { n: 2, slug: 'next', title: 'Next', objective: 'Current work' }, phases: [{ id: 'P2', title: 'Next', objective: 'Next', tasks: [{ id: 'T2.1', title: 'Current task', description: 'Current work', files_to_touch: [], context: 'Current context', acceptance_criteria: ['Works'], depends_on: [], scenario_refs: refs }] }], definitionOfDone: ['Reviewed'], scenarios: [] };
  const file = join(r, 'next.json'); writeFileSync(file, JSON.stringify(plan)); ok(r, ['plan', '--kyro-scope', scope, '--from', file]);
}
// Fixture checks really performed; this is not evidence for a product implementation.
function evidence(r, id, by = 'maker') { ok(r, ['record-evidence', id, '--kyro-scope', scope, '--summary', 'Fixture contract checked', '--validation', 'Node assert: fixture criteria are non-empty', '--by', by]); }
function review(r, id, by = 'checker', verdict = 'pass') { ok(r, ['review', id, '--kyro-scope', scope, '--verdict', verdict, '--by', by, '--yes', ...(verdict === 'fail' ? ['--finding', 'critical:Fixture failure'] : [])]); }
let checks = 0;
function check(label, fn) { fn(); checks++; console.log(`  ok ${label}`); }
try {
  check('each level, disposed, stale, failing verdict and same declared actor (active sprint)', () => {
    const r = sandbox(['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7'], { 'T1.1': ['S1'], 'T1.2': ['S2'], 'T1.3': ['S3'], 'T1.4': ['S4'], 'T1.5': ['S5'], 'T1.6': ['S6'], 'T1.7': ['S7'] });
    evidence(r, 'T1.1'); review(r, 'T1.1');
    evidence(r, 'T1.2');
    ok(r, ['record-evidence', 'T1.4', '--kyro-scope', scope, '--summary', 'Fixture cancellation', '--validation', 'Fixture cancellation requested', '--disposition', 'cancelled', '--reason', 'Fixture decision']);
    evidence(r, 'T1.5', 'alice'); review(r, 'T1.5', ' alice ');
    evidence(r, 'T1.6'); review(r, 'T1.6'); evidence(r, 'T1.6');
    evidence(r, 'T1.7'); review(r, 'T1.7', 'checker', 'fail');
    const analyzed = run(r, ['analyze', '--kyro-scope', scope]); assert.equal(analyzed.status, 1, 'stale review must still block plain analyze');
    const m = matrix(r);
    assert.deepEqual(m.data.scenarios.map((s) => [s.id, s.requirement, s.level]), [['S1', 'R1', 'verdict'], ['S2', 'R2', 'evidence'], ['S3', 'R1', 'linked'], ['S4', 'R2', 'none'], ['S5', 'R1', 'verdict'], ['S6', 'R2', 'evidence'], ['S7', 'R1', 'evidence']]);
    assert.deepEqual(m.data.summary, { none: 1, linked: 1, evidence: 3, verdict: 2, unknown: 0 });
    assert.equal(m.data.note, NOTE); assert.equal(m.data.scope, scope);
    const t11 = row(m, 'S1').tasks[0];
    assert.deepEqual({ ...t11, notes: undefined }, { id: 'T1.1', sprint: 1, source: 'active', level: 'verdict', counted: true, evidenceBy: 'maker', verdictBy: 'checker', notes: undefined });
    const disposed = row(m, 'S4').tasks[0]; assert.equal(disposed.counted, false); assert.equal(disposed.disposition, 'cancelled');
    assert.equal(row(m, 'S5').tasks[0].sameDeclaredActor, true); assert.equal(t11.sameDeclaredActor, undefined);
    assert.equal(row(m, 'S6').tasks[0].level, 'evidence'); assert.match(row(m, 'S6').tasks[0].notes.join(), /stale/);
    assert.match(row(m, 'S7').tasks[0].notes.join(), /verdict fail/);
    for (const line of ['S1 (R1) — verdict recorded — T1.1 [sprint 1]', 'S3 (R1) — linked — T1.3 [sprint 1]', 'T1.5 [sprint 1] ⚠ same declared actor', 'Summary: none=1  linked=1  evidence=3  verdict=2  unknown=0', NOTE]) {
      assert(m.text.includes(line), `matrix text missing "${line}":\n${m.text}`);
    }
    assert(!/\b(reviewed|verified|approved)\b/i.test(m.text.replace(NOTE, '')), `matrix must not claim review/verification:\n${m.text}`);
  });
  check('scope without spec: clear message, exit 0, empty matrix', () => {
    const r = mkdtempSync(join(tmpdir(), 'kyro-matrix-')); roots.push(r);
    cpSync(join(repo, 'fixtures/evals/route-review-task/state'), r, { recursive: true }); mkdirSync(join(r, '.home'));
    const m = matrix(r);
    assert.match(m.text, /no spec traceability/); assert.deepEqual(m.data.scenarios, []);
    assert.deepEqual(m.data.summary, { none: 0, linked: 0, evidence: 0, verdict: 0, unknown: 0 }); assert.match(m.data.message, /no spec traceability/);
  });
  check('closed sprint read from history; legacy snapshot; corrupt/missing history → unknown, never a crash', () => {
    const r = sandbox(['S1', 'S2', 'S3'], { 'T1.1': ['S1'], 'T1.2': ['S2'] });
    evidence(r, 'T1.1'); review(r, 'T1.1'); evidence(r, 'T1.2', 'bob'); review(r, 'T1.2', 'bob');
    ok(r, ['close-sprint', '--kyro-scope', scope, '--outcome', 'shipped', '--yes']);
    assert.equal(read(r).activeSprint, null);
    let m = matrix(r);
    assert.deepEqual(m.data.scenarios.map((s) => s.level), ['verdict', 'verdict', 'none']);
    assert.deepEqual(row(m, 'S1').tasks.map((t) => [t.id, t.sprint, t.source]), [['T1.1', 1, 'history']]);
    assert.equal(row(m, 'S2').tasks[0].sameDeclaredActor, true);
    assert.deepEqual(m.data.history.map((h) => [h.n, h.source, h.status]), [[1, 'checkpoint', 'read']]);
    const checkpoint = join(scopeDir(r), read(r).ledger[0].checkpoint);
    const original = readFileSync(checkpoint);
    writeFileSync(checkpoint, '{ not json');
    m = matrix(r);
    assert.deepEqual(m.data.scenarios.map((s) => s.level), ['unknown', 'unknown', 'unknown']);
    assert.deepEqual(m.data.summary, { none: 0, linked: 0, evidence: 0, verdict: 0, unknown: 3 });
    assert.equal(m.data.history[0].status, 'unknown'); assert.match(m.data.history[0].reason, /Cannot verify historical checkpoint for sprint 1/);
    assert.match(m.text, /\[unknown\] sprint 1/);
    unlinkSync(checkpoint);
    m = matrix(r); assert.equal(m.data.summary.unknown, 3); assert.match(m.data.history[0].reason, /missing/);
    writeFileSync(checkpoint, original);
    // Legacy ledger: snapshot only. Tasks still come from the closed sprint image.
    const legacy = read(r); delete legacy.ledger[0].checkpoint; delete legacy.ledger[0].checkpointSha256; save(r, legacy);
    m = matrix(r); assert.deepEqual(m.data.scenarios.map((s) => s.level), ['verdict', 'verdict', 'none']); assert.equal(m.data.history[0].source, 'snapshot');
    writeFileSync(join(scopeDir(r), legacy.ledger[0].snapshot), 'null');
    m = matrix(r); assert.equal(m.data.summary.unknown, 3); assert.match(m.data.history[0].reason, /malformed/);
    const unsafe = read(r); unsafe.ledger[0].snapshot = '../../escape.json'; save(r, unsafe);
    m = matrix(r); assert.equal(m.data.summary.unknown, 3); assert.match(m.data.history[0].reason, /unsafe/);
  });
  check('history acceptance parity between matrix and strict active-plan', () => {
    const setup = () => {
      const r = sandbox(['S1', 'S2', 'S3'], { 'T1.1': ['S1'] });
      evidence(r, 'T1.1'); review(r, 'T1.1');
      ok(r, ['close-sprint', '--kyro-scope', scope, '--outcome', 'shipped', '--yes']);
      planNextSprint(r, []);
      return r;
    };
    const update = (r, patch) => {
      const s = read(r), file = join(r, 'active-update.json');
      writeFileSync(file, JSON.stringify({ sprint: { n: s.activeSprint.n, slug: s.activeSprint.slug }, reason: 'Parity fixture', ...patch }));
      return ['plan', '--update-active', '--kyro-scope', scope, '--from', file, '--dry-run', '--json'];
    };
    const expectUnknownAndRefusal = (label, damage, code) => {
      const r = setup(), s = read(r), entry = s.ledger[0], checkpoint = join(scopeDir(r), entry.checkpoint), snapshot = join(scopeDir(r), entry.snapshot);
      damage(r, s, entry, checkpoint, snapshot); save(r, s);
      const m = matrix(r); assert.equal(m.data.history[0].status, 'unknown', `${label}: matrix did not mark history unknown`);
      const args = update(r, { requirements: [{ id: 'R1', statement: 'Changed historical definition' }] }), before = tree(r);
      const p = run(r, args); assert.equal(p.status, 1, `${label}: active-plan unexpectedly accepted history`);
      assert.equal(JSON.parse(p.stdout).error?.code, code, `${label}: ${p.stdout}${p.stderr}`);
      assert.deepEqual(tree(r), before, `${label}: refusal changed workspace files`);
    };
    expectUnknownAndRefusal('corrupt checkpoint', (_r, _s, _e, path) => writeFileSync(path, '{ broken'), 'CHECKPOINT_CONFLICT');
    expectUnknownAndRefusal('checkpoint commitment mismatch', (_r, s) => { s.ledger[0].checkpointSha256 = '0'.repeat(64); }, 'CHECKPOINT_CONFLICT');
    expectUnknownAndRefusal('unsafe checkpoint path', (_r, s) => { s.ledger[0].checkpoint = '../escape.json'; }, 'INVALID_INPUT');
    expectUnknownAndRefusal('unreadable snapshot', (_r, s, entry, _checkpoint, path) => { delete entry.checkpoint; delete entry.checkpointSha256; unlinkSync(path); }, 'CHECKPOINT_CORRUPT');
    expectUnknownAndRefusal('malformed snapshot', (_r, s, entry, _checkpoint, path) => { delete entry.checkpoint; delete entry.checkpointSha256; writeFileSync(path, 'null'); }, 'CHECKPOINT_CORRUPT');
    const r = setup(), m = matrix(r), s = read(r), file = join(r, 'active-update.json');
    assert.equal(m.data.history[0].status, 'read');
    writeFileSync(file, JSON.stringify({ sprint: { n: 2, slug: 'next' }, reason: 'Valid history parity', tasks: [{ id: 'T2.1', context: 'Updated current context' }] }));
    const before = tree(r); ok(r, ['plan', '--update-active', '--kyro-scope', scope, '--from', file, '--dry-run', '--json']); assert.deepEqual(tree(r), before);
  });
  check('known backing with unreadable history stays a lower bound; active and historical rows combine', () => {
    const r = sandbox(['S1', 'S2', 'S3'], { 'T1.1': ['S1'] });
    evidence(r, 'T1.1'); review(r, 'T1.1');
    ok(r, ['close-sprint', '--kyro-scope', scope, '--outcome', 'shipped', '--yes']);
    planNextSprint(r, ['S1', 'S2']);
    let m = matrix(r);
    assert.deepEqual(row(m, 'S1').tasks.map((t) => [t.id, t.sprint, t.level]), [['T1.1', 1, 'verdict'], ['T2.1', 2, 'linked']]);
    assert.deepEqual(m.data.scenarios.map((s) => s.level), ['verdict', 'linked', 'none']);
    writeFileSync(join(scopeDir(r), read(r).ledger[0].checkpoint), '[]');
    m = matrix(r);
    assert.deepEqual(m.data.scenarios.map((s) => s.level), ['linked', 'linked', 'unknown']);
    assert.match(row(m, 'S1').notes.join(), /lower bound: sprint 1/);
  });
  check('plain analyze keeps its findings contract; --matrix never sets exit 1 for findings', () => {
    const r = sandbox(['S1', 'S2'], { 'T1.1': ['S1'] });
    const s = read(r); s.activeSprint.phases[0].tasks[0].acceptance_criteria = []; save(r, s);
    const plain = run(r, ['analyze', '--kyro-scope', scope, '--json']); assert.equal(plain.status, 1);
    const data = JSON.parse(plain.stdout).data; assert.deepEqual(Object.keys(data).sort(), ['blocking', 'findings', 'scope']); assert.equal(data.blocking, true);
    const text = run(r, ['analyze', '--kyro-scope', scope]); assert.equal(text.status, 1); assert(!/matrix|verdict recorded/i.test(text.stdout), text.stdout);
    assert.equal(matrix(r).data.summary.linked, 1);
  });
  console.log(`check:verification-matrix — ${checks} matrix checks passed`);
} finally {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
}
