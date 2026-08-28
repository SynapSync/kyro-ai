#!/usr/bin/env node
// Verifies close-sprint's post-close handoff guidance: every non-retired scope stays routable
// to plan_sprint, including after its original roadmap is exhausted. Portable, deterministic
// half of the fresh-context nudge.
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
  const root = join(tmpdir(), `kyro-close-handoff-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(join(root, '.home'), { recursive: true });
  cpSync(resolve(repo, 'fixtures/evals/close-sprint-happy/state'), root, { recursive: true });
  return root;
}

function sprintPath(root) {
  return join(root, '.agents/kyro/scopes/demo/sprint.json');
}

function run(root, extra = []) {
  return spawnSync(process.execPath, [cli, 'close-sprint', '--kyro-scope', 'demo', '--outcome', 'shipped', '--yes', ...extra], {
    cwd: root,
    env: { ...process.env, HOME: join(root, '.home') },
    encoding: 'utf-8',
  });
}

// Case 1 — sprints remain -> plan_sprint -> FRESH session recommendation.
{
  const root = sandbox();
  try {
    const sprint = JSON.parse(readFileSync(sprintPath(root), 'utf-8'));
    sprint.roadmap.plannedSprintCount = 2;
    sprint.roadmap.sprints.push({ n: 2, slug: 'demo-sprint-2', title: 'Demo Sprint 2', state: 'planned' });
    writeFileSync(sprintPath(root), `${JSON.stringify(sprint, null, 2)}\n`);

    const res = run(root);
    const out = res.stdout + res.stderr;
    assert(res.status === 0, `close with remaining sprints should succeed: ${out}`);
    assert(out.includes('Next action: plan_sprint'), `expected plan_sprint next action: ${out}`);
    assert(out.includes('FRESH session'), `expected fresh-session recommendation: ${out}`);
    assert(out.includes('task-context'), `expected task-context pointer: ${out}`);
    assert(out.includes('sprint.json:'), `expected paste-ready handoff facts: ${out}`);
    assert(!out.includes('Scope objective met'), `done message must not appear on plan_sprint: ${out}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// Case 2 — no original sprints remain -> plan_sprint -> scope remains open.
{
  const root = sandbox();
  try {
    const res = run(root);
    const out = res.stdout + res.stderr;
    assert(res.status === 0, `happy close should succeed: ${out}`);
    assert(out.includes('Next action: plan_sprint'), `expected plan_sprint next action: ${out}`);
    assert(out.includes('Scope remains open for planning'), `expected open-scope message: ${out}`);
    assert(out.includes('FRESH session'), `expected fresh-session nudge after final roadmap sprint: ${out}`);
    assert(out.includes('task-context'), `expected task-context pointer after final roadmap sprint: ${out}`);
    const sprint = JSON.parse(readFileSync(sprintPath(root), 'utf-8'));
    assert(sprint.handoff.nextAction === 'plan_sprint', `sprint.json nextAction must be plan_sprint, got ${sprint.handoff.nextAction}`);
    assert(sprint.status === 'planning', `sprint.json status must remain planning, got ${sprint.status}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// Case 3 — adversarial partial close: the final originally-planned sprint has a disposed task, so
// the close persists a partial outcome and the scope STAYS open for planning. Closing the last
// roadmap sprint must never mint nextAction "done" just because the roadmap is exhausted (R2/S2).
{
  const root = sandbox();
  try {
    const sprint = JSON.parse(readFileSync(sprintPath(root), 'utf-8'));
    sprint.activeSprint.phases[0].tasks.push({
      id: 'T1.2',
      title: 'Deferred demo work',
      description: 'Carried work.',
      files_to_touch: [],
      context: 'ctx',
      acceptance_criteria: ['Deferred.'],
      depends_on: [],
      status: 'pending',
      evidence: { summary: 'Deferred.', validation: 'user decision', files_changed: [], notes: '', by: 'maker', recordedAt: '2026-07-02T00:02:00.000Z' },
      verdict: null,
      disposition: { kind: 'cancelled', reason: 'Dropped before close.', by: 'maker', recordedAt: '2026-07-02T00:02:00.000Z' },
    });
    writeFileSync(sprintPath(root), `${JSON.stringify(sprint, null, 2)}\n`);

    const res = run(root, ['--outcome', 'partial']);
    const out = res.stdout + res.stderr;
    assert(res.status === 0, `partial close should succeed: ${out}`);
    assert(out.includes('partial'), `partial close should report a partial outcome: ${out}`);
    assert(out.includes('Next action: plan_sprint'), `final-roadmap partial close must route to plan_sprint, got: ${out}`);
    assert(out.includes('Scope remains open for planning'), `expected open-scope message on partial close: ${out}`);
    assert(!out.includes('Scope objective met'), `done message must never appear for an open post-close scope: ${out}`);

    const closed = JSON.parse(readFileSync(sprintPath(root), 'utf-8'));
    assert(closed.handoff.nextAction === 'plan_sprint', `sprint.json nextAction must be plan_sprint, got ${closed.handoff.nextAction}`);
    assert(closed.status === 'planning', `scope must remain planning after partial final close, got ${closed.status}`);
    assert(closed.activeSprint === null, 'activeSprint must be cleared by close');
    assert(closed.ledger.length === 1 && closed.ledger[0].outcome === 'partial', 'ledger must record the partial outcome');
    // Completion is an explicit, separately confirmed lifecycle decision: close must never infer or
    // mint one, and it must never fabricate reopen history for a scope that was never completed.
    assert(closed.completion === undefined, 'close must never mint an explicit completion record');
    assert(closed.completionHistory === undefined, 'close must never write completion history');
    assert(closed.retirement === undefined, 'close must never mint retirement metadata');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// Case 4 — close refuses a sprint whose unfinished task still lacks a typed disposition (R1): the
// close must fail closed with UNDISPOSED_TASKS and write nothing.
{
  const root = sandbox();
  try {
    const sprint = JSON.parse(readFileSync(sprintPath(root), 'utf-8'));
    sprint.activeSprint.phases[0].tasks.push({
      id: 'T1.2',
      title: 'Unfinished demo work',
      description: 'Incomplete.',
      files_to_touch: [],
      context: 'ctx',
      acceptance_criteria: ['Done.'],
      depends_on: [],
      status: 'pending',
      evidence: { summary: 'partial', validation: 'none', files_changed: [], notes: '', by: 'maker', recordedAt: '2026-07-02T00:02:00.000Z' },
      verdict: null,
    });
    writeFileSync(sprintPath(root), `${JSON.stringify(sprint, null, 2)}\n`);
    const before = readFileSync(sprintPath(root), 'utf-8');

    const res = run(root);
    const out = res.stdout + res.stderr;
    assert(res.status !== 0, 'close with an undisposed unfinished task must fail');
    assert(out.includes('UNDISPOSED_TASKS'), `close should report UNDISPOSED_TASKS: ${out}`);
    assert(out.includes('--disposition'), `close remedy should point to record-evidence disposition: ${out}`);
    assert(readFileSync(sprintPath(root), 'utf-8') === before, 'refused close must not write sprint.json');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// Case 5 — the trace must record the outcome that was actually persisted. `--outcome` defaults to
// "shipped", so emitting the raw argument reports a disposed sprint as shipped while the ledger and
// the checkpoint both say partial. The trace is the audit surface; it may not disagree with them.
{
  const root = sandbox();
  try {
    const sprint = JSON.parse(readFileSync(sprintPath(root), 'utf-8'));
    sprint.activeSprint.phases[0].tasks.push({
      id: 'T1.2',
      title: 'Deferred demo work',
      description: 'Carried work.',
      files_to_touch: [],
      context: 'ctx',
      acceptance_criteria: ['Deferred.'],
      depends_on: [],
      status: 'pending',
      evidence: { summary: 'Deferred.', validation: 'user decision', files_changed: [], notes: '', by: 'maker', recordedAt: '2026-07-02T00:02:00.000Z' },
      verdict: null,
      disposition: { kind: 'cancelled', reason: 'Dropped before close.', by: 'maker', recordedAt: '2026-07-02T00:02:00.000Z' },
    });
    writeFileSync(sprintPath(root), `${JSON.stringify(sprint, null, 2)}\n`);

    // No --outcome: the close derives "partial" from the disposed task while the argument default
    // still reads "shipped". This is the exact gap the trace used to report.
    const res = spawnSync(process.execPath, [cli, 'close-sprint', '--kyro-scope', 'demo', '--yes'], {
      cwd: root,
      env: { ...process.env, HOME: join(root, '.home'), KYRO_TRACE: '1' },
      encoding: 'utf-8',
    });
    const out = res.stdout + res.stderr;
    assert(res.status === 0, `a disposed sprint must close without an explicit outcome: ${out}`);

    const closed = JSON.parse(readFileSync(sprintPath(root), 'utf-8'));
    assert(closed.ledger.at(-1)?.outcome === 'partial', `ledger must persist partial, got ${closed.ledger.at(-1)?.outcome}`);

    const events = readFileSync(join(root, '.agents/kyro/trace/demo/events.ndjson'), 'utf-8')
      .split('\n').filter(Boolean).map((line) => JSON.parse(line));
    const closeEvent = events.find((event) => event.type === 'close_snapshot');
    assert(closeEvent, `the close must emit a close_snapshot trace event: ${JSON.stringify(events)}`);
    assert(closeEvent.outcome === 'partial',
      `close_snapshot must record the persisted outcome, not the raw --outcome default: got ${closeEvent.outcome}`);
    const commandEvent = events.find((event) => event.type === 'tool_command_run' && event.command === 'close-sprint');
    if (commandEvent) {
      assert(commandEvent.args?.outcome === 'partial',
        `the command trace must record the persisted outcome too: ${JSON.stringify(commandEvent)}`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

console.log('check:close-handoff — close-sprint handoff guidance cases passed');
