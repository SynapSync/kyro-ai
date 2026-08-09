#!/usr/bin/env node
/**
 * Scope verification state vocabulary harness (T2.5).
 *
 * Every state is produced from a REAL `close-sprint` / `remediate` run against the built CLI, never
 * from a hand-built look-alike, and every case asserts the state reported by BOTH `doctor
 * --artifacts` and `status` — the single-derivation guarantee of T2.1 is only meaningful if both
 * readers are checked on the same fixture.
 *
 * The failure paths matter more than the happy ones here: this file exists because a harness that
 * cannot exit non-zero certifies nothing.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(fileURLToPath(import.meta.url), '../..');
const cli = process.env.KYRO_CLI_UNDER_TEST
  ? resolve(process.env.KYRO_CLI_UNDER_TEST)
  : resolve(repo, 'dist/cli.js');
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
/** Business-state digest: both append-only anchors are excluded so no hash cycle can form. */
function stateDigest(sprint) {
  const projected = { ...sprint };
  delete projected.remediations;
  delete projected.certifications;
  return digest(projected);
}

function run(root, args) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: 'utf-8',
    env: { ...process.env, HOME: join(root, '.home') },
  });
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

/** Optional T3.5 bridge: preserve the real, already-verified recertified workspace for Lens. */
function exportLensFixture(root) {
  const output = process.env.KYRO_LENS_REAL_FIXTURE;
  if (!output) return;
  rmSync(output, { recursive: true, force: true });
  cpSync(root, output, { recursive: true });
}

/** Recursive snapshot of a directory's bytes, used to prove history was not disturbed. */
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

function sprintPath(root) { return join(root, `.agents/kyro/scopes/${SCOPE}/sprint.json`); }
function archiveDir(root) { return join(root, `.agents/kyro/scopes/${SCOPE}/archive`); }
function historicalArchive(root) {
  return Object.fromEntries(
    Object.entries(fileTree(archiveDir(root))).filter(([path]) => !path.startsWith('remediations/')),
  );
}
function checkpointPath(root) {
  const dir = archiveDir(root);
  const name = readdirSync(dir).find((f) => f.endsWith('.checkpoint.json'));
  return name ? join(dir, name) : null;
}
function narrativePath(root) {
  const dir = archiveDir(root);
  const name = readdirSync(dir).find((f) => f.endsWith('.md'));
  return name ? join(dir, name) : null;
}

/**
 * The state each case starts from: a genuinely closed scope. `corrupt` decides whether the live
 * copy then acquires the prose-origin defect that motivated remediation.
 */
function makeFixture({ corrupt = true, plannedSprints = 1 } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'kyro-verification-states-'));
  cpSync(closeFixture, root, { recursive: true });
  mkdirSync(join(root, '.home'), { recursive: true });

  const sprint = readJson(sprintPath(root));
  // close-sprint routes handoff to plan_sprint only while the roadmap still has sprints left, so a
  // fixture that needs to start sprint 2 must say so before sprint 1 is closed.
  if (plannedSprints > 1) {
    sprint.roadmap.plannedSprintCount = plannedSprints;
    sprint.roadmap.sprints = [
      ...sprint.roadmap.sprints,
      { n: 2, slug: 'follow-up', title: 'Follow-up sprint', state: 'planned' },
    ];
  }
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

  if (corrupt) {
    const live = readJson(sprintPath(root));
    live.debt[0].origin = LEGACY_ORIGIN;
    writeJson(sprintPath(root), live);
  }
  return { root };
}

function withFixture(options, fn) {
  const fx = makeFixture(options);
  try { fn(fx); } finally { rmSync(fx.root, { recursive: true, force: true }); }
}

/** The verification state as reported by `status`. */
function statusState(root) {
  return run(root, ['status', '--kyro-scope', SCOPE]).output.match(/Verification:\s*(\w+)/)?.[1] ?? null;
}
/** The verification state as reported by `doctor --artifacts`, plus its exit status. */
function doctorState(root) {
  const result = run(root, ['doctor', '--artifacts', '--kyro-scope', SCOPE]);
  return {
    state: result.output.match(/\/verification:\s*(\w+)/)?.[1] ?? null,
    status: result.status,
    output: result.output,
  };
}

