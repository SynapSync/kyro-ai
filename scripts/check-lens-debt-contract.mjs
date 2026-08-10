#!/usr/bin/env node
/**
 * Cross-repository conformance for the shared raw-debt contract (R1, convention shared-debt-vectors).
 *
 * Kyro must not be the only judge of what a legacy debt means. This command runs every golden case
 * through the *actual* Lens parser — loaded in memory from the Lens checkout's own Vite toolchain,
 * never reimplemented here — and compares parse success, rejection path and canonical projection
 * with what Kyro's own contract produces.
 *
 * Opt-in, like check-lens-remediation-fixture: set KYRO_LENS_ROOT to a Lens checkout. Nothing is
 * written anywhere: fs mutators are stubbed to throw, and the Lens working tree is compared before
 * and after. The Aliva checkout is never referenced — the corpus already carries minimized copies of
 * its shapes (convention aliva-readonly-probe), and this file is asserted to name no path into it.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const self = fileURLToPath(import.meta.url);
const repo = resolve(self, '../..');
const corpus = JSON.parse(readFileSync(resolve(repo, 'fixtures/debt-contract/golden.json'), 'utf8'));

let passed = 0;
function abort(message, code = 1) {
  console.error(`check:lens-debt-contract — ${message}`);
  process.exit(code);
}
function assert(condition, message) {
  if (!condition) abort(message);
  passed += 1;
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

// --- 0. Preconditions. Every failure here is explicit, never a silent skip. ---
const lensRoot = process.env.KYRO_LENS_ROOT ? resolve(process.env.KYRO_LENS_ROOT) : null;
if (!lensRoot) abort('KYRO_LENS_ROOT must point to a Kyro Lens checkout (opt-in conformance gate).', 2);
const lensParser = join(lensRoot, 'src/data/parse.ts');
const lensVite = join(lensRoot, 'node_modules/vite/dist/node/index.js');
if (!existsSync(lensParser)) abort(`Lens parser not found: ${lensParser}`, 2);
if (!existsSync(lensVite)) abort(`Lens dependencies are not installed: ${lensVite} (run pnpm install in the Lens checkout).`, 2);

// The corpus must already agree with Kyro's own contract; otherwise "Lens diverges" would be a lie.
const kyroContractPath = resolve(repo, 'dist/cli/artifacts/debt-contract.js');
if (!existsSync(kyroContractPath)) abort('Kyro contract is not built: run npm run build first.', 2);
const { assessRawDebt } = require(kyroContractPath);
for (const entry of corpus.cases) {
  const assessment = assessRawDebt(entry.raw, { sprintNumber: entry.context.sprintNumber });
  if (assessment.classification !== entry.expected.classification || !same(assessment.canonical, entry.expected.canonical)) {
    abort(`corpus is stale against the Kyro contract at case ${entry.id}: run npm run check:debt-contract.`, 2);
  }
}

// --- 1. No writes. Anywhere. ---
const fs = require('node:fs');
for (const name of ['writeFileSync', 'appendFileSync', 'unlinkSync', 'rmSync', 'rmdirSync', 'renameSync', 'cpSync', 'copyFileSync', 'truncateSync']) {
  if (typeof fs[name] === 'function') {
    fs[name] = () => {
      throw new Error(`check:lens-debt-contract must not write to disk (fs.${name})`);
    };
  }
}
const lensTree = () => spawnSync('git', ['-C', lensRoot, 'status', '--porcelain'], { encoding: 'utf8' }).stdout ?? '';
const lensTreeBefore = lensTree();

// Naming the convention in prose is fine; naming a path into that checkout is not.
assert(!/aliva[\w-]*\//i.test(readFileSync(self, 'utf8')), 'this command must never reach into the Aliva checkout');

// --- 2. Observe the real Lens behaviour, one case at a time. ---
const { createServer } = await import(pathToFileURL(lensVite).href);
const server = await createServer({
  root: lensRoot,
  configFile: false,
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false },
  optimizeDeps: { noDiscovery: true },
});

const SCOPE = 'demo';
const baseSprint = JSON.parse(
  readFileSync(resolve(repo, 'fixtures/evals/close-sprint-happy/state/.agents/kyro/scopes/demo/sprint.json'), 'utf8'),
);
const projectState = JSON.stringify({
  schemaVersion: 4,
  artifactRoot: '.agents/kyro/scopes',
  activeScope: SCOPE,
  runtimePath: '~/.agents/kyro/current',
  installedAdapters: [],
  scopes: [{ id: SCOPE, title: 'Demo', status: 'active' }],
});

let observations;
try {
  const { buildWorkspace } = await server.ssrLoadModule('/src/data/parse.ts');
  observations = new Map(
    corpus.cases.map((entry) => {
      const sprint = JSON.stringify({ ...baseSprint, debt: [entry.raw] });
      const result = buildWorkspace({ kyroJson: projectState, sprintJsonByScope: { [SCOPE]: sprint } });
      if (!result.ok) return [entry.id, { accepts: false, failure: result.error.message, projection: null }];
      const scopeError = result.value.scopeErrors[SCOPE];
      if (scopeError) return [entry.id, { accepts: false, failure: scopeError.error.message, projection: null }];
      return [entry.id, { accepts: true, failure: null, projection: result.value.sprints[SCOPE].debt[0] ?? null }];
    }),
  );
} finally {
  await server.close();
}

/**
 * Compare corpus expectations with observed Lens behaviour. Pure and throwing, so the mutation
 * suite below can replay it over deliberately corrupted inputs.
 */
