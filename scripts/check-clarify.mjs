#!/usr/bin/env node
// Verifies tool-owned clarification writes: one-at-a-time conversational resolution, explicit
// batches, marker handling, routing, and refusal without mutating sprint.json.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(fileURLToPath(import.meta.url), '../..');
const cli = resolve(repo, 'dist/cli.js');

function assert(condition, message) { if (!condition) throw new Error(message); }

function sandbox() {
  const root = join(tmpdir(), `kyro-clarify-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(join(root, '.home'), { recursive: true });
  cpSync(resolve(repo, 'fixtures/evals/route-review-task/state'), root, { recursive: true });
  return root;
}

function sprintPath(root) { return join(root, '.agents/kyro/scopes/demo/sprint.json'); }
function readSprint(root) { return JSON.parse(readFileSync(sprintPath(root), 'utf-8')); }
function writeJson(path, value) { writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`); }
function run(args, root) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: root, env: { ...process.env, HOME: join(root, '.home') }, encoding: 'utf-8' });
}

function prepareClarifyScope(root, { openQuestions = ['Which locale?', 'Where is presentation exposed?'], objective = 'Clarify the public response.' } = {}) {
  const sprint = readSprint(root);
  sprint.status = 'planning';
  sprint.activeSprint = null;
  sprint.spec = { requirements: [{ id: 'R1', statement: 'Base requirement.', priority: 'must' }], scenarios: [], nonGoals: [], openQuestions };
  sprint.objective = objective;
  sprint.clarifications = [];
  sprint.handoff = { nextAction: 'clarify', nextTaskId: null, blockers: [], note: 'Clarify.', lastUpdated: '2026-08-11' };
  writeJson(sprintPath(root), sprint);
}

// 1) Normal conversational path: one answer persists through CLI but remains clarify.
{
  const root = sandbox();
  try {
    prepareClarifyScope(root);
    const input = join(root, 'one.json');
    writeJson(input, { resolutions: [{ target: { kind: 'open_question', text: 'Which locale?' }, answer: 'Support es and en; fallback to es.', requirements: [{ id: 'R2', statement: 'The MVP supports es and en with an es fallback.', priority: 'must' }] }] });
    const result = run(['clarify', '--from', input, '--kyro-scope', 'demo'], root);
    assert(result.status === 0, `single clarify should succeed: ${result.stdout}${result.stderr}`);
    const sprint = readSprint(root);
    assert(sprint.handoff.nextAction === 'clarify', 'one remaining question must keep nextAction clarify');
    assert(!sprint.spec.openQuestions.includes('Which locale?'), 'resolved question should be removed');
    assert(sprint.clarifications.length === 1, 'accepted answer should be recorded');
    assert(sprint.spec.requirements.some((requirement) => requirement.id === 'R2'), 'derived requirement should be recorded');
  } finally { rmSync(root, { recursive: true, force: true }); }
}

// 2) Batch path: accumulated answers clear the scope and route to planning atomically.
{
  const root = sandbox();
  try {
    prepareClarifyScope(root);
    const input = join(root, 'batch.json');
    writeJson(input, { resolutions: [
      { target: { kind: 'open_question', text: 'Which locale?' }, answer: 'Use es.', requirements: [] },
      { target: { kind: 'open_question', text: 'Where is presentation exposed?' }, answer: 'Use an additive presentation field.', requirements: [] },
    ] });
    const result = run(['clarify', '--from', input, '--kyro-scope', 'demo'], root);
    assert(result.status === 0, `batch clarify should succeed: ${result.stdout}${result.stderr}`);
    const sprint = readSprint(root);
    assert(sprint.spec.openQuestions.length === 0, 'batch should remove every resolved question');
    assert(sprint.clarifications.length === 2, 'batch should record every accepted answer');
    assert(sprint.handoff.nextAction === 'plan_sprint', 'a clear scope without an active sprint should route to planning');
  } finally { rmSync(root, { recursive: true, force: true }); }
}

// 3) A marker is resolved by the CLI, never by a direct artifact edit.
{
  const root = sandbox();
  try {
    prepareClarifyScope(root, { openQuestions: [], objective: 'Expose [NEEDS CLARIFICATION: response locale].' });
    const input = join(root, 'marker.json');
    writeJson(input, { resolutions: [{ target: { kind: 'marker', text: 'response locale' }, answer: 'Spanish response locale.', requirements: [] }] });
    const result = run(['clarify', '--from', input, '--kyro-scope', 'demo'], root);
    assert(result.status === 0, `marker clarify should succeed: ${result.stdout}${result.stderr}`);
    const sprint = readSprint(root);
    assert(!sprint.objective.includes('[NEEDS CLARIFICATION:'), 'marker should be removed by the command');
    assert(sprint.handoff.nextAction === 'plan_sprint', 'cleared marker should route to planning');
  } finally { rmSync(root, { recursive: true, force: true }); }
}

// 4) Invalid batches fail before a write is planned or applied.
{
  const root = sandbox();
  try {
    prepareClarifyScope(root);
    const before = readFileSync(sprintPath(root), 'utf-8');
    const input = join(root, 'duplicate.json');
    writeJson(input, { resolutions: [
      { target: { kind: 'open_question', text: 'Which locale?' }, answer: 'es', requirements: [] },
      { target: { kind: 'open_question', text: 'Which locale?' }, answer: 'en', requirements: [] },
    ] });
    const result = run(['clarify', '--from', input, '--kyro-scope', 'demo'], root);
    assert(result.status !== 0, `duplicate target must fail: ${result.stdout}${result.stderr}`);
    assert(readFileSync(sprintPath(root), 'utf-8') === before, 'failed clarification input must not write sprint.json');
  } finally { rmSync(root, { recursive: true, force: true }); }
}

console.log('check:clarify — tool-owned single, batch, marker, and refusal paths passed');