/** T2.1's core guarantee: one derivation, so both readers must always agree. */
function assertBothReport(root, expected, label) {
  const doctor = doctorState(root);
  const status = statusState(root);
  assert(doctor.state === expected, `${label}: doctor reported ${doctor.state}, expected ${expected}\n${doctor.output}`);
  assert(status === expected, `${label}: status reported ${status}, expected ${expected}`);
  return doctor;
}

/**
 * When the live sprint.json does not satisfy the v4 schema, `status` refuses to report at all
 * rather than describing a file it could not parse. That is the correct fail-closed behaviour, so
 * the agreement assertion does not apply — but the refusal itself must be asserted, not skipped.
 */
function assertDoctorState(root, expected, label) {
  const doctor = doctorState(root);
  assert(doctor.state === expected, `${label}: doctor reported ${doctor.state}, expected ${expected}\n${doctor.output}`);
  const status = run(root, ['status', '--kyro-scope', SCOPE]);
  assert(status.status !== 0, `${label}: status must fail closed on a schema-invalid live file`);
  assert(
    status.output.includes('INVALID_SPRINT_SHAPE'),
    `${label}: status must name the schema failure, got:\n${status.output}`,
  );
  return doctor;
}

/**
 * Remediate the live debt origin to `origin`. The chain head and the observed value are read from
 * live state rather than assumed, so the same helper drives a first and a subsequent remediation.
 */
function remediate(root, live, origin = 1) {
  const head = Array.isArray(live.remediations) && live.remediations.length > 0
    ? live.remediations.at(-1).commitment
    : null;
  const observed = digest(JSON.stringify(canonical(live.debt[0].origin)));
  const manifest = {
    schemaVersion: 1,
    kind: 'scope-remediation-manifest',
    scope: SCOPE,
    base: { stateSha256: stateDigest(live), remediationHead: head },
    issues: [{
      id: 'I-1',
      code: 'debt.origin.not-number',
      path: 'debt[0].origin',
      observedValueSha256: observed,
    }],
    operations: [{
      id: 'O-1',
      kind: 'debt.origin.set',
      resolves: ['I-1'],
      debtId: 'debt-1',
      expectedOriginSha256: observed,
      origin,
      reason: 'The debt was raised during sprint 1.',
    }],
    provenance: { reason: 'Live debt origin was persisted as prose after close.', actor: 'verification-states-harness' },
  };
  writeJson(join(root, 'manifest.json'), manifest);
  return run(root, ['remediate', 'apply', '--kyro-scope', SCOPE, '--manifest', 'manifest.json', '--yes']);
}

console.log('check:verification-states — scope verification state vocabulary (T2.5)');

// 1. historical — a closed, untouched scope with no remediation chain.
withFixture({ corrupt: false }, (fx) => {
  const doctor = assertBothReport(fx.root, 'historical', 'historical');
  assert(doctor.status === 0, `historical: doctor must exit 0, got ${doctor.status}`);
});

// 2. diverged — live drift with no chain that could explain it. Fail-closed.
withFixture({ corrupt: true }, (fx) => {
  const doctor = assertDoctorState(fx.root, 'diverged', 'diverged (uncorrected drift)');
  assert(doctor.status !== 0, 'diverged: doctor must exit non-zero');
});

// 3. remediated — the same drift, now explained by a real replayed chain.
withFixture({ corrupt: true }, (fx) => {
  const applied = remediate(fx.root, readJson(sprintPath(fx.root)));
  assert(applied.status === 0, `remediated: remediate --apply failed: ${applied.output}`);
  const doctor = assertBothReport(fx.root, 'remediated', 'remediated');
  assert(doctor.status === 0, `remediated: doctor must exit 0, got ${doctor.status}`);
  assert(
    readJson(sprintPath(fx.root)).debt[0].origin === 1,
    'remediated: the live defect was not actually corrected',
  );
});

