#!/usr/bin/env node
// Verifies tool-owned `kyro scenario add` / `kyro scenario link`: happy path + refuse invalid
// ids without writing sprint.json (post-mortem #2 F4 — no hand-edit for coverage refine).
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
  const root = join(tmpdir(), `kyro-scenario-${Date.now()}-${Math.random().toString(16).slice(2)}`);
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

function ensureSpec(root) {
  const sprint = readSprint(root);
  sprint.spec = {
    requirements: [{ id: 'R1', statement: 'Demo requirement.', priority: 'must' }],
    scenarios: [{ id: 'S1', requirement: 'R1', given: 'a', when: 'b', then: 'c' }],
    nonGoals: [],
    openQuestions: [],
  };
  const task = sprint.activeSprint.phases[0].tasks[0];
  task.scenario_refs = ['S1'];
  writeFileSync(sprintPath(root), `${JSON.stringify(sprint, null, 2)}\n`);
}

// 1) Happy path: add S2 + link to task
{
  const root = sandbox();
  try {
    ensureSpec(root);
    const before = readFileSync(sprintPath(root), 'utf-8');
    const add = run(
      [
        'scenario',
        'add',
        '--kyro-scope',
        'demo',
        '--id',
        'S2',
        '--requirement',
        'R1',
        '--given',
        'given text',
        '--when',
        'when text',
        '--then',
        'then text',
      ],
      root,
    );
    assert(add.status === 0, `scenario add should succeed: ${add.stdout}${add.stderr}`);
    assert(readFileSync(sprintPath(root), 'utf-8') !== before, 'scenario add should write sprint.json');

    const afterAdd = readSprint(root);
    assert(afterAdd.spec.scenarios.some((s) => s.id === 'S2'), 'S2 should be in spec.scenarios');
    const taskId = afterAdd.activeSprint.phases[0].tasks[0].id;

    const link = run(['scenario', 'link', '--kyro-scope', 'demo', '--task', taskId, '--scenario', 'S2'], root);
    assert(link.status === 0, `scenario link should succeed: ${link.stdout}${link.stderr}`);
    const afterLink = readSprint(root);
    const refs = afterLink.activeSprint.phases[0].tasks[0].scenario_refs ?? [];
    assert(refs.includes('S2'), `task should reference S2, got ${JSON.stringify(refs)}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// 2) Bad scenario id on link: refuse, zero write
{
  const root = sandbox();
  try {
    ensureSpec(root);
    const before = readFileSync(sprintPath(root), 'utf-8');
    const taskId = readSprint(root).activeSprint.phases[0].tasks[0].id;
    const link = run(['scenario', 'link', '--kyro-scope', 'demo', '--task', taskId, '--scenario', 'S404'], root);
    assert(link.status !== 0, `unknown scenario should fail: ${link.stdout}${link.stderr}`);
    assert(readFileSync(sprintPath(root), 'utf-8') === before, 'failed link must not write sprint.json');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// 3) Bad task id on link: refuse, zero write
{
  const root = sandbox();
  try {
    ensureSpec(root);
    const before = readFileSync(sprintPath(root), 'utf-8');
    const link = run(['scenario', 'link', '--kyro-scope', 'demo', '--task', 'T404', '--scenario', 'S1'], root);
    assert(link.status !== 0, `unknown task should fail: ${link.stdout}${link.stderr}`);
    assert(readFileSync(sprintPath(root), 'utf-8') === before, 'failed link must not write sprint.json');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// 4) Duplicate scenario add: refuse
{
  const root = sandbox();
  try {
    ensureSpec(root);
    const before = readFileSync(sprintPath(root), 'utf-8');
    const add = run(
      [
        'scenario',
        'add',
        '--kyro-scope',
        'demo',
        '--id',
        'S1',
        '--requirement',
        'R1',
        '--given',
        'g',
        '--when',
        'w',
        '--then',
        't',
      ],
      root,
    );
    assert(add.status !== 0, `duplicate scenario id should fail: ${add.stdout}${add.stderr}`);
    assert(readFileSync(sprintPath(root), 'utf-8') === before, 'failed add must not write');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

console.log('check:scenario — scenario add/link happy path and refuse-without-write passed');
