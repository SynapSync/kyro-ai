import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const root = mkdtempSync(join(tmpdir(), 'kyro-work-store-'));
const cli = resolve('dist/cli.js');
const brief = join(root, 'brief.md'); writeFileSync(brief, '# Store test\n\nValidate isolated storage with a durable test outcome.\n');
const run = (...args) => spawnSync(process.execPath, [cli, 'work', ...args], { cwd: root, encoding: 'utf8' });
const runConcurrent = (...args) => new Promise((resolveRun) => {
  const child = spawn(process.execPath, [cli, 'work', ...args], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
  child.on('close', (status) => resolveRun({ status, stdout, stderr }));
});
try {
  const dry = run('create', '--id', 'dry-run', '--from', 'brief.md', '--dry-run', '--json'); assert.equal(dry.status, 0, dry.stderr); assert(!existsSync(join(root, '.agents/kyro/work/dry-run')));
  const created = run('create', '--id', 'first-work', '--from', 'brief.md', '--json'); assert.equal(created.status, 0, created.stderr);
  const createdWork = JSON.parse(readFileSync(join(root, '.agents/kyro/work/first-work/work.json'), 'utf8'));
  assert.equal(createdWork.title, 'Store test'); assert.equal(createdWork.objective, 'Validate isolated storage with a durable test outcome.');
  assert.equal(readFileSync(join(root, '.agents/kyro/work/first-work/brief.md'), 'utf8'), readFileSync(brief, 'utf8'), 'create must preserve original brief bytes');
  assert.equal(createdWork.brief.digest, createHash('sha256').update(readFileSync(brief)).digest('hex'), 'create must digest the exact source brief');
  const original = readFileSync(join(root, '.agents/kyro/work/first-work/work.json'), 'utf8');
  const collision = run('create', '--id', 'first-work', '--from', 'brief.md', '--json'); assert.notEqual(collision.status, 0); assert.equal(readFileSync(join(root, '.agents/kyro/work/first-work/work.json'), 'utf8'), original);
  const unsafe = run('create', '--id', '../escape', '--from', 'brief.md', '--json'); assert.notEqual(unsafe.status, 0); assert(!existsSync(join(root, 'escape')));
  const absolute = run('create', '--id', '/tmp/kyro-work-escape', '--from', 'brief.md', '--json'); assert.notEqual(absolute.status, 0); assert(!existsSync('/tmp/kyro-work-escape'));
  const second = run('create', '--id', 'second-work', '--from', 'brief.md', '--json'); assert.equal(second.status, 0, second.stderr);
  assert(existsSync(join(root, '.agents/kyro/work/second-work/work.json')));
  const status = run('status', '--work', 'second-work', '--json'); assert.equal(status.status, 0, status.stderr); assert.equal(JSON.parse(status.stdout).data.nextAction, 'plan_tasks');
  const context = run('context-pack', '--work', 'second-work', '--json'); assert.equal(context.status, 0, context.stderr); assert.equal(JSON.parse(context.stdout).data.work.revision, 1);

  const ideaPath = '.agents/kyro/plan/idea-shaped.md';
  const ideaText = '---\ndocType: plan\ntitle: Front matter title\n---\n\n# Idea heading stays the title\n\n## Core thesis\n\nDeliver a verifiable outcome from the first body statement.\n\n## Later section\n\nOther text.\n';
  mkdirSync(join(root, '.agents/kyro/plan'), { recursive: true }); writeFileSync(join(root, ideaPath), ideaText);
  const ideaCreate = run('create', '--id', 'idea-work', '--from', ideaPath, '--json'); assert.equal(ideaCreate.status, 0, ideaCreate.stderr);
  const ideaWork = JSON.parse(readFileSync(join(root, '.agents/kyro/work/idea-work/work.json'), 'utf8'));
  assert.equal(ideaWork.title, 'Idea heading stays the title');
  assert.equal(ideaWork.objective, 'Deliver a verifiable outcome from the first body statement.');
  assert.equal(ideaWork.brief.sourceIdea.path, ideaPath);

  writeFileSync(join(root, 'missing-outcome.md'), '---\ntitle: Only metadata\n---\n\n# Only a title\n');
  writeFileSync(join(root, 'one-character.md'), 'x\n');
  for (const [id, source] of [['missing-outcome', 'missing-outcome.md'], ['one-character', 'one-character.md']]) {
    const rejected = run('create', '--id', id, '--from', source, '--json');
    assert.notEqual(rejected.status, 0, `${source} must fail without an outcome`);
    assert(!existsSync(join(root, '.agents/kyro/work', id)), `${source} must not publish a Work directory`);
  }

  const invalidWorkPath = join(root, '.agents/kyro/work/second-work/work.json');
  const validWorkText = readFileSync(invalidWorkPath, 'utf8');
  const invalidWork = JSON.parse(validWorkText); invalidWork.handoff = { nextAction: 'done', nextTaskId: null, blockedReason: null };
  writeFileSync(invalidWorkPath, JSON.stringify(invalidWork, null, 2) + '\n');
  for (const verb of ['status', 'context-pack']) {
    const invalidRead = run(verb, '--work', 'second-work', '--json');
    assert.notEqual(invalidRead.status, 0, `${verb} must reject an invalid Work document`);
    const envelope = JSON.parse(invalidRead.stdout);
    assert.equal(envelope.ok, false); assert.match(envelope.error.message, /handoff\.nextAction/);
    assert.notEqual(envelope.data?.nextAction, 'done');
  }
  writeFileSync(invalidWorkPath, validWorkText);

  const storeModule = pathToFileURL(resolve('dist/cli/work/store.js')).href;
  const transitionProbe = `
    const store = await import(${JSON.stringify(storeModule)});
    const { readFileSync } = await import('node:fs');
    const before = readFileSync('.agents/kyro/work/second-work/work.json', 'utf8');
    const updated = store.updateWork('second-work', 1, (current) => {
      const now = new Date().toISOString();
      const task = { id: 'W1', title: 'Verify storage', description: 'Verify the storage transition.', context: '', filesToTouch: [], acceptanceCriteria: ['Storage transition is valid.'], dependsOn: [], status: 'pending', blocker: null, evidence: null, verdict: null, disposition: null, definitionRevision: 1 };
      return { ...current, state: 'active', revision: current.revision + 1, updatedAt: now, tasks: [task], handoff: { nextAction: 'execute_task', nextTaskId: 'W1', blockedReason: null }, activity: [...current.activity, { seq: current.activity.length + 1, at: now, event: 'tasks_planned', taskId: null, by: 'cli', reason: 'Storage fixture planned a task.', revision: current.revision + 1 }] };
    });
    const afterValid = readFileSync('.agents/kyro/work/second-work/work.json', 'utf8');
    let staleCode = ''; let staleMessage = '';
    try { store.updateWork('second-work', 1, (current) => ({ ...current, revision: current.revision + 1 })); }
    catch (error) { staleCode = error.code ?? error.name; staleMessage = error.message; }
    const afterStale = readFileSync('.agents/kyro/work/second-work/work.json', 'utf8');
    let invalidCode = '';
    try { store.updateWork('second-work', 2, (current) => ({ ...current, revision: current.revision + 1, handoff: { nextAction: 'done', nextTaskId: null, blockedReason: null } })); }
    catch (error) { invalidCode = error.code ?? error.name; }
    const afterInvalid = readFileSync('.agents/kyro/work/second-work/work.json', 'utf8');
    console.log(JSON.stringify({ updatedRevision: updated.revision, before, afterValid, staleCode, staleMessage, invalidCode, validUpdatePublished: before !== afterValid, afterValidEqualsAfterStale: afterValid === afterStale, afterValidEqualsAfterInvalid: afterValid === afterInvalid }));
  `;
  const transitionPath = join(root, 'store-transition-probe.mjs'); writeFileSync(transitionPath, transitionProbe);
  const transition = spawnSync(process.execPath, [transitionPath], { cwd: root, encoding: 'utf8' });
  assert.equal(transition.status, 0, transition.stderr);
  const transitionResult = JSON.parse(transition.stdout.trim());
  assert.equal(transitionResult.updatedRevision, 2, 'valid update must increment revision exactly once');
  assert(transitionResult.validUpdatePublished, 'valid update must publish the new Work');
  assert.equal(transitionResult.staleCode, 'STATE_DIVERGED', `stale revision must be rejected: ${JSON.stringify(transitionResult)}`);
  assert.equal(transitionResult.invalidCode, 'INVALID_INPUT', 'invalid update must be rejected');
  assert(transitionResult.afterValidEqualsAfterStale, 'stale revision failure must preserve the latest valid Work bytes');
  assert(transitionResult.afterValidEqualsAfterInvalid, 'invalid update must preserve the latest valid Work bytes');

  const badRootWorkspace = mkdtempSync(join(tmpdir(), 'kyro-work-root-file-'));
  mkdirSync(join(badRootWorkspace, '.agents/kyro'), { recursive: true });
  writeFileSync(join(badRootWorkspace, '.agents/kyro/work'), 'not a directory');
  writeFileSync(join(badRootWorkspace, 'brief.md'), '# Root test\n\nReject a non-directory root before publishing any Work files.\n');
  const badRoot = spawnSync(process.execPath, [cli, 'work', 'create', '--id', 'blocked-by-root', '--from', 'brief.md', '--json'], { cwd: badRootWorkspace, encoding: 'utf8' });
  assert.notEqual(badRoot.status, 0, 'a non-directory Work root must fail closed');
  assert(!existsSync(join(badRootWorkspace, '.agents/kyro/work/blocked-by-root')));
  rmSync(badRootWorkspace, { recursive: true, force: true });

  const concurrent = await Promise.all([
    runConcurrent('create', '--id', 'same-id', '--from', 'brief.md', '--json'),
    runConcurrent('create', '--id', 'same-id', '--from', 'brief.md', '--json'),
  ]);
  assert.equal(concurrent.filter((result) => result.status === 0).length, 1, 'same-ID concurrent creates must have one winner');
  assert.equal(concurrent.filter((result) => result.status !== 0).length, 1, 'same-ID concurrent creates must have one conflict');

  writeFileSync(join(root, '.agents/kyro/work/second-work/brief.md'), 'changed outside the CLI\n');
  const mismatch = run('status', '--work', 'second-work', '--json'); assert.equal(mismatch.status, 0, mismatch.stderr); assert.equal(JSON.parse(mismatch.stdout).data.nextAction, 'resolve_blocker');
  const outside = join(root, 'outside'); writeFileSync(outside, 'preserve external file\n');
  const link = join(root, '.agents/kyro/work/linked'); symlinkSync(outside, link); const symlink = run('create', '--id', 'linked', '--from', 'brief.md', '--json'); assert.notEqual(symlink.status, 0);
  assert.equal(readFileSync(outside, 'utf8'), 'preserve external file\n', 'symlink rejection must preserve external files');

  // --- T4.1 hardened create ingestion: unsafe sources fail before publication ---
  mkdirSync(join(root, '.agents/kyro/scopes/forge-existing'), { recursive: true });
  const t41Forge = ['.agents/kyro/project.json', '.agents/kyro/local.json', '.agents/kyro/scopes/forge-existing/sprint.json'];
  t41Forge.forEach((entry) => writeFileSync(join(root, entry), `{"sentinel":"${entry}"}\n`));
  const t41ForgeBefore = t41Forge.map((entry) => readFileSync(join(root, entry)));
  const t41ForgeUnchanged = (label) => t41Forge.forEach((entry, index) => assert.deepEqual(readFileSync(join(root, entry)), t41ForgeBefore[index], `${label} must preserve Forge layer ${entry}`));
  const t41Fail = (args, code, pattern) => {
    const result = run(...args);
    assert.notEqual(result.status, 0, `${args.join(' ')} must fail`);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.ok, false, 'rejection must use the CLI error envelope');
    assert.equal(envelope.error.code, code, `expected error code ${code}`);
    if (pattern) assert.match(envelope.error.message, pattern);
  };
  const t41NoPartialWork = (id, label) => assert(!existsSync(join(root, '.agents/kyro/work', id)), `${label} must not publish a partial Work directory`);
  writeFileSync(join(root, 'malformed-create.md'), Buffer.from([35, 32, 88, 10, 10, 0xff, 10]));
  t41Fail(['create', '--id', 'malformed-work', '--from', 'malformed-create.md', '--json'], 'INVALID_INPUT', /malformed UTF-8/);
  t41NoPartialWork('malformed-work', 'malformed UTF-8 source');
  symlinkSync(join(root, 'brief.md'), join(root, 'linked-source.md'));
  t41Fail(['create', '--id', 'linked-source-work', '--from', 'linked-source.md', '--json'], 'INVALID_INPUT', /symbolic links/);
  t41NoPartialWork('linked-source-work', 'symlink source');
  writeFileSync(join(root, 'oversized-create.md'), `# Oversized\n\n${'x'.repeat(1_048_576)}\n`);
  t41Fail(['create', '--id', 'oversized-work', '--from', 'oversized-create.md', '--json'], 'INVALID_INPUT', /1 MiB/);
  t41NoPartialWork('oversized-work', 'oversized source');
  t41Fail(['create', '--id', 'missing-work', '--from', 'no-such-brief.md', '--json'], 'INVALID_INPUT', /cannot be opened/);
  t41NoPartialWork('missing-work', 'missing source');
  // A source that misreports its size (virtual size-0 file with readable content)
  // proves post-size-check growth fails closed without publication.
  let growthProven = false;
  try {
    const procVersion = '/proc/version';
    const preview = readFileSync(procVersion);
    if (preview.length > 0) {
      t41Fail(['create', '--id', 'grown-work', '--from', procVersion, '--json'], 'INVALID_INPUT', /changed size during read/);
      t41NoPartialWork('grown-work', 'grown source');
      growthProven = true;
    }
  } catch { /* Non-Linux hosts skip the virtual-file growth probe; the unit probe below still covers swap logic. */ }
  const briefSourceModule = await import(pathToFileURL(resolve('dist/cli/work/brief-source.js')).href);
  briefSourceModule.assertStableSourceIdentity({ dev: 1, ino: 1, size: 10, mtimeMs: 5 }, { dev: 1, ino: 1, size: 10, mtimeMs: 5 }, 10);
  assert.throws(() => briefSourceModule.assertStableSourceIdentity({ dev: 1, ino: 1, size: 10, mtimeMs: 5 }, { dev: 1, ino: 2, size: 10, mtimeMs: 5 }, 10), /replaced during read/, 'a swapped source must fail');
  assert.throws(() => briefSourceModule.assertStableSourceIdentity({ dev: 1, ino: 1, size: 10, mtimeMs: 5 }, { dev: 1, ino: 1, size: 11, mtimeMs: 5 }, 10), /changed size during read/, 'a grown source must fail');
  assert.throws(() => briefSourceModule.assertStableSourceIdentity({ dev: 1, ino: 1, size: 10, mtimeMs: 5 }, { dev: 1, ino: 1, size: 10, mtimeMs: 6 }, 10), /modified during read/, 'a source modified mid-read must fail');
  assert(growthProven, 'the virtual-file growth probe must run on Linux');
  // Valid Unicode, CRLF, and BOM sources publish byte-for-byte with a matching digest.
  const unicodeBytes = Buffer.from('# Résumé 🌱\r\n\r\nDeliver an exact Unicode and CRLF contract.\r\n');
  writeFileSync(join(root, 'unicode-crlf.md'), unicodeBytes);
  const unicodeCreated = run('create', '--id', 'unicode-work', '--from', 'unicode-crlf.md', '--json');
  assert.equal(unicodeCreated.status, 0, unicodeCreated.stderr);
  assert.deepEqual(readFileSync(join(root, '.agents/kyro/work/unicode-work/brief.md')), unicodeBytes, 'Unicode and CRLF bytes must publish verbatim');
  assert.equal(JSON.parse(readFileSync(join(root, '.agents/kyro/work/unicode-work/work.json'), 'utf8')).brief.digest, createHash('sha256').update(unicodeBytes).digest('hex'), 'digest must bind the original source bytes');
  const bomBytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('# BOM title\n\nA BOM-prefixed brief keeps its exact outcome bytes.\n')]);
  writeFileSync(join(root, 'bom-brief.md'), bomBytes);
  const bomCreated = run('create', '--id', 'bom-work', '--from', 'bom-brief.md', '--json');
  assert.equal(bomCreated.status, 0, bomCreated.stderr);
  assert.deepEqual(readFileSync(join(root, '.agents/kyro/work/bom-work/brief.md')), bomBytes, 'BOM bytes must publish verbatim');
  assert.equal(JSON.parse(readFileSync(join(root, '.agents/kyro/work/bom-work/work.json'), 'utf8')).title, 'BOM title', 'BOM must not corrupt title extraction');
  t41ForgeUnchanged('failed and valid creates');
  console.log('Work store isolation fixtures passed.');
} finally { rmSync(root, { recursive: true, force: true }); }
