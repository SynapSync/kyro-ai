#!/usr/bin/env node
/**
 * Aggregate local release certification matrix (Sprint 5 / T5.5).
 *
 * One named gate that runs everything a release decision for this scope depends on, and — more
 * importantly — reports WHICH KIND of thing failed. The whole history of this scope is a history of
 * green runs that certified something adjacent to what the user runs, so a single pass/fail is not
 * an acceptable output. Every step is tagged with the boundary it belongs to:
 *
 *   candidate       the source and the packed/installed artifact
 *   original-scope  the read-only probe of a real local scope
 *   lens            the independent read-only verifier
 *   docs            the operator-safety documentation contract
 *   global-runtime  what users have installed today — an OBSERVATION, never a candidate result
 *
 * What a green run here does NOT establish, and this file will not print:
 *   - that anything is published to npm, tagged, or released
 *   - that remote CI passed
 *   - that ~/.agents/kyro/current was replaced (it is never written)
 *   - that any original project checkout was repaired (only temporary copies are ever remediated)
 *
 * Usage:
 *   node scripts/check-release-matrix.mjs --lens <path> --lens-node <node22 binary>
 *                                         [--original-scope <path>] [--skip-slow]
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const lensRepo = flag('--lens') === undefined ? undefined : resolve(flag('--lens'));
const lensNode = flag('--lens-node') === undefined ? undefined : resolve(flag('--lens-node'));
const originalScope = flag('--original-scope') === undefined ? undefined : resolve(flag('--original-scope'));

const BOUNDARY = {
  CANDIDATE: 'candidate',
  ORIGINAL: 'original-scope',
  LENS: 'lens',
  DOCS: 'docs',
  GLOBAL: 'global-runtime',
};

const results = [];

function run(boundary, label, command, argv, options = {}) {
  const started = Date.now();
  const result = spawnSync(command, argv, {
    cwd: options.cwd ?? repo,
    encoding: 'utf-8',
    env: { ...process.env, ...(options.env ?? {}) },
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.replace(/\[[0-9;]*m/g, '');
  const entry = {
    boundary,
    label,
    ok: result.status === 0,
    seconds: ((Date.now() - started) / 1000).toFixed(1),
    output,
    summary: (options.summarize ?? ((text) => text.trim().split('\n').filter(Boolean).at(-1) ?? ''))(output),
  };
  results.push(entry);
  console.log(`${entry.ok ? '✓' : '✗'} [${boundary}] ${label} (${entry.seconds}s)`);
  if (!entry.ok) console.log(`    ${entry.summary}`);
  return entry;
}

const node = process.execPath;

// =================================================================================================
// Preconditions: a matrix that silently skips its own requirements certifies nothing.
// =================================================================================================
const missing = [];
if (lensRepo === undefined) missing.push('--lens <path to kyro-lens>');
if (lensNode === undefined) missing.push('--lens-node <path to a Node 22 binary>');
if (missing.length > 0) {
  console.error(`check:release-matrix requires: ${missing.join(', ')}`);
  console.error('Lens is a mandatory boundary of this matrix; it is not optional and is not skipped.');
  process.exit(2);
}
if (!existsSync(join(lensRepo, 'package.json'))) {
  console.error(`--lens ${lensRepo} is not a package root`);
  process.exit(2);
}
const lensNodeVersion = spawnSync(lensNode, ['-v'], { encoding: 'utf-8' }).stdout?.trim() ?? '';
if (!/^v22\./.test(lensNodeVersion)) {
  console.error(`--lens-node must be a Node 22 runtime, got "${lensNodeVersion}". ` +
    'Node 25 shadows jsdom\'s localStorage and produces failures that are not product defects.');
  process.exit(2);
}

console.log(`check:release-matrix — candidate ${pkg.name}@${pkg.version}, Lens on ${lensNodeVersion}\n`);

// =================================================================================================
// candidate — the code, the package, and the incident it exists to repair.
// =================================================================================================
run(BOUNDARY.CANDIDATE, 'kyro build', 'npm', ['run', 'build']);
run(BOUNDARY.CANDIDATE, 'kyro check (full static + gate suite)', 'npm', ['run', 'check']);
run(BOUNDARY.CANDIDATE, 'npm pack --dry-run', 'npm', ['pack', '--dry-run'], {
  summarize: (text) => text.split('\n').find((line) => /total files/.test(line))?.trim() ?? 'packed',
});
run(BOUNDARY.CANDIDATE, 'doctor --tokens', 'npm', ['run', 'check:tokens']);
run(BOUNDARY.CANDIDATE, 'doctor --artifacts', 'npm', ['run', 'check:artifacts']);

// The incident gate: source dist + real tarball installed to a temp prefix + hashes + Doctor +
// recertify, and — when a real scope is available — the original-copy probe and Lens over it.
const incidentArgs = [join(repo, 'scripts/check-original-incident-release.mjs')];
if (originalScope !== undefined) {
  incidentArgs.push('--original-scope', originalScope, '--require-original-scope',
    '--lens', lensRepo, '--lens-node', lensNode, '--require-lens');
}
const incident = run(
  originalScope === undefined ? BOUNDARY.CANDIDATE : BOUNDARY.ORIGINAL,
  originalScope === undefined
    ? 'original-incident gate (faithful fixture: source + tarball + temp install)'
    : 'original-incident gate (+ real scope read-only, remediated in a temp copy, Lens-verified)',
  node, incidentArgs,
  { summarize: (text) => text.trim().split('\n').slice(-6).join('\n    ') },
);

// =================================================================================================
// docs — the operator-safety contract.
// =================================================================================================
run(BOUNDARY.DOCS, 'remediation & release documentation', 'npm', ['run', 'check:remediation-release-docs']);

// =================================================================================================
// lens — the independent read-only verifier.
// =================================================================================================
const lensEnv = { PATH: `${dirname(lensNode)}:${process.env.PATH}`, CI: 'true' };
const vitest = join(lensRepo, 'node_modules/vitest/vitest.mjs');
const summarizeVitest = (text) => text.split('\n').find((line) => /^\s*Tests\s+\d/.test(line))?.trim() ?? 'no summary';

// `tsc -b --force`, not `tsc --noEmit -p tsconfig.json`. Lens's root tsconfig is a solution file
// with `files: []` and project references, so `-p` on it typechecks NOTHING and exits 0 in 40ms —
// a vacuous green this matrix caught only because the step was implausibly fast. `--force` also
// defeats the build cache, so a cached success cannot stand in for a real check.
const lensTypecheck = run(BOUNDARY.LENS, 'lens typecheck (tsc -b --force)', lensNode,
  [join(lensRepo, 'node_modules/typescript/bin/tsc'), '-b', '--force'], { cwd: lensRepo, env: lensEnv });
// A typecheck that finishes instantly did not read the program. Fail rather than believe it.
if (lensTypecheck.ok && Number(lensTypecheck.seconds) < 1) {
  lensTypecheck.ok = false;
  lensTypecheck.summary = `typecheck finished in ${lensTypecheck.seconds}s — too fast to have checked the program; ` +
    'it is almost certainly a no-op (solution-style tsconfig, or a cache that --force failed to defeat).';
  results[results.length - 1] = lensTypecheck;
  console.log(`  ✗ downgraded: ${lensTypecheck.summary}`);
}
run(BOUNDARY.LENS, 'lens build', lensNode, [join(lensRepo, 'node_modules/vite/bin/vite.js'), 'build'], { cwd: lensRepo, env: lensEnv });
run(BOUNDARY.LENS, `lens full suite (${lensNodeVersion})`, lensNode, [vitest, 'run', '--reporter=dot'], { cwd: lensRepo, env: lensEnv, summarize: summarizeVitest });
run(BOUNDARY.LENS, 'lens real-contract provenance tests', lensNode,
  [vitest, 'run', 'src/data/remediation-real-contract.test.ts', 'src/data/remediation-summary.test.ts', 'src/data/parse.test.ts', '--reporter=dot'],
  { cwd: lensRepo, env: lensEnv, summarize: summarizeVitest });
run(BOUNDARY.LENS, 'lens guard mutations', lensNode, [join(lensRepo, 'scripts/check-guard-mutations.mjs')], { cwd: lensRepo, env: lensEnv });

// =================================================================================================
// global-runtime — an observation. Read, never written, never a candidate result.
// =================================================================================================
const globalCli = join(homedir(), '.agents/kyro/current/dist/cli.js');
let globalNote;
if (!existsSync(globalCli)) {
  globalNote = 'no global Kyro runtime installed';
} else {
  const probe = mkdtempSync(join(tmpdir(), 'kyro-matrix-global-'));
  try {
    const version = spawnSync(node, [globalCli, '--version'], { cwd: probe, encoding: 'utf-8', env: { ...process.env, HOME: probe } }).stdout?.trim();
    const help = spawnSync(node, [globalCli, 'remediate', '--help'], { cwd: probe, encoding: 'utf-8', env: { ...process.env, HOME: probe } }).stdout ?? '';
    const canCanonicalize = /canonicalize-prepare/.test(help);
    globalNote = `${version} — ${canCanonicalize ? 'has debt.canonicalize' : 'ORIGIN-ONLY, cannot repair a record-level legacy shape'}`;
    console.log(`· [${BOUNDARY.GLOBAL}] installed runtime: ${globalNote} (observation; not written, not the candidate)`);
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
}

// =================================================================================================
// Report.
// =================================================================================================
const failed = results.filter((entry) => !entry.ok);
const byBoundary = new Map();
for (const entry of results) {
  const bucket = byBoundary.get(entry.boundary) ?? { pass: 0, fail: 0 };
  bucket[entry.ok ? 'pass' : 'fail'] += 1;
  byBoundary.set(entry.boundary, bucket);
}

console.log('\n─── boundaries ───');
for (const [boundary, bucket] of byBoundary) {
  console.log(`  ${boundary.padEnd(15)} ${bucket.pass} passed${bucket.fail > 0 ? `, ${bucket.fail} FAILED` : ''}`);
}
console.log(`  ${BOUNDARY.GLOBAL.padEnd(15)} ${globalNote} (observation only)`);
if (originalScope === undefined) {
  console.log(`  ${'note'.padEnd(15)} original-scope probe not requested; pass --original-scope <path> to include it`);
}

if (failed.length > 0) {
  console.error('\n─── failures ───');
  for (const entry of failed) {
    console.error(`\n[${entry.boundary}] ${entry.label}\n${entry.output.trim().split('\n').slice(-25).join('\n')}`);
  }
  console.error(`\ncheck:release-matrix FAILED — ${failed.length} of ${results.length} steps, in boundaries: ${[...new Set(failed.map((e) => e.boundary))].join(', ')}`);
  process.exit(1);
}

console.log(`\ncheck:release-matrix — ${results.length}/${results.length} steps green for ${pkg.name}@${pkg.version}.`);
console.log('\nCertified LOCALLY: this working tree, the tarball it packs, that tarball installed into a');
console.log('temporary prefix, the faithful legacy incident, immutable-history hashes, Doctor,');
console.log('recertification, the documentation contract, and Kyro Lens as an independent verifier.');
console.log('\nNOT certified, and each requiring its own separately authorized gate:');
console.log('  · commit and version release        · npm publish / tags / GitHub release');
console.log('  · replacing ~/.agents/kyro/current  · remote CI');
console.log('  · repairing any original checkout   · closing this sprint');
