#!/usr/bin/env node
/**
 * Append-only scope remediation regression harness.
 *
 * Reproduces the defect that motivated the protocol: a CLOSED scope whose live `debt[].origin` was
 * persisted as prose, which Kyro Doctor now rejects and Kyro Lens always rejected. The scope is
 * closed through the real `kyro close-sprint`, so the checkpoint, snapshot, narrative and ledger
 * commitment under test are genuine artifacts rather than hand-built look-alikes.
 *
 * Every case asserts BYTES and DIGESTS of the original archive, not just exit status: a remediation
 * that "succeeds" while disturbing history is the exact failure this feature exists to prevent.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(fileURLToPath(import.meta.url), '../..');
const cli = resolve(repo, 'dist/cli.js');
const closeFixture = resolve(repo, 'fixtures/evals/close-sprint-happy/state');
const SCOPE = 'demo';
const LEGACY_ORIGIN = 'food-analysis FR-FA-013 revision';

const require = createRequire(import.meta.url);

let passed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
  passed += 1;
}

function readJson(path) { return JSON.parse(readFileSync(path, 'utf8')); }
function writeJson(path, value) { writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`); }

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical(value[k])]));
  return value;
}
function digest(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(canonical(value)), 'utf8').digest('hex');
}
/** Business-state digest: the remediation anchor is excluded so no hash cycle can form. */
function stateDigest(sprint) {
  const projected = { ...sprint };
  delete projected.remediations;
  return digest(projected);
}
function checkpointCommitment(value) {
  const payload = JSON.parse(JSON.stringify(value));
  delete payload.digests;
  delete payload.intendedAfterClose.ledger.at(-1).checkpointSha256;
  return digest(payload);
}

function run(root, args) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: 'utf-8',
    env: { ...process.env, HOME: join(root, '.home') },
  });
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

/**
 * Call a real MCP tool through the shipped dispatcher, in a child process rooted at the fixture, so
 * CLI/MCP parity is compared between two genuine surfaces rather than two calls to one helper.
 */
