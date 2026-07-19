#!/usr/bin/env node
// Verifies `kyro plan --from <file>` (init mode): it materializes a scope's initial sprint.json
// (spec + roadmap, activeSprint: null) from a compact lean plan JSON file — tool-owned and
// validated, so the agent never hand-writes the full v4 sprint.json for INIT. Covers the happy
// path, the [NEEDS CLARIFICATION] routing (allowed here, unlike execute-phase commands), the
// SCOPE_ALREADY_INITIALIZED refusal (no overwrite), input validation, scope-mismatch rejection,
// and --dry-run.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(fileURLToPath(import.meta.url), '../..');
const cli = resolve(repo, 'dist/cli.js');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sandbox() {
  const root = join(tmpdir(), `kyro-plan-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(join(root, '.home'), { recursive: true });
  mkdirSync(join(root, '.agents/kyro'), { recursive: true });
  writeFileSync(
    kyroJsonPath(root),
    `${JSON.stringify(
      {
        schemaVersion: 4,
        artifactRoot: '.agents/kyro/scopes',
        scopes: [],
        activeScope: null,
        runtimePath: '~/.agents/kyro/current',
        installedAdapters: [],
      },
      null,
      2,
    )}\n`,
  );
  return root;
}

function kyroJsonPath(root) {
  return join(root, '.agents/kyro/kyro.json');
}

function sprintPath(root, scope) {
  return join(root, `.agents/kyro/scopes/${scope}/sprint.json`);
}

function readSprint(root, scope) {
  return JSON.parse(readFileSync(sprintPath(root, scope), 'utf-8'));
}

function readKyroJson(root) {
  return JSON.parse(readFileSync(kyroJsonPath(root), 'utf-8'));
}

function run(args, root) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    env: { ...process.env, HOME: join(root, '.home') },
    encoding: 'utf-8',
  });
}

function validLeanPlan(overrides = {}) {
  return {
    scope: 'demo-scope',
    title: 'Demo Scope',
    objective: 'Ship the demo feature end to end.',
    successCriteria: ['A user completes the demo flow in under 2 minutes.'],
    spec: {
      requirements: [{ id: 'R1', statement: 'The system must do the demo thing.', priority: 'must', rationale: 'Core value.' }],
      nonGoals: ['Not doing the other thing.'],
      openQuestions: [],
    },
    roadmap: {
      plannedSprintCount: 2,
      sizingRationale: 'Split foundation from hardening.',
      sprints: [
        { n: 1, slug: 'foundation', title: 'Foundation' },
        { n: 2, slug: 'hardening', title: 'Hardening' },
      ],
    },
    ...overrides,
  };
}

function writeLeanPlan(root, data, name = 'lean-plan.json') {
  const path = join(root, name);
  writeFileSync(path, JSON.stringify(data, null, 2));
  return path;
}

// 1) Happy path: materializes sprint.json (spec + roadmap, activeSprint: null), routes to
//    plan_sprint, registers the scope in kyro.json, and the result passes doctor + analyze clean.
{
  const root = sandbox();
  try {
    const leanPath = writeLeanPlan(root, validLeanPlan());
    const result = run(['plan', '--from', leanPath], root);
    assert(result.status === 0, `kyro plan should succeed: ${result.stdout}${result.stderr}`);

    const sprint = readSprint(root, 'demo-scope');
    assert(sprint.schemaVersion === 4, 'schemaVersion should be 4');
    assert(sprint.status === 'planning', 'status should be planning');
    assert(sprint.activeSprint === null, 'activeSprint must be null in init mode');
    assert(sprint.handoff.nextAction === 'plan_sprint', `nextAction should be plan_sprint, got ${sprint.handoff.nextAction}`);
    assert(sprint.handoff.nextTaskId === null, 'nextTaskId should be null');
    assert(sprint.spec.requirements.length === 1 && sprint.spec.requirements[0].id === 'R1', 'spec.requirements should match input');
    assert(Array.isArray(sprint.spec.scenarios) && sprint.spec.scenarios.length === 0, 'spec.scenarios must always be empty in init mode');
    assert(sprint.roadmap.plannedSprintCount === 2 && sprint.roadmap.sprints.length === 2, 'roadmap should match input');
    assert(sprint.roadmap.sprints.every((s) => s.state === 'planned'), 'roadmap sprints should be state: planned');

    const kyroJson = readKyroJson(root);
    assert(kyroJson.scopes.some((entry) => entry.id === 'demo-scope'), 'kyro.json should register the new scope');
    assert(kyroJson.activeScope === 'demo-scope', 'kyro.json activeScope should be set when previously null');

    const doctorResult = run(['doctor', '--artifacts', '--kyro-scope', 'demo-scope'], root);
    assert(doctorResult.status === 0, `doctor --artifacts should be clean: ${doctorResult.stdout}${doctorResult.stderr}`);

    const analyzeResult = run(['analyze', '--kyro-scope', 'demo-scope'], root);
    assert(analyzeResult.status === 0, `analyze should be clean (no CRITICAL/HIGH): ${analyzeResult.stdout}${analyzeResult.stderr}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// 2) A [NEEDS CLARIFICATION] marker in the lean plan routes to "clarify" (exit 0, file written) —
//    init mode legitimately writes markers; this is not the execute-phase O5 gate.
{
  const root = sandbox();
  try {
    const leanPath = writeLeanPlan(root, validLeanPlan({
      scope: 'clarify-scope',
      objective: 'Ship the demo feature [NEEDS CLARIFICATION: which store backs the demo?].',
    }));
    const result = run(['plan', '--from', leanPath], root);
    assert(result.status === 0, `kyro plan with a marker should still succeed: ${result.stdout}${result.stderr}`);
    const sprint = readSprint(root, 'clarify-scope');
    assert(sprint.handoff.nextAction === 'clarify', `nextAction should be clarify, got ${sprint.handoff.nextAction}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// 3) Already initialized: re-running plan on the same scope refuses with SCOPE_ALREADY_INITIALIZED
//    and never touches the existing sprint.json.
{
  const root = sandbox();
  try {
    const leanPath = writeLeanPlan(root, validLeanPlan());
    const first = run(['plan', '--from', leanPath], root);
    assert(first.status === 0, `first plan should succeed: ${first.stdout}${first.stderr}`);
    const before = readFileSync(sprintPath(root, 'demo-scope'), 'utf-8');

    const second = run(['plan', '--from', leanPath], root);
    assert(second.status === 1, 'second plan on the same scope should fail');
    assert((second.stderr + second.stdout).includes('SCOPE_ALREADY_INITIALIZED'), `should report SCOPE_ALREADY_INITIALIZED: ${second.stdout}${second.stderr}`);

    const after = readFileSync(sprintPath(root, 'demo-scope'), 'utf-8');
    assert(before === after, 'sprint.json must be byte-identical after the refused re-init');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// 4) Invalid input: empty successCriteria fails INVALID_INPUT and writes nothing.
{
  const root = sandbox();
  try {
    const leanPath = writeLeanPlan(root, validLeanPlan({ successCriteria: [] }));
    const result = run(['plan', '--from', leanPath], root);
    assert(result.status === 1, 'empty successCriteria should fail');
    assert((result.stderr + result.stdout).includes('INVALID_INPUT'), `should report INVALID_INPUT: ${result.stdout}${result.stderr}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// 4b) Invalid input: plannedSprintCount mismatched against roadmap.sprints.length.
{
  const root = sandbox();
  try {
    const leanPath = writeLeanPlan(root, validLeanPlan({ roadmap: { plannedSprintCount: 3, sizingRationale: 'x', sprints: [{ n: 1, slug: 'a', title: 'A' }] } }));
    const result = run(['plan', '--from', leanPath], root);
    assert(result.status === 1, 'mismatched plannedSprintCount should fail');
    assert((result.stderr + result.stdout).includes('INVALID_INPUT'), `should report INVALID_INPUT: ${result.stdout}${result.stderr}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// 5) Scope mismatch: --kyro-scope disagrees with the lean plan file's "scope" — fails INVALID_INPUT,
//    nothing written.
{
  const root = sandbox();
  try {
    const leanPath = writeLeanPlan(root, validLeanPlan({ scope: 'b' }));
    const result = run(['plan', '--from', leanPath, '--kyro-scope', 'a'], root);
    assert(result.status === 1, 'scope mismatch should fail');
    assert((result.stderr + result.stdout).includes('INVALID_INPUT'), `should report INVALID_INPUT: ${result.stdout}${result.stderr}`);
    const kyroJson = readKyroJson(root);
    assert(kyroJson.scopes.length === 0, 'kyro.json must not be mutated on scope mismatch');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// 6) --dry-run prints a plan, writes no sprint.json, and does not mutate kyro.json.
{
  const root = sandbox();
  try {
    const leanPath = writeLeanPlan(root, validLeanPlan());
    const beforeKyroJson = readFileSync(kyroJsonPath(root), 'utf-8');
    const result = run(['plan', '--from', leanPath, '--dry-run'], root);
    assert(result.status === 0, `dry-run should succeed: ${result.stdout}${result.stderr}`);
    assert(result.stdout.includes('write'), 'dry-run should print the write operation plan');
    assert(readFileSync(kyroJsonPath(root), 'utf-8') === beforeKyroJson, 'dry-run must not mutate kyro.json');

    let sprintWritten = true;
    try { readSprint(root, 'demo-scope'); } catch { sprintWritten = false; }
    assert(!sprintWritten, 'dry-run must not write sprint.json');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

console.log('check:plan — tool-owned scope init (kyro plan --from) verified end-to-end');
