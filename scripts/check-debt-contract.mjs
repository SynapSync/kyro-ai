/**
 * Executable statement of ADR-0001: compatibility is not canonicality.
 *
 * The golden corpus is the specification; this harness holds production behaviour to it. It
 * asserts the four raw-input outcomes as distinct, the exact canonical projection for readable
 * inputs (including the compatibility defaults Lens applies), the exact field diagnostics for
 * remediable inputs, and fail-closed behaviour for unsupported ones.
 *
 * The classifier is never implemented here: the harness fails, loudly and non-zero, while
 * production classification is missing.
 */
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repo = resolve(fileURLToPath(import.meta.url), '../..');
const corpus = JSON.parse(readFileSync(resolve(repo, 'fixtures/debt-contract/golden.json'), 'utf8'));
// Source dist by default; KYRO_DIST_UNDER_TEST points the same corpus at a projected runtime, so a
// packaged install is proven to classify identically instead of being assumed to (original-incident-gate).
const distRoot = process.env.KYRO_DIST_UNDER_TEST ? resolve(process.env.KYRO_DIST_UNDER_TEST) : resolve(repo, 'dist');
const modulePath = resolve(distRoot, 'cli/artifacts/debt-contract.js');

let passed = 0;
function abort(message) {
  console.error(`check:debt-contract — ${message}`);
  process.exit(1);
}

function assert(condition, message) {
  if (!condition) abort(message);
  passed += 1;
}

// --- Read-only guarantee: this harness must never touch a Kyro scope or the Lens checkout. ---
const fs = require('node:fs');
const MUTATORS = [
  'writeFileSync', 'appendFileSync', 'unlinkSync', 'rmSync', 'rmdirSync', 'mkdirSync',
  'renameSync', 'cpSync', 'copyFileSync', 'truncateSync', 'writeFile', 'appendFile', 'rm', 'mkdir',
];
for (const name of MUTATORS) {
  if (typeof fs[name] === 'function') {
    fs[name] = () => {
      throw new Error(`check:debt-contract must not write to disk (fs.${name})`);
    };
  }
}

const stable = (value) => {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
};
const show = (value) => JSON.stringify(stable(value));
const same = (a, b) => show(a) === show(b);
const digest = (path) => (existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : 'absent');

const scopeRoot = resolve(repo, '.agents/kyro/scopes');
const watched = ['canonical-debt-contract-and-legacy-remediation', 'demo']
  .map((scope) => resolve(scopeRoot, scope, 'sprint.json'))
  .map((path) => [path, digest(path)]);

if (!existsSync(modulePath)) {
  abort(`production classification behavior is missing: ${modulePath.slice(repo.length + 1)} (run npm run build once the contract is implemented)`);
}

let contract;
try {
  contract = require(modulePath);
} catch (error) {
  abort(`production classification behavior is unloadable: ${error.message}`);
}

for (const name of ['assessRawDebt', 'CANONICAL_DEBT_KEYS', 'DEBT_CLASSIFICATION']) {
  if (contract[name] === undefined) abort(`production classification behavior is missing the ${name} export`);
}

assert(
  same(contract.CANONICAL_DEBT_KEYS, corpus.canonicalKeys),
  `production canonical key set must be the corpus key set: ${show(contract.CANONICAL_DEBT_KEYS)}`,
);
assert(
  same(Object.values(contract.DEBT_CLASSIFICATION).sort(), [...corpus.classifications].sort()),
  'production must expose exactly the four raw-input outcomes',
);

const produced = new Set();
for (const entry of corpus.cases) {
  const at = `case ${entry.id}`;
  const actual = contract.assessRawDebt(entry.raw, { sprintNumber: entry.context.sprintNumber });
  const expected = entry.expected;
  assert(actual && typeof actual === 'object', `${at}: assessRawDebt must return an assessment`);
  assert(
    actual.classification === expected.classification,
    `${at}: expected ${expected.classification}, received ${actual.classification}`,
  );
  produced.add(actual.classification);

  // Readable inputs: one exact projection, in canonical key order, matching Lens value for value.
  if (expected.canonical === null) {
    assert(actual.canonical === null, `${at}: an unreadable debt must not be given a canonical projection`);
  } else {
    assert(
      JSON.stringify(Object.keys(actual.canonical ?? {})) === JSON.stringify(corpus.canonicalKeys),
      `${at}: the projection must emit exactly the seven canonical keys, in canonical order`,
    );
    assert(same(actual.canonical, expected.canonical), `${at}: projection mismatch — received ${show(actual.canonical)}`);
    assert(same(actual.canonical, expected.lens.projection), `${at}: the projection must equal the Lens projection`);
  }

  assert(same([...(actual.legacyKeys ?? [])].sort(), [...expected.legacyKeys].sort()), `${at}: legacy key set mismatch`);

  // Diagnostics are compared exactly, field by field: a dropped or softened issue is a failure.
  const key = (diagnostic) => `${diagnostic.field}:${diagnostic.code}`;
  const actualByKey = new Map((actual.diagnostics ?? []).map((diagnostic) => [key(diagnostic), diagnostic]));
  const expectedByKey = new Map(expected.diagnostics.map((diagnostic) => [key(diagnostic), diagnostic]));
  for (const [id, diagnostic] of expectedByKey) {
    const received = actualByKey.get(id);
    assert(received !== undefined, `${at}: missing diagnostic ${id}`);
    if (received) assert(same(received, diagnostic), `${at}: diagnostic ${id} mismatch — received ${show(received)}`);
  }
  for (const id of actualByKey.keys()) {
    assert(expectedByKey.has(id), `${at}: unexpected diagnostic ${id}`);
  }
}