// 4. diverged — a tampered record must never launder drift into `remediated`.
withFixture({ corrupt: true }, (fx) => {
  const applied = remediate(fx.root, readJson(sprintPath(fx.root)));
  assert(applied.status === 0, `forged record: setup failed: ${applied.output}`);
  const recordFile = join(archiveDir(fx.root), 'remediations/remediation-001.json');
  const record = readJson(recordFile);
  record.provenance.reason = 'TAMPERED AFTER PUBLICATION';
  writeJson(recordFile, record);
  const doctor = assertBothReport(fx.root, 'diverged', 'forged record');
  assert(doctor.status !== 0, 'forged record: doctor must exit non-zero');
});

// 4b. A coherent anchor chain still diverges when a non-final compact witness is malformed.
// The re-anchored record isolates witness validation from commitment and continuity failures.
withFixture({ corrupt: true }, (fx) => {
  const first = remediate(fx.root, readJson(sprintPath(fx.root)), 1);
  assert(first.status === 0, `intermediate witness: R-001 setup failed: ${first.output}`);
  const second = remediate(fx.root, readJson(sprintPath(fx.root)), 2);
  assert(second.status === 0, `intermediate witness: R-002 setup failed: ${second.output}`);

  const firstFile = join(archiveDir(fx.root), 'remediations/remediation-001.json');
  const firstRecord = readJson(firstFile);
  firstRecord.result.witness.kind = 'opaque-state';
  writeJson(firstFile, firstRecord);

  const live = readJson(sprintPath(fx.root));
  live.remediations[0].commitment = digest(firstRecord);
  const secondFile = join(archiveDir(fx.root), 'remediations/remediation-002.json');
  const secondRecord = readJson(secondFile);
  secondRecord.base.remediationHead = live.remediations[0].commitment;
  writeJson(secondFile, secondRecord);
  live.remediations[1].commitment = digest(secondRecord);
  writeJson(sprintPath(fx.root), live);

  const doctor = assertBothReport(fx.root, 'diverged', 'intermediate compact witness');
  assert(doctor.status !== 0, 'intermediate compact witness: doctor must exit non-zero');
});

// 4c. Re-anchoring a forged compact record removes the easy commitment failure, so replay itself
// must still reject altered operations and result digests rather than blessing the chain.
for (const [label, mutate] of [
  ['operation', (record) => { record.operations[0].origin = 2; }],
  ['result digest', (record) => { record.result.stateSha256 = 'a'.repeat(64); }],
]) {
  withFixture({ corrupt: true }, (fx) => {
    const applied = remediate(fx.root, readJson(sprintPath(fx.root)));
    assert(applied.status === 0, `forged compact ${label}: setup failed: ${applied.output}`);
    const recordFile = join(archiveDir(fx.root), 'remediations/remediation-001.json');
    const record = readJson(recordFile);
    mutate(record);
    writeJson(recordFile, record);
    const live = readJson(sprintPath(fx.root));
    live.remediations[0].commitment = digest(record);
    writeJson(sprintPath(fx.root), live);
    const doctor = assertBothReport(fx.root, 'diverged', `forged compact ${label}`);
    assert(doctor.status !== 0, `forged compact ${label}: doctor must exit non-zero`);
  });
}

// 5. unsupported — a record declaring a schemaVersion this runtime cannot evaluate must be named,
//    never silently treated as absent (which would read as diverged, or worse as historical).
withFixture({ corrupt: true }, (fx) => {
  const applied = remediate(fx.root, readJson(sprintPath(fx.root)));
  assert(applied.status === 0, `unsupported: setup failed: ${applied.output}`);
  const recordFile = join(archiveDir(fx.root), 'remediations/remediation-001.json');
  const record = readJson(recordFile);
  record.schemaVersion = 99;
  writeJson(recordFile, record);
  const doctor = doctorState(fx.root);
  const status = statusState(fx.root);
  assert(doctor.state === status, `unsupported: doctor (${doctor.state}) and status (${status}) disagree`);
  assert(
    doctor.state === 'unsupported' || doctor.state === 'diverged',
    `unsupported: expected a fail-closed state, got ${doctor.state}`,
  );
  assert(doctor.status !== 0, 'unsupported: doctor must exit non-zero');
});

