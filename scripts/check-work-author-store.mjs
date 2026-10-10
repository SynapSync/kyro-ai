// Invoked by check:work-store through the team runner; no standalone target.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { configureCreator, git, isolatedGitEnv, seedLegacyWork } from './work-author-fixtures.mjs';

export function checkWorkAuthorStore() {
  const root = mkdtempSync(join(tmpdir(), 'kyro-work-author-store-'));
  const cli = resolve('dist/cli.js');
  try {
    const a = join(root, 'repo-a'), b = join(root, 'repo-b');
    mkdirSync(a); mkdirSync(b);
    configureCreator(a, 'Creator A', 'a@example.test');
    configureCreator(b, 'Creator B', 'b@example.test');
    writeFileSync(join(b, 'brief.md'), '---\nauthor: Brief author\n---\n# Creator fixture\n\nDeliver an independently verifiable result.\n');
    const global = join(root, 'global.gitconfig');
    writeFileSync(global, '[user]\n name = Global creator\n email = global@example.test\n');
    const run = (args, extra = {}) => spawnSync(process.execPath, [cli, 'work', ...args, '--json'], { cwd: a, env: { ...isolatedGitEnv(), ...extra }, encoding: 'utf8' });
    const ok = (result) => { assert.equal(result.status, 0, result.stdout || result.stderr); return JSON.parse(result.stdout).data; };
    const path = (id) => join(a, '.agents/kyro/work', id, 'work.json');
    const read = (id) => JSON.parse(readFileSync(path(id)));
    const create = (id, env = {}, tail = []) => run(['create', '--id', id, '--from', join(b, 'brief.md'), '--by', 'Creation actor', ...tail], env);
    ok(create('full', { GIT_CONFIG_GLOBAL: global }));
    const captured = read('full').author;
    assert.deepEqual(captured, { name: 'Creator A', email: 'a@example.test', source: 'git', capturedAt: read('full').createdAt });
    assert.equal(read('full').activity[0].by, 'Creation actor');
    const before = readFileSync(path('full'));
    configureCreator(a, 'Later creator', 'later@example.test');
    assert.notEqual(create('full').status, 0);
    assert.deepEqual(readFileSync(path('full')), before, 'collision preserves the first creator');
    ok(create('dry', {}, ['--dry-run']));
    assert.equal(existsSync(path('dry')), false);
    assert.notEqual(run(['create', '--id', 'flag', '--from', join(b, 'brief.md'), '--author', 'Override']).status, 0);

    for (const [id, name, email, identity] of [
      ['name-only', ' Name only ', '', { name: 'Name only' }],
      ['email-only', '', 'email@example.test', { email: 'email@example.test' }],
      ['invalid-email-name', 'Valid name', 'invalid', { name: 'Valid name' }],
      ['empty', '', '', null], ['whitespace', '   ', '', null], ['malformed', '', 'invalid', null],
    ]) {
      configureCreator(a, name, email);
      ok(create(id, { USER: 'Env creator', LOGNAME: 'Env creator', KYRO_ACTOR: 'Env creator' }));
      const work = read(id);
      if (identity) assert.deepEqual(work.author, { ...identity, source: 'git', capturedAt: work.createdAt });
      else assert.equal(Object.hasOwn(work, 'author'), false, `${id} must omit author, including env/brief fallback`);
    }
    // Effective global configuration and conditional includes remain resolver-owned.
    configureCreator(a, '', '');
    git(a, 'config', '--unset', 'user.name'); git(a, 'config', '--unset', 'user.email');
    ok(create('global', { GIT_CONFIG_GLOBAL: global }));
    assert.equal(read('global').author.name, 'Global creator');
    const included = join(root, 'included.gitconfig');
    writeFileSync(included, '[user]\n name = Conditional creator\n email = conditional@example.test\n');
    writeFileSync(global, `[includeIf "gitdir:${a}/.git"]\n path = ${included}\n`);
    ok(create('conditional', { GIT_CONFIG_GLOBAL: global }));
    assert.equal(read('conditional').author.name, 'Conditional creator');
    // A historical Git commit supplies no identity when current config is absent.
    git(a, '-c', 'user.name=Historical committer', '-c', 'user.email=history@example.test', 'commit', '--allow-empty', '-qm', 'Fixture history');
    ok(create('history-only'));
    assert.equal(Object.hasOwn(read('history-only'), 'author'), false);

    configureCreator(a, 'Configured creator', 'configured@example.test');
    for (const mode of ['missing', 'failure', 'timeout']) {
      const bin = join(root, mode); mkdirSync(bin);
      if (mode !== 'missing') {
        writeFileSync(join(bin, 'git'), mode === 'timeout' ? '#!/bin/sh\nexec /bin/sleep 3\n' : '#!/bin/sh\nexit 1\n');
        chmodSync(join(bin, 'git'), 0o755);
      }
      ok(create(mode, { PATH: bin, USER: 'Env creator', LOGNAME: 'Env creator', KYRO_ACTOR: 'Env creator' }));
      assert.equal(Object.hasOwn(read(mode), 'author'), false, `${mode} Git cannot block creation or infer creator`);
    }
    // Fixed pre-feature bytes are read without normalization, then written without backfill.
    writeFileSync(join(a, 'brief.md'), readFileSync(join(b, 'brief.md')));
    seedLegacyWork(a, 'legacy');
    const legacyBytes = readFileSync(path('legacy'));
    for (const id of ['legacy', 'full']) for (const verb of ['status', 'context-pack']) {
      const bytes = readFileSync(path(id));
      const projection = ok(run([verb, '--work', id])).work;
      assert.equal(Object.hasOwn(projection, 'author'), id === 'full');
      assert.deepEqual(projection.author, read(id).author);
      assert.deepEqual(readFileSync(path(id)), bytes, `${verb} must be byte-preserving`);
    }
    assert.deepEqual(readFileSync(path('legacy')), legacyBytes);
    const store = pathToFileURL(resolve('dist/cli/work/store.js')).href;
    const probe = `
      import assert from 'node:assert/strict';
      import { readFileSync } from 'node:fs';
      import { readWork, updateWork } from ${JSON.stringify(store)};
      const author = ${JSON.stringify(captured)};
      for (const id of ['legacy', 'full']) {
        const path = '.agents/kyro/work/' + id + '/work.json';
        const bytes = readFileSync(path);
        assert.equal(Object.hasOwn(readWork(id), 'author'), id === 'full');
        assert.deepEqual(readFileSync(path), bytes);
        const mutations = id === 'legacy' ? [(w) => { w.author = author; }] : [
          (w) => { delete w.author; }, (w) => { w.author = { ...w.author, name: 'Other' }; },
          ...['name', 'email', 'source', 'capturedAt'].map((key) => (w) => { w.author[key] = key === 'capturedAt' ? '2026-10-01T00:00:00.000Z' : 'Other'; }),
        ];
        for (const mutate of mutations) {
          assert.throws(() => updateWork(id, 1, (w) => { mutate(w); return { ...w, revision: 2 }; }), /preserve its creation-time author/);
          assert.deepEqual(readFileSync(path), bytes, 'illegal author transition must not publish');
        }
        const updated = updateWork(id, 1, (w) => {
          const now = new Date().toISOString();
          const task = { id: 'W1', title: 'Unrelated task plan', description: 'Plan an unrelated valid task.', context: '', filesToTouch: [], acceptanceCriteria: ['Plan is valid.'], dependsOn: [], status: 'pending', blocker: null, evidence: null, verdict: null, disposition: null, definitionRevision: 1 };
          return { ...w, state: 'active', revision: 2, updatedAt: now, tasks: [task], handoff: { nextAction: 'execute_task', nextTaskId: 'W1', blockedReason: null }, activity: [...w.activity, { seq: 2, at: now, event: 'tasks_planned', taskId: null, by: 'Planner B', reason: 'Valid unrelated transition.', revision: 2 }] };
        });
        assert.deepEqual(updated.author, id === 'full' ? author : undefined);
        assert.equal(Object.hasOwn(updated, 'author'), id === 'full');
      }
    `;
    const probePath = join(root, 'author-store-probe.mjs'); writeFileSync(probePath, probe);
    const result = spawnSync(process.execPath, [probePath], { cwd: a, env: isolatedGitEnv(), encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    console.log('Work creator capture matrix, explicit cwd, legacy reads, projections, and immutable store guard passed.');
  } finally { rmSync(root, { recursive: true, force: true }); }
}
