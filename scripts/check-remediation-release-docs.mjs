#!/usr/bin/env node
/**
 * Remediation and release documentation checker (Sprint 5 / T5.4).
 *
 * R9 is an operator-safety contract, not release marketing. The specific harm this file exists to
 * prevent is a future edit — a tidy-up, a version bump, an over-confident release note — that leaves
 * a user believing origin-only 4.43.5 repairs a record-level legacy shape, that upgrading migrates
 * their scopes for them, that Kyro Lens can fix something, or that a green local run means the
 * change is published.
 *
 * So this checker does two different jobs:
 *
 *  1. REQUIRED CLAIMS. Each doc must still make the statements an operator needs: the limitation,
 *     the ordered workflow, explicit operator authority, immutability, and the evidence boundaries.
 *
 *  2. FORBIDDEN CLAIMS. Some sentences must never appear. These are matched as patterns rather than
 *     literals, because the dangerous version of a claim is the paraphrase.
 *
 * The version numbers are read from package.json, not hardcoded, so a bump cannot silently make the
 * docs describe a version that no longer exists.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(resolve(repo, file), 'utf8');
const pkg = JSON.parse(read('package.json'));

/** The last release that could only repair `origin`. Documented as a limitation forever. */
const ORIGIN_ONLY_VERSION = '4.43.5';
const CANDIDATE_VERSION = pkg.version;

const failures = [];
let checked = 0;

function must(file, text, pattern, what) {
  checked += 1;
  if (!pattern.test(text)) failures.push(`${file}: missing ${what}\n    expected to match: ${pattern}`);
}

function mustNot(file, text, pattern, what) {
  checked += 1;
  const match = text.match(pattern);
  if (match !== null) failures.push(`${file}: ${what}\n    found: "${match[0].trim()}"`);
}

// A candidate that adds operations must be tellable apart from the origin-only runtime, or every
// claim below is ambiguous no matter how carefully it is worded.
checked += 1;
if (CANDIDATE_VERSION === ORIGIN_ONLY_VERSION) {
  failures.push(
    `package.json: the candidate version is ${CANDIDATE_VERSION}, the same as the documented ` +
    `origin-only release. Docs cannot truthfully say "${ORIGIN_ONLY_VERSION} is origin-only" and ` +
    `"${CANDIDATE_VERSION} adds debt.canonicalize" at once. Bump the version.`,
  );
}

const escaped = (value) => value.replace(/\./g, '\\.');
const originOnly = new RegExp(escaped(ORIGIN_ONLY_VERSION));
const candidate = new RegExp(escaped(CANDIDATE_VERSION));

// =================================================================================================
// README.md — the first place a user looks, so the limitation must be here and not only in docs/.
// =================================================================================================
{
  const file = 'README.md';
  const text = read(file);
  must(file, text, originOnly, `the origin-only version ${ORIGIN_ONLY_VERSION}`);
  must(file, text, /origin-only/i, 'the phrase "origin-only"');
  must(file, text, candidate, `the candidate version ${CANDIDATE_VERSION} that adds debt.canonicalize`);
  must(file, text, /debt\.canonicalize/, 'the name of the operation that repairs the full record');
  must(file, text, /never rewrites an existing scope|Nothing is migrated for you/i,
    'the statement that upgrading does not migrate scopes automatically');
  must(file, text, /suggestion is never an authorization/i, 'the explicit-operator-authority statement');
  must(file, text, /read-only/i, 'the statement that Kyro Lens is read-only');
  must(file, text, /immutable/i, 'the statement that closed-scope history is immutable');
}

