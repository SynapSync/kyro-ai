#!/usr/bin/env node
/**
 * Canonicalization completion gate (T3.4).
 *
 * Two things are proven here that no other harness proves.
 *
 * 1. The COMPLETE operator flow on the faithful D1 shape — prepare, preview, apply, resume, replay,
 *    doctor, status, recertify — as one continuous transcript against one scope, rather than as
 *    separate cases that each happen to pass in isolation.
 *
 * 2. That every guard added by this sprint is load-bearing. A passing negative test proves the suite
 *    reports a failure; it does NOT prove the failure came from the check we believe in. So each
 *    guard is disabled in a throwaway copy of the built runtime, and the corresponding probe must
 *    change its answer. A guard whose removal changes nothing was never protecting anything, and
 *    this file fails loudly when that is the case.
 *
 * Deliberately out of scope, and owned by later sprints: Kyro Lens parity (Sprint 4), the packaged
 * install and the temporary-copy probe of the original Aliva scope (Sprint 5), release
 * documentation and publication. Nothing here asserts any of those.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(fileURLToPath(import.meta.url), '../..');
const distRoot = resolve(repo, 'dist');
const closeFixture = resolve(repo, 'fixtures/evals/close-sprint-happy/state');
const SCOPE = 'demo';

let passed = 0;
function assert(condition, message) {
  if (!condition) throw new Error(message);
  passed += 1;
}

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical(value[k])]));
  return value;
}
const digest = (value) => createHash('sha256')
  .update(typeof value === 'string' ? value : JSON.stringify(canonical(value)), 'utf8')
  .digest('hex');

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

const sprintPath = (root) => join(root, `.agents/kyro/scopes/${SCOPE}/sprint.json`);
const archiveDir = (root) => join(root, `.agents/kyro/scopes/${SCOPE}/archive`);
const recordPath = (root, id = '001') => join(archiveDir(root), `remediations/remediation-${id}.json`);
/** Archive bytes that predate this sprint's work: history that must never move. */
const history = (root) => Object.fromEntries(
  Object.entries(fileTree(archiveDir(root))).filter(([name]) => !name.startsWith('remediations/') && !name.startsWith('certifications/')),
);

/** Run a CLI from an arbitrary dist tree, so a mutated runtime can be driven exactly like the real one. */
function runWith(dist, root, args) {
  const result = spawnSync(process.execPath, [join(dist, 'cli.js'), ...args], {
    cwd: root,
    encoding: 'utf-8',
    env: { ...process.env, HOME: join(root, '.home') },
  });
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}
const run = (root, args) => runWith(distRoot, root, args);

// --- The faithful fixture -----------------------------------------------------------------------
//
// The corpus is the source of the shape (shared-debt-vectors): if the decisive D1 record is ever
// cleaned up, this gate stops describing the real incident and says so rather than passing quietly.
const corpus = readJson(resolve(repo, 'fixtures/debt-contract/golden.json'));
const D1 = corpus.cases.find((entry) => entry.id === 'live-d1-remediation-required')?.raw;
assert(D1 !== undefined, 'the golden corpus must still carry the faithful D1 case');
assert(typeof D1.origin === 'string', 'the faithful D1 must keep its string origin');
assert(!('priority' in D1) && !('targetSprint' in D1), 'the faithful D1 must keep its absent canonical fields');
for (const key of ['detail', 'resolution', 'addedSprint']) {
  assert(key in D1, `the faithful D1 must keep its legacy key ${key}`);
}

const BYSTANDER = { id: 'D2', title: 'Unrelated debt', origin: 1, priority: 'medium', status: 'open', targetSprint: null, note: 'Untouched.' };

/** A genuinely closed scope whose live debt was then rewritten into the legacy shape. */
function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'kyro-canonicalization-gate-'));
  cpSync(closeFixture, root, { recursive: true });
  mkdirSync(join(root, '.home'), { recursive: true });

  const sprint = readJson(sprintPath(root));
  sprint.debt = [
    { id: 'D1', title: D1.title, origin: 1, priority: 'low', status: D1.status, targetSprint: null, note: D1.note },
    { ...BYSTANDER },
  ];
  writeJson(sprintPath(root), sprint);
  const closed = run(root, ['close-sprint', '--kyro-scope', SCOPE, '--outcome', 'shipped', '--note', 'Closed.', '--summary', 'Closed.', '--confirm']);
  assert(closed.status === 0, `fixture close-sprint failed: ${closed.output}`);

  const live = readJson(sprintPath(root));
  live.debt[0] = { ...D1 };
  writeJson(sprintPath(root), live);
  return root;
}

