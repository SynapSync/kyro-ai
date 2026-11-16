#!/usr/bin/env node
// Guards what the npm tarball contains (roadmap Phase 3, F-5/F-6).
//
// Reads `npm pack --dry-run --json` (npm 10 array and npm 12 keyed-object shapes) and asserts:
//   1. size budgets (packed and unpacked) so the package cannot silently grow back to 10 MB;
//   2. development-only trees stay out (docs/diagrams, scripts, non-eval fixtures, source maps,
//      retired hooks/providers directories);
//   3. every path an installed package reads at runtime is present (see REQUIRED below and the
//      evidence in src/cli/constants.ts PACKAGE_ROOT users, install-plan.ts, eval/discovery.ts,
//      commands/token-audit.ts);
//   4. every runtime file of the repository's build (dist/**/*.js, *.d.ts) is packed;
//   5. no packed file contains an absolute home path (/home/, /Users/, C:\Users);
//   6. relative Markdown links inside the packed README and docs point at packed files.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseNpmPackJson } from './lib/npm-pack-json.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Budgets. Measured at introduction: packed 0.68 MB, unpacked 2.67 MB, 475 files.
// Roughly 45 percent headroom; the roadmap target is "under 2 MB packed".
const MAX_PACKED_BYTES = 1_000_000;
const MAX_UNPACKED_BYTES = 4_000_000;

// Prefixes that must never be published.
const FORBIDDEN_PREFIXES = [
  ['docs/diagrams/', 'visual-check screenshots and 800 kB HTML renders; repository-only'],
  ['docs/plans/', 'development plans (only the ADR linked from shipped docs is allowed, see ALLOWED_EXACT)'],
  ['scripts/', 'check scripts serve development of this repository; no kyro verb runs them'],
  ['fixtures/checkpoints/', 'fixtures used only by check scripts'],
  ['fixtures/context-pack/', 'fixtures used only by check scripts'],
  ['fixtures/debt-contract/', 'fixtures used only by check scripts'],
  ['fixtures/integrity-repair/', 'fixtures used only by check scripts'],
  ['fixtures/mcp/', 'fixtures used only by check scripts'],
  ['fixtures/trace/', 'fixtures used only by check scripts'],
  ['hooks/', 'retired Claude plugin asset'],
  ['providers/', 'retired Claude plugin asset'],
  ['.claude-plugin/', 'retired Claude plugin asset'],
  ['.agents/', 'repository workflow state'],
];
const ALLOWED_EXACT = new Set(['docs/plans/adr-adaptive-sprint-lifecycle.md']);

// Absolute home paths that are legitimate documentation examples. Empty on purpose: a match is a
// leak until someone adds a reviewed `path` + `reason` entry here.
const HOME_PATH_ALLOWLIST = [
  // { path: 'docs/example.md', reason: 'illustrates a Linux home directory' },
];
const HOME_PATH = /\/home\/|\/Users\/|[A-Za-z]:\\+Users\\|[A-Za-z]:\/Users\//;

// Evidence for each requirement lives in the file named after the path.
const REQUIRED = [
  'package.json', // readPackageVersion, update.ts, projected into the runtime
  'config.json', // loadBudgetManifest, projected into the runtime
  'WORKFLOW.yaml', // doctor version check, projected into the runtime
  'README.md',
  'dist/cli.js', // bin, eval runner spawns it
  'dist/index.js', // package.json main
  'dist/index.d.ts', // package.json types
  'agents/orchestrator.md', // install-plan copies agents/; detectPackageRootMode marker
  'commands/forge.md', // install-plan copies commands/
  'internal/skills/sprint-forge/SKILL.md', // install-plan copies internal/skills
  'internal/skills/sprint-forge/assets/fixtures/subcommands-and-reports.sizingDecision.json', // token-audit
];

function assert(condition, message) {
  if (!condition) throw new Error(`check-package-contents: ${message}`);
}

function listFiles(dir, base = dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, base));
    else out.push(full.slice(base.length + 1).split('\\').join('/'));
  }
  return out;
}

