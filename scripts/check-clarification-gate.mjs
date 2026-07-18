#!/usr/bin/env node
// Verifies the portable clarification gate: while sprint.json has an unresolved [NEEDS CLARIFICATION]
// marker, both record-evidence and review fail with CLARIFICATION_REQUIRED and write nothing — on any
// host, because the gate lives in the CLI (not a Claude-only hook). Once resolved, they work again.
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
  const root = join(tmpdir(), `kyro-clarification-${Date.now()}-${Math.random().toString(16).slice(2)}`);
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

const taskArgs = (cmd, root, extra = []) =>
  run([cmd, readSprint(root).activeSprint.phases[0].tasks[0].id, '--kyro-scope', 'demo', ...extra], root);

// 1) With an unresolved marker, record-evidence AND review both refuse and write nothing.
{
  const root = sandbox();
  try {
    const sprint = readSprint(root);
    sprint.activeSprint.objective = `${sprint.activeSprint.objective} [NEEDS CLARIFICATION: which auth flow?]`;
    writeFileSync(sprintPath(root), `${JSON.stringify(sprint, null, 2)}\n`);
    const before = readFileSync(sprintPath(root), 'utf-8');

    const rec = taskArgs('record-evidence', root, ['--summary', 'x', '--validation', 'tsc']);
    assert(rec.status === 1 && (rec.stderr + rec.stdout).includes('CLARIFICATION_REQUIRED'), `record-evidence should block on markers: ${rec.stdout}${rec.stderr}`);

    const rev = taskArgs('review', root, ['--verdict', 'pass']);
    assert(rev.status === 1 && (rev.stderr + rev.stdout).includes('CLARIFICATION_REQUIRED'), `review should block on markers: ${rev.stdout}${rev.stderr}`);

    assert(readFileSync(sprintPath(root), 'utf-8') === before, 'blocked commands must not write sprint.json');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// 2) With no marker (baseline fixture), record-evidence then review succeed — the gate is inert when clean.
{
  const root = sandbox();
  try {
    const rec = taskArgs('record-evidence', root, ['--summary', 'Done.', '--validation', 'npm test -- demo', '--file', 'src/demo.ts']);
    assert(rec.status === 0, `clean record-evidence should pass: ${rec.stdout}${rec.stderr}`);
    const rev = taskArgs('review', root, ['--verdict', 'pass']);
    assert(rev.status === 0, `clean review should pass: ${rev.stdout}${rev.stderr}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

console.log('check:clarification-gate — portable [NEEDS CLARIFICATION] gate verified for record-evidence and review');
