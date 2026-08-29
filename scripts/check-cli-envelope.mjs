#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(fileURLToPath(import.meta.url), '../..');
const cli = resolve(repo, 'dist/cli.js');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function run(args, cwd = repo) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    env: { ...process.env, HOME: join(cwd, '.home') },
    encoding: 'utf-8',
  });
}

function envelope(result, label) {
  assert(result.stderr === '', label + ' must emit nothing on stderr: ' + result.stderr);
  assert(result.stdout.trim().split(/\r?\n/).length === 1, label + ' must emit exactly one stdout document');
  return JSON.parse(result.stdout);
}

for (const args of [['--json', 'capabilities'], ['capabilities', '--json']]) {
  const result = run(args);
  const parsed = envelope(result, args.join(' '));
  assert(result.status === 0 && parsed.schemaVersion === 1 && parsed.ok === true && parsed.command === 'capabilities', 'capabilities envelope mismatch');
}

{
  const result = run(['--json', 'not-a-command']);
  const parsed = envelope(result, 'unknown command');
  assert(result.status === 1 && parsed.ok === false && parsed.error.code === 'UNKNOWN_COMMAND', 'unknown command must be a nonzero error envelope');
}

{
  const result = run(['status', '--kyro-scope', 'missing-scope', '--json']);
  const parsed = envelope(result, 'domain error');
  assert(result.status === 1 && parsed.ok === false && parsed.error.code === 'SCOPE_NOT_FOUND', 'domain failure must retain its code');
}

{
  const result = run(['--json', 'capabilities', '--help']);
  assert(result.status === 0 && result.stdout.startsWith('Usage: kyro capabilities'), '--help must remain textual');
  assert(!result.stdout.includes('"schemaVersion":1'), '--help must not be enveloped');
}

const root = mkdtempSync(join(tmpdir(), 'kyro-envelope-'));
try {
  mkdirSync(join(root, '.home'), { recursive: true });
  cpSync(resolve(repo, 'fixtures/evals/route-review-task/state'), root, { recursive: true });
  writeFileSync(
    join(root, '.agents/kyro/policy.json'),
    JSON.stringify({ policyVersion: 1, operations: { review_task: { level: 'confirm' } }, allow: [], maker_checker: { requireSeparateChecker: false } }, null, 2) + '\n',
  );
  const preview = run(['review', 'T1.1', '--kyro-scope', 'demo', '--verdict', 'fail', '--dry-run', '--json'], root);
  const previewEnvelope = envelope(preview, 'review preview');
  assert(previewEnvelope.phase === 'preview' && previewEnvelope.data.outcome === 'preview' && previewEnvelope.data.requiresConfirmation === true, 'preview must expose confirmation state: ' + preview.stdout);

  const confirmation = run(['review', 'T1.1', '--kyro-scope', 'demo', '--verdict', 'fail', '--json'], root);
  const confirmationEnvelope = envelope(confirmation, 'confirmation required');
  assert(confirmation.status === 1 && confirmationEnvelope.error.code === 'CONFIRMATION_REQUIRED', 'confirmation refusal must be a nonzero error envelope');
  assert(confirmationEnvelope.error.details?.requiresConfirmation === true, 'confirmation error must be machine-actionable');
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('check:cli-envelope — success, preview, confirmation, domain, unknown and help contracts passed');