function main() {
  const pack = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: repo,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  assert(pack.status === 0, `npm pack --dry-run failed: ${pack.stderr || pack.stdout}`);
  const record = parseNpmPackJson(pack.stdout);
  const packed = new Set(record.files.map((file) => file.path));
  const failures = [];

  // 1. Budgets.
  if (record.size > MAX_PACKED_BYTES) failures.push(`packed size ${record.size} bytes exceeds budget ${MAX_PACKED_BYTES}`);
  if (record.unpackedSize > MAX_UNPACKED_BYTES) failures.push(`unpacked size ${record.unpackedSize} bytes exceeds budget ${MAX_UNPACKED_BYTES}`);

  // 2. Forbidden content.
  const forbiddenByReason = new Map();
  const maps = [];
  for (const path of packed) {
    if (ALLOWED_EXACT.has(path)) continue;
    for (const [prefix, why] of FORBIDDEN_PREFIXES) {
      if (path.startsWith(prefix)) forbiddenByReason.set(`${prefix} (${why})`, [...(forbiddenByReason.get(`${prefix} (${why})`) ?? []), path]);
    }
    if (/\.map$/.test(path)) maps.push(path);
  }
  for (const [reason, paths] of forbiddenByReason) failures.push(`tarball must not contain ${paths.length} file(s) under ${reason}, e.g. ${paths[0]}`);
  if (maps.length > 0) failures.push(`tarball must not contain ${maps.length} source map file(s), e.g. ${maps[0]} (maps point at src/, which is not published)`);

  // 3. Runtime requirements.
  const manifest = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));
  const required = [...REQUIRED];
  for (const skill of manifest.skills ?? []) required.push(`${skill.replace(/^\.\//, '')}/SKILL.md`);
  for (const path of required) if (!packed.has(path)) failures.push(`tarball is missing runtime file ${path}`);
  const evalFixtures = [...packed].filter((path) => path.startsWith('fixtures/evals/'));
  const sourceEvals = existsSync(join(repo, 'fixtures/evals')) ? listFiles(join(repo, 'fixtures/evals')).length : 0;
  if (evalFixtures.length === 0 || evalFixtures.length !== sourceEvals) failures.push(`fixtures/evals must be packed completely (${evalFixtures.length} of ${sourceEvals} files)`);

  // 4. The whole build output (minus maps) ships; a stale or partial dist is a packaging bug.
  if (existsSync(join(repo, 'dist'))) {
    for (const relative of listFiles(join(repo, 'dist'))) {
      if (relative.endsWith('.map')) continue;
      if (!packed.has(`dist/${relative}`)) failures.push(`tarball is missing built file dist/${relative}`);
    }
  }

  // 5. Absolute home paths in anything published (package.json included).
  for (const path of packed) {
    const full = join(repo, path);
    if (!existsSync(full) || !statSync(full).isFile()) continue;
    const text = readFileSync(full, 'utf8');
    const match = HOME_PATH.exec(text);
    if (!match) continue;
    if (HOME_PATH_ALLOWLIST.some((entry) => entry.path === path)) continue;
    const line = text.slice(0, match.index).split('\n').length;
    failures.push(`${path}:${line} contains an absolute home path (${text.slice(match.index, match.index + 40).split('\n')[0]})`);
  }

  // 6. Links between shipped documents.
  const linkRe = /\[[^\]]*\]\(([^)\s]+)\)/g;
  for (const path of packed) {
    if (!(path === 'README.md' || (path.startsWith('docs/') && path.endsWith('.md')))) continue;
    const text = readFileSync(join(repo, path), 'utf8');
    for (const match of text.matchAll(linkRe)) {
      const target = match[1].split('#')[0];
      if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
      const resolved = posix.normalize(posix.join(posix.dirname(path), target));
      if (!existsSync(join(repo, resolved))) continue; // check:links reports missing targets
      if (statSync(join(repo, resolved)).isDirectory()) continue;
      if (!packed.has(resolved) && resolved !== 'LICENSE') failures.push(`${path} links to ${resolved}, which is not in the tarball`);
    }
  }

  assert(failures.length === 0, `\n  - ${failures.join('\n  - ')}`);
  console.log(`check:package-contents — ${record.files.length} files, ${(record.size / 1024).toFixed(0)} kB packed (budget ${(MAX_PACKED_BYTES / 1024).toFixed(0)} kB), ${(record.unpackedSize / 1024).toFixed(0)} kB unpacked (budget ${(MAX_UNPACKED_BYTES / 1024).toFixed(0)} kB); no diagrams, scripts, maps or home paths; runtime files present`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
