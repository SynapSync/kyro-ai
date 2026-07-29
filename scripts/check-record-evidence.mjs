#!/usr/bin/env node
// Verifies `kyro record-evidence`: it writes task.evidence + status through the tool (no hand-edit of
// the fat sprint.json), routes the handoff to review_task, and — critically — produces evidence the
// deterministic checker accepts, so `kyro review --verdict pass` succeeds without --yes afterwards.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

// 4) --status blocked records evidence and marks the task blocked (still routes to review_task).
{
  const root = sandbox();
  try {
    const taskId = readSprint(root).activeSprint.phases[0].tasks[0].id;
    const rec = run(['record-evidence', taskId, '--kyro-scope', 'demo', '--summary', 'Stuck.', '--validation', 'tsc', '--status', 'blocked'], root);
    assert(rec.status === 0, `blocked record should succeed: ${rec.stdout}${rec.stderr}`);
    const task = readSprint(root).activeSprint.phases[0].tasks[0];
    assert(task.status === 'blocked', `status should be blocked, got ${task.status}`);
    assert(task.evidence && task.evidence.summary === 'Stuck.', 'evidence still recorded when blocked');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// 5) --dry-run previews without writing.
{
  const root = sandbox();
  try {
    const taskId = readSprint(root).activeSprint.phases[0].tasks[0].id;
    const before = readFileSync(sprintPath(root), 'utf-8');
    const rec = run(['record-evidence', taskId, '--kyro-scope', 'demo', '--summary', 'x', '--validation', 'tsc', '--dry-run'], root);
    assert(rec.status === 0, `dry-run should succeed: ${rec.stdout}${rec.stderr}`);
    assert(readFileSync(sprintPath(root), 'utf-8') === before, 'dry-run must not write sprint.json');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// 6) Re-recording overwrites the prior evidence (last write wins, still valid).
{
  const root = sandbox();
  try {
    const taskId = readSprint(root).activeSprint.phases[0].tasks[0].id;
    run(['record-evidence', taskId, '--kyro-scope', 'demo', '--summary', 'First.', '--validation', 'tsc'], root);
    const rec = run(['record-evidence', taskId, '--kyro-scope', 'demo', '--summary', 'Second.', '--validation', 'npm test -- demo', '--file', 'src/demo.ts'], root);
    assert(rec.status === 0, `re-record should succeed: ${rec.stdout}${rec.stderr}`);
    const ev = readSprint(root).activeSprint.phases[0].tasks[0].evidence;
    assert(ev.summary === 'Second.' && ev.validation === 'npm test -- demo', 're-record should overwrite prior evidence');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// 7) Emergent tasks are locatable and recordable too (not just phase tasks).
{
  const root = sandbox();
  try {
    const sprint = readSprint(root);
    sprint.activeSprint.emergentTasks.push({
      id: 'E1',
      title: 'Emergent task',
      description: 'Emergent work.',
      files_to_touch: [],
      context: 'ctx',
      acceptance_criteria: ['Done.'],
      status: 'pending',
      evidence: null,
      verdict: null,
    });
    writeFileSync(sprintPath(root), `${JSON.stringify(sprint, null, 2)}\n`);
    const rec = run(['record-evidence', 'E1', '--kyro-scope', 'demo', '--summary', 'Handled emergent.', '--validation', 'tsc'], root);
    assert(rec.status === 0, `emergent record should succeed: ${rec.stdout}${rec.stderr}`);
    const emergent = readSprint(root).activeSprint.emergentTasks.find((t) => t.id === 'E1');
    assert(emergent.status === 'done' && emergent.evidence.summary === 'Handled emergent.', 'emergent task evidence should be recorded');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// 8) Hand-forged evidence with a future recordedAt is refused by the checker (integrity guard):
//    record-evidence stamps its own clock, so a recordedAt beyond skew tolerance proves a hand-edit.
//    (Dynamic timestamps are why this lives here and not in a static fixtures/evals case.)
{
  const root = sandbox();
  try {
    const taskId = readSprint(root).activeSprint.phases[0].tasks[0].id;
    run(['record-evidence', taskId, '--kyro-scope', 'demo', '--summary', 'Real work.', '--validation', 'tsc'], root);

    const forged = readSprint(root);
    forged.activeSprint.phases[0].tasks[0].evidence.recordedAt = new Date(Date.now() + 3600_000).toISOString();
    writeFileSync(sprintPath(root), `${JSON.stringify(forged, null, 2)}\n`);

    const review = run(['review', taskId, '--kyro-scope', 'demo', '--verdict', 'pass', '--yes'], root);
    assert(review.status !== 0, 'checker must refuse pass on future-dated evidence');
    assert((review.stderr + review.stdout).includes('recordedAt is in the future'), `expected future-recordedAt finding: ${review.stdout}${review.stderr}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// 9) recordedAt within the skew tolerance (+60s) still passes — pins the 5-minute tolerance.
{
  const root = sandbox();
  try {
    const taskId = readSprint(root).activeSprint.phases[0].tasks[0].id;
    run(['record-evidence', taskId, '--kyro-scope', 'demo', '--summary', 'Real work.', '--validation', 'tsc'], root);

    const skewed = readSprint(root);
    skewed.activeSprint.phases[0].tasks[0].evidence.recordedAt = new Date(Date.now() + 60_000).toISOString();
    writeFileSync(sprintPath(root), `${JSON.stringify(skewed, null, 2)}\n`);

    const review = run(['review', taskId, '--kyro-scope', 'demo', '--verdict', 'pass'], root);
    assert(review.status === 0, `small clock skew must not block the checker: ${review.stdout}${review.stderr}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// 10) Unparsable recordedAt is refused (NaN previously slipped past both timestamp checks).
{
  const root = sandbox();
  try {
    const taskId = readSprint(root).activeSprint.phases[0].tasks[0].id;
    run(['record-evidence', taskId, '--kyro-scope', 'demo', '--summary', 'Real work.', '--validation', 'tsc'], root);

    const forged = readSprint(root);
    forged.activeSprint.phases[0].tasks[0].evidence.recordedAt = 'not-a-timestamp';
    writeFileSync(sprintPath(root), `${JSON.stringify(forged, null, 2)}\n`);

    const review = run(['review', taskId, '--kyro-scope', 'demo', '--verdict', 'pass', '--yes'], root);
    assert(review.status !== 0, 'checker must refuse pass on unparsable recordedAt');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

console.log('check:record-evidence — tool-owned evidence write verified end-to-end');
