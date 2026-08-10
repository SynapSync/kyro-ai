#!/usr/bin/env node
/**
 * Original-incident release gate (Sprint 5 / T5.2, T5.3).
 *
 * `check:canonicalization-gate` already proves the operator flow against the built source tree.
 * That is necessary and not sufficient: a release is a tarball someone installs, and every previous
 * failure in this scope came from certifying something adjacent to what the user actually runs.
 *
 * So this gate asks three questions the source gate cannot:
 *
 *  1. Is the fixture still the real incident? The faithful D1 keeps a STRING origin, the legacy-only
 *     keys detail/resolution/addedSprint, and NO priority/targetSprint. If a future cleanup
 *     canonicalizes the corpus, the gate stops describing the incident — so the shape is asserted,
 *     and section 1 proves those assertions actually bite by breaking the shape on purpose.
 *
 *  2. Does the PACKAGED runtime do it? `npm pack` is installed into a fresh temporary prefix and
 *     driven through the identical flow. Source and package are asserted independently — each run
 *     re-derives the after-image, the retired keys and the chain head from its own output. Neither
 *     is allowed to stand in for the other, and no assertion is satisfied by a shared label.
 *
 *  3. Did history move? Every checkpoint, snapshot and narrative byte, and every existing ledger
 *     commitment, is inventoried by SHA-256 before and after. Only the live projection and the
 *     appended R-NNN/C-NNN artifacts may differ.
 *
 * The globally installed runtime under ~/.agents/kyro is REPORTED, never exercised as the candidate
 * and never written to. Its capability is a compatibility observation about what users have today.
 *
 * With `--original-scope <path>` the gate additionally runs T5.3: a read-only probe of a real local
 * scope, remediated only inside a fresh temporary copy. Without the flag that section reports as
 * not-requested; with `--require-original-scope` its absence is a failure.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
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

const CANONICAL_KEYS = ['id', 'title', 'origin', 'priority', 'status', 'targetSprint', 'note'];
const LEGACY_KEYS = ['detail', 'resolution', 'addedSprint'];

// =================================================================================================
// Temporary-path safety.
//
// Every write this gate performs must land under the OS temp root. The original checkout is
// evidence, not a fixture (convention aliva-readonly-probe), and a harness that can be pointed at a
// working tree by a typo is one bad argument away from destroying the thing it exists to protect.
// =================================================================================================

const TEMP_ROOT = realpathSync(tmpdir());

function assertTemporary(path, label) {
  assert(typeof path === 'string' && path.length > 0, `${label}: a write target must be a non-empty path`);
  const absolute = resolve(path);
  assert(absolute === path, `${label}: a write target must already be absolute and resolved, got ${path}`);
  const real = realpathSync(absolute);
  assert(real === TEMP_ROOT || real.startsWith(TEMP_ROOT + sep),
    `${label}: refusing to write outside the temp root (${TEMP_ROOT}): ${real}`);
  assert(!real.startsWith(realpathSync(repo) + sep) && real !== realpathSync(repo),
    `${label}: refusing to write inside the Kyro checkout: ${real}`);
  return real;
}

function makeTempDir(prefix) {
  const dir = mkdtempSync(join(TEMP_ROOT, prefix));
  assertTemporary(dir, `temp dir ${prefix}`);
  return dir;
}

// The refusal is itself a claim; prove it rather than trusting it.
for (const [bad, why] of [
  [repo, 'the Kyro checkout'],
  [join(repo, 'scripts'), 'a directory inside the Kyro checkout'],
  [homedir(), 'the home directory'],
]) {
  let refused = false;
  try { assertTemporary(bad, 'safety probe'); } catch { refused = true; }
  assert(refused, `the temp-path guard must refuse ${why} (${bad})`);
}
{
  let refused = false;
  try { assertTemporary('relative/path', 'safety probe'); } catch { refused = true; }
  assert(refused, 'the temp-path guard must refuse an unresolved relative path');
}

// =================================================================================================
// The faithful fixture.
// =================================================================================================

const corpus = readJson(resolve(repo, 'fixtures/debt-contract/golden.json'));

function faithfulD1(source = corpus) {
  const entry = source.cases.find((c) => c.id === 'live-d1-remediation-required');
  assert(entry !== undefined, 'the golden corpus must still carry the faithful live D1 case');
  return entry.raw;
}

/**
 * The sentinel. Every clause here is a way the incident could be "cleaned up" out of existence.
 * Section 1 below re-runs this against deliberately cleaned corpora and requires it to throw.
 */
function assertFaithfulShape(source) {
  const d1 = faithfulD1(source);
  assert(typeof d1.origin === 'string', 'the faithful D1 must keep its string origin');
  assert(!('priority' in d1), 'the faithful D1 must keep priority absent');
  assert(!('targetSprint' in d1), 'the faithful D1 must keep targetSprint absent');
  for (const key of LEGACY_KEYS) {
    assert(key in d1, `the faithful D1 must keep its legacy key ${key}`);
  }
  // The historical variants are the checkpoint-era shapes the same record passed through.
  for (const id of ['historical-d1-sprint-1', 'historical-d1-sprint-2']) {
    const historical = source.cases.find((c) => c.id === id);
    assert(historical !== undefined, `the golden corpus must still carry ${id}`);
    assert(typeof historical.raw.origin === 'string', `${id} must keep its string origin`);
  }
  return d1;
}

