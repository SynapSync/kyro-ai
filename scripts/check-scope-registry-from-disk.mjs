#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(repo, 'dist/cli.js');
const root = mkdtempSync(join(tmpdir(), 'kyro-disk-registry-'));
const env = { ...process.env, HOME: join(root, 'home'), USERPROFILE: join(root, 'home'), GIT_CONFIG_NOSYSTEM: '1' };

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed:\n${result.stdout}${result.stderr}`);
  return `${result.stdout}${result.stderr}`;
}
function git(cwd, ...args) { return run('git', args, cwd); }
function plan(scope) {
  return {
    scope, title: scope, objective: `Complete ${scope}.`, successCriteria: [`${scope} works.`],
    spec: { requirements: [{ id: 'R1', statement: `${scope} works.`, priority: 'must' }], nonGoals: [], openQuestions: [] },
    roadmap: { plannedSprintCount: 1, sizingRationale: 'One small scope.', sprints: [{ n: 1, slug: scope, title: scope }] },
  };
}
function shared(cwd) { return JSON.parse(readFileSync(join(cwd, '.agents/kyro/project.json'), 'utf8')); }

try {
  const base = join(root, 'base');
  run('mkdir', ['-p', base], root);
  run(process.execPath, [cli, 'install', '--scope', 'workspace', '--init-workspace', '--yes'], base);
  if (Object.hasOwn(shared(base), 'scopes')) throw new Error('install wrote shared scopes[]');
  git(base, 'init', '-b', 'main');
  git(base, 'config', 'user.name', 'Registry Test');
  git(base, 'config', 'user.email', 'registry@example.invalid');
  git(base, 'add', '.agents/kyro');
  git(base, 'commit', '-m', 'base');
  const origin = join(root, 'origin.git');
  git(root, 'clone', '--bare', base, origin);
  const left = join(root, 'left');
  const right = join(root, 'right');
  git(root, 'clone', origin, left);
  git(root, 'clone', origin, right);
  for (const [cwd, scope] of [[left, 'left'], [right, 'right']]) {
    git(cwd, 'config', 'user.name', 'Registry Test');
    git(cwd, 'config', 'user.email', 'registry@example.invalid');
    writeFileSync(join(cwd, 'plan.json'), `${JSON.stringify(plan(scope), null, 2)}\n`);
    run(process.execPath, [cli, 'plan', '--from', 'plan.json'], cwd);
    if (git(cwd, 'status', '--short', '--', '.agents/kyro/project.json').trim()) {
      throw new Error(`${scope} changed shared project.json`);
    }
    git(cwd, 'add', '.agents/kyro');
    git(cwd, 'commit', '-m', `add ${scope}`);
  }
  git(left, 'push', 'origin', 'main');
  git(right, 'fetch', 'origin', 'main');
  git(right, 'merge', '--no-edit', 'origin/main');
  for (const scope of ['left', 'right']) {
    if (!existsSync(join(right, `.agents/kyro/scopes/${scope}/sprint.json`))) throw new Error(`${scope} disappeared after merge`);
  }
  const listed = run(process.execPath, [cli, 'scope', 'list'], right);
  if (!listed.includes('left [planning]') || !listed.includes('right [planning]')) {
    throw new Error(`merged scope list is incomplete: ${listed}`);
  }
  if (Object.hasOwn(shared(right), 'scopes')) throw new Error('merged project.json contains scopes[]');
  console.log('check:scope-registry-from-disk — two clones merge distinct scopes without shared registry writes');
} finally {
  rmSync(root, { recursive: true, force: true });
}