// 6. A stale-schema checkpoint is historical evidence, but its immutable artifacts are still
//    verified. This is the T2.2 regression: an early return once skipped these digests entirely.
withFixture({ corrupt: false }, (fx) => {
  const cpPath = checkpointPath(fx.root);
  assert(cpPath !== null, 'stale-schema checkpoint: no checkpoint was written');

  // Freeze a value today's stricter schema rejects into BOTH images, so the authorized-transition
  // derivation still holds, then re-anchor honestly: integrity is sound, only the schema is stale.
  const cp = readJson(cpPath);
  cp.beforeClose.debt[0].origin = LEGACY_ORIGIN;
  cp.intendedAfterClose.debt[0].origin = LEGACY_ORIGIN;
  const commitmentPayload = JSON.parse(JSON.stringify(cp));
  delete commitmentPayload.digests;
  delete commitmentPayload.intendedAfterClose.ledger.at(-1).checkpointSha256;
  const commitment = digest(commitmentPayload);
  cp.intendedAfterClose.ledger.at(-1).checkpointSha256 = commitment;
  cp.digests.beforeClose = digest(cp.beforeClose);
  cp.digests.intendedAfterClose = digest(cp.intendedAfterClose);
  cp.digests.legacySnapshot = digest(`${JSON.stringify(cp.beforeClose.activeSprint, null, 2)}\n`);
  writeJson(cpPath, cp);

  const snapshot = join(archiveDir(fx.root), readdirSync(archiveDir(fx.root)).find((f) => f.endsWith('.json') && !f.endsWith('.checkpoint.json')));
  writeFileSync(snapshot, `${JSON.stringify(cp.beforeClose.activeSprint, null, 2)}\n`);

  const live = readJson(sprintPath(fx.root));
  live.debt[0].origin = LEGACY_ORIGIN;
  live.ledger.at(-1).checkpointSha256 = commitment;
  writeJson(sprintPath(fx.root), live);

  const intact = doctorState(fx.root);
  assert(
    intact.output.includes('historical:'),
    `stale-schema checkpoint: fixture did not produce a historical checkpoint:\n${intact.output}`,
  );
  assert(
    intact.output.includes('narrative=ok'),
    `stale-schema checkpoint: artifact integrity was not evaluated at all:\n${intact.output}`,
  );

  // The regression this case exists for: a stale schema must never buy an exemption from the
  // artifact digest checks. Tampering with the immutable narrative has to fail closed.
  const narrative = narrativePath(fx.root);
  assert(narrative !== null, 'stale-schema checkpoint: no narrative artifact was written');
  writeFileSync(narrative, `${readFileSync(narrative, 'utf8')}\nTAMPERED\n`);

  const tampered = doctorState(fx.root);
  assert(
    tampered.output.includes('narrative=conflict'),
    `stale-schema checkpoint: tampering with the narrative was not detected:\n${tampered.output}`,
  );
  assert(tampered.status !== 0, 'stale-schema checkpoint: doctor must exit non-zero after tampering');
});

// 7. Appending a certification anchor must not move the business digest. Without the exclusion,
//    certifying a healthy scope reports it as diverged — certification would look like tampering.
withFixture({ corrupt: true }, (fx) => {
  const applied = remediate(fx.root, readJson(sprintPath(fx.root)));
  assert(applied.status === 0, `certification anchor: setup failed: ${applied.output}`);
  const before = stateDigest(readJson(sprintPath(fx.root)));

  const live = readJson(sprintPath(fx.root));
  live.certifications = [{ id: 'C-001', path: 'archive/certifications/certification-001.json', commitment: 'a'.repeat(64) }];
  writeJson(sprintPath(fx.root), live);

  assert(
    stateDigest(readJson(sprintPath(fx.root))) === before,
    'certification anchor: appending certifications[] moved the business digest',
  );
  const doctor = assertBothReport(fx.root, 'remediated', 'certification anchor');
  assert(doctor.status === 0, `certification anchor: doctor must stay green, got ${doctor.status}\n${doctor.output}`);
});