for (const classification of corpus.classifications) {
  assert(produced.has(classification), `the corpus must exercise ${classification} against production behavior`);
}

// --- The classifier and the canonicalization planner must agree about every golden case. ---
//
// The classifier says what a record is; the planner says whether canonicalization can describe it.
// Binding them here means a corpus case can never be classified one way and planned another, and
// the projected-runtime gate exercises both contracts from the same vectors.
{
  const planner = require(resolve(distRoot, 'cli/remediation/canonicalize-plan.js'));
  const { planDebtCanonicalization, CANONICALIZE_PLAN_STATUS } = planner;
  const sha = (value) => createHash('sha256').update(JSON.stringify(stable(value ?? null))).digest('hex');
  const planCase = (entry, decisions) => planDebtCanonicalization({
    debt: [entry.raw],
    debtId: typeof entry.raw === 'object' && entry.raw !== null ? entry.raw.id : 'missing',
    decisions,
    digest: sha,
    collectionDigest: sha,
  });

  for (const entry of corpus.cases) {
    const at = `case ${entry.id}`;
    // Supply every decidable value, so the only thing under test is whether the planner agrees the
    // record can be described at all.
    const result = planCase(entry, { origin: 1, priority: 'high', targetSprint: null, note: 'Explicitly authorized.' });
    const planable = entry.expected.classification === 'legacy_compatible' || entry.expected.classification === 'remediation_required';
    if (!planable) {
      assert(result.status === CANONICALIZE_PLAN_STATUS.NOT_APPLICABLE,
        `${at}: a ${entry.expected.classification} record must not be planable, got ${result.status}`);
      continue;
    }
    assert(result.status !== CANONICALIZE_PLAN_STATUS.NOT_APPLICABLE,
      `${at}: a ${entry.expected.classification} record must be describable by canonicalization, got NOT_APPLICABLE`);
    assert(result.classification === entry.expected.classification,
      `${at}: the planner must carry the classifier's verdict, got ${result.classification}`);
    // Whatever survives into the after-image is exactly the canonical key set — never a legacy key.
    if (result.status === CANONICALIZE_PLAN_STATUS.READY) {
      assert(same(Object.keys(result.operation.after), corpus.canonicalKeys),
        `${at}: the after-image must hold exactly the canonical keys, got ${show(Object.keys(result.operation.after))}`);
      for (const key of result.retiredKeys) {
        assert(!corpus.canonicalKeys.includes(key), `${at}: ${key} is canonical and must never be retired`);
      }
    }
  }

  // The faithful incident shape, with no decisions at all, must ask rather than assume.
  const liveD1 = corpus.cases.find((entry) => entry.id === 'live-d1-remediation-required');
  const undecided = planCase(liveD1, {});
  assert(undecided.status === CANONICALIZE_PLAN_STATUS.INPUT_REQUIRED, `the faithful D1 must require input, got ${undecided.status}`);
  const judgments = undecided.unresolved.filter((decision) => decision.suggested === null).map((decision) => decision.field);
  assert(judgments.includes('priority') && judgments.includes('targetSprint'),
    `priority and targetSprint must reach the operator with no suggestion at all, got ${show(undecided.unresolved)}`);
  const originDecision = undecided.unresolved.find((decision) => decision.field === 'origin');
  assert(originDecision.suggested === 1 && originDecision.evidence === 'addedSprint=1',
    'the faithful D1 origin must carry its addedSprint evidence as a suggestion only');
}

// --- The two boundaries must stay separate: exact for writes, compatible for readers. ---
{
  const schema = require(resolve(distRoot, 'cli/artifacts/schema.js'));
  const legacyCase = corpus.cases.find((entry) => entry.id === 'legacy-compatible-missing-fields');
  const sprint = { debt: [legacyCase.raw] };
  const exact = schema.validateSprintFile(sprint, 'sprint.json').filter((issue) => issue.field.startsWith('debt[0]'));
  const compatible = schema
    .validateSprintFile(sprint, 'sprint.json', { debt: schema.DEBT_VALIDATION_MODE.COMPATIBLE })
    .filter((issue) => issue.field.startsWith('debt[0]'));
  assert(exact.some((issue) => issue.field === 'debt[0].addedSprint'), 'the exact boundary must reject a legacy-only key');
  assert(
    compatible.every((issue) => !issue.message.includes('is not a canonical debt key')),
    `the compatible boundary must tolerate legacy-only keys: ${show(compatible)}`,
  );
  assert(compatible.length < exact.length, 'the compatible boundary must be strictly more permissive than the exact one');
}

for (const [path, before] of watched) {
  assert(digest(path) === before, `check:debt-contract must not modify ${path.slice(repo.length + 1)}`);
}

console.log(`check:debt-contract — ${passed} assertions passed over ${corpus.cases.length} corpus cases`);