// =================================================================================================
// docs/cli.md — the operator workflow itself.
// =================================================================================================
{
  const file = 'docs/cli.md';
  const text = read(file);
  must(file, text, originOnly, `the origin-only version ${ORIGIN_ONLY_VERSION}`);
  must(file, text, new RegExp(`${escaped(ORIGIN_ONLY_VERSION)}[^.]{0,80}origin-only|origin-only[^.]{0,80}${escaped(ORIGIN_ONLY_VERSION)}`, 'i'),
    `the limitation stated about ${ORIGIN_ONLY_VERSION} specifically`);
  must(file, text, candidate, `the candidate version ${CANDIDATE_VERSION}`);
  must(file, text, /debt\.origin\.set/, 'the origin-only operation name');
  must(file, text, /debt\.canonicalize/, 'the canonicalization operation name');
  must(file, text, /protocol v3|revision 3/i, 'the protocol revision that introduces it');

  // The seven canonical keys, named.
  for (const key of ['id', 'title', 'origin', 'priority', 'status', 'targetSprint', 'note']) {
    must(file, text, new RegExp(`\\b${key}\\b`), `the canonical key ${key}`);
  }
  // The legacy keys the operation retires.
  for (const key of ['detail', 'resolution', 'addedSprint']) {
    must(file, text, new RegExp(`\\b${key}\\b`), `the legacy key ${key}`);
  }

  // The workflow, in order. Order is the safety property: preview before apply, doctor before
  // recertify. A doc that lists the steps in the wrong order is worse than one that omits them.
  const ORDER = [
    ['doctor', /kyro doctor/],
    ['canonicalize-prepare', /canonicalize-prepare/],
    ['canonicalize-preview', /canonicalize-preview/],
    ['remediate apply --yes', /remediate apply[^\n]*--yes/],
    ['doctor after apply', /kyro doctor[^\n]*\n?[\s\S]{0,400}?Verification: remediated/],
    ['recertify apply', /recertify apply[^\n]*--yes/],
    ['recertified', /Verification: recertified/],
  ];
  let cursor = 0;
  for (const [label, pattern] of ORDER) {
    checked += 1;
    const rest = text.slice(cursor);
    const found = rest.search(pattern);
    if (found < 0) {
      failures.push(`${file}: the operator workflow must document "${label}" after the preceding step`);
      break;
    }
    cursor += found + 1;
  }

  must(file, text, /INPUT_REQUIRED/, 'the INPUT_REQUIRED state for an undecided preparation');
  must(file, text, /suggestion is never an authorization/i, 'the explicit-operator-authority statement');
  must(file, text, /READ-ONLY|read-only/, 'the statement that prepare and preview write nothing');
  must(file, text, /never rewritten|immutable/i, 'the immutability statement');
  must(file, text, /PREPARED/, 'the interrupted-apply resume behaviour');
  must(file, text, /no automatic migration|There is no automatic migration|never rewrites an existing scope/i,
    'the statement that nothing is migrated automatically');
  must(file, text, /fail closed|unsupported/i, 'the statement that older readers fail closed');
}

// =================================================================================================
// docs/release-checklist.md — the evidence boundaries.
// =================================================================================================
{
  const file = 'docs/release-checklist.md';
  const text = read(file);
  for (const [label, pattern] of [
    ['source checkout', /source checkout/i],
    ['packed tarball', /packed tarball|npm pack/i],
    ['temporary installed candidate', /temporar\w+ install\w*|fresh temp prefix|temporary prefix/i],
    ['current global runtime', /global runtime/i],
    ['Kyro Lens', /Lens/],
    ['publication', /publication|publish/i],
  ]) {
    must(file, text, pattern, `the "${label}" evidence boundary`);
  }
  must(file, text, /does not authorize a publish|not authorize a publish/i,
    'the statement that a green local matrix does not authorize publishing');
  must(file, text, /Never replace `?~\/\.agents\/kyro\/current`?/i,
    'the prohibition on overwriting the global runtime to test a candidate');
  must(file, text, /check:original-incident-release/, 'the original-incident gate invocation');
}

