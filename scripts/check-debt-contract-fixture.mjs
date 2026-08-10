/**
 * Contract gate for the shared Kyro/Lens debt compatibility corpus.
 *
 * The corpus is data, not code: it freezes the raw debt shapes that the original incident
 * produced (string origin, absent priority/targetSprint, legacy-only keys) together with their
 * expected classification and canonical projection. This checker proves the corpus stays
 * faithful, minimized, internally coherent and deterministic, and that mutating any decisive
 * fact fails closed. Production behaviour is asserted separately by check-debt-contract.mjs.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(fileURLToPath(import.meta.url), '../..');
const fixturePath = resolve(repo, 'fixtures/debt-contract/golden.json');
const raw = readFileSync(fixturePath, 'utf8');

let passed = 0;
function assert(condition, message) {
  if (!condition) throw new Error(message);
  passed += 1;
}

const DIAGNOSTIC_KEYS = ['field', 'code', 'severity', 'authority', 'evidence', 'suggested', 'lensDefault'];
const SEVERITIES = ['info', 'blocking'];
const AUTHORITIES = ['derived', 'evidence', 'operator'];
const DEBT_STATUSES = ['open', 'in_progress', 'resolved', 'deferred'];
const DEBT_PRIORITIES = ['critical', 'high', 'medium', 'low'];
const REQUIRED_CASE_IDS = [
  'canonical-exact',
  'legacy-compatible-missing-fields',
  'live-d1-remediation-required',
  'historical-d1-sprint-1',
  'historical-d1-sprint-2',
  'legacy-severity-mapped',
  'legacy-severity-unrecognized-with-priority',
  'legacy-severity-not-string',
  'legacy-severity-unrecognized',
  'legacy-source-not-string',
  'legacy-prose-not-string',
  'unsupported-bare-string',
  'unsupported-missing-id',
  'unsupported-bad-status',
];
/** Legacy keys the compatibility reader interprets, so their values are typed, not decoration. */
const TYPED_LEGACY_KEYS = ['severity', 'source', 'resolution', 'disposition'];
const SEVERITY_TO_PRIORITY = { critical: 'critical', high: 'high', medium: 'medium', low: 'low', blocker: 'critical', major: 'high', minor: 'low' };
const D1_CASE_IDS = ['live-d1-remediation-required', 'historical-d1-sprint-1', 'historical-d1-sprint-2'];

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const caseById = (corpus, id) => corpus.cases.find((entry) => entry.id === id);
/** Key-order-insensitive structural equality, so projections compare by value, not by writer order. */
const stable = (value) => {
  if (Array.isArray(value)) return value.map(stable);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
};
const sameValue = (a, b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));

/**
 * A typed legacy value is invalid when the compatibility reader would refuse it: a non-string, or an
 * unmapped severity while it is the only source of a priority.
 */
function isLegacyValueInvalid(raw, key) {
  if (!isRecord(raw) || !(key in raw)) return false;
  if (typeof raw[key] !== 'string') return true;
  return key === 'severity' && SEVERITY_TO_PRIORITY[raw[key].toLowerCase()] === undefined && !('priority' in raw);
}

function eachString(value, path, visit) {
  if (typeof value === 'string') visit(value, path);
  else if (Array.isArray(value)) value.forEach((item, index) => eachString(item, `${path}[${index}]`, visit));
  else if (isRecord(value)) for (const [key, item] of Object.entries(value)) eachString(item, `${path}.${key}`, visit);
}

/**
 * Every check that must fail closed lives here so the mutation suite can replay it over clones.
 * Throwing — never `assert` — keeps the mutation contract honest.
 */
