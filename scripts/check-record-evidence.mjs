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

function addDebtAndReplacement(root) {
  const sprint = readSprint(root);
  sprint.debt.push({
    id: 'debt-1',
    title: 'Deferred demo work',
    origin: 1,
    priority: 'medium',
    status: 'open',
    targetSprint: 2,
    note: 'Carry forward.',
  });
  sprint.activeSprint.phases[0].tasks.push({
    id: 'T1.2',
    title: 'Replacement demo',
    description: 'Replacement work.',
    files_to_touch: [],
    context: 'ctx',
    acceptance_criteria: ['Replacement exists.'],
    depends_on: [],
    status: 'pending',
    evidence: null,
    verdict: null,
  });
  writeFileSync(sprintPath(root), `${JSON.stringify(sprint, null, 2)}\n`);
}

// 11) --disposition deferred with an existing debt is not done/pass and does not route to review_task.
{
  const root = sandbox();
  try {
    addDebtAndReplacement(root);
    const rec = run([
      'record-evidence', 'T1.1', '--kyro-scope', 'demo',
      '--summary', 'Deferring remaining work.',
      '--validation', 'user decision to defer',
      '--disposition', 'deferred',
      '--reason', 'Blocked on an upstream API; carry to debt-1.',
      '--target', 'debt:debt-1',
    ], root);
    assert(rec.status === 0, `deferred disposition should succeed: ${rec.stdout}${rec.stderr}`);
    const task = readSprint(root).activeSprint.phases[0].tasks[0];
    assert(task.status !== 'done', `deferred work must not be done, got ${task.status}`);
    assert(task.verdict == null, 'disposition must not write a verdict');
    assert(task.disposition && task.disposition.kind === 'deferred', 'disposition.kind should be deferred');
    assert(task.disposition.reason.includes('upstream API'), 'disposition.reason should be stored');
    assert(task.disposition.target && task.disposition.target.kind === 'debt' && task.disposition.target.id === 'debt-1', 'deferred target should be debt-1');
    const handoff = readSprint(root).handoff;
    assert(handoff.nextAction === 'execute_task', `deferred must not route to review_task, got ${handoff.nextAction}`);
    assert(handoff.nextTaskId === 'T1.2', `next executable should be T1.2, got ${handoff.nextTaskId}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// 12) Invalid/missing dispositions fail without writes.
{
  const root = sandbox();
  try {
    addDebtAndReplacement(root);
    const before = readFileSync(sprintPath(root), 'utf-8');

    const noReason = run([
      'record-evidence', 'T1.1', '--kyro-scope', 'demo',
      '--summary', 'x', '--validation', 'tsc',
      '--disposition', 'cancelled',
    ], root);
    assert(noReason.status === 1 && (noReason.stderr + noReason.stdout).includes('--reason'), 'missing --reason should fail');

    const unknownKind = run([
      'record-evidence', 'T1.1', '--kyro-scope', 'demo',
      '--summary', 'x', '--validation', 'tsc',
      '--disposition', 'skipped', '--reason', 'nope',
    ], root);
    assert(unknownKind.status === 1 && (unknownKind.stderr + unknownKind.stdout).includes('--disposition'), 'unknown kind should fail');

    const missingDebt = run([
      'record-evidence', 'T1.1', '--kyro-scope', 'demo',
      '--summary', 'x', '--validation', 'tsc',
      '--disposition', 'deferred', '--reason', 'later',
      '--target', 'debt:debt-99',
    ], root);
    assert(missingDebt.status === 1 && (missingDebt.stderr + missingDebt.stdout).includes('DEBT_NOT_FOUND'), 'unknown debt target should fail');

    const missingTask = run([
      'record-evidence', 'T1.1', '--kyro-scope', 'demo',
      '--summary', 'x', '--validation', 'tsc',
      '--disposition', 'superseded', '--reason', 'replaced',
      '--target', 'task:T9.9',
    ], root);
    assert(missingTask.status === 1 && (missingTask.stderr + missingTask.stdout).includes('TASK_NOT_FOUND'), 'unknown task target should fail');

    const doneCombo = run([
      'record-evidence', 'T1.1', '--kyro-scope', 'demo',
      '--summary', 'x', '--validation', 'tsc',
      '--disposition', 'cancelled', '--reason', 'skip',
      '--status', 'done',
    ], root);
    assert(doneCombo.status === 1 && (doneCombo.stderr + doneCombo.stdout).includes('--status done'), 'done+disposition should fail');

    const noTarget = run([
      'record-evidence', 'T1.1', '--kyro-scope', 'demo',
      '--summary', 'x', '--validation', 'tsc',
      '--disposition', 'deferred', '--reason', 'later',
    ], root);
    assert(noTarget.status === 1 && (noTarget.stderr + noTarget.stdout).includes('--target'), 'deferred without target should fail');

    assert(readFileSync(sprintPath(root), 'utf-8') === before, 'rejected disposition calls must not write sprint.json');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// 13) cancelled and superseded write a non-success terminal record; blocked disposition sets status blocked.
{
  const root = sandbox();
  try {
    addDebtAndReplacement(root);
    const cancelled = run([
      'record-evidence', 'T1.1', '--kyro-scope', 'demo',
      '--summary', 'Dropping the original approach.',
      '--validation', 'user cancelled',
      '--disposition', 'cancelled',
      '--reason', 'Product dropped this slice.',
    ], root);
    assert(cancelled.status === 0, `cancelled should succeed: ${cancelled.stdout}${cancelled.stderr}`);
    const cancelledTask = readSprint(root).activeSprint.phases[0].tasks[0];
    assert(cancelledTask.status !== 'done', 'cancelled must not be done');
    assert(cancelledTask.disposition.kind === 'cancelled', 'kind should be cancelled');
    assert(!('target' in cancelledTask.disposition), 'cancelled without --target omits target');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = sandbox();
  try {
    addDebtAndReplacement(root);
    const superseded = run([
      'record-evidence', 'T1.1', '--kyro-scope', 'demo',
      '--summary', 'Replaced by T1.2.',
      '--validation', 'user replaced',
      '--disposition', 'superseded',
      '--reason', 'T1.2 is the surviving approach.',
      '--target', 'task:T1.2',
    ], root);
    assert(superseded.status === 0, `superseded should succeed: ${superseded.stdout}${superseded.stderr}`);
    const task = readSprint(root).activeSprint.phases[0].tasks[0];
    assert(task.disposition.kind === 'superseded' && task.disposition.target.id === 'T1.2', 'superseded target should be T1.2');
    assert(task.status !== 'done', 'superseded must not be done');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = sandbox();
  try {
    const rec = run([
      'record-evidence', 'T1.1', '--kyro-scope', 'demo',
      '--summary', 'Still blocked on access.',
      '--validation', 'three failed rounds',
      '--disposition', 'blocked',
      '--reason', 'Cannot proceed without staging credentials.',
    ], root);
    assert(rec.status === 0, `blocked disposition should succeed: ${rec.stdout}${rec.stderr}`);
    const task = readSprint(root).activeSprint.phases[0].tasks[0];
    assert(task.status === 'blocked', `blocked disposition should set status blocked, got ${task.status}`);
    assert(task.disposition.kind === 'blocked', 'kind should be blocked');
    assert(readSprint(root).handoff.nextAction === 'execute_task', 'blocked disposition must not route to review_task');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

console.log('check:record-evidence — tool-owned evidence write verified end-to-end');
