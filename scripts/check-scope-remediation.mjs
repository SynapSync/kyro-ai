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
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(fileURLToPath(import.meta.url), '../..');
const cli = resolve(repo, 'dist/cli.js');
const closeFixture = resolve(repo, 'fixtures/evals/close-sprint-happy/state');
const SCOPE = 'demo';
const LEGACY_ORIGIN = 'food-analysis FR-FA-013 revision';

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
  assert(record.schemaVersion === 1 && record.kind === 'scope-remediation' && record.id === 'R-001', 'record must be a v1 scope-remediation');
  assert(record.base.stateSha256 === stateDigest(fx.live), 'record must bind the pre-remediation base digest');
  assert(record.base.remediationHead === null, 'first remediation must have a null chain head');
  assert(record.operations.length === 1 && record.operations[0].kind === 'debt.origin.set', 'record must carry the typed operation');
  assert(record.issues.length === 1 && record.issues[0].code === 'debt.origin.not-number', 'record must carry the issue it resolves');
  assert(typeof record.provenance.kyroVersion === 'string' && record.provenance.actor === 'regression-harness', 'record must carry provenance');

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

  const doctor = run(fx.root, ['doctor', '--artifacts', '--kyro-scope', SCOPE]);
  assert(!doctor.output.includes('remediation/R-001'), `an unanchored record must not be presented as a remediation: ${doctor.output}`);

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
    assert(applied.output.includes('outside the workspace'), `refusal must name the escaping path: ${applied.output}`);
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

  // A two-record chain must certify, naming the HEAD as the replayed-through record.
  {
    const fx = makeFixture();
    try {
      const closed = readJson(sprintPath(fx.root));
      closed.debt[0].origin = 1;
      writeJson(sprintPath(fx.root), closed);
      const first = applyOne(fx, [makeOp('O-1', 'debt-1', 1, 2)]);
      assert(first.status === 0, `R-001 must apply: ${first.output}`);
      const second = applyOne(fx, [makeOp('O-1', 'debt-1', 2, 3)]);
      assert(second.status === 0, `R-002 must apply on top of R-001: ${second.output}`);

      const doctor = run(fx.root, ['doctor', '--artifacts', '--kyro-scope', SCOPE]);
      assert(doctor.status === 0, `a genuine two-record chain must certify: ${doctor.output}`);
      assert(doctor.output.includes('replayed through R-002'), `the chain head must be named: ${doctor.output}`);
      assert(/remediation\/R-001[\s\S]*?APPLIED/.test(doctor.output), `the earlier record must not be reported as diverged: ${doctor.output}`);
      assert(readJson(sprintPath(fx.root)).debt[0].origin === 3, 'the head result must be the live value');
      assert(JSON.stringify(historicalArchive(fx.root)) === JSON.stringify(fx.archive), 'a chain must not touch history');
    } finally { rmSync(fx.root, { recursive: true, force: true }); }
  }

  // Two operations on the SAME field in one batch: the second describes a value that no longer
  // exists once the first has run, so the batch is refused rather than silently applied.
  {
    const fx = makeFixture();
    try {
      const closed = readJson(sprintPath(fx.root));
      closed.debt[0].origin = 1;
      writeJson(sprintPath(fx.root), closed);
      const before = readFileSync(sprintPath(fx.root), 'utf8');
      const result = applyOne(fx, [makeOp('O-1', 'debt-1', 1, 2), makeOp('O-2', 'debt-1', 1, 3)]);
      assert(result.status !== 0, `a batch whose second operation restates a stale precondition must be refused: ${result.output}`);
      assert(result.output.includes('O-2'), `the refusal must name the offending operation: ${result.output}`);
      assert(readFileSync(sprintPath(fx.root), 'utf8') === before, 'a refused batch must not write');
      assert(!existsSync(recordPath(fx.root)), 'a refused batch must not publish a record');
    } finally { rmSync(fx.root, { recursive: true, force: true }); }
  }
}

console.log(`check:scope-remediation — ${passed} assertions passed`);