// 8. A hand-written certification anchor with no record behind it must never read as certified.
withFixture({ corrupt: true }, (fx) => {
  const applied = remediate(fx.root, readJson(sprintPath(fx.root)));
  assert(applied.status === 0, `hand-written anchor: setup failed: ${applied.output}`);
  const live = readJson(sprintPath(fx.root));
  live.certifications = [{ id: 'C-001', path: 'archive/certifications/certification-001.json', commitment: 'b'.repeat(64) }];
  writeJson(sprintPath(fx.root), live);
  assert(
    !existsSync(join(archiveDir(fx.root), 'certifications/certification-001.json')),
    'hand-written anchor: fixture must not have a real certification record',
  );
  const doctor = doctorState(fx.root);
  assert(doctor.state !== 'recertified', 'hand-written anchor: an anchor with no record reported recertified');
});

// ---------------------------------------------------------------------------------------------
// Certification (T2.4/T2.5). Every fixture below certifies through the real `kyro recertify`.
// ---------------------------------------------------------------------------------------------

/** A remediated scope plus a manifest that cites one genuine, re-derivable piece of evidence. */
function remediatedScopeWithManifest(fx, overrides = {}) {
  const applied = remediate(fx.root, readJson(sprintPath(fx.root)));
  assert(applied.status === 0, `certification setup: remediate failed: ${applied.output}`);
  const live = readJson(sprintPath(fx.root));
  const chainHead = live.remediations.at(-1).commitment;

  // External-artifact evidence: a real file in the workspace, hashed exactly as Kyro hashes it.
  const evidencePath = 'validation-report.txt';
  const evidenceBody = 'npm run check: all suites passed\n';
  writeFileSync(join(fx.root, evidencePath), evidenceBody);

  const manifest = {
    schemaVersion: 1,
    kind: 'scope-certification-manifest',
    scope: SCOPE,
    certifiedChainHeadCommitment: chainHead,
    evidence: [{
      source: { kind: 'external-artifact', path: evidencePath, contentDigest: digest(evidenceBody) },
      chainHeadCommitment: chainHead,
    }],
    verdict: { checker: 'npm run check', outcome: 'pass' },
    provenance: { actor: 'verification-states-harness', reason: 'Corrections independently validated.' },
    ...overrides,
  };
  writeJson(join(fx.root, 'certification.json'), manifest);
  return { chainHead, manifest, evidencePath, evidenceBody };
}

function recertify(root, args) {
  return run(root, ['recertify', ...args, '--kyro-scope', SCOPE, '--manifest', 'certification.json']);
}

// 9. recertified — produced through the real recertify apply, asserted by name in both readers.
withFixture({ corrupt: true }, (fx) => {
  remediatedScopeWithManifest(fx);

  const preview = recertify(fx.root, ['preview']);
  assert(preview.status === 0, `recertify preview failed: ${preview.output}`);
  assert(
    !existsSync(join(archiveDir(fx.root), 'certifications')),
    'recertify preview wrote a certification record (preview must write nothing)',
  );
  assert(readJson(sprintPath(fx.root)).certifications === undefined, 'recertify preview anchored a certificate');

  // Confirmation is never implied by a valid plan.
  const unconfirmed = recertify(fx.root, ['apply']);
  assert(unconfirmed.status !== 0, 'recertify apply without --yes must refuse');
  assert(readJson(sprintPath(fx.root)).certifications === undefined, 'refused apply still anchored a certificate');

  const historyBefore = fileTree(archiveDir(fx.root));
  const applied = recertify(fx.root, ['apply', '--yes']);
  assert(applied.status === 0, `recertify apply failed: ${applied.output}`);

  const doctor = assertBothReport(fx.root, 'recertified', 'recertified');
  assert(doctor.status === 0, `recertified: doctor must exit 0, got ${doctor.status}\n${doctor.output}`);

  // Exactly one record, one anchor, and nothing else in history disturbed.
  const live = readJson(sprintPath(fx.root));
  assert(live.certifications.length === 1, `recertified: expected 1 anchor, got ${live.certifications.length}`);
  assert(live.certifications[0].id === 'C-001', `recertified: expected C-001, got ${live.certifications[0].id}`);
  const historyAfter = fileTree(archiveDir(fx.root));
  for (const [name, content] of Object.entries(historyBefore)) {
    assert(historyAfter[name] === content, `recertified: history file ${name} was modified`);
  }
  exportLensFixture(fx.root);
});