const D1 = assertFaithfulShape(corpus);
const BYSTANDER = { id: 'D2', title: 'Unrelated debt', origin: 1, priority: 'medium', status: 'open', targetSprint: null, note: 'Untouched.' };

// =================================================================================================
// 1. The sentinel bites.
//
// A shape assertion nobody has ever seen fail is a comment. Each clean-up below is exactly the edit
// a well-meaning future contributor would make, and each must take the gate down.
// =================================================================================================

function cleaned(mutate) {
  const copy = JSON.parse(JSON.stringify(corpus));
  mutate(copy.cases.find((c) => c.id === 'live-d1-remediation-required').raw, copy);
  return copy;
}

const CLEANUPS = [
  ['origin canonicalized to a sprint number', (raw) => { raw.origin = 1; }],
  ['origin key deleted outright', (raw) => { delete raw.origin; }],
  ['legacy key detail removed', (raw) => { delete raw.detail; }],
  ['legacy key resolution removed', (raw) => { delete raw.resolution; }],
  ['legacy key addedSprint removed', (raw) => { delete raw.addedSprint; }],
  ['missing canonical field priority filled in', (raw) => { raw.priority = 'medium'; }],
  ['missing canonical field targetSprint filled in', (raw) => { raw.targetSprint = null; }],
  ['the live D1 case deleted', (_raw, copy) => { copy.cases = copy.cases.filter((c) => c.id !== 'live-d1-remediation-required'); }],
  ['a historical variant canonicalized', (_raw, copy) => { copy.cases.find((c) => c.id === 'historical-d1-sprint-1').raw.origin = 1; }],
];

for (const [label, mutate] of CLEANUPS) {
  let bit = false;
  try { assertFaithfulShape(cleaned(mutate)); } catch { bit = true; }
  assert(bit, `the fixture sentinel must fail when the incident shape is destroyed: ${label}`);
}

// =================================================================================================
// Runtimes under test.
// =================================================================================================