// =================================================================================================
// CHANGELOG.md — the release note.
// =================================================================================================
{
  const file = 'CHANGELOG.md';
  const text = read(file);
  must(file, text, new RegExp(`^## \\[${escaped(CANDIDATE_VERSION)}\\]`, 'm'),
    `an entry for the candidate version ${CANDIDATE_VERSION}`);
  must(file, text, /debt\.canonicalize/, 'the operation this release adds');
  must(file, text, new RegExp(`${escaped(ORIGIN_ONLY_VERSION)}[\\s\\S]{0,200}origin-only`, 'i'),
    `the note that ${ORIGIN_ONLY_VERSION} is origin-only`);
}

// =================================================================================================
// Forbidden claims, across every operator-facing document.
//
// Each pattern below is a specific untruth this project has either made or come close to making.
// =================================================================================================
const FORBIDDEN = [
  [
    new RegExp(`${escaped(ORIGIN_ONLY_VERSION)}[^.\\n]{0,120}(repairs?|fixes|remediates|canonicaliz\\w+)\\s+(the\\s+)?(full|whole|complete|entire|record-level|legacy)`, 'i'),
    `claims ${ORIGIN_ONLY_VERSION} repairs the full legacy shape (it is origin-only)`,
  ],
  [
    /\bdebt\.origin\.set\b[^.\n]{0,120}(retires?|removes?)\s+legacy/i,
    'claims the origin-only operation retires legacy keys (it cannot)',
  ],
  [
    /Lens\s+(can\s+)?(repairs?|fixes|remediates|writes|applies|migrates)\b/i,
    'claims Kyro Lens repairs, writes or applies anything (it is a read-only verifier)',
  ],
  [
    /(automatically|automatic\w*)\s+(migrat|canonicaliz|remediat)\w*\s+(every|all|existing|your)\s+scope/i,
    'claims scopes are migrated automatically (nothing is migrated for the operator)',
  ],
  [
    /(already\s+(published|on npm)|is\s+published\s+to\s+npm|available\s+on\s+npm\s+now)/i,
    'claims the change is already published (publication is a separate, CI-owned gate)',
  ],
  [
    /(rewrites?|updates?|replaces?)\s+(the\s+)?(committed\s+)?(checkpoint|snapshot|narrative|ledger)/i,
    'claims immutable history is rewritten',
  ],
  [
    /(infers?|guesses|chooses)\s+(the\s+)?(priority|target ?sprint)\s+for\s+you/i,
    'claims Kyro decides a business judgment for the operator',
  ],
];

for (const file of ['README.md', 'docs/cli.md', 'docs/release-checklist.md', 'CHANGELOG.md']) {
  const text = read(file);
  for (const [pattern, what] of FORBIDDEN) mustNot(file, text, pattern, what);
}

// =================================================================================================
// Self-test: a checker nobody has watched fail is decoration.
//
// Every forbidden pattern is fed a sentence that should trip it. A pattern that matches nothing is
// a pattern that will not catch the edit it was written for.
// =================================================================================================
const TRIPWIRES = [
  `Kyro ${ORIGIN_ONLY_VERSION} repairs the full legacy debt record.`,
  'The debt.origin.set operation retires legacy keys such as detail.',
  'Kyro Lens repairs the scope when it detects drift.',
  'Installing this version automatically migrates every scope.',
  'This change is already published to npm.',
  'Remediation rewrites the checkpoint to match the corrected state.',
  'Kyro infers the priority for you when it is missing.',
];
for (const [index, [pattern, what]] of FORBIDDEN.entries()) {
  checked += 1;
  if (!pattern.test(TRIPWIRES[index])) {
    failures.push(`self-test: the pattern for "${what}" does not match its own tripwire sentence: "${TRIPWIRES[index]}"`);
  }
}

if (failures.length > 0) {
  console.error(`check:remediation-release-docs — ${failures.length} problem(s):\n`);
  for (const failure of failures) console.error(`  - ${failure}\n`);
  console.error('These documents are an operator-safety contract. Fix the docs rather than the checker.');
  process.exit(1);
}

console.log(`check:remediation-release-docs — ${checked} documentation assertions passed (${ORIGIN_ONLY_VERSION} origin-only, ${CANDIDATE_VERSION} adds debt.canonicalize)`);