// 10. A certificate covers ONE chain head: remediating again must drop it.
withFixture({ corrupt: true }, (fx) => {
  remediatedScopeWithManifest(fx);
  assert(recertify(fx.root, ['apply', '--yes']).status === 0, 'stale head: initial certification failed');
  assertBothReport(fx.root, 'recertified', 'stale head: before second remediation');

  // A second, genuine remediation moves the chain head past what C-001 certified.
  const second = remediate(fx.root, readJson(sprintPath(fx.root)), 2);
  assert(second.status === 0, `stale head: second remediate failed: ${second.output}`);

  const doctor = doctorState(fx.root);
  assert(
    doctor.state !== 'recertified',
    `stale head: certificate survived a later remediation (state=${doctor.state})`,
  );
});

// 10b. The chain-head binding, isolated. Remediating 1 -> 2 -> 1 returns the business state to
//      exactly what C-001 certified, so the certified-digest comparison alone cannot tell that
//      anything happened. Only the chain-head binding can, and without it a certificate would
//      silently cover state it never saw.
withFixture({ corrupt: true }, (fx) => {
  remediatedScopeWithManifest(fx);
  assert(recertify(fx.root, ['apply', '--yes']).status === 0, 'chain-head binding: initial certification failed');
  const certifiedDigest = stateDigest(readJson(sprintPath(fx.root)));

  assert(remediate(fx.root, readJson(sprintPath(fx.root)), 2).status === 0, 'chain-head binding: remediate to 2 failed');
  assert(remediate(fx.root, readJson(sprintPath(fx.root)), 1).status === 0, 'chain-head binding: remediate back to 1 failed');

  assert(
    stateDigest(readJson(sprintPath(fx.root))) === certifiedDigest,
    'chain-head binding: fixture must return the business state to the certified digest',
  );
  const doctor = doctorState(fx.root);
  assert(
    doctor.state !== 'recertified',
    'chain-head binding: a certificate covered a chain head it was never issued against',
  );
});

// 11. Certification failure paths. Each must leave no record, no anchor and no disturbed history.
const failureCases = [
  ['empty evidence', { evidence: [] }],
  ['failing verdict', { verdict: { checker: 'npm run check', outcome: 'fail' } }],
  ['stale chain head', { certifiedChainHeadCommitment: 'c'.repeat(64) }],
  ['unknown manifest schemaVersion', { schemaVersion: 99 }],
];
for (const [label, overrides] of failureCases) {
  withFixture({ corrupt: true }, (fx) => {
    remediatedScopeWithManifest(fx, overrides);
    const historyBefore = fileTree(archiveDir(fx.root));
    const result = recertify(fx.root, ['apply', '--yes']);
    assert(result.status !== 0, `${label}: recertify must refuse, got exit 0\n${result.output}`);
    assert(
      !existsSync(join(archiveDir(fx.root), 'certifications')),
      `${label}: a certification record was written by a refused apply`,
    );
    assert(readJson(sprintPath(fx.root)).certifications === undefined, `${label}: an anchor was written by a refused apply`);
    assert(
      JSON.stringify(fileTree(archiveDir(fx.root))) === JSON.stringify(historyBefore),
      `${label}: history was disturbed by a refused apply`,
    );
  });
}

// 12. Evidence that does not re-derive from the workspace is refused (missing file, and a digest
//     that no longer matches its artifact).
withFixture({ corrupt: true }, (fx) => {
  const { evidencePath } = remediatedScopeWithManifest(fx);
  writeFileSync(join(fx.root, evidencePath), 'DIFFERENT CONTENT\n');
  const result = recertify(fx.root, ['apply', '--yes']);
  assert(result.status !== 0, 'evidence digest mismatch: recertify must refuse');
  assert(!existsSync(join(archiveDir(fx.root), 'certifications')), 'evidence digest mismatch: a record was written');
});

withFixture({ corrupt: true }, (fx) => {
  const { evidencePath } = remediatedScopeWithManifest(fx);
  rmSync(join(fx.root, evidencePath));
  const result = recertify(fx.root, ['apply', '--yes']);
  assert(result.status !== 0, 'missing evidence artifact: recertify must refuse');
  assert(!existsSync(join(archiveDir(fx.root), 'certifications')), 'missing evidence artifact: a record was written');
});