function mcpCall(root, tool, args) {
  const script = `
    const { callTool } = require(${JSON.stringify(resolve(repo, 'dist/cli/mcp/handlers.js'))});
    const result = callTool(${JSON.stringify(tool)}, ${JSON.stringify(args)});
    process.stdout.write(JSON.stringify(result.structuredContent ?? result));
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: root,
    encoding: 'utf-8',
    env: { ...process.env, HOME: join(root, '.home') },
  });
  assert(result.status === 0, `mcp ${tool} failed: ${result.stdout}${result.stderr}`);
  return JSON.parse(result.stdout);
}

function fileTree(dir) {
  const out = {};
  const walk = (current) => {
    for (const name of readdirSync(current)) {
      const path = join(current, name);
      if (statSync(path).isDirectory()) walk(path);
      else out[relative(dir, path)] = readFileSync(path, 'utf8');
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}

/** Archive files that predate remediation. Remediation records live here too and must be excluded. */
function historicalArchive(root) {
  const dir = join(root, `.agents/kyro/scopes/${SCOPE}/archive`);
  return Object.fromEntries(Object.entries(fileTree(dir)).filter(([name]) => !name.startsWith('remediations/')));
}

function sprintPath(root) { return join(root, `.agents/kyro/scopes/${SCOPE}/sprint.json`); }
function recordPath(root, id = '001') {
  return join(root, `.agents/kyro/scopes/${SCOPE}/archive/remediations/remediation-${id}.json`);
}

/** Construct immutable v1 evidence only inside a temp fixture; production records are never rewritten. */
function rewriteFixtureRecordAsV1(root, id, snapshot) {
  const record = readJson(recordPath(root, id));
  record.schemaVersion = 1;
  record.result = { stateSha256: record.result.stateSha256, snapshot };
  writeJson(recordPath(root, id), record);
  const live = readJson(sprintPath(root));
  const anchor = live.remediations.find((entry) => entry.id === `R-${id}`);
  anchor.commitment = digest(record);
  writeJson(sprintPath(root), live);
  return record;
}

/**
 * A genuinely closed scope whose live debt origin was then written as prose.
 *
 * The corruption is applied AFTER the close so the immutable checkpoint records the state as it was
 * committed; remediation must correct the live copy without touching that record.
 */
function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'kyro-remediation-'));
  cpSync(closeFixture, root, { recursive: true });
  mkdirSync(join(root, '.home'), { recursive: true });

  const sprint = readJson(sprintPath(root));
  sprint.debt = [{
    id: 'debt-1',
    title: 'Origin recorded during the food-analysis revision.',
    origin: 1,
    priority: 'low',
    status: 'deferred',
    targetSprint: null,
    note: 'Tracked from the closing sprint.',
  }];
  writeJson(sprintPath(root), sprint);

  const closed = run(root, ['close-sprint', '--kyro-scope', SCOPE, '--outcome', 'shipped', '--note', 'Closed.', '--summary', 'Closed.', '--confirm']);
  assert(closed.status === 0, `fixture close-sprint failed: ${closed.output}`);

  // The historical defect: a writer put prose into a numeric field of the already-closed scope.
  const live = readJson(sprintPath(root));
  live.debt[0].origin = LEGACY_ORIGIN;
  writeJson(sprintPath(root), live);

  return { root, live, archive: historicalArchive(root) };
}

function manifestFor(live, overrides = {}) {
  return {
    schemaVersion: 1,
    kind: 'scope-remediation-manifest',
    scope: SCOPE,
    base: { stateSha256: stateDigest(live), remediationHead: null },
    issues: [{
      id: 'I-1',
      code: 'debt.origin.not-number',
      path: 'debt[0].origin',
      observedValueSha256: digest(JSON.stringify(canonical(live.debt[0].origin))),
    }],
    operations: [{
      id: 'O-1',
      kind: 'debt.origin.set',
      resolves: ['I-1'],
      debtId: 'debt-1',
      expectedOriginSha256: digest(JSON.stringify(canonical(live.debt[0].origin))),
      origin: 1,
      reason: 'The debt was raised during sprint 1.',
    }],
    provenance: { reason: 'Live debt origin was persisted as prose after close.', actor: 'regression-harness' },
  };
}

function writeManifest(root, manifest) {
  const path = join(root, 'manifest.json');
  writeJson(path, manifest);
  return 'manifest.json';
}

function withFixture(fn) {
  const fx = makeFixture();
  try { fn(fx); } finally { rmSync(fx.root, { recursive: true, force: true }); }
}

/** Assert a rejected remediation left no applied state and no disturbed history. */
function assertNothingApplied(fx, label) {
  assert(
    JSON.stringify(historicalArchive(fx.root)) === JSON.stringify(fx.archive),
    `${label}: historical archive changed`,
  );
  const live = readJson(sprintPath(fx.root));
  assert(live.debt[0].origin === LEGACY_ORIGIN, `${label}: live debt origin was modified`);
  assert(live.remediations === undefined, `${label}: a remediation anchor was written`);
  assert(!existsSync(recordPath(fx.root)), `${label}: a remediation record was written`);
}

// 1. Baseline: the corrupted closed scope is exactly the state doctor and Lens reject.
withFixture((fx) => {
  const live = readJson(sprintPath(fx.root));
  assert(typeof live.debt[0].origin === 'string', 'fixture must reproduce a non-numeric debt origin');
  const doctor = run(fx.root, ['doctor', '--artifacts', '--kyro-scope', SCOPE]);
  assert(doctor.status === 1, `doctor must reject the corrupted scope, got ${doctor.status}`);
  assert(doctor.output.includes('debt[0].origin must be a number'), `doctor must name the field: ${doctor.output}`);

  const entry = live.ledger.at(-1);
  const checkpoint = readJson(join(fx.root, `.agents/kyro/scopes/${SCOPE}/${entry.checkpoint}`));
  assert(entry.checkpointSha256 === checkpointCommitment(checkpoint), 'fixture checkpoint must be anchored by its ledger commitment');
});

// 2. Valid remediation: preview is pure, apply repairs the live value and leaves history untouched.
withFixture((fx) => {
  const manifest = writeManifest(fx.root, manifestFor(fx.live));
  const beforeTree = fileTree(join(fx.root, '.agents'));

  const preview = run(fx.root, ['remediate', 'preview', '--kyro-scope', SCOPE, '--manifest', manifest]);
  assert(preview.status === 0, `preview failed: ${preview.output}`);
  assert(preview.output.includes(`debt[debt-1].origin ${JSON.stringify(LEGACY_ORIGIN)} -> 1`), `preview must show the typed change: ${preview.output}`);
  assert(preview.output.includes('(verified, unchanged)'), 'preview must report the checkpoint as verified');
  assert(JSON.stringify(beforeTree) === JSON.stringify(fileTree(join(fx.root, '.agents'))), 'preview wrote to a managed file');

  const unconfirmed = run(fx.root, ['remediate', 'apply', '--kyro-scope', SCOPE, '--manifest', manifest]);
  assert(unconfirmed.status !== 0, 'apply without confirmation must fail');
  assert(unconfirmed.output.includes('CONFIRMATION_REQUIRED'), `apply must demand explicit confirmation: ${unconfirmed.output}`);
  assertNothingApplied(fx, 'unconfirmed apply');

  const applied = run(fx.root, ['remediate', 'apply', '--kyro-scope', SCOPE, '--manifest', manifest, '--yes']);
  assert(applied.status === 0, `apply failed: ${applied.output}`);
  assert(applied.output.includes('Remediation R-001 applied'), `apply must report the remediation id: ${applied.output}`);

  // The immutable record.
  assert(existsSync(recordPath(fx.root)), 'apply must publish the immutable remediation record');
  const record = readJson(recordPath(fx.root));
  assert(record.schemaVersion === 2 && record.kind === 'scope-remediation' && record.id === 'R-001', 'record must be a compact v2 scope-remediation');
  assert(record.base.stateSha256 === stateDigest(fx.live), 'record must bind the pre-remediation base digest');
  assert(record.base.remediationHead === null, 'first remediation must have a null chain head');
  assert(record.operations.length === 1 && record.operations[0].kind === 'debt.origin.set', 'record must carry the typed operation');
  assert(record.issues.length === 1 && record.issues[0].code === 'debt.origin.not-number', 'record must carry the issue it resolves');
  assert(typeof record.provenance.kyroVersion === 'string' && record.provenance.actor === 'regression-harness', 'record must carry provenance');
  assert(record.result.witness?.kind === 'operations-replay' && !('snapshot' in record.result), 'v2 record must carry only the typed compact witness');

  // The corrected live state and its anchor.
  const live = readJson(sprintPath(fx.root));
  assert(live.debt[0].origin === 1, 'live debt origin must be the numeric replacement');
  assert(live.remediations.length === 1 && live.remediations[0].id === 'R-001', 'live anchor must be appended');
  assert(live.remediations[0].commitment === digest(record), 'live anchor must commit to the record');
  assert(stateDigest(live) === record.result.stateSha256, 'live state must match the recorded result digest');

  // History is byte-for-byte intact.
  assert(JSON.stringify(historicalArchive(fx.root)) === JSON.stringify(fx.archive), 'remediation must not touch checkpoint, snapshot or narrative bytes');
  assert(live.ledger.at(-1).checkpointSha256 === fx.live.ledger.at(-1).checkpointSha256, 'ledger checkpoint commitment must be unchanged');
  assert(JSON.stringify(live.ledger) === JSON.stringify(fx.live.ledger), 'ledger entries must be unchanged');

  const doctor = run(fx.root, ['doctor', '--artifacts', '--kyro-scope', SCOPE]);
  assert(doctor.output.includes('sprint.json: Schema shapes are valid'), `remediated scope must validate: ${doctor.output}`);
  assert(/remediation\/R-001[\s\S]*?APPLIED/.test(doctor.output), `doctor must report the remediation as APPLIED: ${doctor.output}`);
  assert(doctor.status === 0, `doctor must pass on the remediated scope: ${doctor.output}`);
  // Here the correction restored the exact value the scope was closed with, so the live business
  // state IS the checkpoint after-image. That allowance trusts nothing about the chain's contents.
  assert(doctor.output.includes('remediation anchor excluded'), `doctor must explain the anchor-only difference: ${doctor.output}`);
});

// 3. Rejections: every one must fail closed, writing nothing and disturbing no history.
const rejections = [
  ['unknown operation kind', (m) => { m.operations[0].kind = 'debt.origin.patch'; }, 'operations[0].kind'],
  ['generic patch payload', (m) => { m.operations[0].patch = [{ op: 'replace', path: '/debt/0/origin', value: 1 }]; }, 'not part of the remediation contract'],
  ['string replacement origin', (m) => { m.operations[0].origin = '1'; }, 'operations[0].origin'],
  ['fractional replacement origin', (m) => { m.operations[0].origin = 1.5; }, 'operations[0].origin'],
  ['invalid issue digest', (m) => { m.issues[0].observedValueSha256 = 'not-a-digest'; }, 'issues[0].observedValueSha256'],
  ['issue not referenced by any operation id', (m) => { m.operations[0].resolves = ['I-404']; }, 'undeclared issue id'],
  ['missing provenance actor', (m) => { m.provenance.actor = ''; }, 'provenance.actor'],
  ['stale base digest', (m) => { m.base.stateSha256 = 'b'.repeat(64); }, 'does not match the live state digest'],
  ['stale expected old-value digest', (m) => { m.operations[0].expectedOriginSha256 = 'c'.repeat(64); }, 'live value digests to'],
  ['unknown debt id', (m) => { m.operations[0].debtId = 'debt-404'; }, 'does not exist in the live state'],
  ['manifest targets another scope', (m) => { m.scope = 'other'; }, 'but the command targets'],
  ['unsupported manifest version', (m) => { m.schemaVersion = 2; }, 'schemaVersion'],
];

for (const [label, mutate, expected] of rejections) {
  withFixture((fx) => {
    const manifest = manifestFor(fx.live);
    mutate(manifest);
    const path = writeManifest(fx.root, manifest);
    for (const verb of ['preview', 'apply']) {
      const args = ['remediate', verb, '--kyro-scope', SCOPE, '--manifest', path];
      if (verb === 'apply') args.push('--yes');
      const result = run(fx.root, args);
      assert(result.status !== 0, `${label} (${verb}) must fail: ${result.output}`);
      assert(result.output.includes(expected), `${label} (${verb}) must explain "${expected}": ${result.output}`);
      assertNothingApplied(fx, `${label} (${verb})`);
    }
  });
}

// 4. Batch atomicity: a valid operation next to an invalid one applies nothing.
withFixture((fx) => {
  const live = readJson(sprintPath(fx.root));
  live.debt.push({
    id: 'debt-2',
    title: 'Second legacy origin.',
    origin: 'also prose',
    priority: 'low',
    status: 'deferred',
    targetSprint: null,
    note: 'Second defect.',
  });
  writeJson(sprintPath(fx.root), live);
  const archive = historicalArchive(fx.root);

  const batch = manifestFor(live);
  batch.issues.push({ id: 'I-2', code: 'debt.origin.not-number', path: 'debt[1].origin', observedValueSha256: digest(JSON.stringify(canonical('also prose'))) });
  batch.operations.push({
    id: 'O-2',
    kind: 'debt.origin.set',
    resolves: ['I-2'],
    debtId: 'debt-2',
    expectedOriginSha256: digest(JSON.stringify(canonical('also prose'))),
    origin: 1,
    reason: 'Raised in the same sprint.',
  });

  // Both valid: the batch repairs both fields in one transaction.
  const good = writeManifest(fx.root, JSON.parse(JSON.stringify(batch)));
  const okPreview = run(fx.root, ['remediate', 'preview', '--kyro-scope', SCOPE, '--manifest', good]);
  assert(okPreview.status === 0, `two-operation batch must plan: ${okPreview.output}`);
  assert(okPreview.output.includes('operation O-1') && okPreview.output.includes('operation O-2'), 'preview must list both operations');

  // One invalid: nothing applies, not even the operation that would have succeeded.
  const broken = JSON.parse(JSON.stringify(batch));
  broken.operations[1].expectedOriginSha256 = 'd'.repeat(64);
  const badPath = writeManifest(fx.root, broken);
  const rejected = run(fx.root, ['remediate', 'apply', '--kyro-scope', SCOPE, '--manifest', badPath, '--yes']);
  assert(rejected.status !== 0, 'a batch with one invalid operation must fail');
  assert(rejected.output.includes('O-2'), `failure must name the offending operation: ${rejected.output}`);

  const after = readJson(sprintPath(fx.root));
  assert(after.debt[0].origin === LEGACY_ORIGIN && after.debt[1].origin === 'also prose', 'no operation in a rejected batch may be applied');
  assert(after.remediations === undefined, 'a rejected batch must not write an anchor');
  assert(!existsSync(recordPath(fx.root)), 'a rejected batch must not write a record');
  assert(JSON.stringify(historicalArchive(fx.root)) === JSON.stringify(archive), 'a rejected batch must not touch history');
});

// 5. Interrupted persistence: a published record with no live anchor is PREPARED, never applied,
//    and the retry finishes that same remediation instead of creating a competing one.
withFixture((fx) => {
  const manifest = writeManifest(fx.root, manifestFor(fx.live));
  const corrupted = readFileSync(sprintPath(fx.root), 'utf8');

  const first = run(fx.root, ['remediate', 'apply', '--kyro-scope', SCOPE, '--manifest', manifest, '--yes']);
  assert(first.status === 0, `setup apply failed: ${first.output}`);
  const record = readJson(recordPath(fx.root));

  // Roll the live state back to before the anchor landed: the on-disk shape a crash between the
  // record write and the state write leaves behind.
  writeFileSync(sprintPath(fx.root), corrupted);

  // The record must be visible AND unmistakably not a remediation. Staying silent about it was the
  // older behaviour: it hid an interrupted transaction, and equally hid a planted record (T3.2).
  const doctor = run(fx.root, ['doctor', '--artifacts', '--kyro-scope', SCOPE]);
  assert(/remediation\/R-001: PREPARED/.test(doctor.output), `an unanchored record must be reported as PREPARED: ${doctor.output}`);
  assert(!/remediation\/R-001: APPLIED/.test(doctor.output), `an unanchored record must never be presented as applied: ${doctor.output}`);
  assert(/\[WARN\][^\n]*remediation\/R-001/.test(doctor.output), `an interrupted publish is a warning, not a healthy record: ${doctor.output}`);

  const preview = run(fx.root, ['remediate', 'preview', '--kyro-scope', SCOPE, '--manifest', manifest]);
  assert(preview.status === 0, `preview over a prepared transaction failed: ${preview.output}`);
  assert(preview.output.includes('PREPARED'), `preview must report the interrupted transaction: ${preview.output}`);

  const resumed = run(fx.root, ['remediate', 'apply', '--kyro-scope', SCOPE, '--manifest', manifest, '--yes']);
  assert(resumed.status === 0, `resume failed: ${resumed.output}`);
  assert(resumed.output.includes('Resumed interrupted remediation R-001'), `retry must resume, not restart: ${resumed.output}`);
  assert(readdirSync(join(fx.root, `.agents/kyro/scopes/${SCOPE}/archive/remediations`)).length === 1, 'a retry must not create a second record');
  assert(JSON.stringify(readJson(recordPath(fx.root))) === JSON.stringify(record), 'the resumed record must be byte-equal to the prepared one');

  const live = readJson(sprintPath(fx.root));
  assert(live.debt[0].origin === 1 && live.remediations.length === 1, 'the resumed transaction must leave the corrected state');
  assert(JSON.stringify(historicalArchive(fx.root)) === JSON.stringify(fx.archive), 'resume must not touch history');

  // Idempotency: the same committed manifest can never produce a second applied remediation.
  const again = run(fx.root, ['remediate', 'apply', '--kyro-scope', SCOPE, '--manifest', manifest, '--yes']);
  assert(again.status !== 0, 'replaying a committed manifest must be refused');
  assert(again.output.includes('does not match the live state digest'), `replay must be refused as stale: ${again.output}`);
  assert(readdirSync(join(fx.root, `.agents/kyro/scopes/${SCOPE}/archive/remediations`)).length === 1, 'a refused replay must not add a record');
});

// 6. A hand-written or tampered anchor never passes as provenance.
withFixture((fx) => {
  const manifest = writeManifest(fx.root, manifestFor(fx.live));
  const applied = run(fx.root, ['remediate', 'apply', '--kyro-scope', SCOPE, '--manifest', manifest, '--yes']);
  assert(applied.status === 0, `setup apply failed: ${applied.output}`);

  const live = readJson(sprintPath(fx.root));
  live.remediations[0].commitment = 'e'.repeat(64);
  writeJson(sprintPath(fx.root), live);
  const tampered = run(fx.root, ['doctor', '--artifacts', '--kyro-scope', SCOPE]);
  assert(tampered.status === 1, 'a tampered anchor commitment must fail doctor');
  assert(tampered.output.includes('DIVERGED'), `tampering must be reported as divergence: ${tampered.output}`);

  const malformed = readJson(sprintPath(fx.root));
  malformed.remediations = [{ id: 'R-001', path: 'archive/remediations/remediation-001.json', commitment: 'nope' }];
  writeJson(sprintPath(fx.root), malformed);
  const bad = run(fx.root, ['doctor', '--artifacts', '--kyro-scope', SCOPE]);
  assert(bad.status === 1, 'a malformed anchor must fail doctor');
  assert(bad.output.includes('remediations[0].commitment'), `doctor must name the malformed field: ${bad.output}`);
});

// 7. Replay path: a correction that moves the scope to a NEW value still certifies, because the
//    chain replays from the checkpoint's after-image and reproduces the live state exactly.
withFixture((fx) => {
  const closed = readJson(sprintPath(fx.root));
  // Close left a valid numeric origin; the correction is that it named the wrong sprint.
  closed.debt[0].origin = 1;
  const observed = digest(JSON.stringify(canonical(1)));
  const businessState = { ...closed };
  delete businessState.remediations;
  writeJson(join(fx.root, 'manifest.json'), {
    schemaVersion: 1,
    kind: 'scope-remediation-manifest',
    scope: SCOPE,
    base: { stateSha256: digest(businessState), remediationHead: null },
    issues: [{ id: 'I-1', code: 'debt.origin.wrong-sprint', path: 'debt[0].origin', observedValueSha256: observed }],
    operations: [{ id: 'O-1', kind: 'debt.origin.set', resolves: ['I-1'], debtId: 'debt-1', expectedOriginSha256: observed, origin: 2, reason: 'Raised in sprint 2, not sprint 1.' }],
    provenance: { reason: 'Origin attributed to the wrong sprint.', actor: 'regression-harness' },
  });
  // Restore the closed state first: this case starts from a scope that closed clean.
  writeJson(sprintPath(fx.root), closed);

  const applied = run(fx.root, ['remediate', 'apply', '--kyro-scope', SCOPE, '--manifest', 'manifest.json', '--yes']);
  assert(applied.status === 0, `replay-path remediation must apply: ${applied.output}`);
  const live = readJson(sprintPath(fx.root));
  assert(live.debt[0].origin === 2, 'the new value must be persisted');

  const doctor = run(fx.root, ['doctor', '--artifacts', '--kyro-scope', SCOPE]);
  assert(doctor.status === 0, `a replay-verified remediation must certify: ${doctor.output}`);
  assert(doctor.output.includes('replayed through R-001'), `doctor must report the replay: ${doctor.output}`);
  assert(JSON.stringify(historicalArchive(fx.root)) === JSON.stringify(fx.archive), 'replay-path remediation must not touch history');
});

// 8. QA probe 1 — a valid remediation must not launder unrelated post-close tampering.
//    Hand-edit the closed live state, then apply a legitimate no-op correction on top.
withFixture((fx) => {
  const tampered = readJson(sprintPath(fx.root));
  tampered.debt[0].origin = 1;
  tampered.objective = 'TAMPERED objective';
  tampered.ledger.at(-1).note = 'TAMPERED note';
  tampered.ledger.at(-1).outcome = 'TAMPERED outcome';
  writeJson(sprintPath(fx.root), tampered);

  const before = run(fx.root, ['doctor', '--artifacts', '--kyro-scope', SCOPE]);
  assert(before.status === 1 && before.output.includes('DIVERGED'), `hand-edited closed state must diverge: ${before.output}`);

  const observed = digest(JSON.stringify(canonical(1)));
  const businessState = { ...tampered };
  delete businessState.remediations;
  writeJson(join(fx.root, 'manifest.json'), {
    schemaVersion: 1,
    kind: 'scope-remediation-manifest',
    scope: SCOPE,
    base: { stateSha256: digest(businessState), remediationHead: null },
    issues: [{ id: 'I-1', code: 'debt.origin.review', path: 'debt[0].origin', observedValueSha256: observed }],
    operations: [{ id: 'O-1', kind: 'debt.origin.set', resolves: ['I-1'], debtId: 'debt-1', expectedOriginSha256: observed, origin: 1, reason: 'No-op correction.' }],
    provenance: { reason: 'Cosmetic.', actor: 'attacker' },
  });
  const applied = run(fx.root, ['remediate', 'apply', '--kyro-scope', SCOPE, '--manifest', 'manifest.json', '--yes']);
  assert(applied.status === 0, `the no-op remediation itself is valid: ${applied.output}`);

  const after = run(fx.root, ['doctor', '--artifacts', '--kyro-scope', SCOPE]);
  assert(after.status === 1, `a remediation must not certify unrelated tampering: ${after.output}`);
  assert(after.output.includes('DIVERGED'), `tampered state must stay DIVERGED: ${after.output}`);
  assert(!after.output.includes('replayed through'), `tampered state must not claim a verified replay: ${after.output}`);
  assert(readJson(sprintPath(fx.root)).objective === 'TAMPERED objective', 'the probe must leave the tampering in place');
});

// 9. QA probe 2 — a hand-written record plus anchor, with no kyro command run at all, must not
//    flip a diverged scope to certified. Its digests correspond to no state Kyro can reproduce.
withFixture((fx) => {
  const tampered = readJson(sprintPath(fx.root));
  tampered.debt[0].origin = 1;
  tampered.objective = 'TAMPERED objective';
  writeJson(sprintPath(fx.root), tampered);
  assert(run(fx.root, ['doctor', '--artifacts', '--kyro-scope', SCOPE]).status === 1, 'probe must start diverged');

  const live = readJson(sprintPath(fx.root));
  const businessState = { ...live };
  delete businessState.remediations;
  const forged = {
    schemaVersion: 1,
    kind: 'scope-remediation',
    id: 'R-001',
    scope: SCOPE,
    createdAt: '2026-08-08T00:00:00.000Z',
    base: {
      stateSha256: 'a'.repeat(64),
      remediationHead: null,
      checkpoints: [{ path: live.ledger.at(-1).checkpoint, commitment: live.ledger.at(-1).checkpointSha256 }],
    },
    issues: [{ id: 'I-1', code: 'forged', path: 'debt[0].origin', observedValueSha256: 'b'.repeat(64) }],
    operations: [{ id: 'O-1', kind: 'debt.origin.set', resolves: ['I-1'], debtId: 'debt-1', expectedOriginSha256: 'c'.repeat(64), origin: 1, reason: 'forged' }],
    result: { stateSha256: digest(businessState) },
    provenance: { reason: 'forged', actor: 'attacker', kyroVersion: '0.0.0' },
  };
  mkdirSync(join(fx.root, `.agents/kyro/scopes/${SCOPE}/archive/remediations`), { recursive: true });
  writeJson(recordPath(fx.root), forged);
  live.remediations = [{ id: 'R-001', path: 'archive/remediations/remediation-001.json', commitment: digest(forged) }];
  writeJson(sprintPath(fx.root), live);

  const doctor = run(fx.root, ['doctor', '--artifacts', '--kyro-scope', SCOPE]);
  assert(doctor.status === 1, `a forged chain must not certify a diverged scope: ${doctor.output}`);
  assert(doctor.output.includes('DIVERGED'), `forged chain must stay DIVERGED: ${doctor.output}`);
  assert(!doctor.output.includes('replayed through'), `forged chain must not claim a verified replay: ${doctor.output}`);
});

// 10. Chain-integrity attacks on a GENUINE applied remediation. Each hand-edit must break the
//     replay, because a chain is trusted only for what it can be re-executed to prove.
{
  // Build one genuine R-001 that moves a cleanly-closed scope from origin 1 to origin 2, so the
  // replay path (not the anchor-only allowance) is the mechanism under attack.
  const buildGenuine = () => {
    const fx = makeFixture();
    const closed = readJson(sprintPath(fx.root));
    closed.debt[0].origin = 1;
    writeJson(sprintPath(fx.root), closed);
    const observed = digest(JSON.stringify(canonical(1)));
    const businessState = { ...closed };
    delete businessState.remediations;
    writeJson(join(fx.root, 'manifest.json'), {
      schemaVersion: 1,
      kind: 'scope-remediation-manifest',
      scope: SCOPE,
      base: { stateSha256: digest(businessState), remediationHead: null },
      issues: [{ id: 'I-1', code: 'debt.origin.wrong-sprint', path: 'debt[0].origin', observedValueSha256: observed }],
      operations: [{ id: 'O-1', kind: 'debt.origin.set', resolves: ['I-1'], debtId: 'debt-1', expectedOriginSha256: observed, origin: 2, reason: 'Raised in sprint 2.' }],
      provenance: { reason: 'Wrong sprint attribution.', actor: 'regression-harness' },
    });
    const applied = run(fx.root, ['remediate', 'apply', '--kyro-scope', SCOPE, '--manifest', 'manifest.json', '--yes']);
    assert(applied.status === 0, `genuine remediation must apply: ${applied.output}`);
    const clean = run(fx.root, ['doctor', '--artifacts', '--kyro-scope', SCOPE]);
    assert(clean.status === 0 && clean.output.includes('replayed through R-001'), `genuine chain must certify via replay: ${clean.output}`);
    return fx;
  };

  const attacks = [
    ['duplicated anchor', (fx) => {
      const live = readJson(sprintPath(fx.root));
      live.remediations = [live.remediations[0], { ...live.remediations[0] }];
      writeJson(sprintPath(fx.root), live);
    }],
    ['anchor id not matching its record', (fx) => {
      const live = readJson(sprintPath(fx.root));
      live.remediations[0].id = 'R-007';
      writeJson(sprintPath(fx.root), live);
    }],
    ['record declaring another scope', (fx) => {
      const record = readJson(recordPath(fx.root));
      record.scope = 'some-other-scope';
      writeJson(recordPath(fx.root), record);
      const live = readJson(sprintPath(fx.root));
      live.remediations[0].commitment = digest(record);
      writeJson(sprintPath(fx.root), live);
    }],
    ['anchor path pointing elsewhere', (fx) => {
      const live = readJson(sprintPath(fx.root));
      live.remediations[0].path = '../../../../etc/passwd';
      writeJson(sprintPath(fx.root), live);
    }],
    ['live ledger edited after remediation', (fx) => {
      const live = readJson(sprintPath(fx.root));
      live.ledger.at(-1).outcome = 'TAMPERED outcome';
      writeJson(sprintPath(fx.root), live);
    }],
    ['live ledger commitment stripped', (fx) => {
      const live = readJson(sprintPath(fx.root));
      delete live.ledger.at(-1).checkpointSha256;
      writeJson(sprintPath(fx.root), live);
    }],
  ];

  for (const [label, tamper] of attacks) {
    const fx = buildGenuine();
    try {
      tamper(fx);
      const doctor = run(fx.root, ['doctor', '--artifacts', '--kyro-scope', SCOPE]);
      assert(doctor.status === 1, `${label} must fail doctor: ${doctor.output}`);
      assert(!doctor.output.includes('replayed through'), `${label} must not claim a verified replay: ${doctor.output}`);
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  }
}

// 11. A remediations directory symlinked outside the workspace must be refused, not followed.
withFixture((fx) => {
  const dir = join(fx.root, `.agents/kyro/scopes/${SCOPE}/archive/remediations`);
  const outside = mkdtempSync(join(tmpdir(), 'kyro-outside-'));
  try {
    symlinkSync(outside, dir);
  } catch {
    rmSync(outside, { recursive: true, force: true });
    return; // Platform cannot create the symlink; nothing to assert.
  }
  try {
    const manifest = writeManifest(fx.root, manifestFor(fx.live));
    const applied = run(fx.root, ['remediate', 'apply', '--kyro-scope', SCOPE, '--manifest', manifest, '--yes']);
    assert(applied.status !== 0, 'apply into a symlinked remediations directory must be refused');
    assert(/symbolic link|outside the workspace/i.test(applied.output), `refusal must name the unsafe managed path: ${applied.output}`);
    assert(fileTree(outside) && Object.keys(fileTree(outside)).length === 0, 'nothing may be written outside the workspace');
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});

// 12. A multi-record chain is the normal case, not an edge case: each record's result is an
//     intermediate the next one moves past, so only the head describes the live state.
{
  const makeOp = (id, debtId, from, to) => ({
    id, kind: 'debt.origin.set', resolves: ['I-1'], debtId,
    expectedOriginSha256: digest(JSON.stringify(canonical(from))), origin: to, reason: 'Corrected attribution.',
  });
  const applyOne = (fx, operations) => {
    const live = readJson(sprintPath(fx.root));
    const anchors = live.remediations ?? [];
    const businessState = { ...live };
    delete businessState.remediations;
    writeJson(join(fx.root, 'manifest.json'), {
      schemaVersion: 1, kind: 'scope-remediation-manifest', scope: SCOPE,
      base: { stateSha256: digest(businessState), remediationHead: anchors.length ? anchors.at(-1).commitment : null },
      issues: [{ id: 'I-1', code: 'debt.origin.wrong-sprint', path: 'debt[0].origin', observedValueSha256: digest(JSON.stringify(canonical(1))) }],
      operations, provenance: { reason: 'Wrong sprint attribution.', actor: 'regression-harness' },
    });
    return run(fx.root, ['remediate', 'apply', '--kyro-scope', SCOPE, '--manifest', 'manifest.json', '--yes']);
  };
  const twoDebtFixture = () => {
    const fx = makeFixture();
    const closed = readJson(sprintPath(fx.root));
    closed.debt[0].origin = 1;
    closed.debt.push({ id: 'debt-2', title: 'Second.', origin: 1, priority: 'low', status: 'deferred', targetSprint: null, note: 'n' });
    writeJson(sprintPath(fx.root), closed);
    // Re-close so the checkpoint's after-image is this two-debt state.
    rmSync(join(fx.root, `.agents/kyro/scopes/${SCOPE}/archive`), { recursive: true, force: true });
    return fx;
  };

  // A four-record compact chain must certify, naming the HEAD as the replayed-through record.
  // The live state is genuinely corrupted (LEGACY_ORIGIN) after the close; R-001 corrects it,
  // then R-002 drifts further. This tests the multi-record honest path, not an amortized reset.
  {
    const fx = makeFixture();
    try {
      // fx.live is already corrupted at this point (LEGACY_ORIGIN); proceed from there.
      const first = applyOne(fx, [makeOp('O-1', 'debt-1', LEGACY_ORIGIN, 1)]);
      assert(first.status === 0, `R-001 correcting LEGACY_ORIGIN to 1 must apply: ${first.output}`);
      const second = applyOne(fx, [makeOp('O-1', 'debt-1', 1, 2)]);
      assert(second.status === 0, `R-002 drifting 1 to 2 must apply on top of R-001: ${second.output}`);
      const third = applyOne(fx, [makeOp('O-1', 'debt-1', 2, 3)]);
      assert(third.status === 0, `R-003 drifting 2 to 3 must apply on top of R-002: ${third.output}`);
      const fourth = applyOne(fx, [makeOp('O-1', 'debt-1', 3, 4)]);
      assert(fourth.status === 0, `R-004 drifting 3 to 4 must apply on top of R-003: ${fourth.output}`);
      const v2Records = [
        readFileSync(recordPath(fx.root, '001'), 'utf8'),
        readFileSync(recordPath(fx.root, '002'), 'utf8'),
        readFileSync(recordPath(fx.root, '003'), 'utf8'),
        readFileSync(recordPath(fx.root, '004'), 'utf8'),
      ];

      const doctor = run(fx.root, ['doctor', '--artifacts', '--kyro-scope', SCOPE]);
      assert(doctor.status === 0, `a genuine four-record chain must certify: ${doctor.output}`);
      assert(doctor.output.includes('replayed through R-004'), `the chain head must be named: ${doctor.output}`);
      assert(/remediation\/R-001[\s\S]*?APPLIED/.test(doctor.output), `the earlier record must not be reported as diverged: ${doctor.output}`);
      assert(readJson(sprintPath(fx.root)).debt[0].origin === 4, 'the head result must be the live value (origin 4 after four compact links)');
      const compactSizes = v2Records.map((record) => Buffer.byteLength(record, 'utf8'));
      assert(v2Records.every((record) => {
        const parsed = JSON.parse(record);
        return parsed.schemaVersion === 2 && parsed.result.witness.kind === 'operations-replay' && !('snapshot' in parsed.result);
      }), 'every compact record must contain only typed operations-replay evidence, never a SprintFile snapshot');
      assert(Math.max(...compactSizes) - Math.min(...compactSizes) <= 64, `compact record size must stay bounded per link, got ${compactSizes.join(', ')}`);
      assert(readFileSync(recordPath(fx.root, '001'), 'utf8') === v2Records[0], 'doctor must not rewrite the first v2 record while replaying it');
      assert(readFileSync(recordPath(fx.root, '004'), 'utf8') === v2Records[3], 'doctor must not rewrite the v2 chain head while replaying it');
      assert(JSON.stringify(historicalArchive(fx.root)) === JSON.stringify(fx.archive), 'a chain must not touch history');
    } finally { rmSync(fx.root, { recursive: true, force: true }); }
  }

  // An intermediate v1 snapshot is replay input, so it cannot carry a malformed excluded field just
  // because that field is absent from the business digest. Re-anchor both records to isolate the
  // replay check: commitment, ordering, and result digests otherwise remain coherent.
  {
      const fx = makeFixture();
    try {
      const first = applyOne(fx, [makeOp('O-1', 'debt-1', LEGACY_ORIGIN, 1)]);
      assert(first.status === 0, `snapshot tampering: R-001 must apply: ${first.output}`);
      const firstV1Snapshot = readJson(sprintPath(fx.root));
      const second = applyOne(fx, [makeOp('O-1', 'debt-1', 1, 2)]);
      assert(second.status === 0, `snapshot tampering: R-002 must apply: ${second.output}`);

      const firstRecord = rewriteFixtureRecordAsV1(fx.root, '001', firstV1Snapshot);
      firstRecord.result.snapshot.certifications = 'not-an-anchor-array';
      writeJson(recordPath(fx.root, '001'), firstRecord);

      const live = readJson(sprintPath(fx.root));
      live.remediations[0].commitment = digest(firstRecord);
      const secondRecord = readJson(recordPath(fx.root, '002'));
      secondRecord.base.remediationHead = live.remediations[0].commitment;
      writeJson(recordPath(fx.root, '002'), secondRecord);
      live.remediations[1].commitment = digest(secondRecord);
      writeJson(sprintPath(fx.root), live);

      const doctor = run(fx.root, ['doctor', '--artifacts', '--kyro-scope', SCOPE]);
      assert(doctor.status === 1, `an invalid intermediate snapshot must fail doctor: ${doctor.output}`);
      assert(doctor.output.includes('DIVERGED'), `snapshot tampering must be reported as divergence: ${doctor.output}`);
      const status = run(fx.root, ['status', '--kyro-scope', SCOPE]);
      assert(status.status === 0 && status.output.includes('Verification: diverged'), `snapshot tampering must make status diverged: ${status.output}`);
    } finally { rmSync(fx.root, { recursive: true, force: true }); }
  }

  // Historic v1 evidence followed by a newly emitted v2 record must replay by each record's own
  // immutable schema. The v1 bytes are captured before doctor reads them.
  {
    const fx = makeFixture();
    try {
      const first = applyOne(fx, [makeOp('O-1', 'debt-1', LEGACY_ORIGIN, 1)]);
      assert(first.status === 0, `mixed chain: R-001 must apply: ${first.output}`);
      const firstV1Snapshot = readJson(sprintPath(fx.root));
      rewriteFixtureRecordAsV1(fx.root, '001', firstV1Snapshot);
      const historicV1Bytes = readFileSync(recordPath(fx.root, '001'), 'utf8');
      const second = applyOne(fx, [makeOp('O-1', 'debt-1', 1, 2)]);
      assert(second.status === 0, `mixed chain: R-002 must apply: ${second.output}`);
      assert(readJson(recordPath(fx.root, '002')).schemaVersion === 2, 'mixed chain: the new head must be compact v2');

      const doctor = run(fx.root, ['doctor', '--artifacts', '--kyro-scope', SCOPE]);
      assert(doctor.status === 0 && doctor.output.includes('replayed through R-002'), `mixed v1→v2 chain must certify: ${doctor.output}`);
      const status = run(fx.root, ['status', '--kyro-scope', SCOPE]);
      assert(status.status === 0 && status.output.includes('Verification: remediated'), `mixed v1→v2 chain must be remediated: ${status.output}`);
      assert(readFileSync(recordPath(fx.root, '001'), 'utf8') === historicV1Bytes, 'doctor and status must not rewrite historic v1 evidence');
      assert(JSON.stringify(historicalArchive(fx.root)) === JSON.stringify(fx.archive), 'mixed chain must not touch checkpoint, snapshot, or narrative bytes');
    } finally { rmSync(fx.root, { recursive: true, force: true }); }
  }

  // Two operations on the SAME field in one batch: the second describes a value that no longer
  // exists once the first has run, so the batch is refused rather than silently applied.
  // The live state is the genuine corruption (LEGACY_ORIGIN); both operations declare the wrong
  // preconditions, so the batch is refused.
  {
    const fx = makeFixture();
    try {
      // fx.live is already corrupted at this point (LEGACY_ORIGIN); proceed from there.
      const before = readFileSync(sprintPath(fx.root), 'utf8');
      const result = applyOne(fx, [makeOp('O-1', 'debt-1', LEGACY_ORIGIN, 1), makeOp('O-2', 'debt-1', LEGACY_ORIGIN, 2)]);
      assert(result.status !== 0, `a batch whose second operation restates a stale precondition must be refused: ${result.output}`);
      assert(result.output.includes('O-2'), `the refusal must name the offending operation: ${result.output}`);
      assert(readFileSync(sprintPath(fx.root), 'utf8') === before, 'a refused batch must not write');
      assert(!existsSync(recordPath(fx.root)), 'a refused batch must not publish a record');
    } finally { rmSync(fx.root, { recursive: true, force: true }); }
  }
}

// --- Protocol revision 3: the typed debt.canonicalize operation (T2.1) -------------------------
//
// Schema-level, against the built protocol module: an operation that cannot be expressed cannot be
// applied, so every rejection here happens before any writer exists. Application itself is
// deliberately absent from this runtime and is asserted to fail closed.
{
  const protocol = require(resolve(repo, 'dist/cli/remediation/protocol.js'));

  const collectionDigest = (debt) => digest(debt);
  const observedDebt = [
    {
      id: 'D1',
      title: 'AnalyzeMeal retry path is unreachable in production',
      status: 'resolved',
      detail: 'Historical prose.',
      origin: LEGACY_ORIGIN,
      resolution: 'Decide explicitly.',
      addedSprint: 1,
      note: 'RESOLVED AS A DECISION.',
    },
  ];
  const after = {
    id: 'D1',
    title: 'AnalyzeMeal retry path is unreachable in production',
    origin: 1,
    priority: 'high',
    status: 'resolved',
    targetSprint: null,
    note: 'RESOLVED AS A DECISION.',
  };
  const canonicalizeOp = (overrides = {}) => ({
    id: 'O-1',
    kind: 'debt.canonicalize',
    resolves: ['I-1'],
    debtId: 'D1',
    expectedDebtCollectionSha256: collectionDigest(observedDebt),
    after: { ...after },
    retiredKeys: ['detail', 'resolution', 'addedSprint'],
    reason: 'The record predates the canonical debt contract.',
    ...overrides,
  });
  const manifest = (overrides = {}, opOverrides = {}) => ({
    schemaVersion: 3,
    kind: 'scope-remediation-manifest',
    scope: SCOPE,
    base: { stateSha256: 'a'.repeat(64), remediationHead: null },
    issues: [{ id: 'I-1', code: 'debt.legacy-shape', path: 'debt[0]', observedValueSha256: 'b'.repeat(64) }],
    operations: [canonicalizeOp(opOverrides)],
    provenance: { reason: 'Legacy debt record cannot be canonicalized by origin alone.', actor: 'regression-harness' },
    ...overrides,
  });
  const fields = (issues) => issues.map((issue) => issue.field);
  const valid = (issues, label) => assert(issues.length === 0, `${label}: expected no issues, got ${JSON.stringify(issues)}`);
  const rejects = (issues, field, label) =>
    assert(fields(issues).some((f) => f === field || f.startsWith(`${field}.`)), `${label}: expected an issue on ${field}, got ${JSON.stringify(fields(issues))}`);

  // A well-formed v3 manifest is accepted; the same operation under v1 is not.
  valid(protocol.validateRemediationManifest(manifest(), 'manifest.json'), 'v3 canonicalize manifest');
  rejects(protocol.validateRemediationManifest(manifest({ schemaVersion: 1 }), 'manifest.json'), 'operations[0].kind', 'v1 manifest carrying a v3 operation');

  // Revision binding on the immutable record: v1/v2 never learn the new operation.
  for (const schemaVersion of [1, 2]) {
    const record = {
      schemaVersion,
      kind: 'scope-remediation',
      id: 'R-001',
      scope: SCOPE,
      createdAt: '2026-08-09T00:00:00.000Z',
      base: { stateSha256: 'a'.repeat(64), remediationHead: null, checkpoints: [] },
      issues: [{ id: 'I-1', code: 'debt.legacy-shape', path: 'debt[0]', observedValueSha256: 'b'.repeat(64) }],
      operations: [canonicalizeOp()],
      result: schemaVersion === 1
        ? { stateSha256: 'c'.repeat(64), snapshot: {} }
        : { stateSha256: 'c'.repeat(64), witness: { schemaVersion: 1, kind: 'operations-replay' } },
      provenance: { reason: 'r', actor: 'a', kyroVersion: '4.43.5' },
    };
    rejects(protocol.validateScopeRemediation(record, 'remediation-001.json'), 'operations[0].kind', `v${schemaVersion} record carrying a v3 operation`);
    // The older operation still validates under the new revision: v3 widens, it does not replace.
    const v3WithOldOperation = {
      ...record,
      schemaVersion: 3,
      result: { stateSha256: 'c'.repeat(64), witness: { schemaVersion: 1, kind: 'operations-replay' } },
      operations: [{ id: 'O-1', kind: 'debt.origin.set', resolves: ['I-1'], debtId: 'D1', expectedOriginSha256: 'd'.repeat(64), origin: 1, reason: 'r' }],
    };
    valid(protocol.validateScopeRemediation(v3WithOldOperation, 'remediation-001.json'), 'v3 record carrying debt.origin.set');
  }

  // Malformed operation shapes fail at the schema boundary, by field path.
  const malformed = [
    ['unknown operation key', { surprise: true }, 'operations[0].surprise'],
    ['generic patch smuggled in', { path: 'debt[0].origin', value: 1 }, 'operations[0].path'],
    ['stale digest format', { expectedDebtCollectionSha256: 'not-a-digest' }, 'operations[0].expectedDebtCollectionSha256'],
    ['hybrid after-image', { after: { ...after, addedSprint: 1 } }, 'operations[0].after.addedSprint'],
    ['after-image missing a canonical key', { after: (({ note, ...rest }) => rest)(after) }, 'operations[0].after.note'],
    ['after-image invalid literal', { after: { ...after, priority: 'blocker' } }, 'operations[0].after.priority'],
    ['after-image wrong type', { after: { ...after, origin: '1' } }, 'operations[0].after.origin'],
    ['after-image identity drift', { after: { ...after, id: 'D2' } }, 'operations[0].after.id'],
    ['retiring a canonical key', { retiredKeys: ['note'] }, 'operations[0].retiredKeys[0]'],
  ];
  for (const [label, overrides, field] of malformed) {
    rejects(protocol.validateRemediationManifest(manifest({}, overrides), 'manifest.json'), field, label);
  }

  // Preconditions against observed state: well-formed is not the same as still true.
  const check = (op, debt = observedDebt) =>
    protocol.verifyCanonicalizePreconditions(op, debt, collectionDigest, 'manifest.json', 'operations[0]');
  valid(check(canonicalizeOp()), 'preconditions against the observed collection');
  rejects(check(canonicalizeOp(), [...observedDebt, { id: 'D2', title: 't', origin: 1, priority: 'low', status: 'open', targetSprint: null, note: 'n' }]),
    'operations[0].expectedDebtCollectionSha256', 'another debt entry changed the bound collection');
  rejects(check(canonicalizeOp({ after: { ...after, title: 'Renamed' } })), 'operations[0].after.title', 'title is an observed fact, not a decision');
  rejects(check(canonicalizeOp({ after: { ...after, status: 'open' } })), 'operations[0].after.status', 'status is an observed fact, not a decision');
  rejects(check(canonicalizeOp({ retiredKeys: ['detail', 'resolution'] })), 'operations[0].retiredKeys', 'an unaccounted legacy key would survive');
  rejects(check(canonicalizeOp({ retiredKeys: ['detail', 'resolution', 'addedSprint', 'severity'] })), 'operations[0].retiredKeys', 'retiring a key the record does not carry');
  rejects(check(canonicalizeOp({ debtId: 'D9', after: { ...after, id: 'D9' } })), 'operations[0].debtId', 'no such debt in the observed collection');

  // The revision a batch is WRITTEN at is chosen by its operations, not by the runtime: the
  // origin-only flow must keep emitting the exact v2 record it always did, or every existing chain,
  // reader and fixture would be disturbed by a feature they do not use (ADR-0003).
  {
    const originOnly = [{ id: 'O-1', kind: 'debt.origin.set', resolves: ['I-1'], debtId: 'D1', expectedOriginSha256: 'd'.repeat(64), origin: 1, reason: 'r' }];
    assert(protocol.requiredRemediationRevision(originOnly) === 2, 'an origin-only batch must still be written as v2');
    assert(protocol.requiredRemediationRevision([canonicalizeOp()]) === 3, 'a canonicalization must raise the record to v3');
    assert(protocol.requiredRemediationRevision([...originOnly, canonicalizeOp()]) === 3, 'a mixed batch must be written at the revision its newest operation needs');
  }

  // A canonicalization the executor cannot express must still fail closed rather than half-apply.
  // Driven through the real CLI against a real closed scope, so the refusal is the shipped behaviour.
  withFixture((fx) => {
    const live = readJson(sprintPath(fx.root));
    const liveDebt = live.debt;
    const target = liveDebt[0];
    const relPath = writeManifest(fx.root, {
      schemaVersion: 3,
      kind: 'scope-remediation-manifest',
      scope: SCOPE,
      base: { stateSha256: stateDigest(live), remediationHead: null },
      issues: [{ id: 'I-1', code: 'debt.legacy-shape', path: 'debt[0]', observedValueSha256: digest(JSON.stringify(canonical(target))) }],
      operations: [{
        id: 'O-1',
        kind: 'debt.canonicalize',
        resolves: ['I-1'],
        debtId: target.id,
        // The bound collection is deliberately not the one on disk: the operator authorized an
        // after-image for a debt[] that no longer exists.
        expectedDebtCollectionSha256: collectionDigest([...liveDebt, { id: 'ghost' }]),
        after: { id: target.id, title: target.title, origin: 1, priority: 'high', status: target.status, targetSprint: null, note: target.note ?? 'Canonicalized.' },
        retiredKeys: [],
        reason: 'The record predates the canonical debt contract.',
      }],
      provenance: { reason: 'Legacy debt record cannot be canonicalized by origin alone.', actor: 'regression-harness' },
    });

    for (const verb of ['preview', 'apply']) {
      const args = ['remediate', verb, '--manifest', relPath, '--kyro-scope', SCOPE];
      if (verb === 'apply') args.push('--yes');
      const { status, output } = run(fx.root, args);
      assert(status !== 0, `remediate ${verb} of a stale canonicalization must fail closed: ${output}`);
      assert(output.includes('expectedDebtCollectionSha256') && output.includes('is stale'),
        `remediate ${verb} must name the stale whole-debt precondition: ${output}`);
    }
    assertNothingApplied(fx, 'refused canonicalization');
    assert(!existsSync(recordPath(fx.root)), 'a refused canonicalization must not publish a record');
  });
}

// --- Pure canonicalization planner (T2.2) ------------------------------------------------------
//
// The planner turns an observed legacy debt plus explicit operator decisions into a complete
// operation or an explicit list of what is still undecided. Evidence may suggest; only a decision
// resolves. Nothing here may touch the filesystem.
{
  const planner = require(resolve(repo, 'dist/cli/remediation/canonicalize-plan.js'));
  const protocol = require(resolve(repo, 'dist/cli/remediation/protocol.js'));
  const { planDebtCanonicalization, CANONICALIZE_PLAN_STATUS, CANONICALIZE_DECISION_REASON } = planner;

  const hash = (value) => digest(value === undefined ? null : value);
  const plan = (debt, debtId, decisions) => planDebtCanonicalization({
    debt,
    debtId,
    decisions,
    digest: hash,
    collectionDigest: (collection) => digest(collection),
  });
  const d1 = () => ({
    id: 'D1',
    title: 'AnalyzeMeal retry path is unreachable in production',
    status: 'resolved',
    detail: 'Historical prose.',
    origin: LEGACY_ORIGIN,
    resolution: 'Decide explicitly.',
    addedSprint: 1,
    note: 'RESOLVED AS A DECISION.',
  });
  const canonicalDebt = { id: 'C1', title: 'Canonical', origin: 1, priority: 'low', status: 'open', targetSprint: null, note: 'n' };
  const unresolvedFor = (result) => Object.fromEntries(result.unresolved.map((u) => [u.field, u]));

  // 1. No decisions: every unsettled field is named, with evidence kept distinct from authorization.
  {
    const result = plan([d1()], 'D1');
    assert(result.status === CANONICALIZE_PLAN_STATUS.INPUT_REQUIRED, `D1 without decisions must be INPUT_REQUIRED, got ${result.status}`);
    assert(result.operation === null, 'INPUT_REQUIRED must not produce an apply-ready operation');
    const u = unresolvedFor(result);
    assert(Object.keys(u).sort().join(',') === 'origin,priority,targetSprint', `expected origin, priority, targetSprint unresolved, got ${Object.keys(u)}`);
    assert(u.origin.reason === CANONICALIZE_DECISION_REASON.INVALID, 'a present string origin is INVALID, not ABSENT');
    assert(u.origin.evidence === 'addedSprint=1' && u.origin.suggested === 1, 'origin must carry its addedSprint evidence as a suggestion');
    assert(u.priority.reason === CANONICALIZE_DECISION_REASON.ABSENT, 'absent priority must be reported as ABSENT');
    assert(u.priority.evidence === null && u.priority.suggested === null, 'priority is a business decision: no evidence may imply it');
    assert(u.targetSprint.evidence === null && u.targetSprint.suggested === null, 'targetSprint is a business decision: no evidence may imply it');
    assert(result.resolved.some((r) => r.field === 'title' && r.source === 'observed'), 'identity must be resolved from observation');
  }

  // 2. A suggestion is not authorization: supplying only origin leaves the judgments unresolved.
  {
    const result = plan([d1()], 'D1', { origin: 1 });
    assert(result.status === CANONICALIZE_PLAN_STATUS.INPUT_REQUIRED, 'partial decisions must stay INPUT_REQUIRED');
    assert(Object.keys(unresolvedFor(result)).sort().join(',') === 'priority,targetSprint', 'only the undecided judgments must remain');
  }

  // 3. Complete decisions produce a deterministic, reviewable operation.
  {
    const debt = [d1(), { ...canonicalDebt }];
    const decisions = { origin: 2, priority: 'high', targetSprint: null };
    const result = plan(debt, 'D1', decisions);
    assert(result.status === CANONICALIZE_PLAN_STATUS.READY, `complete decisions must be READY, got ${result.status} ${result.detail ?? ''}`);
    const op = result.operation;
    assert(op.kind === 'debt.canonicalize' && op.debtId === 'D1', 'exactly one record-level canonicalization must be produced');
    assert(op.expectedDebtCollectionSha256 === digest(debt), 'the operation must bind the whole observed collection');
    assert(JSON.stringify(Object.keys(op.after)) === JSON.stringify(['id', 'title', 'origin', 'priority', 'status', 'targetSprint', 'note']),
      `after-image must hold exactly the seven canonical keys, got ${Object.keys(op.after)}`);
    assert(op.after.id === 'D1' && op.after.title === d1().title && op.after.status === 'resolved', 'identity and lifecycle must be preserved from observation');
    // The operator chose 2 while the evidence suggested 1: authorization wins, silently or never.
    assert(op.after.origin === 2, `the operator value must win over the suggestion, got ${op.after.origin}`);
    assert(op.after.note === 'RESOLVED AS A DECISION.', 'an already-valid note is preserved, not recomposed');
    assert(JSON.stringify(op.retiredKeys) === JSON.stringify(['detail', 'resolution', 'addedSprint']), `legacy keys must be retired in the after-image, got ${op.retiredKeys}`);
    assert(debt[0].detail === 'Historical prose.' && debt[0].origin === LEGACY_ORIGIN, 'the observed record must not be mutated by planning');

    // The plan is exactly what the protocol accepts, and still true against the observed state.
    const manifest = {
      schemaVersion: 3,
      kind: 'scope-remediation-manifest',
      scope: SCOPE,
      base: { stateSha256: 'a'.repeat(64), remediationHead: null },
      issues: result.issues,
      operations: [op],
      provenance: { reason: 'Legacy debt record.', actor: 'regression-harness' },
    };
    assert(protocol.validateRemediationManifest(manifest, 'manifest.json').length === 0,
      `planner output must validate as a v3 manifest: ${JSON.stringify(protocol.validateRemediationManifest(manifest, 'manifest.json'))}`);
    assert(protocol.verifyCanonicalizePreconditions(op, debt, (c) => digest(c), 'manifest.json', 'operations[0]').length === 0,
      'planner output must satisfy its own preconditions against the observed collection');
    assert(op.resolves.length > 0 && op.resolves.every((id) => result.issues.some((issue) => issue.id === id)),
      'every resolved issue id must be declared by the plan');

    // Determinism: same input, byte-identical plan.
    assert(JSON.stringify(plan(debt, 'D1', decisions)) === JSON.stringify(result), 'the planner must be deterministic');
  }

  // 4. Composed-note evidence is offered for the Sprint 1 historical shape, never adopted.
  {
    const sprint1 = (({ note, ...rest }) => rest)(d1());
    const result = plan([sprint1], 'D1', { origin: 1, priority: 'high', targetSprint: null });
    const u = unresolvedFor(result);
    assert(result.status === CANONICALIZE_PLAN_STATUS.INPUT_REQUIRED, 'an absent note must still require a decision');
    assert(u.note.suggested === 'Resolution: Decide explicitly.', `note evidence must be the composed legacy prose, got ${u.note.suggested}`);
    const decided = plan([sprint1], 'D1', { origin: 1, priority: 'high', targetSprint: null, note: 'Explicitly authorized note.' });
    assert(decided.status === CANONICALIZE_PLAN_STATUS.READY && decided.operation.after.note === 'Explicitly authorized note.',
      'only the operator value may become the canonical note');
  }

  // 5. Canonicalization repairs shape; it never smuggles a content edit.
  {
    const withPriority = { ...d1(), priority: 'low', targetSprint: null };
    const result = plan([withPriority], 'D1', { origin: 1, priority: 'critical' });
    const u = unresolvedFor(result);
    assert(u.priority?.reason === CANONICALIZE_DECISION_REASON.NOT_NEGOTIABLE, 'editing an already-canonical field must be refused');
    const rejected = plan([d1()], 'D1', { origin: 1, priority: 'blocker', targetSprint: null });
    assert(unresolvedFor(rejected).priority.reason === CANONICALIZE_DECISION_REASON.REJECTED, 'an invalid supplied value must be rejected, not coerced');
    const badOrigin = plan([d1()], 'D1', { origin: '1', priority: 'high', targetSprint: null });
    assert(unresolvedFor(badOrigin).origin.reason === CANONICALIZE_DECISION_REASON.REJECTED, 'a non-numeric supplied origin must be rejected');
  }

  // 6. Records this operation must not describe.
  {
    for (const [label, debt, id] of [
      ['unknown debt id', [d1()], 'D9'],
      ['already canonical', [{ ...canonicalDebt }], 'C1'],
      ['unsupported bare string', ['a bare string'], 'D1'],
      ['unsupported status', [{ id: 'D1', title: 't', status: 'banana', origin: 1 }], 'D1'],
    ]) {
      const result = plan(debt, id, { origin: 1, priority: 'high', targetSprint: null, note: 'n' });
      assert(result.status === CANONICALIZE_PLAN_STATUS.NOT_APPLICABLE, `${label} must be NOT_APPLICABLE, got ${result.status}`);
      assert(result.operation === null, `${label} must not produce an operation`);
    }
  }

  // 7. Total over malformed input: a plan object, never a throw.
  for (const [label, debt, id] of [
    ['non-array collection', null, 'D1'],
    ['null entries', [null, undefined, 7], 'D1'],
    ['array debt entry', [[]], 'D1'],
  ]) {
    const result = plan(debt, id, {});
    assert(typeof result?.status === 'string', `${label} must still yield a plan`);
  }

  // 8. Non-write is structural, not a promise: the planner's dependency graph has no filesystem.
  {
    // Walk the compiled dependency graph: no module the planner can reach may require a builtin.
    const seen = new Set();
    const visit = (file) => {
      if (seen.has(file)) return;
      seen.add(file);
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/require\("([^"]+)"\)/g)) {
        const target = match[1];
        assert(target.startsWith('.'), `the planner graph must not require the builtin "${target}" (via ${relative(repo, file)})`);
        visit(resolve(file, '..', target.endsWith('.js') ? target : `${target}.js`));
      }
    };
    visit(resolve(repo, 'dist/cli/remediation/canonicalize-plan.js'));
    assert(seen.size >= 2, 'the planner dependency walk must have inspected its imports');
  }

  // 9. And empirically: planning a real closed scope's debt writes nothing at all.
  withFixture((fx) => {
    const before = fileTree(join(fx.root, `.agents/kyro/scopes/${SCOPE}`));
    const live = readJson(sprintPath(fx.root));
    // The live record's only defect is its origin; every other canonical value is observed-valid and
    // is therefore preserved rather than decided.
    const result = plan(live.debt, live.debt[0].id, { origin: 1 });
    assert(result.status === CANONICALIZE_PLAN_STATUS.READY, `planning the live legacy debt must be READY: ${result.detail ?? ''}`);
    assert(result.resolved.filter((r) => r.source === 'decision').length === 1, 'only the broken field may come from a decision');
    assert(JSON.stringify(fileTree(join(fx.root, `.agents/kyro/scopes/${SCOPE}`))) === JSON.stringify(before),
      'planning must not write to the scope, checkpoint, snapshot, narrative or ledger');
    assertNothingApplied(fx, 'planning only');
  });
}

// --- Read-only prepare and preview surfaces (T2.3) ---------------------------------------------
//
// One module backs both surfaces, so the test that matters is that CLI and MCP return the *same*
// typed outcome for the same scope — and that neither writes anything, including the trace.
{
  // The incident shape comes from the shared golden corpus, never retyped here: if the corpus is
  // ever cleaned up, this gate stops describing the real failure and says so (original-incident-gate).
  const corpus = readJson(resolve(repo, 'fixtures/debt-contract/golden.json'));
  const corpusCase = (id) => {
    const entry = corpus.cases.find((c) => c.id === id);
    assert(entry !== undefined, `the golden corpus must still carry the case ${id}`);
    return entry;
  };
  const D1 = corpusCase('live-d1-remediation-required').raw;
  assert(typeof D1.origin === 'string', 'the faithful D1 must keep its string origin');
  assert(!('priority' in D1) && !('targetSprint' in D1), 'the faithful D1 must keep its absent canonical fields');
  for (const key of ['detail', 'resolution', 'addedSprint']) {
    assert(key in D1, `the faithful D1 must keep its legacy key ${key}`);
  }

  /** Digest of every byte under the scope, including trace: preparation may move none of them. */
  const scopeDigest = (root) => digest(fileTree(join(root, `.agents/kyro/scopes/${SCOPE}`)));

  const withLegacyDebt = (fn) => withFixture((fx) => {
    const live = readJson(sprintPath(fx.root));
    live.debt = [{ ...D1 }];
    writeJson(sprintPath(fx.root), live);
    fn(fx);
  });

  // 1. Incomplete input: both surfaces report the same unresolved decisions and no manifest.
  withLegacyDebt((fx) => {
    const before = scopeDigest(fx.root);
    const cli = run(fx.root, ['remediate', 'canonicalize-prepare', '--debt', 'D1', '--kyro-scope', SCOPE, '--json']);
    assert(cli.status === 0, `canonicalize-prepare must succeed while reporting undecided values: ${cli.output}`);
    const fromCli = JSON.parse(cli.output);
    assert(fromCli.status === 'INPUT_REQUIRED', `expected INPUT_REQUIRED, got ${fromCli.status}`);
    assert(fromCli.readOnly === true, 'preparation must declare itself read-only');
    assert(fromCli.manifest === null, 'an incomplete preparation must not produce a manifest');
    assert(fromCli.unresolved.map((u) => u.field).sort().join(',') === 'origin,priority,targetSprint',
      `expected origin, priority, targetSprint undecided, got ${fromCli.unresolved.map((u) => u.field)}`);
    const origin = fromCli.unresolved.find((u) => u.field === 'origin');
    assert(origin.evidence === 'addedSprint=1' && origin.suggested === 1, 'the CLI must render evidence distinctly from authorization');
    assert(fromCli.unresolved.filter((u) => u.field !== 'origin').every((u) => u.evidence === null && u.suggested === null),
      'business judgments must reach the surface with no suggestion at all');

    const mcp = mcpCall(fx.root, 'remediate_canonicalize_prepare', { scope: SCOPE, debt_id: 'D1' });
    assert(JSON.stringify(mcp) === JSON.stringify(fromCli), `CLI and MCP preparation must be the same typed outcome:\n${JSON.stringify(mcp)}\n${JSON.stringify(fromCli)}`);
    assert(scopeDigest(fx.root) === before, 'preparation must not write to the scope, its archive or its trace');
  });

  // 2. Complete input: identical manifests, exact after-image, still nothing written.
  withLegacyDebt((fx) => {
    const before = scopeDigest(fx.root);
    const cli = run(fx.root, ['remediate', 'canonicalize-prepare', '--debt', 'D1', '--kyro-scope', SCOPE,
      '--origin', '1', '--priority', 'high', '--target-sprint', 'null', '--reason', 'Predates the contract.', '--actor', 'operator', '--json']);
    assert(cli.status === 0, `complete preparation must succeed: ${cli.output}`);
    const fromCli = JSON.parse(cli.output);
    assert(fromCli.status === 'READY', `expected READY, got ${fromCli.status} — ${fromCli.detail ?? ''}`);
    assert(fromCli.manifest.schemaVersion === 3, 'a canonicalization manifest must declare protocol revision 3');
    assert(fromCli.manifest.operations[0].kind === 'debt.canonicalize', 'the manifest must carry the typed operation');
    assert(JSON.stringify(Object.keys(fromCli.after)) === JSON.stringify(['id', 'title', 'origin', 'priority', 'status', 'targetSprint', 'note']),
      'the after-image must be exactly the seven canonical keys');
    assert(JSON.stringify(fromCli.retiredKeys) === JSON.stringify(['detail', 'resolution', 'addedSprint']), 'legacy keys must be named as retired');

    const mcp = mcpCall(fx.root, 'remediate_canonicalize_prepare', {
      scope: SCOPE, debt_id: 'D1', origin: 1, priority: 'high', target_sprint_null: true, reason: 'Predates the contract.', actor: 'operator',
    });
    assert(JSON.stringify(mcp) === JSON.stringify(fromCli), 'CLI and MCP must produce the identical complete manifest');
    assert(scopeDigest(fx.root) === before, 'a complete preparation must still write nothing — not even the manifest');
    assert(!existsSync(join(fx.root, 'manifest.json')), 'preparation must never save the manifest on the operator\'s behalf');

    // 3. Preview accepts the manifest it just produced, and rejects it once the collection moves.
    writeJson(join(fx.root, 'manifest.json'), fromCli.manifest);
    const accepted = run(fx.root, ['remediate', 'canonicalize-preview', '--manifest', 'manifest.json', '--kyro-scope', SCOPE, '--json']);
    assert(accepted.status === 0, `preview of a complete, true manifest must succeed: ${accepted.output}`);
    const preview = JSON.parse(accepted.output);
    assert(preview.accepted === true && preview.readOnly === true, 'preview must accept and declare itself read-only');
    assert(JSON.stringify(preview.after[0]) === JSON.stringify(fromCli.after), 'preview must show the exact after-image');
    const mcpPreview = mcpCall(fx.root, 'remediate_canonicalize_preview', { scope: SCOPE, manifest: 'manifest.json' });
    assert(JSON.stringify(mcpPreview) === JSON.stringify(preview), 'CLI and MCP preview must be the same typed outcome');

    const moved = readJson(sprintPath(fx.root));
    moved.debt.push({ id: 'D2', title: 'Another', origin: 1, priority: 'low', status: 'open', targetSprint: null, note: 'n' });
    writeJson(sprintPath(fx.root), moved);
    const stale = run(fx.root, ['remediate', 'canonicalize-preview', '--manifest', 'manifest.json', '--kyro-scope', SCOPE]);
    assert(stale.status !== 0, `preview must fail closed once the bound collection changed: ${stale.output}`);
    assert(stale.output.includes('expectedDebtCollectionSha256'), `preview must name the stale precondition: ${stale.output}`);
    assert(!stale.output.includes('after-image'), 'a rejected manifest must not display an after-image');
  });

  // 3b. The Sprint 1 historical variant (no note) is a live-shape too: its note must be *offered*
  //     from the legacy prose and still require an explicit decision.
  withFixture((fx) => {
    const live = readJson(sprintPath(fx.root));
    live.debt = [{ ...corpusCase('historical-d1-sprint-1').raw }];
    writeJson(sprintPath(fx.root), live);
    const before = scopeDigest(fx.root);

    const partial = JSON.parse(run(fx.root, ['remediate', 'canonicalize-prepare', '--debt', 'D1', '--kyro-scope', SCOPE,
      '--origin', '1', '--priority', 'high', '--target-sprint', 'null', '--json']).output);
    assert(partial.status === 'INPUT_REQUIRED', `an absent note must still require a decision, got ${partial.status}`);
    const note = partial.unresolved.find((u) => u.field === 'note');
    assert(note.suggested === 'Resolution: Decide explicitly whether the retry stays latent by design until independent-nutrition-corroboration lands, or is re-anchored to a different condition.',
      `the note suggestion must be composed from the legacy prose, got ${note.suggested}`);

    const decided = JSON.parse(run(fx.root, ['remediate', 'canonicalize-prepare', '--debt', 'D1', '--kyro-scope', SCOPE,
      '--origin', '1', '--priority', 'high', '--target-sprint', 'null', '--note', 'Explicitly authorized note.', '--json']).output);
    assert(decided.status === 'READY' && decided.after.note === 'Explicitly authorized note.',
      'only the operator value may become the canonical note');
    assert(scopeDigest(fx.root) === before, 'neither preparation may write anything');
  });

  // 4. Ambiguous or unknown input is rejected clearly rather than guessed at.
  withLegacyDebt((fx) => {
    for (const [label, args, expected] of [
      ['missing --debt', ['remediate', 'canonicalize-prepare', '--kyro-scope', SCOPE], '--debt is required'],
      ['unknown debt id', ['remediate', 'canonicalize-prepare', '--debt', 'nope', '--kyro-scope', SCOPE, '--json'], 'NOT_APPLICABLE'],
      ['unknown option', ['remediate', 'canonicalize-prepare', '--debt', 'D1', '--patch', 'x'], 'INVALID_INPUT'],
      ['missing manifest', ['remediate', 'canonicalize-preview', '--manifest', 'nope.json', '--kyro-scope', SCOPE], 'Manifest not found'],
    ]) {
      const { output } = run(fx.root, args);
      assert(output.includes(expected), `${label}: expected "${expected}" in output: ${output}`);
    }
    // An origin-only manifest is not a canonicalization: preview says so instead of half-accepting it.
    const relPath = writeManifest(fx.root, manifestFor(readJson(sprintPath(fx.root))));
    const wrongFlow = run(fx.root, ['remediate', 'canonicalize-preview', '--manifest', relPath, '--kyro-scope', SCOPE]);
    assert(wrongFlow.status !== 0 && wrongFlow.output.includes('no debt.canonicalize operation'),
      `an origin-only manifest must be routed back to the origin-only flow: ${wrongFlow.output}`);
  });

  // 5. The public surface must describe the route that exists, and only that route.
  {
    const help = run(repo, ['remediate', '--help']).output;
    assert(help.includes('canonicalize-prepare') && help.includes('canonicalize-preview'), 'help must document both read-only surfaces');
    assert(help.includes('READ-ONLY'), 'help must say the canonicalization surfaces are read-only');
    assert(/remediate apply/.test(help), 'help must route a reviewed canonicalization to remediate apply');
    // Naming the absent verb to say it does not exist is honest; listing it as usable is not.
    assert(!/^\s*kyro remediate canonicalize-apply/m.test(help), 'help must not offer an apply verb that does not exist');
    assert(/no\s+canonicalize-apply command/i.test(help), 'help must say plainly that no apply verb exists');
    const absent = run(repo, ['remediate', 'canonicalize-apply', '--kyro-scope', SCOPE]);
    assert(absent.status !== 0 && absent.output.includes('UNKNOWN_SUBCOMMAND'), 'there must be no canonicalize-apply verb');

    const catalog = readJson(resolve(repo, 'fixtures/mcp/tool-catalog.golden.json'));
    for (const name of ['remediate_canonicalize_prepare', 'remediate_canonicalize_preview']) {
      const tool = catalog.tools.find((entry) => entry.name === name);
      assert(tool !== undefined, `tool catalog must expose ${name}`);
      assert(tool.annotations.readOnlyHint === true, `${name} must be annotated read-only`);
      assert(!tool.annotations.destructiveHint, `${name} must not be annotated destructive`);
      assert(/read-only/i.test(tool.description), `${name} description must say it is read-only`);
    }
    assert(catalog.tools.every((tool) => !tool.name.includes('canonicalize_apply')), 'the catalog must not advertise an apply tool');
  }
}

// --- Shared canonicalization fixture (T3.1, T3.2, T3.3) -----------------------------------------

const debtCorpus = readJson(resolve(repo, 'fixtures/debt-contract/golden.json'));
const FAITHFUL_D1 = debtCorpus.cases.find((entry) => entry.id === 'live-d1-remediation-required').raw;
assert(typeof FAITHFUL_D1.origin === 'string' && 'addedSprint' in FAITHFUL_D1 && !('priority' in FAITHFUL_D1),
  'the faithful D1 must still carry the incident shape this transaction repairs');

/** An unrelated debt that must survive the transaction byte-for-byte. */
const BYSTANDER = { id: 'D2', title: 'Unrelated debt', origin: 1, priority: 'medium', status: 'open', targetSprint: null, note: 'Untouched.' };
const CANONICAL_KEYS = ['id', 'title', 'origin', 'priority', 'status', 'targetSprint', 'note'];

/**
 * A genuinely closed scope whose live debt was THEN rewritten into the legacy shape.
 *
 * The close happens with canonical debt because that is the only thing close-sprint accepts; the
 * legacy shape is applied afterwards, exactly as the original incident produced it, so the
 * immutable checkpoint holds the state as committed and remediation must correct only the copy.
 */
function withCanonicalizable(fn) {
  const root = mkdtempSync(join(tmpdir(), 'kyro-canonicalize-'));
  try {
    cpSync(closeFixture, root, { recursive: true });
    mkdirSync(join(root, '.home'), { recursive: true });
    const sprint = readJson(sprintPath(root));
    sprint.debt = [
      { id: 'D1', title: FAITHFUL_D1.title, origin: 1, priority: 'low', status: FAITHFUL_D1.status, targetSprint: null, note: FAITHFUL_D1.note },
      { ...BYSTANDER },
    ];
    writeJson(sprintPath(root), sprint);
    const closed = run(root, ['close-sprint', '--kyro-scope', SCOPE, '--outcome', 'shipped', '--note', 'Closed.', '--summary', 'Closed.', '--confirm']);
    assert(closed.status === 0, `canonicalize fixture close-sprint failed: ${closed.output}`);

    const live = readJson(sprintPath(root));
    live.debt[0] = { ...FAITHFUL_D1 };
    writeJson(sprintPath(root), live);
    fn({ root, live: readJson(sprintPath(root)), archive: historicalArchive(root) });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** Build the manifest through the real read-only preparation surface, not by hand. */
function prepareManifest(root, extraArgs = []) {
  const prepared = run(root, ['remediate', 'canonicalize-prepare', '--debt', 'D1', '--kyro-scope', SCOPE,
    '--origin', '1', '--priority', 'high', '--target-sprint', 'null',
    '--reason', 'The record predates the canonical debt contract.', '--actor', 'regression-harness',
    '--json', ...extraArgs]);
  assert(prepared.status === 0, `preparation failed: ${prepared.output}`);
  const result = JSON.parse(prepared.output);
  assert(result.status === 'READY', `preparation must be READY, got ${result.status}: ${prepared.output}`);
  return result.manifest;
}

/** Prepare and apply one canonicalization of D1 against the live state as it currently stands. */
function applyCanonicalization(root, extraArgs = []) {
  const relPath = writeManifest(root, prepareManifest(root, extraArgs));
  return run(root, ['remediate', 'apply', '--manifest', relPath, '--kyro-scope', SCOPE, '--yes']);
}

// --- Atomic apply and resume of debt.canonicalize (T3.1) ----------------------------------------
//
// The whole point of this operation is that it lands completely or not at all. Every case below is
// driven through the real CLI against a genuinely closed scope, and every rejection is asserted on
// BYTES — the archive, the live debt, the anchor and the record directory — because a refusal that
// still moved something is the failure this contract exists to prevent.
{
  const D1 = FAITHFUL_D1;
  const canonicalizedDebt = (root) => readJson(sprintPath(root)).debt.find((entry) => entry.id === 'D1');

  /** Nothing moved: archive bytes, live debt shape, anchors and the record directory. */
  const assertUntouched = (fx, label) => {
    assert(JSON.stringify(historicalArchive(fx.root)) === JSON.stringify(fx.archive), `${label}: historical archive changed`);
    const live = readJson(sprintPath(fx.root));
    assert(JSON.stringify(live.debt) === JSON.stringify(fx.live.debt), `${label}: live debt was modified`);
    assert(live.remediations === undefined, `${label}: a remediation anchor was written`);
    assert(!existsSync(recordPath(fx.root)), `${label}: a remediation record was written`);
  };

  // 1. The happy path: one append-only v3 record, an exact seven-key after-image, history intact.
  withCanonicalizable((fx) => {
    const relPath = writeManifest(fx.root, prepareManifest(fx.root));
    const preview = run(fx.root, ['remediate', 'canonicalize-preview', '--manifest', relPath, '--kyro-scope', SCOPE, '--json']);
    assert(preview.status === 0, `preview of a complete manifest must be accepted: ${preview.output}`);
    assert(JSON.parse(preview.output).accepted === true, 'preview must accept the prepared manifest');

    const applied = run(fx.root, ['remediate', 'apply', '--manifest', relPath, '--kyro-scope', SCOPE, '--yes']);
    assert(applied.status === 0, `apply of a prepared canonicalization must succeed: ${applied.output}`);

    const record = readJson(recordPath(fx.root));
    assert(record.schemaVersion === 3, `a canonicalization must be recorded at protocol revision 3, got ${record.schemaVersion}`);
    assert(record.kind === 'scope-remediation' && record.id === 'R-001', 'the record must be the first link of the chain');
    assert(record.result.witness.kind === 'operations-replay' && !('snapshot' in record.result),
      'a v3 record must carry the compact witness, never a state image');
    assert(record.operations.length === 1 && record.operations[0].kind === 'debt.canonicalize',
      'exactly one typed canonicalization must be recorded');
    assert(record.operations[0].retiredKeys.join(',') === 'detail,resolution,addedSprint',
      `the record must name every retired legacy key, got ${record.operations[0].retiredKeys}`);

    const target = canonicalizedDebt(fx.root);
    assert(JSON.stringify(Object.keys(target)) === JSON.stringify(CANONICAL_KEYS),
      `the live record must hold exactly the seven canonical keys in order, got ${Object.keys(target)}`);
    assert(target.origin === 1 && target.priority === 'high' && target.targetSprint === null,
      'the operator-authorized values must be the ones that landed');
    assert(target.title === D1.title && target.status === D1.status, 'identity and lifecycle must be preserved from observation');
    for (const key of ['detail', 'resolution', 'addedSprint']) {
      assert(!(key in target), `${key} must not survive canonicalization`);
    }

    const live = readJson(sprintPath(fx.root));
    assert(JSON.stringify(live.debt.find((entry) => entry.id === 'D2')) === JSON.stringify(BYSTANDER),
      'an unrelated debt record must not be touched');
    assert(live.remediations.length === 1 && live.remediations[0].id === 'R-001', 'exactly one anchor must be appended');
    assert(live.remediations[0].commitment === digest(record), 'the anchor must commit to the published record');
    assert(JSON.stringify(historicalArchive(fx.root)) === JSON.stringify(fx.archive),
      'checkpoint, snapshot, narrative and ledger bytes must be unchanged by a successful canonicalization');

    // The corrected scope is a first-class remediated scope, not merely a file that parses.
    const doctor = run(fx.root, ['doctor', '--artifacts', '--kyro-scope', SCOPE]);
    assert(doctor.status === 0, `doctor must accept the canonicalized scope: ${doctor.output}`);
    assert(/APPLIED/.test(doctor.output), `doctor must report the canonicalization as APPLIED: ${doctor.output}`);

    // Re-running the same manifest is refused as stale, not applied twice: the base state is gone.
    const again = run(fx.root, ['remediate', 'apply', '--manifest', relPath, '--kyro-scope', SCOPE, '--yes']);
    assert(again.status !== 0, 'a second apply of the same manifest must be refused');
    assert(again.output.includes('STATE_DIVERGED'), `the second apply must report a stale base: ${again.output}`);
    assert(!existsSync(recordPath(fx.root, '002')), 'a refused re-apply must not publish a competing record');
    assert(readJson(sprintPath(fx.root)).remediations.length === 1, 'a refused re-apply must not append a second anchor');
  });

  // 2. Resume: an interrupted publish finishes as the SAME record, never as a competing second one.
  withCanonicalizable((fx) => {
    const manifest = prepareManifest(fx.root);
    const relPath = writeManifest(fx.root, manifest);

    // Reproduce the interruption exactly: the immutable record is on disk, the live anchor is not.
    const rehearsal = mkdtempSync(join(tmpdir(), 'kyro-canonicalize-rehearsal-'));
    cpSync(fx.root, rehearsal, { recursive: true });
    assert(run(rehearsal, ['remediate', 'apply', '--manifest', relPath, '--kyro-scope', SCOPE, '--yes']).status === 0,
      'the rehearsal apply must succeed so its record can be replanted');
    const preparedRecord = readJson(recordPath(rehearsal));
    rmSync(rehearsal, { recursive: true, force: true });

    mkdirSync(join(fx.root, `.agents/kyro/scopes/${SCOPE}/archive/remediations`), { recursive: true });
    writeJson(recordPath(fx.root), preparedRecord);

    // Preview is the surface that can see this state: doctor walks anchors, and an interrupted
    // publish is precisely a record with no anchor yet.
    const before = run(fx.root, ['remediate', 'preview', '--manifest', relPath, '--kyro-scope', SCOPE, '--json']);
    assert(before.status === 0, `preview of an interrupted transaction must succeed: ${before.output}`);
    assert(JSON.parse(before.output).transactionStatus === 'PREPARED',
      `an interrupted canonicalization must be reported as PREPARED: ${before.output}`);

    const resumed = run(fx.root, ['remediate', 'apply', '--manifest', relPath, '--kyro-scope', SCOPE, '--yes']);
    assert(resumed.status === 0, `resume must complete the interrupted transaction: ${resumed.output}`);
    assert(/Resumed interrupted remediation/.test(resumed.output), `resume must report itself as a resume: ${resumed.output}`);
    assert(JSON.stringify(readJson(recordPath(fx.root))) === JSON.stringify(preparedRecord),
      'resume must finish the existing record byte-for-byte, not rewrite it');
    assert(!existsSync(recordPath(fx.root, '002')), 'resume must not publish a duplicate R-NNN');
    const live = readJson(sprintPath(fx.root));
    assert(live.remediations.length === 1 && live.remediations[0].commitment === digest(preparedRecord),
      'resume must anchor exactly the record that was already published');
    assert(run(fx.root, ['doctor', '--artifacts', '--kyro-scope', SCOPE]).status === 0, 'the resumed scope must be healthy');
  });

  // 3. Every way the input can be wrong leaves the scope exactly as it was.
  const mutations = [
    ['stale whole-debt precondition', (m) => { m.operations[0].expectedDebtCollectionSha256 = 'a'.repeat(64); }, 'STATE_DIVERGED'],
    ['stale base state', (m) => { m.base.stateSha256 = 'b'.repeat(64); }, 'STATE_DIVERGED'],
    ['forged chain head', (m) => { m.base.remediationHead = 'c'.repeat(64); }, 'STATE_DIVERGED'],
    ['forged after-image identity', (m) => { m.operations[0].after.id = 'D9'; }, 'INVALID_INPUT'],
    ['renamed title', (m) => { m.operations[0].after.title = 'Renamed by the manifest'; }, 'STATE_DIVERGED'],
    ['lifecycle moved', (m) => { m.operations[0].after.status = 'open'; }, 'STATE_DIVERGED'],
    ['hybrid after-image', (m) => { m.operations[0].after.addedSprint = 1; }, 'INVALID_INPUT'],
    ['unaccounted legacy key', (m) => { m.operations[0].retiredKeys = ['detail']; }, 'STATE_DIVERGED'],
    ['unknown debt id', (m) => { m.operations[0].debtId = 'D9'; m.operations[0].after.id = 'D9'; }, 'DEBT_NOT_FOUND'],
    ['unknown protocol revision', (m) => { m.schemaVersion = 5; }, 'INVALID_INPUT'],
    ['canonicalization smuggled into v1', (m) => { m.schemaVersion = 1; }, 'INVALID_INPUT'],
  ];
  for (const [label, mutate, expected] of mutations) {
    withCanonicalizable((fx) => {
      const manifest = prepareManifest(fx.root);
      mutate(manifest);
      const relPath = writeManifest(fx.root, manifest);
      const { status, output } = run(fx.root, ['remediate', 'apply', '--manifest', relPath, '--kyro-scope', SCOPE, '--yes']);
      assert(status !== 0, `${label}: apply must fail closed: ${output}`);
      assert(output.includes(expected), `${label}: expected ${expected}, got: ${output}`);
      assertUntouched(fx, label);
    });
  }

  // 4. Confirmation is never implied by a valid plan, and a plan is not a write.
  withCanonicalizable((fx) => {
    const relPath = writeManifest(fx.root, prepareManifest(fx.root));
    const unconfirmed = run(fx.root, ['remediate', 'apply', '--manifest', relPath, '--kyro-scope', SCOPE]);
    assert(unconfirmed.status !== 0 && unconfirmed.output.includes('CONFIRMATION_REQUIRED'),
      `apply without --yes must stop at the gate: ${unconfirmed.output}`);
    assert(/debt\[D1\]/.test(unconfirmed.output), `the refused plan must still show the record-level change: ${unconfirmed.output}`);
    assertUntouched(fx, 'unconfirmed apply');

    const previewed = run(fx.root, ['remediate', 'preview', '--manifest', relPath, '--kyro-scope', SCOPE]);
    assert(previewed.status === 0, `preview of a canonicalization must succeed: ${previewed.output}`);
    assertUntouched(fx, 'preview');
  });

  // 5. The origin-only flow is untouched by all of this: same v2 record, same bytes.
  withFixture((fx) => {
    const relPath = writeManifest(fx.root, manifestFor(readJson(sprintPath(fx.root))));
    assert(run(fx.root, ['remediate', 'apply', '--manifest', relPath, '--kyro-scope', SCOPE, '--yes']).status === 0,
      'the origin-only remediation must still apply');
    const record = readJson(recordPath(fx.root));
    assert(record.schemaVersion === 2, `an origin-only remediation must still be recorded as v2, got ${record.schemaVersion}`);
    assert(record.operations[0].kind === 'debt.origin.set', 'the origin-only operation must be recorded unchanged');
    assert(readJson(sprintPath(fx.root)).debt[0].origin === 1, 'the origin-only correction must still land');
  });
}

// --- Replay and verification of v1/v2/v3 and mixed chains (T3.2) --------------------------------
//
// A chain containing a canonicalization must be replayed by the SAME executor that applied it, at
// each record's OWN declared revision. Doctor and status must agree, historic records must never be
// reinterpreted or rewritten, and every forged variant must fail closed with a named diagnostic.
{
  /**
   * Append an origin-only v2 remediation on top of whatever chain already exists.
   *
   * `debtId` matters: an origin-only correction of the still-legacy D1 cannot be applied at all,
   * because the projected state would keep its legacy-only keys and fail strict validation. That is
   * the motivating incident itself, so a v2 link that precedes canonicalization must target the
   * already-canonical bystander instead.
   */
  const applyOriginSet = (root, debtId, from, to) => {
    const live = readJson(sprintPath(root));
    const anchors = live.remediations ?? [];
    const relPath = writeManifest(root, {
      schemaVersion: 1,
      kind: 'scope-remediation-manifest',
      scope: SCOPE,
      base: { stateSha256: stateDigest(live), remediationHead: anchors.at(-1)?.commitment ?? null },
      issues: [{ id: 'I-1', code: 'debt.origin.drift', path: `debt[${debtId}].origin`, observedValueSha256: digest(JSON.stringify(canonical(from))) }],
      operations: [{
        id: 'O-1',
        kind: 'debt.origin.set',
        resolves: ['I-1'],
        debtId,
        expectedOriginSha256: digest(JSON.stringify(canonical(from))),
        origin: to,
        reason: 'Origin corrected.',
      }],
      provenance: { reason: 'Origin drift after close.', actor: 'regression-harness' },
    });
    return run(root, ['remediate', 'apply', '--manifest', relPath, '--kyro-scope', SCOPE, '--yes']);
  };

  // The premise above, asserted rather than assumed. Strict projection is whole-file, so while a
  // legacy record is present NO remediation applies — not even one that never touches it. The
  // canonicalization must therefore be the FIRST link of such a scope's chain, which is exactly why
  // the motivating incident could not be repaired by the origin-only operation at all.
  withCanonicalizable((fx) => {
    for (const [label, debtId, from, to] of [
      ['the legacy record itself', 'D1', FAITHFUL_D1.origin, 1],
      ['an unrelated canonical record', 'D2', 1, 2],
    ]) {
      const refused = applyOriginSet(fx.root, debtId, from, to);
      assert(refused.status !== 0, `${label}: an origin-only remediation must be refused while a legacy record is present`);
      assert(refused.output.includes('INVALID_SPRINT_SHAPE'),
        `${label}: the refusal must name the still-invalid projection: ${refused.output}`);
      assert(!existsSync(recordPath(fx.root)), `${label}: a refused remediation must publish nothing`);
    }
  });

  /**
   * The verification state status reports, or `refused:<code>` when status will not report at all.
   *
   * Refusing is itself a fail-closed answer: a live state that no longer satisfies the schema is one
   * status must not summarize, and saying so beats inventing a verification state for it.
   */
  const verificationOf = (root) => {
    const status = run(root, ['status', '--kyro-scope', SCOPE]);
    if (status.status !== 0) {
      const code = /Code: (\w+)/.exec(status.output);
      return `refused:${code === null ? 'unknown' : code[1]}`;
    }
    const match = /Verification: (\w+)/.exec(status.output);
    return match === null ? null : match[1];
  };

  // 1. A single v3 chain replays: doctor, status and the checkpoint lens all agree.
  withCanonicalizable((fx) => {
    assert(applyCanonicalization(fx.root).status === 0, 'the canonicalization must apply');
    const recordBytes = readFileSync(recordPath(fx.root, '001'), 'utf8');

    const doctor = run(fx.root, ['doctor', '--artifacts', '--kyro-scope', SCOPE]);
    assert(doctor.status === 0, `a v3 chain must verify: ${doctor.output}`);
    assert(doctor.output.includes('replayed through R-001'), `the checkpoint lens must name the replayed chain: ${doctor.output}`);
    assert(/remediation\/R-001[\s\S]*?APPLIED/.test(doctor.output), `the v3 record must be APPLIED: ${doctor.output}`);
    assert(verificationOf(fx.root) === 'remediated', 'a replayed v3 chain must make the scope remediated');
    assert(readFileSync(recordPath(fx.root, '001'), 'utf8') === recordBytes, 'replay must not rewrite the v3 record');
    assert(JSON.stringify(historicalArchive(fx.root)) === JSON.stringify(fx.archive),
      'the original close must stay historical evidence, byte-for-byte, after canonicalization');
  });

  // 2. A mixed v3 → v2 chain: each record replays at its own revision, never at the head's.
  //    The reverse order does not exist by construction — see the ordering property above.
  withCanonicalizable((fx) => {
    assert(applyCanonicalization(fx.root).status === 0, 'v3 link must apply');
    const second = applyOriginSet(fx.root, 'D1', 1, 2);
    assert(second.status === 0, `v2 link must apply on top of a v3 link: ${second.output}`);

    const revisions = ['001', '002'].map((id) => readJson(recordPath(fx.root, id)).schemaVersion);
    assert(JSON.stringify(revisions) === JSON.stringify([3, 2]),
      `the chain must genuinely mix revisions in order, got ${revisions}`);
    const doctor = run(fx.root, ['doctor', '--artifacts', '--kyro-scope', SCOPE]);
    assert(doctor.status === 0, `a mixed chain must verify: ${doctor.output}`);
    assert(doctor.output.includes('replayed through R-002'), `the head must be named: ${doctor.output}`);
    assert(/remediation\/R-001[\s\S]*?APPLIED/.test(doctor.output), `the earlier link must not read as diverged: ${doctor.output}`);
    assert(verificationOf(fx.root) === 'remediated', 'a mixed chain must be remediated');
    assert(readJson(sprintPath(fx.root)).debt.find((entry) => entry.id === 'D1').origin === 2,
      'the head result must be the live value');
    assert(JSON.stringify(historicalArchive(fx.root)) === JSON.stringify(fx.archive), 'history must be untouched');
  });

  // 3. A v1 record as an INTERMEDIATE link of a chain headed past a canonicalization.
  //
  //    v1 is the only revision that carries a snapshot witness, and that witness is only consulted
  //    for a non-final record. A v1 link can never hold the canonicalization itself (the revision
  //    binding rejects that), so the shape under test is v3 → v1 → v2: the canonicalization opens
  //    the chain, and a historic v1 record sits in the middle supplying its own replay image.
  withCanonicalizable((fx) => {
    assert(applyCanonicalization(fx.root).status === 0, 'v3→v1→v2: the canonicalization must open the chain');
    assert(applyOriginSet(fx.root, 'D1', 1, 2).status === 0, 'v3→v1→v2: the intermediate link must apply');
    const intermediateSnapshot = readJson(sprintPath(fx.root));
    assert(applyOriginSet(fx.root, 'D1', 2, 3).status === 0, 'v3→v1→v2: the head link must apply');

    // Rewrite the middle record as historic v1 evidence, then re-anchor the links downstream of it
    // so the chain stays coherent and only the replay path is under test.
    const middle = rewriteFixtureRecordAsV1(fx.root, '002', intermediateSnapshot);
    const live = readJson(sprintPath(fx.root));
    const head = readJson(recordPath(fx.root, '003'));
    head.base.remediationHead = digest(middle);
    writeJson(recordPath(fx.root, '003'), head);
    live.remediations[2].commitment = digest(head);
    writeJson(sprintPath(fx.root), live);
    const historicBytes = readFileSync(recordPath(fx.root, '002'), 'utf8');

    const revisions = ['001', '002', '003'].map((id) => readJson(recordPath(fx.root, id)).schemaVersion);
    assert(JSON.stringify(revisions) === JSON.stringify([3, 1, 2]), `the chain must be v3 → v1 → v2, got ${revisions}`);
    const doctor = run(fx.root, ['doctor', '--artifacts', '--kyro-scope', SCOPE]);
    assert(doctor.status === 0, `a v3 → v1 → v2 chain must verify: ${doctor.output}`);
    assert(doctor.output.includes('replayed through R-003'), `the head must be named: ${doctor.output}`);
    assert(verificationOf(fx.root) === 'remediated', 'a v3 → v1 → v2 chain must be remediated');
    assert(readFileSync(recordPath(fx.root, '002'), 'utf8') === historicBytes,
      'replaying must not rewrite historic v1 evidence under a later revision\'s semantics');
    assert(JSON.stringify(historicalArchive(fx.root)) === JSON.stringify(fx.archive), 'history must be untouched');
  });

  // 4. Every forged variant of a v3 chain fails closed, on both surfaces, with a named diagnostic.
  const forgeries = [
    ['forged after-image in the record', (root) => {
      const record = readJson(recordPath(root, '001'));
      record.operations[0].after.priority = 'low';
      writeJson(recordPath(root, '001'), record);
    }, 'DIVERGED', 'diverged'],
    ['result digest that no operation produces', (root) => {
      const record = readJson(recordPath(root, '001'));
      record.result.stateSha256 = 'f'.repeat(64);
      writeJson(recordPath(root, '001'), record);
    }, 'DIVERGED', 'diverged'],
    ['anchor commitment detached from the record', (root) => {
      const live = readJson(sprintPath(root));
      live.remediations[0].commitment = 'e'.repeat(64);
      writeJson(sprintPath(root), live);
    }, 'DIVERGED', 'diverged'],
    ['unknown protocol revision on the record', (root) => {
      const record = readJson(recordPath(root, '001'));
      record.schemaVersion = 99;
      writeJson(recordPath(root, '001'), record);
      const live = readJson(sprintPath(root));
      live.remediations[0].commitment = digest(record);
      writeJson(sprintPath(root), live);
    }, 'UNSUPPORTED_VERSION', 'unsupported'],
    ['live debt edited behind the applied record', (root) => {
      const live = readJson(sprintPath(root));
      live.debt.find((entry) => entry.id === 'D1').priority = 'low';
      writeJson(sprintPath(root), live);
    }, 'DIVERGED', 'diverged'],
    ['legacy key reintroduced into the canonicalized record', (root) => {
      const live = readJson(sprintPath(root));
      live.debt.find((entry) => entry.id === 'D1').addedSprint = 1;
      writeJson(sprintPath(root), live);
      // A retired legacy key coming back is not a verification question but a schema one: status
      // must refuse to summarize a state it cannot read, rather than name a verification for it.
    }, 'DIVERGED', 'refused:INVALID_SPRINT_SHAPE'],
  ];
  for (const [label, forge, expected, expectedState] of forgeries) {
    withCanonicalizable((fx) => {
      assert(applyCanonicalization(fx.root).status === 0, `${label}: setup canonicalization must apply`);
      forge(fx.root);
      const doctor = run(fx.root, ['doctor', '--artifacts', '--kyro-scope', SCOPE]);
      assert(doctor.status === 1, `${label}: doctor must fail closed: ${doctor.output}`);
      assert(doctor.output.includes(expected), `${label}: doctor must report ${expected}: ${doctor.output}`);
      const verification = verificationOf(fx.root);
      assert(verification === expectedState, `${label}: status must report ${expectedState}, got ${verification}`);
      assert(JSON.stringify(historicalArchive(fx.root)) === JSON.stringify(fx.archive),
        `${label}: a failing verification must not touch the archive`);
    });
  }

  // 5. An unanchored record is named, and named for what it is: resumable or planted.
  withCanonicalizable((fx) => {
    const relPath = writeManifest(fx.root, prepareManifest(fx.root));
    const beforeApply = readFileSync(sprintPath(fx.root), 'utf8');
    assert(run(fx.root, ['remediate', 'apply', '--manifest', relPath, '--kyro-scope', SCOPE, '--yes']).status === 0,
      'setup apply must succeed');
    writeFileSync(sprintPath(fx.root), beforeApply);

    const interrupted = run(fx.root, ['doctor', '--artifacts', '--kyro-scope', SCOPE]);
    assert(/remediation\/R-001: PREPARED/.test(interrupted.output),
      `an interrupted v3 publish must be reported as PREPARED: ${interrupted.output}`);
    assert(!/remediation\/R-001: APPLIED/.test(interrupted.output), 'an unanchored record must never read as applied');

    // Now make the same orphan a record that does NOT continue the chain: it is not resumable.
    const planted = readJson(recordPath(fx.root, '001'));
    planted.base.remediationHead = 'd'.repeat(64);
    writeJson(recordPath(fx.root, '001'), planted);
    const forged = run(fx.root, ['doctor', '--artifacts', '--kyro-scope', SCOPE]);
    assert(forged.status === 1, `a planted unanchored record must fail doctor: ${forged.output}`);
    assert(/does not continue the live chain/.test(forged.output),
      `a planted record must be distinguished from an interrupted publish: ${forged.output}`);
  });
}

console.log(`check:scope-remediation — ${passed} assertions passed`);
