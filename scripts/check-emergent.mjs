#!/usr/bin/env node
// Verifies `kyro add-emergent`: it appends a task to activeSprint.emergentTasks[] through the tool
// (no hand-edit of the fat sprint.json), assigns fresh sequential E<N> ids, enforces referential
// integrity on --depends-on, requires an active sprint, and produces a task that record-evidence and
// review then accept as a first-class lifecycle citizen (the whole point of this command).
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
  const root = join(tmpdir(), `kyro-emergent-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(join(root, '.home'), { recursive: true });
  cpSync(resolve(repo, 'fixtures/evals/route-review-task/state'), root, { recursive: true });
  return root;
}

function sprintPath(root, scope = 'demo') {
  return join(root, `.agents/kyro/scopes/${scope}/sprint.json`);
}

function readSprint(root, scope = 'demo') {
  return JSON.parse(readFileSync(sprintPath(root, scope), 'utf-8'));
}

function run(args, root) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    env: { ...process.env, HOME: join(root, '.home') },
    encoding: 'utf-8',
  });
}

// Bootstraps a scope in init mode (sprint.json exists, activeSprint: null) so the NO_ACTIVE_SPRINT
// case has a scope to point at.
function initOnlyScope(root, scope = 'no-sprint-scope') {
  const leanPath = join(root, 'lean-plan.json');
  writeFileSync(
    leanPath,
    JSON.stringify(
      {
        scope,
        title: 'No Sprint Scope',
        objective: 'Not planned yet.',
        successCriteria: ['Placeholder.'],
        roadmap: { plannedSprintCount: 1, sizingRationale: 'One sprint.', sprints: [{ n: 1, slug: 'foundation', title: 'Foundation' }] },
      },
      null,
      2,
    ),
  );
  const result = run(['plan', '--from', leanPath], root);
  assert(result.status === 0, `init-only bootstrap should succeed: ${result.stdout}${result.stderr}`);
}

// 1) Happy path: add-emergent lands E1 in emergentTasks[], schema-valid, and the full maker/checker
//    lifecycle (record-evidence -> review --verdict pass) accepts it like any other task.
{
  const root = sandbox();
  try {
    const before = readFileSync(sprintPath(root), 'utf-8');
    const add = run(['add-emergent', '--kyro-scope', 'demo', '--title', 'Add missing migration', '--description', 'The schema change needs a migration.', '--acceptance', 'Migration runs clean.'], root);
    assert(add.status === 0, `add-emergent should succeed: ${add.stdout}${add.stderr}`);
    assert(readFileSync(sprintPath(root), 'utf-8') !== before, 'add-emergent should write sprint.json');

    const sprint = readSprint(root);
    assert(sprint.activeSprint.emergentTasks.length === 1, `expected 1 emergent task, got ${sprint.activeSprint.emergentTasks.length}`);
    const task = sprint.activeSprint.emergentTasks[0];
    assert(task.id === 'E1', `expected E1, got ${task.id}`);
    assert(task.status === 'pending', `expected pending, got ${task.status}`);
    assert(task.evidence === null, 'evidence should be null');
    assert(task.verdict === null, 'verdict should be null');
    assert(task.title === 'Add missing migration', 'title should round-trip');
    assert(Array.isArray(task.acceptance_criteria) && task.acceptance_criteria[0] === 'Migration runs clean.', 'acceptance_criteria should round-trip');
    assert(Array.isArray(task.depends_on) && task.depends_on.length === 0, 'depends_on should default to []');
    assert(Array.isArray(task.files_to_touch) && task.files_to_touch.length === 0, 'files_to_touch should default to []');
    assert(task.context === '', 'context should default to empty string');

    const validate = run(['doctor', '--artifacts', '--kyro-scope', 'demo'], root);
    assert(validate.status === 0, `doctor --artifacts should pass after add-emergent: ${validate.stdout}${validate.stderr}`);

    const rec = run(['record-evidence', 'E1', '--kyro-scope', 'demo', '--summary', 'Added the migration.', '--validation', 'npm run migrate'], root);
    assert(rec.status === 0, `record-evidence on emergent task should succeed: ${rec.stdout}${rec.stderr}`);
    const review = run(['review', 'E1', '--kyro-scope', 'demo', '--verdict', 'pass'], root);
    assert(review.status === 0, `review on emergent task should accept a pass without --yes: ${review.stdout}${review.stderr}`);
    assert(readSprint(root).activeSprint.emergentTasks[0].verdict.result === 'pass', 'emergent task verdict should be pass');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// 2) Id sequencing: two adds get E1 then E2.
{
  const root = sandbox();
  try {
    run(['add-emergent', '--kyro-scope', 'demo', '--title', 'First', '--description', 'First emergent task.', '--acceptance', 'Done.'], root);
    const second = run(['add-emergent', '--kyro-scope', 'demo', '--title', 'Second', '--description', 'Second emergent task.', '--acceptance', 'Done.'], root);
    assert(second.status === 0, `second add-emergent should succeed: ${second.stdout}${second.stderr}`);
    const ids = readSprint(root).activeSprint.emergentTasks.map((t) => t.id);
    assert(ids.length === 2 && ids[0] === 'E1' && ids[1] === 'E2', `expected [E1, E2], got ${JSON.stringify(ids)}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// 3) Missing --acceptance -> exit 1, nothing written.
{
  const root = sandbox();
  try {
    const before = readFileSync(sprintPath(root), 'utf-8');
    const result = run(['add-emergent', '--kyro-scope', 'demo', '--title', 'No acceptance', '--description', 'Missing criteria.'], root);
    assert(result.status === 1, 'missing --acceptance should fail');
    assert((result.stderr + result.stdout).includes('--acceptance'), `error should mention --acceptance, got: ${result.stderr}${result.stdout}`);
    assert(readFileSync(sprintPath(root), 'utf-8') === before, 'rejected add-emergent must not write sprint.json');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// 4) No active sprint -> NO_ACTIVE_SPRINT, nothing written.
{
  const root = sandbox();
  try {
    initOnlyScope(root, 'no-sprint-scope');
    const before = readFileSync(sprintPath(root, 'no-sprint-scope'), 'utf-8');
    const result = run(['add-emergent', '--kyro-scope', 'no-sprint-scope', '--title', 'Too early', '--description', 'No sprint yet.', '--acceptance', 'Done.'], root);
    assert(result.status === 1, 'add-emergent with no active sprint should fail');
    assert((result.stderr + result.stdout).includes('NO_ACTIVE_SPRINT'), `error should be NO_ACTIVE_SPRINT, got: ${result.stderr}${result.stdout}`);
    assert(readFileSync(sprintPath(root, 'no-sprint-scope'), 'utf-8') === before, 'rejected add-emergent must not write sprint.json');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// 5) --depends-on a non-existent task id -> TASK_NOT_FOUND, nothing written; an existing phase task
//    id succeeds.
{
  const root = sandbox();
  try {
    const before = readFileSync(sprintPath(root), 'utf-8');
    const bad = run(['add-emergent', '--kyro-scope', 'demo', '--title', 'Bad dep', '--description', 'Depends on nothing real.', '--acceptance', 'Done.', '--depends-on', 'T9.9'], root);
    assert(bad.status === 1, 'unknown --depends-on should fail');
    assert((bad.stderr + bad.stdout).includes('TASK_NOT_FOUND'), `error should be TASK_NOT_FOUND, got: ${bad.stderr}${bad.stdout}`);
    assert(readFileSync(sprintPath(root), 'utf-8') === before, 'rejected add-emergent must not write sprint.json');

    const good = run(['add-emergent', '--kyro-scope', 'demo', '--title', 'Good dep', '--description', 'Depends on a real phase task.', '--acceptance', 'Done.', '--depends-on', 'T1.1'], root);
    assert(good.status === 0, `--depends-on an existing phase task should succeed: ${good.stdout}${good.stderr}`);
    const task = readSprint(root).activeSprint.emergentTasks[0];
    assert(Array.isArray(task.depends_on) && task.depends_on[0] === 'T1.1', 'depends_on should record the referenced task id');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// 6) --dry-run prints a plan and writes nothing.
{
  const root = sandbox();
  try {
    const before = readFileSync(sprintPath(root), 'utf-8');
    const dry = run(['add-emergent', '--kyro-scope', 'demo', '--title', 'Dry run item', '--description', 'Should not write.', '--acceptance', 'Done.', '--dry-run'], root);
    assert(dry.status === 0, `dry-run should succeed: ${dry.stdout}${dry.stderr}`);
    assert(dry.stdout.includes('write') || dry.stdout.toLowerCase().includes('plan'), `dry-run should print a plan, got: ${dry.stdout}`);
    assert(dry.stdout.includes('Dry run complete'), `dry-run should announce no write, got: ${dry.stdout}`);
    assert(readFileSync(sprintPath(root), 'utf-8') === before, 'dry-run must not write sprint.json');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

console.log('check:emergent — tool-owned emergent-task append verified end-to-end');