// 13. A forged certification record must never certify, and an interrupted apply (record present,
//     anchor absent) must report PREPARED and be completed — never duplicated — by a retry.
withFixture({ corrupt: true }, (fx) => {
  remediatedScopeWithManifest(fx);
  assert(recertify(fx.root, ['apply', '--yes']).status === 0, 'forged record: setup failed');
  const recordFile = join(archiveDir(fx.root), 'certifications/certification-001.json');
  const record = readJson(recordFile);
  record.provenance.reason = 'TAMPERED AFTER PUBLICATION';
  writeJson(recordFile, record);
  const doctor = doctorState(fx.root);
  assert(doctor.state !== 'recertified', 'forged record: a tampered certificate still certified the scope');
});

withFixture({ corrupt: true }, (fx) => {
  remediatedScopeWithManifest(fx);
  assert(recertify(fx.root, ['apply', '--yes']).status === 0, 'resume: setup failed');

  // Simulate the interruption: the immutable record persisted, the live anchor did not.
  const live = readJson(sprintPath(fx.root));
  delete live.certifications;
  writeJson(sprintPath(fx.root), live);

  const preview = recertify(fx.root, ['preview']);
  assert(preview.output.includes('PREPARED'), `resume: interrupted state must report PREPARED:\n${preview.output}`);
  assert(doctorState(fx.root).state !== 'recertified', 'resume: a PREPARED certificate was presented as certified');

  const retry = recertify(fx.root, ['apply', '--yes']);
  assert(retry.status === 0, `resume: retry failed: ${retry.output}`);
  assert(retry.output.includes('Resumed'), `resume: retry did not report a resume:\n${retry.output}`);

  const after = readJson(sprintPath(fx.root));
  assert(after.certifications.length === 1, `resume: retry created ${after.certifications.length} anchors, expected 1`);
  assert(after.certifications[0].id === 'C-001', 'resume: retry minted a second certificate id');
  const files = readdirSync(join(archiveDir(fx.root), 'certifications'));
  assert(files.length === 1, `resume: expected exactly 1 certification record, got ${files.join(', ')}`);
  assertBothReport(fx.root, 'recertified', 'resume: completed certificate');
});

// ---------------------------------------------------------------------------------------------
// Active-sprint drift. A checkpoint's after-image is only the expected live state until a LATER
// sprint starts; after that, every edit that sprint makes moves live state off it legitimately.
// Reading that as tampering reported ordinary in-sprint work as `diverged` and failed doctor.
// ---------------------------------------------------------------------------------------------

/** Start sprint 2 on a scope whose sprint 1 is already closed, through the real `kyro plan`. */
function startNextSprint(root) {
  writeJson(join(root, 'sprint-plan.json'), {
    sprint: { n: 2, slug: 'follow-up', title: 'Follow-up sprint', objective: 'Continue the work after close.' },
    phases: [{
      id: 'P1',
      title: 'Follow-up phase',
      objective: 'Do the next piece of work.',
      tasks: [{
        id: 'T2.1',
        title: 'A task in the active sprint',
        description: 'Ordinary work that legitimately moves live state off the sprint 1 after-image.',
        files_to_touch: ['src/example.ts'],
        context: 'Active-sprint drift regression.',
        acceptance_criteria: ['The work is done.'],
        depends_on: [],
        scenario_refs: [],
      }],
    }],
    definitionOfDone: ['The follow-up task is done.'],
  });
  return run(root, ['plan', '--from', 'sprint-plan.json', '--kyro-scope', SCOPE]);
}