/** Drive a CLI from an arbitrary runtime root, always inside a temporary workspace. */
function runWith(runtime, root, args) {
  assertTemporary(root, 'cli invocation cwd');
  const result = spawnSync(process.execPath, [runtime.cli, ...args], {
    cwd: root,
    encoding: 'utf-8',
    // HOME is redirected into the fixture so nothing can reach the real ~/.agents.
    env: { ...process.env, HOME: join(root, '.home'), OPENSSL_CONF: '/dev/null' },
  });
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

const sprintPath = (root, scope = SCOPE) => join(root, `.agents/kyro/scopes/${scope}/sprint.json`);
const archiveDir = (root, scope = SCOPE) => join(root, `.agents/kyro/scopes/${scope}/archive`);
const recordPath = (root, id = '001', scope = SCOPE) => join(archiveDir(root, scope), `remediations/remediation-${id}.json`);

function fileTree(dir) {
  const out = {};
  const walk = (current) => {
    for (const name of readdirSync(current)) {
      const path = join(current, name);
      if (statSync(path).isDirectory()) walk(path);
      else out[relative(dir, path)] = readFileSync(path);
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}

/**
 * SHA-256 inventory of immutable history: checkpoints (.checkpoint.json), snapshots (.json) and
 * narratives (.md), plus every ledger commitment already recorded in live state. Appended
 * remediation and certification artifacts are excluded — those are the only things allowed to grow.
 */
function historyInventory(root, scope = SCOPE) {
  const files = Object.fromEntries(
    Object.entries(fileTree(archiveDir(root, scope)))
      .filter(([name]) => !name.startsWith('remediations/') && !name.startsWith('certifications/'))
      .map(([name, bytes]) => [name, createHash('sha256').update(bytes).digest('hex')]),
  );
  const live = existsSync(sprintPath(root, scope)) ? readJson(sprintPath(root, scope)) : {};
  const ledger = (live.ledger ?? []).map((entry) => digest(entry));
  assert(Object.keys(files).length > 0, 'a scope under test must actually have archived history to protect');
  return { files, ledger };
}

function assertHistoryUnchanged(before, after, label) {
  assert(JSON.stringify(after.files) === JSON.stringify(before.files),
    `${label}: checkpoint, snapshot and narrative bytes must be identical.\n  before: ${JSON.stringify(before.files)}\n  after:  ${JSON.stringify(after.files)}`);
  assert(JSON.stringify(after.ledger) === JSON.stringify(before.ledger),
    `${label}: existing ledger commitments must be identical`);
}

/** A genuinely closed scope whose live D1 is then rewritten into the faithful legacy shape. */
function makeIncidentFixture(runtime) {
  const root = makeTempDir('kyro-incident-');
  cpSync(closeFixture, root, { recursive: true });
  mkdirSync(join(root, '.home'), { recursive: true });

  const seed = readJson(sprintPath(root));
  seed.debt = [
    { id: 'D1', title: D1.title, origin: 1, priority: 'low', status: D1.status, targetSprint: null, note: D1.note },
    { ...BYSTANDER },
  ];
  writeJson(sprintPath(root), seed);
  const closed = runWith(runtime, root, ['close-sprint', '--kyro-scope', SCOPE, '--outcome', 'shipped', '--note', 'Closed.', '--summary', 'Closed.', '--confirm']);
  assert(closed.status === 0, `${runtime.label}: fixture close-sprint failed: ${closed.output}`);

  const live = readJson(sprintPath(root));
  live.debt[0] = { ...D1 };
  writeJson(sprintPath(root), live);

  // The fixture must genuinely be the incident before anything is done to it.
  const seeded = readJson(sprintPath(root)).debt.find((d) => d.id === 'D1');
  assert(typeof seeded.origin === 'string', `${runtime.label}: the seeded fixture must carry the string origin`);
  for (const key of LEGACY_KEYS) assert(key in seeded, `${runtime.label}: the seeded fixture must carry legacy key ${key}`);
  assert(!('priority' in seeded) && !('targetSprint' in seeded), `${runtime.label}: the seeded fixture must lack the canonical fields`);
  return root;
}

/**
 * The complete candidate flow, run end to end against ONE runtime, asserting only what THAT runtime
 * produced. Returns the observations so the caller can compare runtimes without either one's
 * assertions having been satisfied by the other's work.
 */
function runIncidentFlow(runtime) {
  const root = makeIncidentFixture(runtime);
  try {
    const run = (args) => runWith(runtime, root, args);
    const historyBefore = historyInventory(root);
    const liveBefore = readFileSync(sprintPath(root), 'utf8');

    // -- pre-remediation: the incident is refused, and named. ------------------------------------
    const before = run(['doctor', '--artifacts', '--kyro-scope', SCOPE]);
    assert(before.status !== 0, `${runtime.label}: the un-remediated legacy scope must NOT verify clean: ${before.output}`);
    assert(/origin/i.test(before.output), `${runtime.label}: the refusal must name the offending field: ${before.output}`);

    // -- prepare: read-only, and it refuses to decide for the operator. --------------------------
    const askArgs = ['remediate', 'canonicalize-prepare', '--debt', 'D1', '--kyro-scope', SCOPE,
      '--reason', 'The record predates the canonical debt contract.', '--actor', 'release-gate', '--json'];
    const undecided = run(askArgs);
    assert(undecided.status === 0, `${runtime.label}: canonicalize-prepare failed: ${undecided.output}`);
    const asked = JSON.parse(undecided.output);
    assert(asked.status === 'INPUT_REQUIRED', `${runtime.label}: an undecided preparation must ask, got ${asked.status}`);
    assert(asked.manifest === null, `${runtime.label}: an undecided preparation must not produce a manifest`);
    assert(asked.unresolved.map((u) => u.field).sort().join(',') === 'origin,priority,targetSprint',
      `${runtime.label}: every unsettled canonical value must be named, got ${asked.unresolved.map((u) => u.field)}`);
    assert(readFileSync(sprintPath(root), 'utf8') === liveBefore, `${runtime.label}: preparation must not write`);

    // -- explicit operator authority: only the passed values become canonical. --------------------
    const ready = JSON.parse(run([...askArgs, '--origin', '1', '--priority', 'high', '--target-sprint', 'null']).output);
    assert(ready.status === 'READY', `${runtime.label}: a fully decided preparation must be READY, got ${ready.status}`);
    assert(ready.manifest.schemaVersion === 3, `${runtime.label}: a canonicalization manifest must declare protocol revision 3`);
    assert(ready.manifest.operations.length === 1 && ready.manifest.operations[0].kind === 'debt.canonicalize',
      `${runtime.label}: the prepared manifest must carry exactly one debt.canonicalize operation`);
    assert(readFileSync(sprintPath(root), 'utf8') === liveBefore, `${runtime.label}: a complete preparation must still not write`);
    writeJson(join(root, 'manifest.json'), ready.manifest);

    // -- preview: accepted, still read-only. -----------------------------------------------------
    const preview = run(['remediate', 'canonicalize-preview', '--manifest', 'manifest.json', '--kyro-scope', SCOPE, '--json']);
    assert(preview.status === 0, `${runtime.label}: preview must accept the prepared manifest: ${preview.output}`);
    assert(JSON.parse(preview.output).accepted === true, `${runtime.label}: preview must accept the prepared manifest`);
    assert(readFileSync(sprintPath(root), 'utf8') === liveBefore, `${runtime.label}: preview must not write`);
    assertHistoryUnchanged(historyBefore, historyInventory(root), `${runtime.label}: read-only phase`);

    // -- interrupted publish, then resume: one record, never two. --------------------------------
    const rehearsal = makeTempDir('kyro-incident-rehearsal-');
    let preparedRecord;
    try {
      cpSync(root, rehearsal, { recursive: true });
      assert(runWith(runtime, rehearsal, ['remediate', 'apply', '--manifest', 'manifest.json', '--kyro-scope', SCOPE, '--yes']).status === 0,
        `${runtime.label}: the rehearsal apply must succeed so its record can be replanted`);
      preparedRecord = readJson(recordPath(rehearsal));
    } finally {
      rmSync(rehearsal, { recursive: true, force: true });
    }

    mkdirSync(join(archiveDir(root), 'remediations'), { recursive: true });
    writeJson(recordPath(root), preparedRecord);
    const interrupted = run(['doctor', '--artifacts', '--kyro-scope', SCOPE]);
    assert(/remediation\/R-001: PREPARED/.test(interrupted.output),
      `${runtime.label}: an interrupted publish must be visible as PREPARED: ${interrupted.output}`);

    const resumed = run(['remediate', 'apply', '--manifest', 'manifest.json', '--kyro-scope', SCOPE, '--yes']);
    assert(resumed.status === 0, `${runtime.label}: resume must complete the interrupted transaction: ${resumed.output}`);
    assert(/Resumed interrupted remediation/.test(resumed.output), `${runtime.label}: the resume must report itself as one`);
    assert(JSON.stringify(readJson(recordPath(root))) === JSON.stringify(preparedRecord),
      `${runtime.label}: resume must finish the existing record byte-for-byte`);
    assert(!existsSync(recordPath(root, '002')), `${runtime.label}: resume must not publish a duplicate R-NNN`);

    // -- the applied result, re-derived from THIS runtime's output. -------------------------------
    const live = readJson(sprintPath(root));
    const after = live.debt.find((d) => d.id === 'D1');
    assert(JSON.stringify(Object.keys(after)) === JSON.stringify(CANONICAL_KEYS),
      `${runtime.label}: the live record must hold exactly the seven canonical keys in order, got ${Object.keys(after)}`);
    assert(after.origin === 1 && after.priority === 'high' && after.targetSprint === null,
      `${runtime.label}: the operator-authorized values must be the ones that landed`);
    assert(after.title === D1.title && after.status === D1.status && after.note === D1.note,
      `${runtime.label}: identity and prose fields must be preserved verbatim`);
    for (const key of LEGACY_KEYS) assert(!(key in after), `${runtime.label}: legacy key ${key} must be retired from live state`);
    assert(JSON.stringify(live.debt.find((d) => d.id === 'D2')) === JSON.stringify(BYSTANDER),
      `${runtime.label}: an unrelated debt must be untouched`);

    const record = readJson(recordPath(root));
    assert(record.schemaVersion === 3, `${runtime.label}: the record must be written at protocol revision 3`);
    const operation = record.operations[0];
    assert(JSON.stringify(Object.keys(operation.after)) === JSON.stringify(CANONICAL_KEYS),
      `${runtime.label}: the recorded after-image must be exactly the seven canonical keys`);
    assert(JSON.stringify(operation.after) === JSON.stringify(after),
      `${runtime.label}: the recorded after-image must equal the live record it produced`);
    assert(JSON.stringify([...operation.retiredKeys].sort()) === JSON.stringify([...LEGACY_KEYS].sort()),
      `${runtime.label}: the record must name exactly the retired legacy keys, got ${operation.retiredKeys}`);
    assert(live.remediations.length === 1, `${runtime.label}: exactly one anchor must be appended`);
    assertHistoryUnchanged(historyBefore, historyInventory(root), `${runtime.label}: after canonicalization`);

    // -- doctor and status agree the chain explains live state. ----------------------------------
    const doctor = run(['doctor', '--artifacts', '--kyro-scope', SCOPE]);
    assert(doctor.status === 0, `${runtime.label}: the canonicalized scope must verify: ${doctor.output}`);
    assert(doctor.output.includes('replayed through R-001'), `${runtime.label}: the chain must be named as the explanation: ${doctor.output}`);
    const status = run(['status', '--kyro-scope', SCOPE]);
    assert(/Verification: remediated/.test(status.output), `${runtime.label}: status must report remediated: ${status.output}`);

    // -- recertify against THIS chain head, on re-derivable evidence. -----------------------------
    const chainHead = live.remediations.at(-1).commitment;
    const evidenceBody = `${runtime.label}: candidate release gate passed\n`;
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
      verdict: { checker: 'check:original-incident-release', outcome: 'pass' },
      provenance: { actor: 'release-gate', reason: 'Canonicalization independently validated.' },
    });
    const certified = run(['recertify', 'apply', '--kyro-scope', SCOPE, '--manifest', 'certification.json', '--yes']);
    assert(certified.status === 0, `${runtime.label}: the verified head must be certifiable: ${certified.output}`);

    const finalLive = readJson(sprintPath(root));
    assert(finalLive.certifications.length === 1, `${runtime.label}: exactly one certification anchor must be appended`);
    // The anchor carries only {id, path, commitment}; the binding it anchors lives in the immutable
    // record, so read that rather than trusting the live pointer.
    const certRecord = readJson(join(archiveDir(root), 'certifications/certification-001.json'));
    assert(certRecord.certifiedChainHeadCommitment === chainHead,
      `${runtime.label}: the certification record must bind the current chain head, got ${certRecord.certifiedChainHeadCommitment}`);
    assert(digest(certRecord) !== '' && finalLive.certifications.at(-1).id === certRecord.certificationId,
      `${runtime.label}: the live anchor must point at the record it certifies`);
    assert(/Verification: recertified/.test(run(['status', '--kyro-scope', SCOPE]).output),
      `${runtime.label}: status must report recertified`);
    assert(run(['doctor', '--artifacts', '--kyro-scope', SCOPE]).status === 0, `${runtime.label}: the certified scope must stay healthy`);
    assertHistoryUnchanged(historyBefore, historyInventory(root), `${runtime.label}: end of flow`);

    return {
      after,
      retiredKeys: [...operation.retiredKeys].sort(),
      chainHead,
      recordSchemaVersion: record.schemaVersion,
      version: run(['--version']).output.trim(),
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// =================================================================================================
// 2. The source runtime.
// =================================================================================================

assert(existsSync(join(distRoot, 'cli.js')), 'dist/cli.js must be built before this gate runs (npm run build)');
const sourceRuntime = { label: 'source dist', cli: join(distRoot, 'cli.js') };
const sourceResult = runIncidentFlow(sourceRuntime);

// =================================================================================================
// 3. The packaged runtime: npm pack, installed into a fresh temporary prefix.
//
// This is the artifact a user actually gets. If the package omits a runtime asset the flow needs,
// only this section can notice.
// =================================================================================================

const pkg = readJson(resolve(repo, 'package.json'));

/**
 * Pack the candidate and install it into a fresh temporary prefix.
 *
 * The installed runtime stays alive for the rest of the gate — the original-incident probe in
 * section 5 must be able to run the REAL scope through the PACKAGED artifact, not merely through
 * the source tree. Cleanup is registered on process exit so the temporary prefix is removed whether
 * the gate finishes or throws.
 */
function installCandidatePackage() {
  const packDir = makeTempDir('kyro-pack-');
  process.on('exit', () => rmSync(packDir, { recursive: true, force: true }));

  const packed = spawnSync('npm', ['pack', '--pack-destination', packDir, '--silent'], { cwd: repo, encoding: 'utf-8' });
  assert(packed.status === 0, `npm pack failed: ${packed.stdout ?? ''}${packed.stderr ?? ''}`);
  const tarballs = readdirSync(packDir).filter((n) => n.endsWith('.tgz'));
  assert(tarballs.length === 1, `npm pack must produce exactly one tarball, got ${JSON.stringify(tarballs)}`);
  const tarball = join(packDir, tarballs[0]);
  assert(tarballs[0] === `${pkg.name}-${pkg.version}.tgz`,
    `the tarball must be named for the candidate version, got ${tarballs[0]} for ${pkg.name}@${pkg.version}`);

  const prefix = join(packDir, 'prefix');
  mkdirSync(prefix, { recursive: true });
  const installed = spawnSync('npm', ['install', '--prefix', prefix, '--global', '--no-audit', '--no-fund', '--silent', tarball],
    { cwd: packDir, encoding: 'utf-8' });
  assert(installed.status === 0, `installing the tarball into a temporary prefix failed: ${installed.stdout ?? ''}${installed.stderr ?? ''}`);

  const installedRoot = join(prefix, 'lib/node_modules', pkg.name);
  const installedCli = join(installedRoot, 'dist/cli.js');
  assert(existsSync(installedCli), `the installed package must expose ${relative(prefix, installedCli)}`);

  // The gate drives more than the CLI entrypoint: assert the assets it depends on shipped too.
  for (const asset of ['dist/cli.js', 'fixtures/debt-contract/golden.json', 'scripts/check-original-incident-release.mjs', 'config.json', 'WORKFLOW.yaml']) {
    assert(existsSync(join(installedRoot, asset)), `the candidate package must contain ${asset}`);
  }
  const installedCorpus = readJson(join(installedRoot, 'fixtures/debt-contract/golden.json'));
  assertFaithfulShape(installedCorpus);
  assert(digest(installedCorpus) === digest(corpus), 'the packaged golden corpus must be byte-equivalent to the source corpus');

  const runtime = { label: 'installed candidate package', cli: installedCli };
  return { runtime, version: runWith(runtime, packDir, ['--version']).output.trim() };
}

const candidatePackage = installCandidatePackage();
const packageRuntime = candidatePackage.runtime;
const installedVersion = candidatePackage.version;
const packageResult = runIncidentFlow(packageRuntime);

// -- the two runtimes agreed, having each been proven on its own. ---------------------------------
assert(JSON.stringify(sourceResult.after) === JSON.stringify(packageResult.after),
  `source and package must produce the identical canonical after-image.\n  source:  ${JSON.stringify(sourceResult.after)}\n  package: ${JSON.stringify(packageResult.after)}`);
assert(JSON.stringify(sourceResult.retiredKeys) === JSON.stringify(packageResult.retiredKeys),
  'source and package must retire the identical legacy keys');
assert(sourceResult.recordSchemaVersion === 3 && packageResult.recordSchemaVersion === 3,
  'both runtimes must write the record at protocol revision 3');
assert(sourceResult.version === pkg.version && installedVersion === pkg.version,
  `both runtimes must report the candidate version ${pkg.version}, got source=${sourceResult.version} installed=${installedVersion}`);

// =================================================================================================
// 4. The globally installed runtime: an observation, never the candidate.
//
// Reported, never written, never exercised as evidence for the candidate. Its capability is what
// users have today; the gate asserts only that the two are TELLABLE APART, because a candidate that
// shares a version string with a runtime of different capability cannot be honestly documented.
// =================================================================================================

const globalCli = join(homedir(), '.agents/kyro/current/dist/cli.js');
let globalReport;
if (!existsSync(globalCli)) {
  globalReport = { present: false, note: 'no global Kyro runtime installed; nothing to compare' };
} else {
  const probeRoot = makeTempDir('kyro-global-probe-');
  try {
    const globalRuntime = { label: 'global installed runtime', cli: globalCli };
    const version = runWith(globalRuntime, probeRoot, ['--version']).output.trim();
    const help = runWith(globalRuntime, probeRoot, ['remediate', '--help']).output;
    const canCanonicalize = /canonicalize-prepare/.test(help);
    globalReport = { present: true, version, canCanonicalize };

    assert(version !== pkg.version || canCanonicalize,
      `the global runtime reports ${version}, the same version as the candidate, but lacks debt.canonicalize. ` +
      'A release cannot be documented or shipped while two runtimes of different capability share one version string.');
    if (!canCanonicalize) {
      assert(version !== pkg.version, `origin-only runtime ${version} must not share the candidate version ${pkg.version}`);
    }
  } finally {
    rmSync(probeRoot, { recursive: true, force: true });
  }
}
// Nothing above wrote to the global runtime, and nothing below may either.
assert(existsSync(globalCli) === (globalReport.present === true), 'the global runtime must be exactly as present as it was before this gate ran');

// =================================================================================================
// 5. T5.3 — the actual incident, probed read-only and remediated only in a temporary copy.
// =================================================================================================

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const originalScopeArg = flag('--original-scope');
const requireOriginal = args.includes('--require-original-scope');
const lensRepo = flag('--lens') === undefined ? undefined : resolve(flag('--lens'));
const lensNode = flag('--lens-node') === undefined ? undefined : resolve(flag('--lens-node'));
const requireLens = args.includes('--require-lens');

let originalReport;
if (originalScopeArg === undefined) {
  assert(!requireOriginal, '--require-original-scope was given but --original-scope <path> was not');
  originalReport = { probed: false, reason: 'not requested (pass --original-scope <path> to run it)' };
} else {
  const projectRoot = resolve(originalScopeArg);

  // Both runtimes, each in its OWN temporary copy of the original, each verified by Lens on its own
  // result. R8 exists because a gate once proved the source tree could do something and let that
  // stand for the artifact users install; running only `dist/cli.js` here would reinstate exactly
  // that gap on the one case that actually matters.
  const runs = [
    probeOriginalScope(projectRoot, { label: 'original copy / source dist', cli: join(distRoot, 'cli.js') }),
    probeOriginalScope(projectRoot, { label: 'original copy / installed candidate package', cli: packageRuntime.cli }),
  ];
  const [viaSource, viaPackage] = runs;

  // The packaged artifact repaired the real record, and agreed with the source tree in every
  // observable the operator depends on — each having been proven separately first.
  assert(JSON.stringify(viaSource.after) === JSON.stringify(viaPackage.after),
    `source and packaged runtimes must produce the identical canonical after-image for the real scope.\n  source:  ${JSON.stringify(viaSource.after)}\n  package: ${JSON.stringify(viaPackage.after)}`);
  assert(JSON.stringify(viaSource.retiredKeys) === JSON.stringify(viaPackage.retiredKeys),
    'source and packaged runtimes must retire the identical legacy keys on the real scope');
  // Commitments cannot match: a record carries `createdAt`, so two runs minutes apart hash
  // differently by design. Comparing the records with only the timestamp set aside is the stronger
  // claim anyway — it says the two runtimes wrote the SAME record, not merely the same after-image.
  const withoutTimestamp = ({ createdAt, ...rest }) => rest;
  assert(JSON.stringify(canonical(withoutTimestamp(viaSource.record))) === JSON.stringify(canonical(withoutTimestamp(viaPackage.record))),
    'source and packaged runtimes must write the identical remediation record for the real scope (timestamp aside).\n' +
    `  source:  ${JSON.stringify(withoutTimestamp(viaSource.record))}\n  package: ${JSON.stringify(withoutTimestamp(viaPackage.record))}`);
  assert(viaSource.chainHead !== viaPackage.chainHead || viaSource.record.createdAt === viaPackage.record.createdAt,
    'two records with different timestamps cannot share a commitment; the chain head is not binding createdAt');
  assert(viaPackage.recordSchemaVersion === 3,
    'the packaged runtime must repair the real record at protocol revision 3');
  assert(!requireLens || viaPackage.lens.run,
    'the packaged runtime\'s result for the real scope must be verified by Lens');

  originalReport = { ...viaPackage, runs };
}

/**
 * Drive Kyro Lens's real parser, provenance resolver and Overview contract tests over the temporary
 * copy — under an explicitly supported Node runtime.
 *
 * Node 25 ships a native `localStorage` that shadows jsdom's and breaks unrelated Lens suites, so
 * the runtime is pinned and asserted rather than inherited: a green Lens result means nothing if it
 * came from a runtime the project does not support, and a red one must not be blamed on the product.
 *
 * The tests are name-filtered, and the run must report exactly the expected number of PASSED tests.
 * Requiring the count is the point: these suites skip themselves when the environment variable is
 * absent, so "0 failed" alone would be satisfied by a run that verified nothing.
 */
function verifyWithLens(lensRepo, workspace, scopeId) {
  assert(existsSync(lensRepo), `--lens ${lensRepo} does not exist`);
  assert(existsSync(join(lensRepo, 'package.json')), `--lens ${lensRepo} is not a package root`);
  assert(lensNode !== undefined, '--lens requires --lens-node <node binary> so the runtime is explicit, never inherited');
  assert(existsSync(lensNode), `--lens-node ${lensNode} does not exist`);

  const reported = spawnSync(lensNode, ['-v'], { encoding: 'utf-8' });
  assert(reported.status === 0, `--lens-node ${lensNode} did not report a version`);
  const nodeVersion = reported.stdout.trim();
  assert(/^v22\./.test(nodeVersion),
    `Lens evidence must come from a supported Node 22 runtime, got ${nodeVersion}. Node 25 is known bad for this suite.`);

  const files = ['src/data/remediation-real-contract.test.ts', 'src/components/kyro/views/overview.test.tsx'];
  const EXPECTED_PASSED = 2;
  const result = spawnSync(lensNode, [join(lensRepo, 'node_modules/vitest/vitest.mjs'), 'run', ...files, '-t', 'original incident', '--reporter=dot'], {
    cwd: lensRepo,
    encoding: 'utf-8',
    env: {
      ...process.env,
      PATH: `${resolve(lensNode, '..')}:${process.env.PATH}`,
      KYRO_ORIGINAL_INCIDENT_SCOPE: workspace,
      KYRO_ORIGINAL_INCIDENT_SCOPE_ID: scopeId,
      CI: 'true',
    },
  });
  // vitest colours its summary, so the counts are read from de-styled text rather than raw bytes.
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.replace(/\[[0-9;]*m/g, '');
  assert(result.status === 0, `Lens verification of the temporary copy failed on ${nodeVersion}:\n${output}`);

  const summaryLine = output.split('\n').find((line) => /^\s*Tests\s+\d/.test(line));
  assert(summaryLine !== undefined, `could not read a test summary from the Lens run:\n${output}`);
  const summary = summaryLine.match(/(\d+) passed/);
  assert(summary !== null, `could not read a passed count from "${summaryLine.trim()}"`);
  assert(Number(summary[1]) === EXPECTED_PASSED,
    `the Lens original-incident tests must all run: expected ${EXPECTED_PASSED} passed, got ${summary[1]}. ` +
    `A skipped suite means Lens verified nothing.\n${output}`);
  assert(!/failed/i.test(summaryLine), `the Lens run reported failures:\n${output}`);

  return { run: true, nodeVersion, passed: Number(summary[1]), files };
}

/**
 * Read-only discovery, then remediation of the real scope in a fresh temporary copy, using the
 * runtime the CALLER names.
 *
 * The runtime is a parameter, not a constant, because R8's whole point is that "the source tree can
 * do it" and "the artifact users install can do it" are different claims. Each runtime gets its own
 * temporary copy and its own Lens verification, so neither result can be standing in for the other.
 *
 * Fail closed at every step: an absent path, a scope that does not match the faithful shape, or any
 * byte of drift in the original tree stops the gate. A synthetic fixture is never substituted —
 * that substitution is precisely the failure ADR-0005 exists to prevent.
 */
function probeOriginalScope(projectRoot, runtime) {
  assert(existsSync(projectRoot), `original scope probe: ${projectRoot} does not exist`);
  const scopesDir = join(projectRoot, '.agents/kyro/scopes');
  assert(existsSync(scopesDir), `original scope probe: ${scopesDir} does not exist; refusing to substitute a fixture`);

  const candidates = readdirSync(scopesDir).filter((name) => existsSync(join(scopesDir, name, 'sprint.json')));
  const scopeName = candidates.find((name) => name === 'model-catalog-and-routing');
  assert(scopeName !== undefined,
    `original scope probe: model-catalog-and-routing not found under ${scopesDir} (saw ${JSON.stringify(candidates)}); refusing to substitute a fixture`);

  // -- read-only inventory of the original, before anything else. -------------------------------
  const originalScopeDir = join(scopesDir, scopeName);
  const inventoryBefore = Object.fromEntries(
    Object.entries(fileTree(originalScopeDir)).map(([name, bytes]) => [name, createHash('sha256').update(bytes).digest('hex')]),
  );
  const gitBefore = spawnSync('git', ['status', '--porcelain'], { cwd: projectRoot, encoding: 'utf-8' });
  const gitStateBefore = gitBefore.status === 0 ? gitBefore.stdout : null;
  const localBefore = existsSync(join(projectRoot, '.agents/kyro/local.json'))
    ? readFileSync(join(projectRoot, '.agents/kyro/local.json'), 'utf8') : null;

  // -- does it actually match the incident? -----------------------------------------------------
  const originalSprint = readJson(join(originalScopeDir, 'sprint.json'));
  const legacyDebt = (originalSprint.debt ?? []).filter((d) => typeof d.origin === 'string');
  assert(legacyDebt.length > 0,
    `original scope probe: ${scopeName} carries no string-origin debt, so it is not the historical shape this gate certifies; refusing to substitute a fixture`);
  for (const entry of legacyDebt) {
    assert(LEGACY_KEYS.some((key) => key in entry),
      `original scope probe: ${entry.id} has a string origin but none of the legacy keys ${LEGACY_KEYS}; shape mismatch`);
  }

  // -- copy into a fresh temporary directory and remediate THERE. -------------------------------
  const temp = makeTempDir('kyro-original-copy-');
  let result;
  try {
    cpSync(join(projectRoot, '.agents'), join(temp, '.agents'), { recursive: true });
    mkdirSync(join(temp, '.home'), { recursive: true });
    const run = (a) => runWith(runtime, temp, a);

    const target = legacyDebt[0];
    const historyBefore = historyInventory(temp, scopeName);

    const askArgs = ['remediate', 'canonicalize-prepare', '--debt', target.id, '--kyro-scope', scopeName,
      '--reason', 'The record predates the canonical debt contract.', '--actor', 'release-gate', '--json'];
    const ready = JSON.parse(run([...askArgs, '--origin', String(target.addedSprint ?? 1), '--priority', 'medium', '--target-sprint', 'null']).output);
    assert(ready.status === 'READY', `${runtime.label}: preparation must be READY, got ${ready.status}`);
    writeJson(join(temp, 'manifest.json'), ready.manifest);

    const applied = run(['remediate', 'apply', '--manifest', 'manifest.json', '--kyro-scope', scopeName, '--yes']);
    assert(applied.status === 0, `${runtime.label}: apply failed: ${applied.output}`);

    const live = readJson(sprintPath(temp, scopeName));
    const after = live.debt.find((d) => d.id === target.id);
    assert(JSON.stringify(Object.keys(after)) === JSON.stringify(CANONICAL_KEYS),
      `${runtime.label}: the remediated record must hold exactly the seven canonical keys, got ${Object.keys(after)}`);
    assertHistoryUnchanged(historyBefore, historyInventory(temp, scopeName), runtime.label);

    const doctor = run(['doctor', '--artifacts', '--kyro-scope', scopeName]);
    assert(doctor.status === 0, `${runtime.label}: doctor must be clean after remediation: ${doctor.output}`);

    const chainHead = live.remediations.at(-1).commitment;
    const evidenceBody = 'original-copy release gate passed\n';
    writeFileSync(join(temp, 'validation-report.txt'), evidenceBody);
    writeJson(join(temp, 'certification.json'), {
      schemaVersion: 1,
      kind: 'scope-certification-manifest',
      scope: scopeName,
      certifiedChainHeadCommitment: chainHead,
      evidence: [{ source: { kind: 'external-artifact', path: 'validation-report.txt', contentDigest: digest(evidenceBody) }, chainHeadCommitment: chainHead }],
      verdict: { checker: 'check:original-incident-release', outcome: 'pass' },
      provenance: { actor: 'release-gate', reason: 'Original-incident copy independently validated.' },
    });
    const certified = run(['recertify', 'apply', '--kyro-scope', scopeName, '--manifest', 'certification.json', '--yes']);
    assert(certified.status === 0, `${runtime.label}: recertify failed: ${certified.output}`);
    assert(/Verification: recertified/.test(run(['status', '--kyro-scope', scopeName]).output),
      `${runtime.label}: status must report recertified`);

    // -- Lens verifies the temporary result, and nothing else. -----------------------------------
    //
    // Lens is a read-only verifier: it recomputes the provenance from these bytes with its own
    // parser and resolver rather than trusting the state Kyro just wrote. It is pointed at the
    // temporary copy only — the original project is never on any Lens path.
    const lensReport = lensRepo === undefined
      ? { run: false, reason: 'not requested (pass --lens <kyro-lens path> --lens-node <node22 binary>)' }
      : verifyWithLens(lensRepo, temp, scopeName);
    assert(!requireLens || lensReport.run, '--require-lens was given but the Lens verification did not run');

    // Re-derived from the record this runtime wrote, so the comparison between runtimes is between
    // two independently produced artifacts rather than between two copies of one expectation.
    const record = readJson(join(temp, `.agents/kyro/scopes/${scopeName}/${live.remediations.at(-1).path}`));
    assert(record.operations.length === 1 && record.operations[0].kind === 'debt.canonicalize',
      `${runtime.label}: the real record must be repaired by debt.canonicalize`);

    result = {
      probed: true,
      projectRoot,
      runtime: runtime.label,
      scope: scopeName,
      debtId: target.id,
      after,
      retiredKeys: [...record.operations[0].retiredKeys].sort(),
      recordSchemaVersion: record.schemaVersion,
      chainHead,
      record,
      lens: lensReport,
    };
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }

  // -- the original must not have moved, in any respect. ----------------------------------------
  const inventoryAfter = Object.fromEntries(
    Object.entries(fileTree(originalScopeDir)).map(([name, bytes]) => [name, createHash('sha256').update(bytes).digest('hex')]),
  );
  assert(JSON.stringify(inventoryAfter) === JSON.stringify(inventoryBefore),
    'original scope probe: the original scope bytes must be identical before and after');
  const gitAfter = spawnSync('git', ['status', '--porcelain'], { cwd: projectRoot, encoding: 'utf-8' });
  assert((gitAfter.status === 0 ? gitAfter.stdout : null) === gitStateBefore,
    'original scope probe: the original checkout git state must be unchanged (nothing written, staged or committed)');
  const localAfter = existsSync(join(projectRoot, '.agents/kyro/local.json'))
    ? readFileSync(join(projectRoot, '.agents/kyro/local.json'), 'utf8') : null;
  assert(localAfter === localBefore, 'original scope probe: the original active-scope selection must be unchanged');

  return result;
}

// =================================================================================================
// Report.
// =================================================================================================

console.log(`  candidate package:  ${pkg.name}@${pkg.version} — packed, installed to a temp prefix, full flow green`);
console.log(`  source dist:        ${sourceResult.version} — full flow green, asserted independently`);
console.log(`  canonical result:   origin=${sourceResult.after.origin} priority=${sourceResult.after.priority} targetSprint=${String(sourceResult.after.targetSprint)}; retired ${sourceResult.retiredKeys.join(', ')}`);
if (globalReport.present) {
  console.log(`  global runtime:     ${globalReport.version} — ${globalReport.canCanonicalize ? 'has debt.canonicalize' : 'ORIGIN-ONLY (cannot repair this incident)'} [observation only; not written, not the candidate]`);
} else {
  console.log(`  global runtime:     ${globalReport.note}`);
}
if (!originalReport.probed) {
  console.log(`  original incident:  not probed — ${originalReport.reason}`);
} else {
  console.log(`  original incident:  ${originalReport.scope}/${originalReport.debtId} — original bytes, git state and active scope unchanged`);
  for (const attempt of originalReport.runs) {
    console.log(`    · ${attempt.runtime}: repaired at protocol v${attempt.recordSchemaVersion}, doctor clean, recertified` +
      (attempt.lens.run
        ? `; Lens verified ${attempt.lens.passed} tests on ${attempt.lens.nodeVersion} (read-only)`
        : `; Lens not run — ${attempt.lens.reason}`));
  }
}
console.log(`check:original-incident-release — ${passed} assertions passed`);
