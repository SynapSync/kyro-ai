#!/usr/bin/env node
// End-to-end contract for the human-approved, digest-bound, tool-owned scope retirement flow.
// Every mutation runs in an isolated temporary workspace; this script never targets repository scopes.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(fileURLToPath(import.meta.url), '../..');
const cli = resolve(repo, 'dist/cli.js');
const fixture = resolve(repo, 'fixtures/evals/close-sprint-happy/state');
const temporaryRoots = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function workspace({ close = true, layered = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'kyro-scope-retire-'));
  temporaryRoots.push(root);
  mkdirSync(join(root, '.home'), { recursive: true });
  cpSync(fixture, root, { recursive: true });
  if (close) {
    const result = run(root, ['close-sprint', '--kyro-scope', 'demo', '--outcome', 'shipped', '--yes']);
    assert(result.status === 0, `fixture close must succeed: ${output(result)}`);
    if (layered) layerize(root);
  }
  return root;
}

function run(root, args, extraEnv = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    env: {
      ...process.env,
      HOME: join(root, '.home'),
      KYRO_TRACE: '0',
      OPENSSL_CONF: '/dev/null',
      ...extraEnv,
    },
    encoding: 'utf-8',
  });
}

function output(result) {
  return `${result.stdout ?? ''}${result.stderr ?? ''}`;
}

function assertFailure(result, code) {
  const text = output(result);
  assert(result.status !== 0, `expected ${code} failure, got success: ${text}`);
  assert(text.includes(`Code: ${code}`) || text.includes(`[${code}]`), `expected ${code}, got: ${text}`);
}

function prepare(root, extra = []) {
  const result = run(root, [
    'scope', 'retire', '--kyro-scope', 'demo', '--reason', 'Scope replaced by the successor.', ...extra,
  ]);
  assert(result.status === 0, `preparation must succeed: ${output(result)}`);
  const text = output(result);
  const match = text.match(/Plan digest: ([0-9a-f]{64})/);
  assert(match, `preparation must print a SHA-256 plan digest: ${text}`);
  return { digest: match[1], text };
}

function apply(root, digest, extra = [], extraEnv = {}) {
  return run(root, [
    'scope', 'retire', '--kyro-scope', 'demo', '--reason', 'Scope replaced by the successor.',
    ...extra, '--digest', digest, '--yes',
  ], extraEnv);
}