function conform(expectedCorpus, observed) {
  const fail = (message) => {
    throw new Error(message);
  };
  const seen = new Set();
  for (const entry of expectedCorpus.cases) {
    const at = `case ${entry.id}`;
    const actual = observed.get(entry.id);
    if (actual === undefined) fail(`${at}: was never run against Lens — no case may be skipped`);
    seen.add(entry.id);
    const expected = entry.expected.lens;

    if (expected.accepts !== actual.accepts) {
      fail(`${at}: Lens ${actual.accepts ? 'accepted' : 'rejected'} a case recorded as ${expected.accepts ? 'accepted' : 'rejected'}${actual.failure ? ` (${actual.failure})` : ''}`);
    }
    if (expected.accepts) {
      if (!same(actual.projection, expected.projection)) {
        fail(`${at}: Lens projection diverged — expected ${show(expected.projection)}, received ${show(actual.projection)}`);
      }
      // R1: one shared projection. Kyro's canonical value must be the same object Lens derives.
      if (!same(actual.projection, entry.expected.canonical)) {
        fail(`${at}: Lens and the Kyro canonical projection disagree — received ${show(actual.projection)}`);
      }
    } else if (!String(actual.failure).includes(expected.failure)) {
      fail(`${at}: Lens rejected at the wrong path — expected "${expected.failure}", received "${actual.failure}"`);
    }
  }
  for (const id of observed.keys()) {
    if (!seen.has(id)) fail(`case ${id} was run but is not part of the corpus`);
  }
}

conform(corpus, observations);
assert(true, 'every golden case conforms to the live Lens parser');
assert(observations.size === corpus.cases.length, 'every corpus case must be exercised against Lens');

// --- 3. Divergence must be detectable, from either side. ---
const cloneCorpus = () => JSON.parse(JSON.stringify(corpus));
const cloneObserved = () => new Map([...observations].map(([id, value]) => [id, JSON.parse(JSON.stringify(value))]));
const mutations = [
  ['Kyro expected projection drifts', () => {
    const mutated = cloneCorpus();
    mutated.cases.find((c) => c.id === 'legacy-compatible-missing-fields').expected.lens.projection.priority = 'high';
    return [mutated, cloneObserved()];
  }],
  ['Kyro canonical projection drifts from Lens', () => {
    const mutated = cloneCorpus();
    mutated.cases.find((c) => c.id === 'canonical-exact').expected.canonical.origin = 9;
    return [mutated, cloneObserved()];
  }],
  ['Lens starts accepting a rejected shape', () => {
    const observed = cloneObserved();
    observed.set('live-d1-remediation-required', { accepts: true, failure: null, projection: { id: 'D1' } });
    return [cloneCorpus(), observed];
  }],
  ['Lens rejects at a different path', () => {
    const observed = cloneObserved();
    observed.get('unsupported-bad-status').failure = 'sprint.json.debt[0] is weird';
    return [cloneCorpus(), observed];
  }],
  ['Lens projection loses a normalized default', () => {
    const observed = cloneObserved();
    delete observed.get('legacy-compatible-missing-fields').projection.priority;
    return [cloneCorpus(), observed];
  }],
  ['a case is skipped', () => {
    const observed = cloneObserved();
    observed.delete('historical-d1-sprint-2');
    return [cloneCorpus(), observed];
  }],
];

for (const [name, build] of mutations) {
  const [mutatedCorpus, mutatedObserved] = build();
  let threw = false;
  try {
    conform(mutatedCorpus, mutatedObserved);
  } catch {
    threw = true;
  }
  assert(threw, `conformance must fail when ${name}`);
}

assert(lensTree() === lensTreeBefore, 'the Lens working tree must be byte-identical after the probe');

console.log(`check:lens-debt-contract — ${passed} assertions passed; ${corpus.cases.length} golden cases conform to the live Lens parser`);
