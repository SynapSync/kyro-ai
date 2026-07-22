#!/usr/bin/env node
// Verifies tool-owned `kyro adr add` and improved ADR shape validation messages.
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
  const root = join(tmpdir(), `kyro-adr-${Date.now()}-${Math.random().toString(16).slice(2)}`);
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

// 1) Happy path
{
  const root = sandbox();
  try {
    const before = readFileSync(sprintPath(root), 'utf-8');
    const add = run(
      [
        'adr',
        'add',
        '--kyro-scope',
        'demo',
        '--title',
        'Prefer projected CLI',
        '--context',
        'PATH often empty for agents',
        '--decision',
        'Surface canonical entrypoint in doctor and skill stubs',
        '--consequence',
        'Less rediscovery tax',
        '--alternative',
        'Require global kyro on PATH always',
      ],
      root,
    );
    assert(add.status === 0, `adr add should succeed: ${add.stdout}${add.stderr}`);
    assert(readFileSync(sprintPath(root), 'utf-8') !== before, 'adr add should write sprint.json');
    const sprint = readSprint(root);
    assert(Array.isArray(sprint.adrs) && sprint.adrs.length === 1, 'expected one ADR');
    assert(sprint.adrs[0].id === 'ADR-0001', `expected ADR-0001 got ${sprint.adrs[0].id}`);
    assert(sprint.adrs[0].title.includes('projected'), 'title preserved');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// 2) Missing required flag refuses without write
{
  const root = sandbox();
  try {
    const before = readFileSync(sprintPath(root), 'utf-8');
    const add = run(['adr', 'add', '--kyro-scope', 'demo', '--title', 'Only title'], root);
    assert(add.status !== 0, `incomplete adr add should fail: ${add.stdout}${add.stderr}`);
    assert(readFileSync(sprintPath(root), 'utf-8') === before, 'failed add must not write');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// 3) Incomplete ADR object on disk surfaces example in doctor/validation path
{
  const root = sandbox();
  try {
    const sprint = readSprint(root);
    sprint.adrs = [{ id: 'ADR-0001', title: 'Broken' }];
    writeFileSync(sprintPath(root), `${JSON.stringify(sprint, null, 2)}\n`);
    const doctor = run(['doctor', '--artifacts', '--kyro-scope', 'demo'], root);
    const out = `${doctor.stdout}${doctor.stderr}`;
    assert(doctor.status !== 0, `doctor should fail on broken ADR: ${out}`);
    assert(out.includes('example') || out.includes('ADR-0001') || out.includes('incomplete'), `should mention ADR shape: ${out}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

console.log('check:adr — adr add happy path, refuse-without-write, and shape messaging passed');
