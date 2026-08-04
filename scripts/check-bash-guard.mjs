#!/usr/bin/env node
// Verifies the PreToolUse Bash output guard: unbounded recursive searches are blocked
// (exit 2), while bounded/scoped searches, tests, and non-search commands pass (exit 0).
// The guard runs on every Bash call, so the ALLOW matrix is the important half — a false
// positive there would break legitimate work.
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(fileURLToPath(import.meta.url), '../..');
const hook = resolve(repo, 'hooks/guard-bash-output.mjs');

function decide(payload) {
  const res = spawnSync(process.execPath, [hook], { input: JSON.stringify(payload), encoding: 'utf-8' });
  if (res.status === 2) return 'block';
  if (res.status === 0) return 'allow';
  throw new Error(`unexpected exit ${res.status}: ${res.stderr}`);
}

function bash(command) {
  return { tool_name: 'Bash', tool_input: { command } };
}

const cases = [
  // Unbounded broad searches → block.
  ['block', bash('rg foo')],
  ['block', bash("rg 'foo bar'")],
  ['block', bash('grep -rn foo .')],
  ['block', bash('grep -R "thing" .')],
  ['block', bash('rg -A 3 foo')],
  ['block', bash('rg 123')],
  ['block', bash('rg -i TODO')],
  // Bounded by a cap → allow.
  ['allow', bash('rg foo -m 50')],
  ['allow', bash('rg -l foo')],
  ['allow', bash('rg -c foo')],
  ['allow', bash('grep -rl foo .')],
  ['allow', bash('rg --files-with-matches foo')],
  // Bounded by scope filter / path → allow.
  ['allow', bash('rg foo src/')],
  ['allow', bash('rg foo src/cli/review.ts')],
  ['allow', bash('grep -rn foo src/ --include=*.ts')],
  ['allow', bash('rg foo --glob "*.ts"')],
  ['allow', bash('rg -A 3 foo src/')],
  // Bounded by pipe / redirect → allow.
  ['allow', bash('rg foo | head -20')],
  ['allow', bash('rg foo | wc -l')],
  ['allow', bash('rg foo > /tmp/o.txt')],
  // Not a recursive content search → allow.
  ['allow', bash('npm test')],
  ['allow', bash('npm test -- demo')],
  ['allow', bash('git status')],
  ['allow', bash('cat x.txt | grep foo')],
  ['allow', bash('git grep foo')],
  // Non-Bash tools and malformed payloads → allow (fail open).
  ['allow', { tool_name: 'Read', tool_input: { file_path: '/x' } }],
  ['allow', { tool_name: 'Bash', tool_input: {} }],
  ['allow', {}],
];

const failures = [];
for (const [expected, payload] of cases) {
  const got = decide(payload);
  if (got !== expected) failures.push(`expected ${expected}, got ${got}: ${JSON.stringify(payload)}`);
}

if (failures.length > 0) {
  console.error(`check:bash-guard — ${failures.length} case(s) failed:\n${failures.join('\n')}`);
  process.exit(1);
}

console.log(`check:bash-guard — ${cases.length} Bash output-guard cases passed`);