// 14. A closed scope that then legitimately starts sprint 2 must keep doctor green and must not be
//     accused of divergence for work the new sprint did.
withFixture({ corrupt: false, plannedSprints: 2 }, (fx) => {
  const planned = startNextSprint(fx.root);
  assert(planned.status === 0, `active sprint: kyro plan failed: ${planned.output}`);

  const live = readJson(sprintPath(fx.root));
  assert(live.activeSprint?.n === 2, `active sprint: expected sprint 2 active, got ${live.activeSprint?.n}`);
  assert(
    stateDigest(live) !== undefined,
    'active sprint: fixture must have live state',
  );

  const doctor = doctorState(fx.root);
  assert(
    doctor.status === 0,
    `active sprint: doctor must stay green while sprint 2 is active, got exit ${doctor.status}\n${doctor.output}`,
  );
  assert(
    doctor.state !== 'diverged',
    `active sprint: legitimate in-sprint drift was reported as ${doctor.state}\n${doctor.output}`,
  );
  assert(
    !doctor.output.includes('[FAIL]'),
    `active sprint: doctor reported a failure on ordinary in-sprint work:\n${doctor.output}`,
  );
});

// 15. The same, but on a scope that WAS remediated before the new sprint started. The chain is
//     still validated (a forged record must still be caught); only drift goes unjudged.
withFixture({ corrupt: true, plannedSprints: 2 }, (fx) => {
  const applied = remediate(fx.root, readJson(sprintPath(fx.root)));
  assert(applied.status === 0, `active sprint + chain: remediate failed: ${applied.output}`);
  assertBothReport(fx.root, 'remediated', 'active sprint + chain: before the new sprint');

  const planned = startNextSprint(fx.root);
  assert(planned.status === 0, `active sprint + chain: kyro plan failed: ${planned.output}`);

  const doctor = doctorState(fx.root);
  assert(doctor.status === 0, `active sprint + chain: doctor must stay green, got exit ${doctor.status}\n${doctor.output}`);
  assert(
    doctor.state === 'remediated',
    `active sprint + chain: expected remediated, got ${doctor.state}\n${doctor.output}`,
  );

  // Chain health is still enforced: tampering with the record must still be caught even though
  // drift is no longer judged.
  const recordFile = join(archiveDir(fx.root), 'remediations/remediation-001.json');
  const record = readJson(recordFile);
  record.provenance.reason = 'TAMPERED AFTER PUBLICATION';
  writeJson(recordFile, record);
  const tampered = doctorState(fx.root);
  assert(
    tampered.state === 'diverged',
    `active sprint + chain: a forged record went unreported while a sprint was active (state=${tampered.state})`,
  );
  assert(tampered.status !== 0, 'active sprint + chain: doctor must exit non-zero on a forged record');
});

// 16. A record version the runtime does not understand is not a malformed v1 record to be
// coerced: both readers report unsupported, fail closed, and leave the close evidence untouched.
withFixture({ corrupt: true }, (fx) => {
  const applied = remediate(fx.root, readJson(sprintPath(fx.root)));
  assert(applied.status === 0, `unsupported remediation version: setup failed: ${applied.output}`);
  const historyBefore = historicalArchive(fx.root);
  const ledgerBefore = JSON.stringify(readJson(sprintPath(fx.root)).ledger);

  const recordFile = join(archiveDir(fx.root), 'remediations/remediation-001.json');
  const record = readJson(recordFile);
  record.schemaVersion = 99;
  writeJson(recordFile, record);
  const live = readJson(sprintPath(fx.root));
  live.remediations[0].commitment = digest(record);
  writeJson(sprintPath(fx.root), live);

  const doctor = assertBothReport(fx.root, 'unsupported', 'unsupported remediation version');
  assert(doctor.status !== 0, 'unsupported remediation version: doctor must fail closed');
  assert(doctor.output.includes('schemaVersion=99'), `unsupported remediation version: doctor must name the version\n${doctor.output}`);
  const status = run(fx.root, ['status', '--kyro-scope', SCOPE]);
  assert(status.output.includes('schemaVersion=99'), `unsupported remediation version: status must name the version\n${status.output}`);
  assert(JSON.stringify(historicalArchive(fx.root)) === JSON.stringify(historyBefore), 'unsupported remediation version: checkpoint, snapshot, and narrative bytes changed');
  assert(JSON.stringify(readJson(sprintPath(fx.root)).ledger) === ledgerBefore, 'unsupported remediation version: ledger changed');
});

console.log(`check:verification-states — ${passed} assertions passed`);
