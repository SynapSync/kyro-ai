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

{
  const result = run(['work', '--help', '--json']);
  assert(result.status === 0, result.stderr);
  assert(/work record-evidence[^\n]* --by <maker> \[--dry-run\]/.test(result.stdout), 'evidence help must require maker identity');
  assert(/work review[^\n]* --by <checker> \[--dry-run\]/.test(result.stdout), 'review help must require checker identity');
  assert(/work create[^\n]* \[--by <actor>\]/.test(result.stdout), 'create help must keep actor optional');
  assert(result.stdout.includes('Validation results are maker-reported'), 'help must disclose reported validation');
  assert(result.stdout.includes('different checker'), 'help must disclose checker separation');
  assert(!result.stdout.includes('"schemaVersion":1'), 'Work help must remain textual');
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

const workRoot = mkdtempSync(join(tmpdir(), 'kyro-work-envelope-'));
try {
  mkdirSync(join(workRoot, '.home'), { recursive: true });
  writeFileSync(join(workRoot, 'brief.md'), '# Envelope Work\n\nCheck read-only Work command phases and durable create publication.\n');
  const create = run(['work', 'create', '--id', 'envelope-work', '--from', 'brief.md', '--json'], workRoot);
  const createEnvelope = envelope(create, 'Work create');
  assert(create.status === 0 && createEnvelope.ok && createEnvelope.command === 'work create' && createEnvelope.phase === 'applied', 'Work create must be applied');
  const workHelp = run(['work', '--help'], workRoot);
  assert(workHelp.status === 0, 'Work help must be available');
  for (const verb of ['amend-task', 'amend-brief', 'dispose', 'close', 'reopen', 'promote', 'context-pack']) {
    assert(workHelp.stdout.includes(`kyro work ${verb}`), `Work help must document ${verb}`);
  }
  assert(workHelp.stdout.includes('--expect-revision') && workHelp.stdout.includes('--by <checker>'), 'Work help must document revision and actor gates');

  const dryRun = run(['work', 'create', '--id', 'preview-work', '--from', 'brief.md', '--dry-run', '--json'], workRoot);
  const dryRunEnvelope = envelope(dryRun, 'Work create dry-run');
  assert(dryRun.status === 0 && dryRunEnvelope.phase === 'preview', 'Work create dry-run must be preview');

  for (const verb of ['status', 'context-pack']) {
    const result = run(['work', verb, '--work', 'envelope-work', '--json'], workRoot);
    const parsed = envelope(result, `Work ${verb}`);
    assert(result.status === 0 && parsed.ok && parsed.command === `work ${verb}` && parsed.phase === 'result', `Work ${verb} must be a read-only result`);
  }
  writeFileSync(join(workRoot, 'plan.json'), JSON.stringify({ tasks: [{ id: 'W1', title: 'Envelope task', description: 'Exercise applied Work phases.', context: '', filesToTouch: [], acceptanceCriteria: ['Phases are truthful.'], dependsOn: [] }] }));
  const plan = run(['work', 'plan', '--work', 'envelope-work', '--from', 'plan.json', '--expect-revision', '1', '--json'], workRoot);
  assert(plan.status === 0 && envelope(plan, 'Work plan').phase === 'applied', 'Work plan must be applied');
  const dispose = run(['work', 'dispose', '--work', 'envelope-work', '--task', 'W1', '--kind', 'cancelled', '--reason', 'Fixture disposition.', '--by', 'fixture-owner', '--expect-revision', '2', '--json'], workRoot);
  assert(dispose.status === 0 && envelope(dispose, 'Work dispose').phase === 'applied', 'Work dispose must be applied');
  const closePreview = run(['work', 'close', '--work', 'envelope-work', '--outcome', 'completed', '--reason', 'Fixture close.', '--by', 'fixture-owner', '--expect-revision', '3', '--dry-run', '--json'], workRoot);
  assert(closePreview.status === 0 && envelope(closePreview, 'Work close preview').phase === 'preview', 'Work close dry-run must be preview');
  const close = run(['work', 'close', '--work', 'envelope-work', '--outcome', 'completed', '--reason', 'Fixture close.', '--by', 'fixture-owner', '--expect-revision', '3', '--yes', '--json'], workRoot);
  assert(close.status === 0 && envelope(close, 'Work close').phase === 'applied', 'Work close must be applied');
  const reopen = run(['work', 'reopen', '--work', 'envelope-work', '--reason', 'Fixture reopen.', '--by', 'fixture-owner', '--expect-revision', '4', '--yes', '--json'], workRoot);
  assert(reopen.status === 0 && envelope(reopen, 'Work reopen').phase === 'applied', 'Work reopen must be applied');
  writeFileSync(join(workRoot, 'brief-promote.md'), '# Envelope promotion\n\nPromote one pending task through the envelope phases.\n');
  const promoteCreate = run(['work', 'create', '--id', 'promote-envelope-work', '--from', 'brief-promote.md', '--json'], workRoot);
  assert(promoteCreate.status === 0, promoteCreate.stderr || promoteCreate.stdout);
  writeFileSync(join(workRoot, 'promote-plan.json'), JSON.stringify({ tasks: [{ id: 'W1', title: 'Envelope promotion task', description: 'Exercise promote phases.', context: '', filesToTouch: [], acceptanceCriteria: ['Phases are truthful.'], dependsOn: [] }] }));
  const promotePlan = run(['work', 'plan', '--work', 'promote-envelope-work', '--from', 'promote-plan.json', '--expect-revision', '1', '--json'], workRoot);
  assert(promotePlan.status === 0, promotePlan.stderr || promotePlan.stdout);
  const promotePreview = run(['work', 'promote', '--work', 'promote-envelope-work', '--to-scope', 'envelope-target', '--expect-revision', '2', '--by', 'fixture-owner', '--dry-run', '--json'], workRoot);
  const promotePreviewEnvelope = envelope(promotePreview, 'Work promote preview');
  assert(promotePreview.status === 0 && promotePreviewEnvelope.ok && promotePreviewEnvelope.command === 'work promote' && promotePreviewEnvelope.phase === 'preview', 'Work promote dry-run must be preview');
  const promoteApply = run(['work', 'promote', '--work', 'promote-envelope-work', '--to-scope', 'envelope-target', '--expect-revision', '2', '--by', 'fixture-owner', '--yes', '--json'], workRoot);
  const promoteApplyEnvelope = envelope(promoteApply, 'Work promote');
  assert(promoteApply.status === 0 && promoteApplyEnvelope.ok && promoteApplyEnvelope.command === 'work promote' && promoteApplyEnvelope.phase === 'applied', 'Work promote must be applied');
} finally {
  rmSync(workRoot, { recursive: true, force: true });
}

console.log('check:cli-envelope — success, preview, confirmation, domain, unknown, help, and Work phase contracts passed');