function json(path) {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

function scopePath(root, name = 'sprint.json') {
  return join(root, '.agents/kyro/scopes/demo', name);
}

function digestTree(root) {
  const hash = createHash('sha256');
  if (!existsSync(root)) return hash.digest('hex');
  const visit = (path) => {
    const stat = lstatSync(path);
    const name = relative(root, path).split('\\').join('/');
    hash.update(`${stat.isDirectory() ? 'd' : stat.isSymbolicLink() ? 'l' : 'f'}:${name}\0`);
    if (stat.isSymbolicLink()) hash.update(readFileSync(path));
    else if (stat.isDirectory()) {
      for (const entry of readdirSync(path).sort()) visit(join(path, entry));
    } else hash.update(readFileSync(path));
  };
  visit(root);
  return hash.digest('hex');
}

function projectPaths(root) {
  return {
    legacy: join(root, '.agents/kyro/kyro.json'),
    shared: join(root, '.agents/kyro/project.json'),
    local: join(root, '.agents/kyro/local.json'),
  };
}

function layerize(root) {
  const paths = projectPaths(root);
  if (existsSync(paths.shared) && existsSync(paths.local)) return;
  const legacy = json(paths.legacy);
  writeJson(paths.shared, {
    schemaVersion: 4,
    artifactRoot: legacy.artifactRoot,
    scopes: legacy.scopes,
    ...(legacy.principles ? { principles: legacy.principles } : {}),
    ...(legacy.conventions ? { conventions: legacy.conventions } : {}),
    ...(legacy.team ? { team: legacy.team } : {}),
  });
  writeJson(paths.local, {
    schemaVersion: 4,
    activeScope: legacy.activeScope ?? null,
    installedAdapters: legacy.installedAdapters ?? [],
    ...(legacy.runtimePath ? { runtimePath: legacy.runtimePath } : {}),
  });
  rmSync(paths.legacy);
}

function addSuccessor(root) {
  const paths = projectPaths(root);
  const shared = json(paths.shared);
  shared.scopes.push({ id: 'successor', title: 'Successor', status: 'planning' });
  writeJson(paths.shared, shared);
}

try {
  // Preparation and dry-run are read-only and stop at the exact human approval gate.
  {
    const root = workspace();
    const before = digestTree(join(root, '.agents'));
    const prepared = prepare(root);
    assert(prepared.text.includes('Preparation complete. No files changed.'), 'prepare must state that it did not write');
    assert(
      prepared.text.includes('¿Autorizas retirar el scope `demo` con este plan?'),
      'prepare must ask the exact approval question',
    );
    assert(digestTree(join(root, '.agents')) === before, 'prepare must not change any managed file');

    const dryRun = run(root, [
      'scope', 'retire', '--kyro-scope', 'demo', '--reason', 'Scope replaced by the successor.', '--dry-run',
    ]);
    assert(dryRun.status === 0, `dry-run must succeed: ${output(dryRun)}`);
    assert(digestTree(join(root, '.agents')) === before, 'dry-run must not change any managed file');

    const missingYes = run(root, [
      'scope', 'retire', '--kyro-scope', 'demo', '--reason', 'Scope replaced by the successor.',
      '--digest', prepared.digest,
    ]);
    assertFailure(missingYes, 'HUMAN_APPROVAL_REQUIRED');
    assert(digestTree(join(root, '.agents')) === before, 'missing confirmation must not write');

    const wrongDigest = apply(root, `${prepared.digest.slice(0, 63)}${prepared.digest.endsWith('0') ? '1' : '0'}`);
    assertFailure(wrongDigest, 'DIVERGED');
    assert(digestTree(join(root, '.agents')) === before, 'incorrect digest must not write');
  }

  // Missing registration, active sprint, and corrupt close checkpoints fail closed without writes.
  {
    const root = workspace({ close: false });
    const before = digestTree(join(root, '.agents'));
    const active = run(root, [
      'scope', 'retire', '--kyro-scope', 'demo', '--reason', 'No longer needed.',
    ]);
    assertFailure(active, 'SPRINT_ALREADY_ACTIVE');
    assert(digestTree(join(root, '.agents')) === before, 'active-sprint rejection must not write');
  }
  {
    const root = workspace();
    const paths = projectPaths(root);
    rmSync(scopePath(root, 'archive'), { recursive: true, force: true });
    const shared = json(paths.shared);
    shared.scopes = [];
    writeJson(paths.shared, shared);
    const before = digestTree(join(root, '.agents'));
    const missing = run(root, [
      'scope', 'retire', '--kyro-scope', 'demo', '--reason', 'No longer needed.',
    ]);
    assertFailure(missing, 'SCOPE_NOT_FOUND');
    assert(digestTree(join(root, '.agents')) === before, 'unregistered-scope rejection must not write');
  }
  {
    const root = workspace();
    const archive = scopePath(root, 'archive');
    const checkpointName = readdirSync(archive).find((name) => name.endsWith('.checkpoint.json'));
    assert(checkpointName, 'closed fixture must contain a close checkpoint');
    writeFileSync(join(archive, checkpointName), '{ broken', 'utf-8');
    const before = digestTree(join(root, '.agents'));
    const corrupt = run(root, [
      'scope', 'retire', '--kyro-scope', 'demo', '--reason', 'No longer needed.',
    ]);
    assertFailure(corrupt, 'CHECKPOINT_CORRUPT');
    assert(digestTree(join(root, '.agents')) === before, 'corrupt-checkpoint rejection must not write');
  }

  // The approved digest binds both state and archive bytes; stale inputs fail before checkpoint publication.
  {
    const root = workspace();
    const prepared = prepare(root);
    const sprint = json(scopePath(root));
    sprint.objective = `${sprint.objective} changed`;
    writeJson(scopePath(root), sprint);
    const before = digestTree(join(root, '.agents'));
    const stale = apply(root, prepared.digest);
    assertFailure(stale, 'DIVERGED');
    assert(!existsSync(scopePath(root, 'retirement.checkpoint.json')), 'stale apply must not publish a checkpoint');
    assert(digestTree(join(root, '.agents')) === before, 'stale apply must not write');
  }
  {
    const root = workspace();
    const prepared = prepare(root);
    writeFileSync(join(scopePath(root, 'archive'), 'late-byte.txt'), 'changed after approval\n', 'utf-8');
    const before = digestTree(join(root, '.agents'));
    const stale = apply(root, prepared.digest);
    assertFailure(stale, 'DIVERGED');
    assert(digestTree(join(root, '.agents')) === before, 'archive divergence must not write');
  }

  // Successful apply records the terminal lifecycle across every consumer and preserves archive bytes.
  {
    const root = workspace();
    addSuccessor(root);
    const archiveBefore = digestTree(scopePath(root, 'archive'));
    const prepared = prepare(root, ['--superseded-by', 'successor']);
    const result = apply(root, prepared.digest, ['--superseded-by', 'successor']);
    assert(result.status === 0, `apply must succeed: ${output(result)}`);
    assert(digestTree(scopePath(root, 'archive')) === archiveBefore, 'apply must preserve archive byte-for-byte');

    const sprint = json(scopePath(root));
    const retirementCheckpoint = json(scopePath(root, 'retirement.checkpoint.json'));
    const paths = projectPaths(root);
    const shared = json(paths.shared);
    const local = json(paths.local);
    const entry = shared.scopes.find((candidate) => candidate.id === 'demo');
    assert(sprint.status === 'retired' && sprint.handoff.nextAction === 'done', 'sprint must enter the retired terminal state');
    assert(sprint.activeSprint === null, 'retired scope must have no active sprint');
    assert(sprint.retirement.reason === 'Scope replaced by the successor.', 'sprint must record the human reason');
    assert(sprint.retirement.supersededBy === 'successor', 'sprint must record the successor');
    assert(
      retirementCheckpoint.approval?.decision === 'approved'
        && retirementCheckpoint.approval?.approvedPlanDigest === prepared.digest
        && retirementCheckpoint.approval?.identityVerified === false,
      'checkpoint must record the explicit decision without claiming verified identity',
    );
    assert(entry?.status === 'retired' && entry.retirement?.planDigest === prepared.digest, 'registry must record retirement');
    assert(local.activeScope === null, 'retiring the active scope must clear local activeScope');

    const status = run(root, ['status', 'brief', '--kyro-scope', 'demo', '--json']);
    assert(status.status === 0, `status must understand retired scopes: ${output(status)}`);
    const statusJson = JSON.parse(status.stdout);
    assert(statusJson.status === 'retired' && statusJson.nextAction === 'done', 'status must report retired/done');
    assert(statusJson.retirement?.supersededBy === 'successor', 'status must expose retirement metadata');

    const context = run(root, ['context-pack', '--kyro-scope', 'demo', '--json']);
    assert(context.status === 0, `context-pack must understand retired scopes: ${output(context)}`);
    const contextJson = JSON.parse(context.stdout);
    assert(contextJson.nextAction === 'done' && contextJson.retirement?.planDigest === prepared.digest, 'context-pack must terminate at done');

    const doctor = run(root, ['doctor', '--artifacts', '--kyro-scope', 'demo']);
    assert(doctor.status === 0, `doctor must certify a retired scope: ${output(doctor)}`);
    assert(output(doctor).includes('retirement.checkpoint.json'), 'doctor must inspect the retirement transaction');

    const analyze = run(root, ['analyze', '--kyro-scope', 'demo', '--json']);
    assert(analyze.status === 0, `analyze must accept retired state: ${output(analyze)}`);
    const repairBefore = digestTree(join(root, '.agents'));
    const repair = run(root, ['repair', '--kyro-scope', 'demo', '--dry-run']);
    assert(repair.status === 0, `repair dry-run must understand retired state: ${output(repair)}`);
    assert(digestTree(join(root, '.agents')) === repairBefore, 'repair dry-run must preserve retired state');

    const repairApply = run(root, ['repair', '--kyro-scope', 'demo', '--yes']);
    assertFailure(repairApply, 'SCOPE_RETIRED');
    assert(digestTree(join(root, '.agents')) === repairBefore, 'terminal write guard must preserve retired state');

    const activate = run(root, ['scope', 'set-active', 'demo', '--yes']);
    assertFailure(activate, 'SCOPE_RETIRED');

    const retryBefore = digestTree(join(root, '.agents'));
    const retry = apply(root, prepared.digest, ['--superseded-by', 'successor']);
    assert(retry.status === 0 && output(retry).includes('resumed=true'), `identical retry must be safe: ${output(retry)}`);
    assert(digestTree(join(root, '.agents')) === retryBefore, 'identical retry must be an exact no-op when tracing is disabled');

    const changedReason = run(root, [
      'scope', 'retire', '--kyro-scope', 'demo', '--reason', 'A different reason.',
      '--superseded-by', 'successor', '--digest', prepared.digest, '--yes',
    ]);
    assertFailure(changedReason, 'CHECKPOINT_CONFLICT');
  }

  // A legacy monolithic workspace migrates through the existing compatibility path on apply.
  {
    const root = workspace({ layered: false });
    const archiveBefore = digestTree(scopePath(root, 'archive'));
    const prepared = prepare(root);
    const result = apply(root, prepared.digest);
    assert(result.status === 0, `legacy workspace apply must succeed: ${output(result)}`);
    const paths = projectPaths(root);
    assert(existsSync(paths.shared) && existsSync(paths.local), 'legacy apply must produce project/local layers');
    assert(existsSync(`${paths.legacy}.migrated`), 'legacy state must be preserved as the standard migration backup');
    assert(digestTree(scopePath(root, 'archive')) === archiveBefore, 'legacy migration must preserve archive bytes');
  }

  // The immutable transaction resumes after interruption, including a split project-layer write.
  {
    const root = workspace();
    const archiveBefore = digestTree(scopePath(root, 'archive'));
    const prepared = prepare(root);
    const interrupted = apply(root, prepared.digest, [], { KYRO_TEST_RETIRE_FAIL_AFTER: 'sprint' });
    assert(interrupted.status !== 0, 'injected interruption must fail');
    const checkpoint = json(scopePath(root, 'retirement.checkpoint.json'));
    assert(json(scopePath(root)).status === 'retired', 'sprint write must be durable before interruption');

    // Simulate a crash after the shared registry layer but before the local active-scope layer.
    const paths = projectPaths(root);
    const shared = json(paths.shared);
    shared.scopes = checkpoint.afterProject.scopes;
    writeJson(paths.shared, shared);
    assert(json(paths.local).activeScope === 'demo', 'fixture must represent the partial layered write');

    const resumed = apply(root, prepared.digest);
    assert(resumed.status === 0, `retry must converge an interrupted transaction: ${output(resumed)}`);
    assert(json(paths.local).activeScope === null, 'resume must finish the local layer');
    assert(digestTree(scopePath(root, 'archive')) === archiveBefore, 'resume must preserve archive bytes');
  }

  // Projected workflow owns the human pause and no Forge/routing/handoff path auto-invokes apply.
  {
    const router = readFileSync(resolve(repo, 'commands/scope-retire.md'), 'utf-8');
    assert(router.includes('¿Autorizas retirar el scope `<scope>` con este plan?'), 'router must contain the exact approval question');
    assert(/STOP/i.test(router), 'router must explicitly stop after asking for approval');
    const forbiddenRoots = ['agents', 'internal/skills/sprint-forge', 'commands/forge.md', 'commands/task-context.md'];
    for (const rootName of forbiddenRoots) {
      const path = resolve(repo, rootName);
      const files = lstatSync(path).isDirectory() ? listFiles(path) : [path];
      for (const file of files) {
        const text = readFileSync(file, 'utf-8');
        assert(!text.includes('scope retire'), `${relative(repo, file)} must not auto-route scope retirement`);
      }
    }
  }

  console.log('check:scope-retire — lifecycle, approval, digest, recovery, consumers, and router isolation passed');
} finally {
  for (const root of temporaryRoots) rmSync(root, { recursive: true, force: true });
}

function listFiles(root) {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}
