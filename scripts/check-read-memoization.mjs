#!/usr/bin/env node
// Guards the in-process read memo (src/cli/artifacts/read-cache.ts):
//  1. a single CLI process reads each managed file about once (read-count bound);
//  2. a memoised file is never served stale (same-size rewrite in place, by rename, by another process);
//  3. callers never share mutable parsed values;
//  4. the checkpoint integrity/commitment verdict memos are served only for unchanged bytes.
// The read-count part runs on a scope built in the sandbox by the CLI: four closed sprints, four checkpoints.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(fileURLToPath(import.meta.url), '../..');
const cli = resolve(repo, 'dist/cli.js');
// The memo only trusts files whose mtime and ctime are older than its racy window (2 s).
const SETTLE_MS = 2_300;

function assert(condition, message) { if (!condition) throw new Error(message); }
function sleep(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

const root = mkdtempSync(join(tmpdir(), 'kyro-read-memo-'));
try {
  mkdirSync(join(root, '.home'), { recursive: true });
  mkdirSync(join(root, '.agents/kyro'), { recursive: true });
  writeFileSync(join(root, '.agents/kyro/kyro.json'), `${JSON.stringify({ schemaVersion: 4, artifactRoot: '.agents/kyro/scopes', scopes: [], activeScope: null, runtimePath: '~/.agents/kyro/current', installedAdapters: [] }, null, 2)}\n`);
  const env = { ...process.env, HOME: join(root, '.home'), KYRO_TRACE: '0', OPENSSL_CONF: '/dev/null' };
  const kyro = (...args) => {
    const run = spawnSync(process.execPath, [cli, ...args], { cwd: root, env, encoding: 'utf8' });
    assert(run.status === 0, `kyro ${args.join(' ')} failed: ${run.stdout}${run.stderr}`);
    return run;
  };
  const SPRINTS = 4;
  const slugs = Array.from({ length: SPRINTS }, (_, i) => `s${i + 1}`);
  const lean = (n) => ({ sprint: { n, slug: slugs[n - 1], title: `Sprint ${n}`, objective: 'Objective.' }, phases: [{ id: 'P1', title: 'Phase', objective: 'Phase objective.', tasks: [{ id: 'T1.1', title: 'Task', description: 'Do it.', files_to_touch: ['src/app.txt'], context: 'None.', acceptance_criteria: ['It is done.'], depends_on: [], scenario_refs: [] }] }], definitionOfDone: ['Done.'] });
  writeFileSync(join(root, '.home', 'init.json'), JSON.stringify({ scope: 'demo', title: 'Demo', objective: 'Demo objective.', successCriteria: ['Demo works.'], roadmap: { plannedSprintCount: SPRINTS, sprints: slugs.map((slug, i) => ({ n: i + 1, slug, title: `Sprint ${i + 1}` })) } }));
  kyro('plan', '--from', join(root, '.home', 'init.json'));
  for (let n = 1; n <= SPRINTS; n++) {
    writeFileSync(join(root, '.home', `sprint-${n}.json`), JSON.stringify(lean(n)));
    kyro('plan', '--from', join(root, '.home', `sprint-${n}.json`), '--kyro-scope', 'demo');
    kyro('record-evidence', 'T1.1', '--kyro-scope', 'demo', '--summary', 'Done.', '--validation', 'manual: ok');
    kyro('review', 'T1.1', '--kyro-scope', 'demo', '--verdict', 'pass', '--yes');
    kyro('close-sprint', '--kyro-scope', 'demo', '--outcome', 'shipped', '--yes');
  }
  const checkpointRel = '.agents/kyro/scopes/demo/archive/sprint-001-s1.checkpoint.json';

  // Preload that counts reads of managed state files in the CLI process.
  const preload = join(root, '.home', 'count-reads.cjs');
  writeFileSync(preload, `
const fs = require('node:fs');
const original = fs.readFileSync;
const counts = new Map();
fs.readFileSync = function (path, ...rest) {
  if (typeof path === 'string' && path.includes('.agents/kyro')) counts.set(path, (counts.get(path) || 0) + 1);
  return original.call(this, path, ...rest);
};
process.on('exit', () => {
  let reads = 0;
  for (const n of counts.values()) reads += n;
  const cp = [...counts].filter(([p]) => p.endsWith('.checkpoint.json')).map(([, n]) => n);
  process.stderr.write('READCOUNT ' + JSON.stringify({ reads, unique: counts.size, max: Math.max(0, ...counts.values()), checkpoints: cp.length, maxCheckpoint: Math.max(0, ...cp) }) + '\\n');
});
`);
  sleep(SETTLE_MS);

  // 1. Read-count bounds: total, and per checkpoint (the defect scaled with ledger length).
  const bounds = [
    { args: ['status'], factor: 1.5 },
    { args: ['context-pack'], factor: 1.5 },
    { args: ['doctor', '--artifacts'], factor: 2 },
  ];
  for (const { args, factor } of bounds) {
    const run = spawnSync(process.execPath, ['-r', preload, cli, ...args], { cwd: root, env, encoding: 'utf8' });
    const line = run.stderr.split('\n').find((l) => l.startsWith('READCOUNT '));
    assert(line, `${args.join(' ')}: read counter did not report. stderr=${run.stderr.slice(0, 400)}`);
    const { reads, unique, max, checkpoints, maxCheckpoint } = JSON.parse(line.slice('READCOUNT '.length));
    assert(checkpoints >= SPRINTS, `${args.join(' ')}: expected ${SPRINTS} checkpoints to be read, saw ${checkpoints}`);
    assert(maxCheckpoint <= 2, `${args.join(' ')}: a checkpoint was read ${maxCheckpoint} times (limit 2)`);
    assert(unique >= 3, `${args.join(' ')}: expected managed files to be read, saw ${unique}`);
    assert(reads <= factor * unique, `${args.join(' ')}: ${reads} reads of ${unique} unique files exceeds ${factor}x (max per file ${max})`);
  }

  // 2 + 3. Stale-read and shared-mutation probes, inside one Node process whose cwd is the sandbox.
  const probe = `
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { readJsonSafely } = require(${JSON.stringify(join(repo, 'dist/cli/artifacts/json.js'))});
const rel = '.agents/kyro/memo-probe.json';
const abs = path.resolve(rel);
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const body = (tag) => JSON.stringify({ tag, nested: { list: [1, 2, 3] } }) + '\\n';
const fail = (m) => { process.stderr.write('PROBE-FAIL ' + m + '\\n'); process.exit(1); };
const original = fs.readFileSync;
let reads = 0;
fs.readFileSync = function (p, ...rest) { if (String(p) === abs) reads++; return original.call(this, p, ...rest); };
const tagOf = () => readJsonSafely(rel).value?.tag;

// (a) racy: rewrite same-size content straight after a read, many times, no settle time.
for (let i = 0; i < 300; i++) {
  const before = 'a'.repeat(8) + String(i).padStart(4, '0');
  fs.writeFileSync(abs, body(before));
  if (tagOf() !== before) fail('racy first read ' + i);
  const after = 'b'.repeat(8) + String(i).padStart(4, '0');
  fs.writeFileSync(abs, body(after));
  if (tagOf() !== after) fail('racy same-size in-place rewrite served stale at ' + i);
}

// (b) settled file is actually served from memory, then a same-size in-place rewrite is seen.
fs.writeFileSync(abs, body('settled-AAAA'));
sleep(${SETTLE_MS});
tagOf();
reads = 0;
if (tagOf() !== 'settled-AAAA') fail('settled read');
if (reads !== 0) fail('settled file was re-read (' + reads + ' reads); the memo is not active');
fs.writeFileSync(abs, body('settled-BBBB'));
if (tagOf() !== 'settled-BBBB') fail('settled same-size in-place rewrite served stale');

// (c) rewrite by another process, same size, in place and by atomic rename.
sleep(${SETTLE_MS});
tagOf();
reads = 0;
tagOf();
if (reads !== 0) fail('memo not active before child rewrite');
const child = (script) => { const r = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' }); if (r.status !== 0) fail('child failed ' + r.stderr); };
child('require("fs").writeFileSync(' + JSON.stringify(abs) + ', ' + JSON.stringify(body('settled-CCCC')) + ')');
if (tagOf() !== 'settled-CCCC') fail('child in-place rewrite served stale');
sleep(${SETTLE_MS});
tagOf();
child('const fs=require("fs");fs.writeFileSync(' + JSON.stringify(abs + '.tmp') + ',' + JSON.stringify(body('settled-DDDD')) + ');fs.renameSync(' + JSON.stringify(abs + '.tmp') + ',' + JSON.stringify(abs) + ')');
if (tagOf() !== 'settled-DDDD') fail('child rename rewrite served stale');

// (d) no shared mutation: a caller mutating its result never changes what the next caller sees.
sleep(${SETTLE_MS});
tagOf();
const first = readJsonSafely(rel);
first.value.tag = 'MUTATED';
first.value.nested.list.push(99);
delete first.value.nested;
const second = readJsonSafely(rel);
if (second.value.tag !== 'settled-DDDD' || JSON.stringify(second.value.nested) !== '{"list":[1,2,3]}') fail('mutation leaked into a later read');
if (second.value === first.value) fail('two reads returned the same object');

// (e) deletion and invalid JSON are reported, not served from memory.
fs.writeFileSync(abs, '{not json');
if (!readJsonSafely(rel).error) fail('invalid JSON not reported');
fs.rmSync(abs);
if (readJsonSafely(rel).exists) fail('deleted file still reported as existing');
process.stdout.write('PROBE-OK\\n');
`;
  const result = spawnSync(process.execPath, ['-e', probe], { cwd: root, env, encoding: 'utf8' });
  assert(result.status === 0 && result.stdout.includes('PROBE-OK'), `read probe failed: ${result.stderr || result.stdout}`);

  // 4. Verdict memos: resolve a valid checkpoint through the compiled effective-checkpoint API.
  const verdictProbe = `
const fs = require('node:fs');
const path = require('node:path');
const { resolveEffectiveCheckpointAtPath, effectiveCommitment } = require(${JSON.stringify(join(repo, 'dist/cli/checkpoints/effective.js'))});
const rel = ${JSON.stringify(checkpointRel)};
const abs = path.resolve(rel);
const fail = (m) => { process.stderr.write('VERDICT-FAIL ' + m + '\\n'); process.exit(1); };
const original = fs.readFileSync;
let reads = 0;
fs.readFileSync = function (p, ...rest) { if (String(p) === abs) reads++; return original.call(this, p, ...rest); };
const resolveNow = () => resolveEffectiveCheckpointAtPath('demo', rel);
const view = (r) => ({ status: r.status, commitment: effectiveCommitment(r) });

const first = resolveNow();
const base = view(first);
if (base.status !== 'valid' || !base.commitment) fail('fixture checkpoint is not valid: ' + JSON.stringify(base) + ' ' + first.detail);

// a second resolve is served from the memos: no read of the checkpoint, same verdict.
reads = 0;
const second = resolveNow();
if (reads !== 0) fail('second resolve re-read the checkpoint ' + reads + ' times; the memo is not active');
if (JSON.stringify(view(second)) !== JSON.stringify(base)) fail('second resolve changed verdict ' + JSON.stringify(view(second)));

// a caller mutating its result cannot change a later verdict.
second.checkpoint.identity.scope = 'mutated';
second.checkpoint.close.outcome = 'mutated';
second.checkpoint.intendedAfterClose.ledger.push({ n: 99 });
delete second.checkpoint.digests;
const third = resolveNow();
if (JSON.stringify(view(third)) !== JSON.stringify(base)) fail('mutation leaked into a later verdict ' + JSON.stringify(view(third)));

// same-size in-place tamper of one value, atime/mtime restored: must be detected.
const originalText = fs.readFileSync(abs, 'utf8');
const stat = fs.statSync(abs);
const marker = '"createdAt": "';
const at = originalText.indexOf(marker) + marker.length;
const flipped = originalText[at + 3] === '9' ? '8' : '9';
const tampered = originalText.slice(0, at + 3) + flipped + originalText.slice(at + 4);
if (tampered.length !== originalText.length || tampered === originalText) fail('tamper construction');
fs.writeFileSync(abs, tampered);
fs.utimesSync(abs, stat.atime, stat.mtime);
const bad = view(resolveNow());
if (bad.status === 'valid' || bad.commitment !== null) fail('same-size tamper with restored mtime still valid: ' + JSON.stringify(bad));

// restoring the original bytes makes it valid again with the original commitment.
fs.writeFileSync(abs, originalText);
fs.utimesSync(abs, stat.atime, stat.mtime);
if (JSON.stringify(view(resolveNow())) !== JSON.stringify(base)) fail('restored bytes did not give the original verdict');

// tampered replacement by atomic rename.
fs.writeFileSync(abs + '.tmp', tampered);
fs.renameSync(abs + '.tmp', abs);
const renamed = view(resolveNow());
if (renamed.status === 'valid') fail('rename tamper still valid');
process.stdout.write('VERDICT-OK\\n');
`;
  const verdict = spawnSync(process.execPath, ['-e', verdictProbe], { cwd: root, env, encoding: 'utf8' });
  assert(verdict.status === 0 && verdict.stdout.includes('VERDICT-OK'), `verdict probe failed: ${verdict.stderr || verdict.stdout}`);
  console.log('read memoization check passed');
} finally {
  rmSync(root, { recursive: true, force: true });
}