function validateCorpus(corpus) {
  const fail = (message) => {
    throw new Error(message);
  };

  if (corpus.schemaVersion !== 1) fail('schemaVersion must be 1');
  if (corpus.kind !== 'kyro.debt-contract.golden') fail('kind must be kyro.debt-contract.golden');

  const canonicalKeys = corpus.canonicalKeys;
  if (JSON.stringify(canonicalKeys) !== JSON.stringify(['id', 'title', 'origin', 'priority', 'status', 'targetSprint', 'note'])) {
    fail('canonicalKeys must be the exact seven-field canonical debt key set, in order');
  }
  if (JSON.stringify(corpus.legacyOnlyKeys) !== JSON.stringify(['detail', 'resolution', 'addedSprint', 'severity', 'source', 'disposition'])) {
    fail('legacyOnlyKeys must be the full legacy vocabulary: detail, resolution, addedSprint, severity, source, disposition');
  }
  for (const key of TYPED_LEGACY_KEYS) {
    if (!corpus.legacyOnlyKeys.includes(key)) fail(`${key} is interpreted by the compatibility reader and must be declared`);
  }
  for (const field of ['typed', 'severity', 'opaque']) {
    if (typeof corpus.legacyValueRules?.[field] !== 'string') fail(`legacyValueRules must state the ${field} rule`);
  }
  if (JSON.stringify(corpus.classifications) !== JSON.stringify(['canonical', 'legacy_compatible', 'remediation_required', 'unsupported'])) {
    fail('classifications must be the four contract labels, in order');
  }
  for (const classification of corpus.classifications) {
    if (typeof corpus.contract?.[classification] !== 'string') fail(`contract must state what ${classification} means`);
  }

  // Case coverage: exactly the decisive cases, no duplicates, no silent additions.
  const ids = corpus.cases.map((entry) => entry.id);
  if (new Set(ids).size !== ids.length) fail('case ids must be unique');
  if (JSON.stringify(ids) !== JSON.stringify(REQUIRED_CASE_IDS)) {
    fail(`cases must be exactly ${REQUIRED_CASE_IDS.join(', ')} — received ${ids.join(', ')}`);
  }
  const covered = new Set(corpus.cases.map((entry) => entry.expected.classification));
  for (const classification of corpus.classifications) {
    if (!covered.has(classification)) fail(`classification ${classification} has no case`);
  }

  const usedCodes = new Set();
  for (const entry of corpus.cases) {
    const at = `case ${entry.id}`;
    for (const field of ['id', 'title', 'source']) {
      if (typeof entry[field] !== 'string' || entry[field].length === 0) fail(`${at}: ${field} must be a non-empty string`);
    }
    if (entry.target !== 'live' && entry.target !== 'history') fail(`${at}: target must be live or history`);
    if (!isRecord(entry.context) || typeof entry.context.sprintNumber !== 'number') {
      fail(`${at}: context.sprintNumber is required — the compatibility origin default depends on it`);
    }

    const expected = entry.expected;
    if (!isRecord(expected)) fail(`${at}: expected must be an object`);
    if (!corpus.classifications.includes(expected.classification)) fail(`${at}: unknown classification ${expected.classification}`);
    if (typeof expected.remediable !== 'boolean') fail(`${at}: remediable must be a boolean`);
    // Immutable history is observed, never repaired (convention history-immutability).
    if (entry.target === 'history' && expected.remediable) fail(`${at}: historical cases must never be marked remediable`);
    if (expected.remediable && expected.classification !== 'remediation_required') {
      fail(`${at}: only remediation-required cases may be remediable`);
    }
    if (!Array.isArray(expected.legacyKeys)) fail(`${at}: legacyKeys must be an array`);
    for (const key of expected.legacyKeys) {
      if (!corpus.legacyOnlyKeys.includes(key)) fail(`${at}: ${key} is not a declared legacy-only key`);
      if (!isRecord(entry.raw) || !(key in entry.raw)) fail(`${at}: declared legacy key ${key} is absent from raw`);
    }
    if (isRecord(entry.raw)) {
      for (const key of corpus.legacyOnlyKeys) {
        if (key in entry.raw && !expected.legacyKeys.includes(key)) fail(`${at}: raw carries legacy key ${key} but does not declare it`);
      }
    }

    const lens = expected.lens;
    if (!isRecord(lens) || typeof lens.accepts !== 'boolean') fail(`${at}: expected.lens.accepts must be a boolean`);
    if (lens.accepts) {
      if (!isRecord(lens.projection)) fail(`${at}: an accepting Lens must record its projection`);
      if (lens.failure !== null) fail(`${at}: an accepting Lens has no failure message`);
      if (JSON.stringify(Object.keys(lens.projection).sort()) !== JSON.stringify([...canonicalKeys].sort())) {
        fail(`${at}: the Lens projection must hold exactly the seven canonical keys`);
      }
    } else {
      if (lens.projection !== null) fail(`${at}: a rejecting Lens must not carry a projection`);
      if (typeof lens.failure !== 'string' || lens.failure.length === 0) fail(`${at}: a rejecting Lens must record its failure message`);
    }
    // R1: a readable input must produce one shared projection, not two dialects.
    if (isRecord(expected.canonical) !== lens.accepts) fail(`${at}: Kyro readability and Lens acceptance must agree`);
    if (isRecord(expected.canonical) && !sameValue(expected.canonical, lens.projection)) {
      fail(`${at}: the Kyro canonical projection and the Lens projection must be identical`);
    }
    if (isRecord(expected.canonical)) {
      if (JSON.stringify(Object.keys(expected.canonical)) !== JSON.stringify(canonicalKeys)) {
        fail(`${at}: the canonical projection must emit exactly the seven canonical keys, in canonical order`);
      }
      if (typeof expected.canonical.origin !== 'number') fail(`${at}: the canonical projection origin must be a sprint number`);
      if (!DEBT_PRIORITIES.includes(expected.canonical.priority)) fail(`${at}: the canonical projection priority must be a valid priority`);
      if (!DEBT_STATUSES.includes(expected.canonical.status)) fail(`${at}: the canonical projection status must be a valid status`);
      if (expected.canonical.targetSprint !== null && typeof expected.canonical.targetSprint !== 'number') {
        fail(`${at}: the canonical projection targetSprint must be a number or null`);
      }
      if (typeof expected.canonical.note !== 'string') fail(`${at}: the canonical projection note must be a string`);
    }

    if (!Array.isArray(expected.diagnostics)) fail(`${at}: diagnostics must be an array`);
    const byField = new Map();
    for (const diagnostic of expected.diagnostics) {
      if (!isRecord(diagnostic)) fail(`${at}: each diagnostic must be an object`);
      if (JSON.stringify(Object.keys(diagnostic)) !== JSON.stringify(DIAGNOSTIC_KEYS)) {
        fail(`${at}: diagnostic keys must be exactly ${DIAGNOSTIC_KEYS.join(', ')} in order`);
      }
      if (!corpus.diagnosticCodes.includes(diagnostic.code)) fail(`${at}: undeclared diagnostic code ${diagnostic.code}`);
      if (!SEVERITIES.includes(diagnostic.severity)) fail(`${at}: unknown severity ${diagnostic.severity}`);
      if (!AUTHORITIES.includes(diagnostic.authority)) fail(`${at}: unknown authority ${diagnostic.authority}`);
      if (byField.has(`${diagnostic.field}:${diagnostic.code}`)) fail(`${at}: duplicate diagnostic for ${diagnostic.field}`);
      byField.set(`${diagnostic.field}:${diagnostic.code}`, diagnostic);
      // ADR-0004: a suggestion is never authorization, and an operator decision is never suggested.
      if (diagnostic.authority === 'operator' && diagnostic.suggested !== null) {
        fail(`${at}: operator-authority ${diagnostic.field} must not carry a suggested value`);
      }
      if (diagnostic.authority === 'evidence' && (diagnostic.evidence === null || diagnostic.suggested === null)) {
        fail(`${at}: evidence-authority ${diagnostic.field} must carry both evidence and a suggested value`);
      }
      if (diagnostic.code === 'LEGACY_KEY_PRESENT') {
        if (diagnostic.severity !== 'info') fail(`${at}: legacy key presence is informational, not blocking`);
        if (!expected.legacyKeys.includes(diagnostic.field)) fail(`${at}: LEGACY_KEY_PRESENT on undeclared key ${diagnostic.field}`);
      }
      if (diagnostic.code === 'MISSING_CANONICAL_FIELD') {
        // Absence is normalizable, so it never blocks reading; it only withholds operator authority.
        if (diagnostic.severity !== 'info') fail(`${at}: a missing canonical field is compatible, not blocking`);
        if (!canonicalKeys.includes(diagnostic.field)) fail(`${at}: MISSING_CANONICAL_FIELD on non-canonical key ${diagnostic.field}`);
        if (isRecord(entry.raw) && diagnostic.field in entry.raw) fail(`${at}: ${diagnostic.field} is present but reported as missing`);
        if (lens.accepts && !sameValue(diagnostic.lensDefault, lens.projection[diagnostic.field])) {
          fail(`${at}: the recorded default for ${diagnostic.field} does not match the accepted projection`);
        }
      }
      usedCodes.add(diagnostic.code);
    }
    const blocking = expected.diagnostics.filter((diagnostic) => diagnostic.severity === 'blocking');
    // Every canonical field that is absent must be named, whatever the classification.
    if (isRecord(entry.raw)) {
      for (const key of canonicalKeys) {
        const named = byField.has(`${key}:MISSING_CANONICAL_FIELD`);
        if (!(key in entry.raw) && !named && expected.classification !== 'unsupported') {
          fail(`${at}: absent canonical field ${key} is not reported`);
        }
      }
    }

    switch (expected.classification) {
      case 'canonical': {
        if (!isRecord(entry.raw)) fail(`${at}: canonical case must be an object`);
        if (JSON.stringify(Object.keys(entry.raw)) !== JSON.stringify(canonicalKeys)) {
          fail(`${at}: canonical case must hold exactly the seven canonical keys, in order`);
        }
        if (!sameValue(expected.canonical, entry.raw)) fail(`${at}: canonical projection must equal raw`);
        if (expected.legacyKeys.length !== 0 || expected.diagnostics.length !== 0) fail(`${at}: canonical case must have no legacy keys and no diagnostics`);
        break;
      }
      case 'legacy_compatible': {
        if (!isRecord(entry.raw)) fail(`${at}: legacy-compatible case must be an object`);
        if (blocking.length !== 0) fail(`${at}: legacy-compatible case must have no blocking diagnostic`);
        // Present canonical values survive the projection untouched; absent ones come from defaults.
        for (const key of canonicalKeys) {
          if (key in entry.raw && !sameValue(entry.raw[key], expected.canonical[key])) {
            fail(`${at}: the projection must preserve the present value of ${key}`);
          }
        }
        // The converse of the remediation branch: nothing the reader interprets may be invalid here.
        for (const key of TYPED_LEGACY_KEYS) {
          if (isLegacyValueInvalid(entry.raw, key)) fail(`${at}: ${key} is a present invalid value, so this case is not legacy-compatible`);
        }
        const missing = canonicalKeys.filter((key) => !(key in entry.raw));
        const droppable = expected.legacyKeys.length > 0;
        if (missing.length === 0 && !droppable) fail(`${at}: a legacy-compatible case must differ from an exact canonical debt`);
        break;
      }
      case 'remediation_required': {
        if (!isRecord(entry.raw)) fail(`${at}: remediation-required case must be an object`);
        if (expected.canonical !== null) fail(`${at}: remediation-required case must not claim a canonical projection`);
        if (blocking.length === 0) fail(`${at}: remediation-required case must carry a blocking diagnostic`);
        // Only a present, wrongly typed value blocks; absence never does. "Present" spans the typed
        // legacy keys too: the compatibility reader interprets them, so it can refuse them.
        const named = new Set(blocking.map((diagnostic) => diagnostic.field));
        const invalid = [...canonicalKeys, ...TYPED_LEGACY_KEYS].filter((key) => {
          if (TYPED_LEGACY_KEYS.includes(key)) return isLegacyValueInvalid(entry.raw, key);
          if (!(key in entry.raw)) return false;
          if (key === 'origin') return typeof entry.raw[key] !== 'number';
          if (key === 'priority') return !DEBT_PRIORITIES.includes(entry.raw[key]);
          if (key === 'targetSprint') return entry.raw[key] !== null && typeof entry.raw[key] !== 'number';
          return typeof entry.raw[key] !== 'string';
        });
        for (const key of invalid) {
          if (!named.has(key)) fail(`${at}: present invalid field ${key} is not named by a blocking diagnostic`);
        }
        for (const key of named) {
          if (!invalid.includes(key)) fail(`${at}: ${key} blocks but is not a present invalid value`);
        }
        if (invalid.length === 0) fail(`${at}: remediation-required requires at least one present invalid value`);
        break;
      }
      case 'unsupported': {
        if (expected.canonical !== null) fail(`${at}: unsupported case must not claim a canonical projection`);
        if (blocking.length === 0) fail(`${at}: unsupported case must carry a blocking diagnostic`);
        const usableIdentity = isRecord(entry.raw)
          && typeof entry.raw.id === 'string'
          && typeof entry.raw.title === 'string'
          && DEBT_STATUSES.includes(entry.raw.status);
        if (usableIdentity) fail(`${at}: a record with a usable id, title and status is readable, not unsupported`);
        break;
      }
      default:
        fail(`${at}: unhandled classification`);
    }
  }

  for (const code of corpus.diagnosticCodes) {
    if (!usedCodes.has(code)) fail(`declared diagnostic code ${code} is never exercised`);
  }

  // --- Sentinels: the exact failure shapes the original incident produced. ---
  const liveD1 = caseById(corpus, 'live-d1-remediation-required');
  if (typeof liveD1.raw.origin !== 'string') fail('sentinel: live D1 origin must stay a string');
  if ('priority' in liveD1.raw) fail('sentinel: live D1 must not gain a priority');
  if ('targetSprint' in liveD1.raw) fail('sentinel: live D1 must not gain a targetSprint');
  if (typeof liveD1.raw.note !== 'string') fail('sentinel: live D1 must keep its note');

  const sprint1 = caseById(corpus, 'historical-d1-sprint-1');
  if ('note' in sprint1.raw) fail('sentinel: the Sprint 1 checkpoint variant must have no note');
  if (sprint1.raw.status !== 'open') fail('sentinel: the Sprint 1 checkpoint variant was still open');

  const sprint2 = caseById(corpus, 'historical-d1-sprint-2');
  if (typeof sprint2.raw.note !== 'string') fail('sentinel: the Sprint 2 checkpoint variant must keep its note');
  if (sprint2.raw.status !== 'resolved') fail('sentinel: the Sprint 2 checkpoint variant was resolved');

  for (const id of D1_CASE_IDS) {
    const entry = caseById(corpus, id);
    if (entry.raw.id !== 'D1') fail(`sentinel: ${id} must describe D1`);
    if (typeof entry.raw.origin !== 'string') fail(`sentinel: ${id} origin must stay a string`);
    // The incident's own key triple, named literally: the wider legacy vocabulary must never dilute it.
    for (const key of ['detail', 'resolution', 'addedSprint']) {
      if (!(key in entry.raw)) fail(`sentinel: ${id} must keep the legacy key ${key}`);
    }
  }

  // --- Minimization and portability. ---
  const limit = corpus.maxStringLength;
  if (typeof limit !== 'number' || limit > 240) fail('maxStringLength must be a number no larger than 240');
  eachString(corpus.cases, 'cases', (value, path) => {
    if (value.length > limit) fail(`${path} exceeds the ${limit}-character minimization budget (${value.length})`);
    if (/(^|[\s"'(])(\/Users\/|\/home\/|\/private\/|[A-Za-z]:\\)/.test(value)) fail(`${path} contains an absolute local path`);
  });
}

validateCorpus(JSON.parse(raw));
assert(true, 'the committed corpus satisfies the debt contract');

const corpus = JSON.parse(raw);
assert(`${JSON.stringify(corpus, null, 2)}\n` === raw, 'corpus must be deterministic JSON: 2-space indent, one trailing newline, no key reordering');

// --- Mutation suite: every decisive fact must fail closed. ---
const clone = () => JSON.parse(raw);
const mutations = [
  ['live D1 origin becomes canonical', (c) => {
    caseById(c, 'live-d1-remediation-required').raw.origin = 1;
  }],
  ['live D1 gains a priority', (c) => {
    caseById(c, 'live-d1-remediation-required').raw.priority = 'high';
  }],
  ['live D1 gains a targetSprint', (c) => {
    caseById(c, 'live-d1-remediation-required').raw.targetSprint = null;
  }],
  ['Sprint 1 variant gains a note', (c) => {
    caseById(c, 'historical-d1-sprint-1').raw.note = 'backfilled';
  }],
  ['legacy detail key is silently removed', (c) => {
    delete caseById(c, 'live-d1-remediation-required').raw.detail;
  }],
  ['legacy resolution key is silently removed', (c) => {
    delete caseById(c, 'historical-d1-sprint-2').raw.resolution;
  }],
  ['legacy addedSprint key is silently removed', (c) => {
    delete caseById(c, 'historical-d1-sprint-1').raw.addedSprint;
  }],
  ['a remediation-required case is relabelled canonical', (c) => {
    caseById(c, 'live-d1-remediation-required').expected.classification = 'canonical';
  }],
  ['a remediation-required case is relabelled legacy-compatible', (c) => {
    caseById(c, 'live-d1-remediation-required').expected.classification = 'legacy_compatible';
  }],
  ['the canonical case is relabelled legacy-compatible', (c) => {
    caseById(c, 'canonical-exact').expected.classification = 'legacy_compatible';
  }],
  ['a legacy-compatible case is relabelled remediation-required', (c) => {
    caseById(c, 'legacy-compatible-missing-fields').expected.classification = 'remediation_required';
  }],
  ['an unsupported case is relabelled remediation-required', (c) => {
    caseById(c, 'unsupported-bad-status').expected.classification = 'remediation_required';
  }],
  ['a canonical projection is claimed for the live D1', (c) => {
    caseById(c, 'live-d1-remediation-required').expected.canonical = { ...caseById(c, 'canonical-exact').raw };
  }],
  ['the legacy-compatible projection keeps a legacy key', (c) => {
    caseById(c, 'legacy-compatible-missing-fields').expected.canonical.addedSprint = 1;
  }],
  ['the legacy-compatible projection overwrites a present value', (c) => {
    caseById(c, 'legacy-compatible-missing-fields').expected.canonical.origin = 9;
  }],
  ['Kyro and Lens projections drift apart', (c) => {
    caseById(c, 'legacy-compatible-missing-fields').expected.lens.projection.priority = 'high';
  }],
  ['a recorded Lens default contradicts the projection', (c) => {
    const entry = caseById(c, 'legacy-compatible-missing-fields');
    entry.expected.diagnostics.find((d) => d.field === 'priority').lensDefault = 'low';
  }],
  ['a rejecting Lens is credited with a projection', (c) => {
    caseById(c, 'live-d1-remediation-required').expected.lens.accepts = true;
  }],
  ['an operator decision is given a suggested value', (c) => {
    caseById(c, 'live-d1-remediation-required').expected.diagnostics.find((d) => d.field === 'priority').suggested = 'high';
  }],
  ['a missing canonical field is escalated to blocking', (c) => {
    caseById(c, 'live-d1-remediation-required').expected.diagnostics.find((d) => d.field === 'priority').severity = 'blocking';
  }],
  ['the diagnostic for a missing field is dropped', (c) => {
    const entry = caseById(c, 'live-d1-remediation-required');
    entry.expected.diagnostics = entry.expected.diagnostics.filter((d) => d.field !== 'targetSprint');
  }],
  ['the blocking origin diagnostic is dropped', (c) => {
    const entry = caseById(c, 'historical-d1-sprint-2');
    entry.expected.diagnostics = entry.expected.diagnostics.filter((d) => d.field !== 'origin');
  }],
  ['a historical case is marked remediable', (c) => {
    caseById(c, 'historical-d1-sprint-1').expected.remediable = true;
  }],
  ['a non-string severity is called legacy-compatible', (c) => {
    caseById(c, 'legacy-severity-not-string').expected.classification = 'legacy_compatible';
  }],
  ['a non-string prose key is called legacy-compatible', (c) => {
    caseById(c, 'legacy-source-not-string').expected.classification = 'legacy_compatible';
  }],
  ['the blocking severity diagnostic is dropped', (c) => {
    const entry = caseById(c, 'legacy-severity-unrecognized');
    entry.expected.diagnostics = entry.expected.diagnostics.filter((d) => d.code !== 'SEVERITY_NOT_RECOGNIZED');
  }],
  ['an ignored severity is escalated to blocking', (c) => {
    caseById(c, 'legacy-severity-unrecognized-with-priority').expected.classification = 'remediation_required';
  }],
  ['a rejecting Lens is credited with reading a bad severity', (c) => {
    caseById(c, 'legacy-severity-not-string').expected.lens.accepts = true;
  }],
  ['the severity mapping is rewritten', (c) => {
    caseById(c, 'legacy-severity-mapped').expected.canonical.priority = 'low';
  }],
  ['a typed legacy key leaves the declared vocabulary', (c) => {
    c.legacyOnlyKeys = c.legacyOnlyKeys.filter((key) => key !== 'severity');
  }],
  ['a case is dropped from the corpus', (c) => {
    c.cases = c.cases.filter((entry) => entry.id !== 'unsupported-bare-string');
  }],
  ['prose grows past the minimization budget', (c) => {
    caseById(c, 'canonical-exact').raw.note = 'x'.repeat(c.maxStringLength + 1);
  }],
  ['an absolute local path leaks into the corpus', (c) => {
    caseById(c, 'canonical-exact').source = 'read from /Users/example/checkout/sprint.json';
  }],
];

for (const [name, mutate] of mutations) {
  const mutated = clone();
  mutate(mutated);
  let threw = false;
  try {
    validateCorpus(mutated);
  } catch {
    threw = true;
  }
  assert(threw, `mutation must fail the corpus: ${name}`);
}

console.log(`check:debt-contract-fixture — ${passed} assertions passed (${corpus.cases.length} cases, ${mutations.length} mutations)`);
