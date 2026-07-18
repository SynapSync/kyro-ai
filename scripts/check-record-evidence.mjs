#!/usr/bin/env node
// Verifies `kyro record-evidence`: it writes task.evidence + status through the tool (no hand-edit of
// the fat sprint.json), routes the handoff to review_task, and — critically — produces evidence the
// deterministic checker accepts, so `kyro review --verdict pass` succeeds without --yes afterwards.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(fileURLToPath(import.meta.url), '../..');
const cli = resolve(repo, 'dist/cli.js');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sandbox() {
  const root = join(tmpdir(), `kyro-record-evidence-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(join(root, '.home'), { recursive: true });
  cpSync(resolve(repo, 'fixtures/evals/route-review-task/state'), root, { recursive: true });
  return root;
}

function sprintPath(root) {
  return join(root, '.agents/kyro/scopes/demo/sprint.json');
}

function readSprint(root) {
  return JSON.parse(readFileSync(sprintPath(root), 'utf-8'));
}

function run(args, root) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    env: { ...process.env, HOME: join(root, '.home') },
    encoding: 'utf-8',
  });
}

// 1) Happy path: record-evidence writes valid evidence, sets status done, routes to review_task,
//    and the checker then accepts a pass with NO --yes (the whole point of O3).
{
  const root = sandbox();
  try {
    const taskId = readSprint(root).activeSprint.phases[0].tasks[0].id;
    const rec = run(['record-evidence', taskId, '--kyro-scope', 'demo', '--summary', 'Implemented the demo task.', '--validation', 'npm test -- demo', '--file', 'src/demo.ts'], root);
    assert(rec.status === 0, `record-evidence should succeed: ${rec.stdout}${rec.stderr}`);

    const task = readSprint(root).activeSprint.phases[0].tasks[0];
    assert(task.status === 'done', `status should be done, got ${task.status}`);
    assert(task.evidence && task.evidence.by === 'maker', 'evidence.by should default to maker');
    assert(task.evidence.validation === 'npm test -- demo', 'single --validation should store as a string');
    assert(Array.isArray(task.evidence.files_changed) && task.evidence.files_changed[0] === 'src/demo.ts', 'files_changed should carry --file');
    assert(task.verdict == null, 'record-evidence must NOT write a verdict (checker owns it)');

    const handoff = readSprint(root).handoff;
    assert(handoff.nextAction === 'review_task' && handoff.nextTaskId === taskId, 'handoff should route to review_task for this task');

    const review = run(['review', taskId, '--kyro-scope', 'demo', '--verdict', 'pass'], root);
    assert(review.status === 0, `checker must accept tool-written evidence without --yes: ${review.stdout}${review.stderr}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// 2) Multiple --validation lines are stored as an array (still schema-valid).
{
  const root = sandbox();
  try {
    const taskId = readSprint(root).activeSprint.phases[0].tasks[0].id;
    const rec = run(['record-evidence', taskId, '--kyro-scope', 'demo', '--summary', 'Did it.', '--validation', 'tsc', '--validation', 'npm test -- demo'], root);
    assert(rec.status === 0, `multi-validation should succeed: ${rec.stdout}${rec.stderr}`);
    const ev = readSprint(root).activeSprint.phases[0].tasks[0].evidence;
    assert(Array.isArray(ev.validation) && ev.validation.length === 2, 'two --validation flags should store an array');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// 3) Required-field and lookup guards.
{
  const root = sandbox();
  try {
    const taskId = readSprint(root).activeSprint.phases[0].tasks[0].id;
    const before = readFileSync(sprintPath(root), 'utf-8');

    const noSummary = run(['record-evidence', taskId, '--kyro-scope', 'demo', '--validation', 'tsc'], root);
    assert(noSummary.status === 1 && (noSummary.stderr + noSummary.stdout).includes('--summary'), 'missing --summary should fail');

    const noValidation = run(['record-evidence', taskId, '--kyro-scope', 'demo', '--summary', 'x'], root);
    assert(noValidation.status === 1 && (noValidation.stderr + noValidation.stdout).includes('--validation'), 'missing --validation should fail');

    const badTask = run(['record-evidence', 'T9.9', '--kyro-scope', 'demo', '--summary', 'x', '--validation', 'tsc'], root);
    assert(badTask.status === 1 && (badTask.stderr + badTask.stdout).includes('TASK_NOT_FOUND'), 'unknown task should fail TASK_NOT_FOUND');

    assert(readFileSync(sprintPath(root), 'utf-8') === before, 'rejected record-evidence calls must not write sprint.json');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

console.log('check:record-evidence — tool-owned evidence write verified end-to-end');
