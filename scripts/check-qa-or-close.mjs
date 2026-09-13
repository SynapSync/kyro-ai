#!/usr/bin/env node
import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = resolve(fileURLToPath(import.meta.url), '../..');
const cli = resolve(repo, 'dist/cli.js');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function run(root, args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    env: { ...process.env, HOME: join(root, '.home') },
    encoding: 'utf-8',
  });
}

function output(result) {
  return `${result.stdout}${result.stderr}`;
}

function parseJson(result, label) {
  assert(result.status === 0, `${label} should succeed: ${output(result)}`);
  return JSON.parse(result.stdout).data;
}

const mode = readFileSync(resolve(repo, 'internal/skills/sprint-forge/assets/modes/qa-or-close.md'), 'utf-8');
for (const marker of [
  'kyro qa <scope>',
  'APPROVED',
  'APPROVED WITH NOTES',
  'CHANGES REQUIRED',
  'REJECTED',
  'qaRemediationPending',
  'Close without QA',
]) {
  assert(mode.includes(marker), `qa-or-close mode should contain ${marker}`);
}
assert(mode.includes('not a shell verb'), 'mode should explicitly prevent treating kyro qa as a CLI subcommand');

const qaCommand = readFileSync(resolve(repo, 'commands/qa.md'), 'utf-8');
assert(qaCommand.includes('read-only'), 'existing QA command must remain read-only');
assert(qaCommand.includes('independent of the forge cycle'), 'existing QA command must remain independently invocable');

const root = join(tmpdir(), `kyro-qa-or-close-${Date.now()}-${Math.random().toString(16).slice(2)}`);
mkdirSync(join(root, '.home'), { recursive: true });
cpSync(resolve(repo, 'fixtures/evals/route-review-task/state'), root, { recursive: true });
try {
  const evidence = run(root, ['record-evidence', 'T1.1', '--kyro-scope', 'demo', '--summary', 'Implemented demo.', '--validation', 'npm test']);
  assert(evidence.status === 0, `record-evidence should succeed: ${output(evidence)}`);
  const review = run(root, ['review', 'T1.1', '--kyro-scope', 'demo', '--verdict', 'pass']);
  assert(review.status === 0, `review should succeed: ${output(review)}`);

  const ready = parseJson(run(root, ['context-pack', '--kyro-scope', 'demo', '--json']), 'qa-or-close context pack');
  assert(ready.nextAction === 'qa_or_close', `final task pass should route to qa_or_close, got ${ready.nextAction}`);
  assert(ready.budgetClass === 'close', `qa_or_close should use close budget, got ${ready.budgetClass}`);
  assert(ready.routing.modes.includes('qa-or-close.md'), 'qa_or_close should load qa-or-close.md');
  assert(!ready.cliRecipes.some((recipe) => recipe.id === 'close-sprint'), 'qa_or_close must not advertise close-sprint as the only next recipe');

  const emergent = run(root, [
    'add-emergent', '--kyro-scope', 'demo',
    '--title', 'Fix QA finding',
    '--description', 'Correct a blocking finding reported by kyro qa.',
    '--acceptance', 'The QA finding no longer reproduces.',
    '--context', 'Required by kyro qa.',
  ]);
  assert(emergent.status === 0, `QA remediation emergent task should be added: ${output(emergent)}`);
  const remediation = parseJson(run(root, ['context-pack', '--kyro-scope', 'demo', '--json']), 'QA remediation context pack');
  assert(remediation.nextAction === 'execute_task', `QA remediation should route to execute_task, got ${remediation.nextAction}`);
  assert(remediation.nextTaskId === 'E1', `QA remediation should select E1, got ${remediation.nextTaskId}`);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('check:qa-or-close — optional QA routing and remediation handoff verified');
