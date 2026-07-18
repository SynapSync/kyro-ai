#!/usr/bin/env node
// Verifies close-sprint's post-close handoff guidance: when sprints remain (plan_sprint) it
// recommends a FRESH session + paste-ready handoff facts; when none remain (wrap_up) it points
// at wrap-up instead. This is the portable, deterministic half of the fresh-context nudge.
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

function run(root) {
  return spawnSync(process.execPath, [cli, 'close-sprint', '--kyro-scope', 'demo', '--outcome', 'shipped', '--yes'], {
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
    assert(!out.includes('Scope objective met'), `wrap_up message must not appear on plan_sprint: ${out}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// Case 2 — no sprints remain -> wrap_up -> no fresh-session nudge, points at wrap-up.
{
  const root = sandbox();
  try {
    const res = run(root);
    const out = res.stdout + res.stderr;
    assert(res.status === 0, `happy close should succeed: ${out}`);
    assert(out.includes('Next action: wrap_up'), `expected wrap_up next action: ${out}`);
    assert(out.includes('Scope objective met'), `expected scope-complete message: ${out}`);
    assert(!out.includes('FRESH session'), `fresh-session nudge must not appear on wrap_up: ${out}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

console.log('check:close-handoff — close-sprint handoff guidance cases passed');