function withFixture(fn) {
  const root = makeFixture();
  try { return fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

/** The complete manifest the operator would hold, built through the real preparation surface. */
function prepare(root, decisions = ['--origin', '1', '--priority', 'high', '--target-sprint', 'null'], dist = distRoot) {
  const result = runWith(dist, root, ['remediate', 'canonicalize-prepare', '--debt', 'D1', '--kyro-scope', SCOPE,
    '--reason', 'The record predates the canonical debt contract.', '--actor', 'gate', '--json', ...decisions]);
  assert(result.status === 0, `canonicalize-prepare failed: ${result.output}`);
  return JSON.parse(result.output);
}

// =================================================================================================
// 1. The complete flow, on one scope, in order.
// =================================================================================================
withFixture((root) => {
  const historyBefore = history(root);
  const liveBefore = readFileSync(sprintPath(root), 'utf8');

  // -- prepare: nothing is decided for the operator, and nothing is written. ----------------------
  const undecided = prepare(root, []);
  assert(undecided.status === 'INPUT_REQUIRED', `an undecided preparation must ask, got ${undecided.status}`);
  assert(undecided.manifest === null, 'an undecided preparation must not produce a manifest');
  assert(undecided.unresolved.map((entry) => entry.field).sort().join(',') === 'origin,priority,targetSprint',
    `every unsettled canonical value must be named, got ${undecided.unresolved.map((entry) => entry.field)}`);
  assert(undecided.unresolved.find((entry) => entry.field === 'origin').suggested === 1,
    'origin must carry its addedSprint evidence as a suggestion');
  assert(undecided.unresolved.filter((entry) => entry.field !== 'origin').every((entry) => entry.suggested === null),
    'a business judgment must reach the operator with no suggestion at all');
  assert(readFileSync(sprintPath(root), 'utf8') === liveBefore, 'preparation must not write');

  const ready = prepare(root);
  assert(ready.status === 'READY', `a fully decided preparation must be READY, got ${ready.status}`);
  assert(ready.manifest.schemaVersion === 3, 'a canonicalization manifest must declare protocol revision 3');
  assert(readFileSync(sprintPath(root), 'utf8') === liveBefore, 'a complete preparation must still not write');
  writeJson(join(root, 'manifest.json'), ready.manifest);

  // -- preview: accepted, and still nothing written. ---------------------------------------------
  const preview = run(root, ['remediate', 'canonicalize-preview', '--manifest', 'manifest.json', '--kyro-scope', SCOPE, '--json']);
  assert(preview.status === 0, `preview must accept the prepared manifest: ${preview.output}`);
  assert(JSON.parse(preview.output).accepted === true, 'preview must accept the prepared manifest');
  assert(readFileSync(sprintPath(root), 'utf8') === liveBefore, 'preview must not write');

  // -- interrupted publish, then resume: one record, never two. ----------------------------------
  const rehearsal = mkdtempSync(join(tmpdir(), 'kyro-gate-rehearsal-'));
  cpSync(root, rehearsal, { recursive: true });
  assert(run(rehearsal, ['remediate', 'apply', '--manifest', 'manifest.json', '--kyro-scope', SCOPE, '--yes']).status === 0,
    'the rehearsal apply must succeed so its record can be replanted');
  const preparedRecord = readJson(recordPath(rehearsal));
  rmSync(rehearsal, { recursive: true, force: true });

  mkdirSync(join(archiveDir(root), 'remediations'), { recursive: true });
  writeJson(recordPath(root), preparedRecord);
  const interrupted = run(root, ['doctor', '--artifacts', '--kyro-scope', SCOPE]);
  assert(/remediation\/R-001: PREPARED/.test(interrupted.output),
    `an interrupted publish must be visible as PREPARED: ${interrupted.output}`);

  const resumed = run(root, ['remediate', 'apply', '--manifest', 'manifest.json', '--kyro-scope', SCOPE, '--yes']);
  assert(resumed.status === 0, `resume must complete the interrupted transaction: ${resumed.output}`);
  assert(/Resumed interrupted remediation/.test(resumed.output), 'the resume must report itself as one');
  assert(JSON.stringify(readJson(recordPath(root))) === JSON.stringify(preparedRecord),
    'resume must finish the existing record byte-for-byte');
  assert(!existsSync(recordPath(root, '002')), 'resume must not publish a duplicate R-NNN');

  // -- the applied result: exactly canonical, append-only, history untouched. ---------------------
  const live = readJson(sprintPath(root));
  const target = live.debt.find((entry) => entry.id === 'D1');
  assert(JSON.stringify(Object.keys(target)) === JSON.stringify(['id', 'title', 'origin', 'priority', 'status', 'targetSprint', 'note']),
    `the live record must hold exactly the seven canonical keys in order, got ${Object.keys(target)}`);
  assert(target.origin === 1 && target.priority === 'high' && target.targetSprint === null,
    'the operator-authorized values must be the ones that landed');
  assert(JSON.stringify(live.debt.find((entry) => entry.id === 'D2')) === JSON.stringify(BYSTANDER),
    'an unrelated debt must be untouched');
  assert(live.remediations.length === 1, 'exactly one anchor must be appended');
  assert(readJson(recordPath(root)).schemaVersion === 3, 'the record must be written at protocol revision 3');
  assert(JSON.stringify(history(root)) === JSON.stringify(historyBefore),
    'checkpoint, snapshot, narrative and ledger bytes must be unchanged by the transaction');

  // -- replay: doctor and status agree the chain explains live state. ----------------------------
  const doctor = run(root, ['doctor', '--artifacts', '--kyro-scope', SCOPE]);
  assert(doctor.status === 0, `the canonicalized scope must verify: ${doctor.output}`);
  assert(doctor.output.includes('replayed through R-001'), `the chain must be named as the explanation: ${doctor.output}`);
  const status = run(root, ['status', '--kyro-scope', SCOPE]);
  assert(status.status === 0 && /Verification: remediated/.test(status.output),
    `status must report remediated: ${status.output}`);

  // -- recertify: one C-NNN bound to this head, on re-derivable evidence. -------------------------
  const chainHead = live.remediations.at(-1).commitment;
  const evidenceBody = 'npm run check: all suites passed\n';
  writeFileSync(join(root, 'validation-report.txt'), evidenceBody);
  writeJson(join(root, 'certification.json'), {
    schemaVersion: 1,
    kind: 'scope-certification-manifest',
    scope: SCOPE,
    certifiedChainHeadCommitment: chainHead,
    evidence: [{
      source: { kind: 'external-artifact', path: 'validation-report.txt', contentDigest: digest(evidenceBody) },
      chainHeadCommitment: chainHead,
    }],
    verdict: { checker: 'npm run check', outcome: 'pass' },
    provenance: { actor: 'gate', reason: 'Canonicalization independently validated.' },
  });
  const certified = run(root, ['recertify', 'apply', '--kyro-scope', SCOPE, '--manifest', 'certification.json', '--yes']);
  assert(certified.status === 0, `the verified head must be certifiable: ${certified.output}`);
  const finalStatus = run(root, ['status', '--kyro-scope', SCOPE]);
  assert(/Verification: recertified/.test(finalStatus.output), `status must report recertified: ${finalStatus.output}`);
  assert(run(root, ['doctor', '--artifacts', '--kyro-scope', SCOPE]).status === 0, 'the certified scope must stay healthy');
  assert(JSON.stringify(history(root)) === JSON.stringify(historyBefore),
    'the whole flow must leave checkpoint, snapshot, narrative and ledger bytes untouched');
});

// =================================================================================================
// 2. Guard mutation: every check must be provably load-bearing.
// =================================================================================================

/**
 * Run `fn` against the built runtime with exactly one guard disabled, then restore it.
 *
 * The mutation is applied to the real `dist/` in place rather than to a copy. That is deliberate:
 * the CLI classifies its own package root from its location, so a runtime copied elsewhere is a
 * different root and doctor reports on the layout instead of on the scope — every probe would then
 * "detect" a guard it never exercised. Mutating in place keeps the runtime under test identical to
 * the shipped one in every respect but the single line being removed.
 *
 * The original bytes are restored in `finally`, and the restore is verified. If this harness is ever
 * interrupted hard enough to skip that, `npm run build` regenerates dist/ from source.
 */
function withMutatedRuntime(mutation, fn) {
  const path = join(distRoot, mutation.file);
  const before = readFileSync(path, 'utf8');
  const occurrences = before.split(mutation.find).length - 1;
  // A mutation that silently failed to apply would make every probe below report "guard removed,
  // nothing changed" — which is exactly the conclusion this section exists to draw honestly.
  assert(occurrences === 1,
    `mutation "${mutation.label}" must match its anchor exactly once in ${mutation.file}, matched ${occurrences}`);
  try {
    writeFileSync(path, before.replace(mutation.find, mutation.replace));
    return fn(distRoot);
  } finally {
    writeFileSync(path, before);
    assert(readFileSync(path, 'utf8') === before, `mutation "${mutation.label}" did not restore ${mutation.file}`);
  }
}

/** A probe result the guard is expected to produce by refusing the operation outright. */
const refuses = (result) => result.status !== 0;
/** A probe result the guard is expected to produce by letting a legitimate operation through. */
const accepts = (result) => result.status === 0;

/**
 * Each entry names a guard, how to disable it, and a probe that must give a DIFFERENT answer with
 * the guard gone. `guardWorking` says what the probe looks like while the guard is intact, so a
 * probe that silently stopped exercising its case cannot masquerade as a working mutation test.
 *
 * Detection is a predicate over the whole result rather than an exit code, because not every guard
 * is expressed as one: `status` reports a scope's verification state on stdout and exits 0 either
 * way, so the only honest question to ask it is what it SAID.
 */
const GUARDS = [
  {
    label: 'whole-debt collection precondition',
    file: 'cli/remediation/protocol.js',
    find: 'if (observedDigest !== operation.expectedDebtCollectionSha256) {',
    replace: 'if (false) {',
    guardWorking: refuses,
    probe: (dist, root) => {
      const manifest = prepare(root).manifest;
      manifest.operations[0].expectedDebtCollectionSha256 = 'a'.repeat(64);
      writeJson(join(root, 'manifest.json'), manifest);
      return runWith(dist, root, ['remediate', 'apply', '--manifest', 'manifest.json', '--kyro-scope', SCOPE, '--yes']);
    },
  },
  {
    label: 'identity and lifecycle preservation',
    file: 'cli/remediation/protocol.js',
    find: "for (const key of ['title', 'status']) {",
    replace: 'for (const key of []) {',
    guardWorking: refuses,
    probe: (dist, root) => {
      const manifest = prepare(root).manifest;
      manifest.operations[0].after.title = 'Renamed by the manifest';
      writeJson(join(root, 'manifest.json'), manifest);
      return runWith(dist, root, ['remediate', 'apply', '--manifest', 'manifest.json', '--kyro-scope', SCOPE, '--yes']);
    },
  },
  {
    label: 'retired-key accounting',
    file: 'cli/remediation/protocol.js',
    find: 'if (!operation.retiredKeys.includes(key)) {',
    replace: 'if (false) {',
    guardWorking: refuses,
    probe: (dist, root) => {
      const manifest = prepare(root).manifest;
      manifest.operations[0].retiredKeys = ['detail'];
      writeJson(join(root, 'manifest.json'), manifest);
      return runWith(dist, root, ['remediate', 'apply', '--manifest', 'manifest.json', '--kyro-scope', SCOPE, '--yes']);
    },
  },
  {
    label: 'exact seven-key after-image',
    file: 'cli/remediation/protocol.js',
    find: 'requireUnknownKeys(value, exports.CANONICAL_DEBT_AFTER_KEYS, path, prefix, issues);',
    replace: '',
    guardWorking: refuses,
    probe: (dist, root) => {
      const manifest = prepare(root).manifest;
      manifest.operations[0].after.addedSprint = 1;
      writeJson(join(root, 'manifest.json'), manifest);
      return runWith(dist, root, ['remediate', 'apply', '--manifest', 'manifest.json', '--kyro-scope', SCOPE, '--yes']);
    },
  },
  {
    label: 'protocol revision binding',
    file: 'cli/remediation/protocol.js',
    find: "[exports.SCOPE_REMEDIATION_SCHEMA_VERSION]: ['debt.origin.set'],",
    replace: "[exports.SCOPE_REMEDIATION_SCHEMA_VERSION]: ['debt.origin.set', 'debt.canonicalize'],",
    guardWorking: refuses,
    probe: (dist, root) => {
      // A canonicalization smuggled into the revision that predates it.
      const manifest = prepare(root).manifest;
      manifest.schemaVersion = 1;
      writeJson(join(root, 'manifest.json'), manifest);
      return runWith(dist, root, ['remediate', 'apply', '--manifest', 'manifest.json', '--kyro-scope', SCOPE, '--yes']);
    },
  },
  {
    label: 'compact-revision replay',
    file: 'cli/remediation/plan.js',
    find: 'if (isLast || record.schemaVersion !== protocol_1.SCOPE_REMEDIATION_SCHEMA_VERSION)',
    replace: 'if (isLast || record.schemaVersion === 2)',
    guardWorking: accepts,
    probe: (dist, root) => {
      // A v3 record that is NOT the chain head: only a correct compact-revision test replays it.
      assert(run(root, ['remediate', 'apply', '--manifest', writeReadyManifest(root), '--kyro-scope', SCOPE, '--yes']).status === 0,
        'compact-revision probe: the canonicalization must apply');
      const live = readJson(sprintPath(root));
      writeJson(join(root, 'origin.json'), {
        schemaVersion: 1,
        kind: 'scope-remediation-manifest',
        scope: SCOPE,
        base: { stateSha256: businessDigest(live), remediationHead: live.remediations.at(-1).commitment },
        issues: [{ id: 'I-1', code: 'debt.origin.drift', path: 'debt[D1].origin', observedValueSha256: digest(JSON.stringify(canonical(1))) }],
        operations: [{ id: 'O-1', kind: 'debt.origin.set', resolves: ['I-1'], debtId: 'D1', expectedOriginSha256: digest(JSON.stringify(canonical(1))), origin: 2, reason: 'Origin corrected.' }],
        provenance: { reason: 'Drift after canonicalization.', actor: 'gate' },
      });
      assert(run(root, ['remediate', 'apply', '--manifest', 'origin.json', '--kyro-scope', SCOPE, '--yes']).status === 0,
        'compact-revision probe: the second link must apply');
      return runWith(dist, root, ['doctor', '--artifacts', '--kyro-scope', SCOPE]);
    },
  },
  {
    // The shared semantic evaluation, which BOTH readers consume. Removing it must blind doctor.
    label: 'unanchored-record evaluation',
    file: 'cli/remediation/plan.js',
    find: 'function evaluateUnanchoredRemediationRecords(scope, anchors, headCommitment = null, headResult = null) {',
    replace: 'function evaluateUnanchoredRemediationRecords(scope, anchors, headCommitment = null, headResult = null) { return [];',
    guardWorking: refuses,
    probe: (dist, root) => plantUnanchoredRecord(dist, root, ['doctor', '--artifacts', '--kyro-scope', SCOPE]),
  },
  {
    // The verification derivation's consultation of that evaluation. `status` exits 0 either way, so
    // what is under test is what it SAID — this is the guard whose absence let doctor report a
    // planted record as DIVERGED while status called the same scope `remediated`.
    label: 'unanchored records reach the verification state',
    file: 'cli/remediation/plan.js',
    find: 'const unanchored = evaluateUnanchoredRemediationRecords(scope, anchors, expectedHead, expectedBase);',
    replace: 'const unanchored = [];',
    guardWorking: (result) => /Verification: diverged/.test(result.output),
    probe: (dist, root) => plantUnanchoredRecord(dist, root, ['status', '--kyro-scope', SCOPE]),
  },
];

/**
 * Bring a scope to a genuinely verified state, then plant a record that no anchor references and
 * that does not continue the chain, and ask one reader about it.
 *
 * The verified starting point matters: without it the fixture's own legacy drift would make every
 * reader unhappy regardless, and the probe would "detect" a guard it never exercised.
 */
function plantUnanchoredRecord(dist, root, args) {
  assert(run(root, ['remediate', 'apply', '--manifest', writeReadyManifest(root), '--kyro-scope', SCOPE, '--yes']).status === 0,
    'unanchored probe: the canonicalization must apply');
  assert(run(root, ['doctor', '--artifacts', '--kyro-scope', SCOPE]).status === 0,
    'unanchored probe: the scope must verify before the record is planted');
  assert(/Verification: remediated/.test(run(root, ['status', '--kyro-scope', SCOPE]).output),
    'unanchored probe: status must agree the scope is healthy before the record is planted');

  const planted = readJson(recordPath(root));
  planted.id = 'R-002';
  planted.base.remediationHead = 'd'.repeat(64);
  writeJson(recordPath(root, '002'), planted);
  return runWith(dist, root, args);
}

/** Business-state digest: both append-only anchors are excluded, exactly as Kyro projects it. */
function businessDigest(sprint) {
  const projected = { ...sprint };
  delete projected.remediations;
  delete projected.certifications;
  return digest(projected);
}

function writeReadyManifest(root) {
  writeJson(join(root, 'manifest.json'), prepare(root).manifest);
  return 'manifest.json';
}

for (const guard of GUARDS) {
  const real = withFixture((root) => guard.probe(distRoot, root));
  const mutated = withMutatedRuntime(guard, (dist) => withFixture((root) => guard.probe(dist, root)));

  assert(guard.guardWorking(real),
    `${guard.label}: the probe does not exercise this guard against the real runtime:\n${real.output}`);
  assert(!guard.guardWorking(mutated),
    `${guard.label}: disabling the guard changed nothing — the probe is not bound to it:\n${mutated.output}`);
}

console.log(`check:canonicalization-gate — ${passed} assertions passed; ${GUARDS.length} guards proven load-bearing`);
