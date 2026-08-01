#!/usr/bin/env node
// Verifies tool-owned scope rule registration, optional global promotion, inheritance, and
// refuse-without-write behavior.
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

function sandbox({ layered = true, secondScope = false } = {}) {
  const root = join(tmpdir(), `kyro-rule-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(join(root, '.home'), { recursive: true });
  cpSync(resolve(repo, 'fixtures/evals/route-review-task/state'), root, { recursive: true });
  const kyroRoot = join(root, '.agents/kyro');
  const monolitoPath = join(kyroRoot, 'kyro.json');
  const monolito = readJson(monolitoPath);
  if (layered) {
    writeJson(join(kyroRoot, 'project.json'), {
      schemaVersion: 4,
      artifactRoot: monolito.artifactRoot,
      scopes: secondScope
        ? [...monolito.scopes, { id: 'other', title: 'Other', status: 'active' }]
        : monolito.scopes,
    });
    writeJson(join(kyroRoot, 'local.json'), {
      schemaVersion: 4,
      activeScope: monolito.activeScope,
      installedAdapters: monolito.installedAdapters,
      runtimePath: monolito.runtimePath,
    });
    rmSync(monolitoPath);
  }
  if (secondScope) {
    const other = readSprint(root);
    other.scope = 'other';
    other.title = 'Other';
    other.conventions = [];
    mkdirSync(join(kyroRoot, 'scopes/other'), { recursive: true });
    writeJson(sprintPath(root, 'other'), other);
  }
  return root;
}

function sprintPath(root, scope = 'demo') {
  return join(root, `.agents/kyro/scopes/${scope}/sprint.json`);
}

function projectPath(root) {
  return join(root, '.agents/kyro/project.json');
}

function readSprint(root, scope = 'demo') {
  return readJson(sprintPath(root, scope));
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function run(args, root) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    env: { ...process.env, HOME: join(root, '.home') },
    encoding: 'utf-8',
  });
}

function output(result) {
  return `${result.stdout ?? ''}${result.stderr ?? ''}`;
}

// 1) Default target is the active scope; project.json remains untouched.
{
  const root = sandbox();
  try {
    const projectBefore = readFileSync(projectPath(root), 'utf-8');
    const add = run(['rule', 'add', '--rule', 'Keep verified evidence synchronized.', '--tag', 'process'], root);
    assert(add.status === 0, `scope rule add should succeed: ${output(add)}`);
    const sprint = readSprint(root);
    assert(sprint.conventions.length === 1, 'scope rule add should append one convention');
    assert(sprint.conventions[0].id === 'process-1', 'rule id should be allocated from the primary tag');
    assert(sprint.conventions[0].addedSprint === sprint.activeSprint.n, 'active sprint number should be captured');
    assert(readFileSync(projectPath(root), 'utf-8') === projectBefore, 'scope-only add must not write project.json');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// 2) --global writes the same rule to project.json and context-pack inherits it in another scope.
{
  const root = sandbox({ secondScope: true });
  try {
    const add = run([
      'rule', 'add', '--rule', 'Run docs-check after OpenAPI changes.', '--tag', 'process', '--global',
    ], root);
    assert(add.status === 0, `global rule add should succeed: ${output(add)}`);
    const scoped = readSprint(root).conventions[0];
    const global = readJson(projectPath(root)).conventions[0];
    assert(JSON.stringify(scoped) === JSON.stringify(global), 'scope and global convention records should match');

    const pack = run(['context-pack', '--kyro-scope', 'other', '--json'], root);
    assert(pack.status === 0, `other scope context-pack should succeed: ${output(pack)}`);
    const inherited = JSON.parse(pack.stdout).conventions;
    assert(inherited.some((rule) => rule.rule === global.rule), 'other scope should inherit global project rule');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// 3) Duplicate scope rule refuses without modifying either state file.
{
  const root = sandbox();
  try {
    const first = run(['rule', 'add', '--rule', 'Preserve unrelated dirty work.'], root);
    assert(first.status === 0, `first rule add should succeed: ${output(first)}`);
    const sprintBefore = readFileSync(sprintPath(root), 'utf-8');
    const projectBefore = readFileSync(projectPath(root), 'utf-8');
    const duplicate = run(['rule', 'add', '--rule', '  preserve   unrelated dirty work. ', '--global'], root);
    assert(duplicate.status !== 0, 'duplicate scope rule should fail');
    assert(readFileSync(sprintPath(root), 'utf-8') === sprintBefore, 'duplicate refusal must not write sprint.json');
    assert(readFileSync(projectPath(root), 'utf-8') === projectBefore, 'duplicate refusal must not write project.json');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// 4) Scope-only ids account for global ids so a local rule cannot shadow an inherited rule.
{
  const root = sandbox();
  try {
    const project = readJson(projectPath(root));
    project.conventions = [{ id: 'process-1', rule: 'Global first.', tags: ['process'], addedSprint: 1 }];
    writeJson(projectPath(root), project);
    const add = run(['rule', 'add', '--rule', 'Scope second.'], root);
    assert(add.status === 0, `scope add beside global id should succeed: ${output(add)}`);
    assert(readSprint(root).conventions[0].id === 'process-2', 'scope id allocator must skip inherited global ids');
    const pack = run(['context-pack', '--json'], root);
    assert(pack.status === 0, `context-pack with local/global rules should succeed: ${output(pack)}`);
    assert(JSON.parse(pack.stdout).conventions.length === 2, 'both global and scope rule must survive the merge');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// 5) Global promotion requires layered project.json and refuses before changing the scope.
{
  const root = sandbox({ layered: false });
  try {
    const before = readFileSync(sprintPath(root), 'utf-8');
    const add = run(['rule', 'add', '--rule', 'Use the shared truth.', '--global'], root);
    assert(add.status !== 0, 'global add without project.json should fail');
    assert(output(add).includes('project.json'), 'global refusal should name project.json remedy');
    assert(readFileSync(sprintPath(root), 'utf-8') === before, 'failed global add must not write sprint.json');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// 6) Dry-run previews both writes but changes neither file.
{
  const root = sandbox();
  try {
    const sprintBefore = readFileSync(sprintPath(root), 'utf-8');
    const projectBefore = readFileSync(projectPath(root), 'utf-8');
    const preview = run(['rule', 'add', '--rule', 'Preview this rule.', '--global', '--dry-run'], root);
    assert(preview.status === 0, `global dry-run should succeed: ${output(preview)}`);
    assert(output(preview).includes('Dry run complete'), 'dry-run should report that nothing changed');
    assert(readFileSync(sprintPath(root), 'utf-8') === sprintBefore, 'dry-run must not write sprint.json');
    assert(readFileSync(projectPath(root), 'utf-8') === projectBefore, 'dry-run must not write project.json');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// 7) Agent-facing instructions own the ambiguity: ask about global, then call the CLI; no hand-edit.
{
  const learner = readFileSync(resolve(repo, 'skills/sprint-forge/assets/helpers/learner.md'), 'utf-8');
  const executor = readFileSync(resolve(repo, 'skills/kyro-sprint-executor/SKILL.md'), 'utf-8');
  for (const [name, body] of [['learner', learner], ['executor', executor]]) {
    assert(body.includes('{{KYRO_CLI}} rule add'), `${name} must direct agents to the rule command`);
    assert(/ask.+global/i.test(body), `${name} must tell agents to ask about global persistence`);
    assert(!/append it to `sprint\.json\.conventions\[\]` using the Artifact Write Contract/.test(body), `${name} must not direct manual convention writes`);
  }
}

console.log('check:rule — scope/global registration, inheritance, refusals, and agent routing passed');
