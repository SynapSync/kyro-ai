// Disposable creator fixtures shared by the registered Work checks.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const creator = { name: 'fixture-checker', email: 'creator@example.test' };
export function isolatedGitEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  for (const key of Object.keys(env)) if (/^GIT_CONFIG/.test(key)) delete env[key];
  return { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_SYSTEM: '/dev/null', GIT_CONFIG_GLOBAL: '/dev/null' };
}
export function git(root, ...args) {
  const result = spawnSync('git', args, { cwd: root, env: isolatedGitEnv(), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}
export function configureCreator(root, name = creator.name, email = creator.email) {
  if (!existsSync(join(root, '.git'))) git(root, 'init', '-q');
  git(root, 'config', 'user.name', name);
  git(root, 'config', 'user.email', email);
}
export function legacyDraft(id, briefBytes) {
  const at = '2026-09-26T00:00:00.000Z';
  return { schemaVersion: 1, kind: 'organic-work', id, title: 'Historical Work', objective: 'Preserve historical creator absence.',
    brief: { path: 'brief.md', digest: createHash('sha256').update(briefBytes).digest('hex'), sourceIdea: null },
    state: 'draft', revision: 1, createdAt: at, updatedAt: at,
    handoff: { nextAction: 'plan_tasks', nextTaskId: null, blockedReason: null }, tasks: [],
    activity: [{ seq: 1, at, event: 'created', taskId: null, by: 'historical-actor', reason: 'Historical fixture.', revision: 1 }], closure: null, promotion: null };
}
export function seedLegacyWork(root, id, source = 'brief.md') {
  const brief = readFileSync(join(root, source));
  const directory = join(root, '.agents/kyro/work', id);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'brief.md'), brief);
  writeFileSync(join(directory, 'work.json'), `${JSON.stringify(legacyDraft(id, brief), null, 2)}\n`);
}
let action = 0;
export function spawnWithAuthor(command, args, options) {
  if (command !== process.execPath || args[0] !== resolve('dist/cli.js') || args[1] !== 'work') return spawnSync(command, args, options);
  const root = options.cwd;
  const verb = args[2];
  const id = args[args.indexOf(verb === 'create' ? '--id' : '--work') + 1];
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id ?? '')) return spawnSync(command, args, { ...options, env: isolatedGitEnv(options.env) });
  const path = join(root, '.agents/kyro/work', id, 'work.json');
  const document = () => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; } };
  const before = document();
  if (verb === 'create') configureCreator(root);
  else configureCreator(root, `Later actor ${++action}`, `later-${action}@example.test`);
  const result = spawnSync(command, args, { ...options, env: isolatedGitEnv(options.env) });
  const after = document();
  if (after) {
    if (before) {
      assert.equal(Object.hasOwn(after, 'author'), Object.hasOwn(before, 'author'), `${verb} preserves creator presence`);
      assert.deepEqual(after.author, before.author, `${verb} preserves every creator field under changed Git identity`);
      assert.equal(after.createdAt, before.createdAt, `${verb} preserves creation time`);
    } else if (result.status === 0 && verb === 'create') {
      assert.deepEqual(after.author, { ...creator, source: 'git', capturedAt: after.createdAt });
    }
    if (result.status === 0 && ['status', 'context-pack'].includes(verb) && args.includes('--json')) {
      const projection = JSON.parse(result.stdout).data.work;
      assert.equal(Object.hasOwn(projection, 'author'), Object.hasOwn(after, 'author'));
      assert.deepEqual(projection.author, after.author);
    }
    if (result.status === 0 && verb === 'promote' && !args.includes('--dry-run')) {
      const sprint = JSON.parse(readFileSync(join(root, after.promotion.targetPath), 'utf8'));
      assert.equal(Object.hasOwn(sprint, 'author'), false, 'Forge destination stays authorless');
    }
  }
  return result;
}
