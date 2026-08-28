#!/usr/bin/env node
// End-to-end contract for the human-approved, digest-bound, tool-owned scope retirement flow.
// Every mutation runs in an isolated temporary workspace; this script never targets repository scopes.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
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
const require = createRequire(import.meta.url);
const { scopeCompletionRequestDigest } = require(join(repo, 'dist/cli/checkpoints/lifecycle-state.js'));

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

function integrityPrepare(root) {
  const result = run(root, ['repair', 'integrity', 'prepare', '--kyro-scope', 'demo', '--json']);
  let plan = null;
  try {
    plan = JSON.parse(result.stdout);
  } catch {
    // The caller will surface the command output in its assertion. Keeping parsing here means the
    // acceptance cases below exercise the public JSON contract rather than an implementation detail.
  }
  return { result, plan };
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

  // Explicit scope completion (T2.2): a confirmed tool-owned transition, distinct from retirement.
  {
    const root = workspace();
    const archiveBefore = digestTree(scopePath(root, 'archive'));
    // The workspace() fixture closed the sprint, so sprint.json is the checkpoint after-image.
    const pristineSprint = readFileSync(scopePath(root), 'utf-8');
    const restorePristine = () => writeFileSync(scopePath(root), pristineSprint);

    // Refuse an active sprint with no write.
    const activeSprint = json(scopePath(root));
    activeSprint.activeSprint = {
      n: 1, slug: 's1', title: 'S1', objective: 'o', status: 'planned',
      phases: [{ id: 'P1', title: 'P1', objective: 'o', status: 'pending', tasks: [] }],
      emergentTasks: [], definitionOfDone: [],
    };
    activeSprint.handoff = { nextAction: 'execute_task', nextTaskId: null, blockers: [], note: '', lastUpdated: '2026-07-02' };
    writeJson(scopePath(root), activeSprint);
    const refusedActive = run(root, ['scope', 'complete', '--kyro-scope', 'demo', '--summary', 'done', '--yes']);
    assertFailure(refusedActive, 'NOT_READY_TO_COMPLETE');
    assert(digestTree(scopePath(root, 'archive')) === archiveBefore, 'refused completion must not touch archive');
    restorePristine();

    // Refuse open debt with no write.
    const sprint = json(scopePath(root));
    sprint.activeSprint = null;
    sprint.debt = [{ id: 'D-1', title: 'Open debt', origin: 1, priority: 'high', status: 'open', targetSprint: 2, note: 'guard' }];
    writeJson(scopePath(root), sprint);
    const refusedDebt = run(root, ['scope', 'complete', '--kyro-scope', 'demo', '--summary', 'done', '--yes']);
    assertFailure(refusedDebt, 'NOT_READY_TO_COMPLETE');
    assert(digestTree(scopePath(root, 'archive')) === archiveBefore, 'refused completion must not touch archive');
    restorePristine();

    // Dry-run previews without writing.
    const dry = run(root, ['scope', 'complete', '--kyro-scope', 'demo', '--summary', 'All done.', '--dry-run']);
    assert(dry.status === 0, `dry-run must succeed: ${output(dry)}`);
    assert(digestTree(scopePath(root, 'archive')) === archiveBefore, 'dry-run must not touch archive');

    // Missing confirmation fails closed.
    const unconfirmed = run(root, ['scope', 'complete', '--kyro-scope', 'demo', '--summary', 'All done.']);
    assertFailure(unconfirmed, 'CONFIRMATION_REQUIRED');
    assert(digestTree(scopePath(root, 'archive')) === archiveBefore, 'unconfirmed completion must not touch archive');

    // Happy path: apply records completion as a distinct lifecycle fact (completed, not retired).
    const applied = run(root, ['scope', 'complete', '--kyro-scope', 'demo', '--summary', 'All demo work done.', '--yes']);
    assert(applied.status === 0, `complete apply must succeed: ${output(applied)}`);
    const completedSprint = json(scopePath(root));
    assert(completedSprint.status === 'completed', 'sprint must enter completed state');
    assert(completedSprint.handoff.nextAction === 'done', 'completion must set nextAction=done');
    assert(completedSprint.activeSprint === null, 'completed scope must have no active sprint');
    assert(completedSprint.completion && completedSprint.completion.summary === 'All demo work done.', 'completion record must persist the summary');
    assert(completedSprint.retirement === undefined, 'completion must NOT mint retirement metadata');
    assert(digestTree(scopePath(root, 'archive')) === archiveBefore, 'completion must never rewrite archive/');
    const paths = projectPaths(root);
    const sharedEntry = json(paths.shared).scopes.find((candidate) => candidate.id === 'demo');
    assert(sharedEntry?.status === 'completed' && sharedEntry.completion?.summary === 'All demo work done.', 'registry must record completion status and metadata');

    // Completion is visible in status and context-pack, distinct from retirement.
    const status = run(root, ['status', 'brief', '--kyro-scope', 'demo', '--json']);
    assert(status.status === 0, `status must understand completed scopes: ${output(status)}`);
    const statusJson = JSON.parse(status.stdout);
    assert(statusJson.status === 'completed' && statusJson.nextAction === 'done', 'status must report completed/done');
    assert(statusJson.retirement === null, 'status must not conflate completion with retirement');
    const context = run(root, ['context-pack', '--kyro-scope', 'demo', '--json']);
    assert(context.status === 0, `context-pack must understand completed scopes: ${output(context)}`);
    assert(JSON.parse(context.stdout).nextAction === 'done', 'context-pack must terminate at done');

    // Completion cannot be applied twice, and a completed scope cannot be retired without a conflict.
    const twice = run(root, ['scope', 'complete', '--kyro-scope', 'demo', '--summary', 'again', '--yes']);
    assertFailure(twice, 'COMPLETION_CONFLICT');
  }

  // Scope completion recovery: a single locked transaction, revalidated and resumable. A fault
  // injected after the sprint write but before the registry write must leave sprint.json durably
  // completed and the registry untouched; retrying the identical request must resume by writing only
  // the registry, and retrying again after that must be a byte-for-byte no-op.
  {
    const root = workspace();
    const archiveBefore = digestTree(scopePath(root, 'archive'));
    const paths = projectPaths(root);

    const interrupted = run(
      root,
      ['scope', 'complete', '--kyro-scope', 'demo', '--summary', 'Recovery summary.', '--yes'],
      { KYRO_TEST_COMPLETE_FAIL_AFTER: 'sprint' },
    );
    assert(interrupted.status !== 0, `injected sprint-boundary failure must fail: ${output(interrupted)}`);
    const afterFault = json(scopePath(root));
    assert(afterFault.status === 'completed' && afterFault.completion?.requestDigest, 'sprint write must be durable before interruption');
    const sprintBytesAfterFault = readFileSync(scopePath(root), 'utf-8');
    const registryAfterFault = json(paths.shared).scopes.find((s) => s.id === 'demo');
    assert(registryAfterFault?.status !== 'completed', 'registry must still be pre-transition after the injected failure');
    assert(digestTree(scopePath(root, 'archive')) === archiveBefore, 'interrupted completion must never touch archive/');

    // Retry the identical request: must resume by finishing only the registry write.
    const resumed = run(root, ['scope', 'complete', '--kyro-scope', 'demo', '--summary', 'Recovery summary.', '--yes']);
    assert(resumed.status === 0, `resume must succeed: ${output(resumed)}`);
    assert(output(resumed).includes('resumed=true'), `resume must report resumed=true: ${output(resumed)}`);
    assert(readFileSync(scopePath(root), 'utf-8') === sprintBytesAfterFault, 'resume must not rewrite sprint.json');
    const registryAfterResume = json(paths.shared).scopes.find((s) => s.id === 'demo');
    assert(registryAfterResume?.status === 'completed', 'resume must finish the registry update');
    assert(
      JSON.stringify(registryAfterResume.completion) === JSON.stringify(afterFault.completion),
      'resumed registry completion must exactly match the authorized sprint completion',
    );
    assert(digestTree(scopePath(root, 'archive')) === archiveBefore, 'resume must never touch archive/');

    // Idempotent retry against a fully-applied state must write nothing new (no new timestamps, no
    // new bytes anywhere in the tree).
    const wholeTreeBefore = digestTree(join(root, '.agents'));
    const noop = run(root, ['scope', 'complete', '--kyro-scope', 'demo', '--summary', 'Recovery summary.', '--yes']);
    assert(noop.status === 0, `idempotent retry must succeed: ${output(noop)}`);
    assert(output(noop).includes('resumed=true'), `idempotent retry must report resumed=true: ${output(noop)}`);
    assert(digestTree(join(root, '.agents')) === wholeTreeBefore, 'idempotent retry must write zero new bytes');

    // The intent digest alone is not sufficient evidence of success. If a concurrent or manual
    // writer leaves the same completion record on a non-terminal registry entry, retry must fail
    // closed rather than declaring the request a no-op.
    const malformedProject = json(paths.shared);
    malformedProject.scopes.find((s) => s.id === 'demo').status = 'planning';
    writeJson(paths.shared, malformedProject);
    const malformedBytes = readFileSync(paths.shared, 'utf-8');
    const malformedRetry = run(root, ['scope', 'complete', '--kyro-scope', 'demo', '--summary', 'Recovery summary.', '--yes']);
    assertFailure(malformedRetry, 'DIVERGED');
    assert(readFileSync(paths.shared, 'utf-8') === malformedBytes, 'a digest-matching but non-terminal registry must not be overwritten');
  }

  // Scope completion: an incompatible retry (different summary) against an already-completed scope
  // fails closed as a conflict, and an externally modified registry between an interrupted sprint
  // write and the resume fails closed as diverged — neither case may overwrite anything.
  {
    const root = workspace();
    const archiveBefore = digestTree(scopePath(root, 'archive'));
    const paths = projectPaths(root);

    const applied = run(root, ['scope', 'complete', '--kyro-scope', 'demo', '--summary', 'Original summary.', '--yes']);
    assert(applied.status === 0, `complete apply must succeed: ${output(applied)}`);
    const wholeTreeBeforeConflict = digestTree(join(root, '.agents'));
    const differentSummary = run(root, ['scope', 'complete', '--kyro-scope', 'demo', '--summary', 'Different summary.', '--yes']);
    assertFailure(differentSummary, 'COMPLETION_CONFLICT');
    assert(digestTree(join(root, '.agents')) === wholeTreeBeforeConflict, 'a conflicting retry must not write anything');

    const root2 = workspace();
    const archiveBefore2 = digestTree(scopePath(root2, 'archive'));
    const interrupted = run(
      root2,
      ['scope', 'complete', '--kyro-scope', 'demo', '--summary', 'Recovery summary.', '--yes'],
      { KYRO_TEST_COMPLETE_FAIL_AFTER: 'sprint' },
    );
    assert(interrupted.status !== 0, `injected sprint-boundary failure must fail: ${output(interrupted)}`);
    const paths2 = projectPaths(root2);
    const shared = json(paths2.shared);
    const entry = shared.scopes.find((s) => s.id === 'demo');
    entry.title = 'Renamed by a concurrent writer';
    writeJson(paths2.shared, shared);
    const tamperedBytes = readFileSync(paths2.shared, 'utf-8');
    const resumeAttempt = run(root2, ['scope', 'complete', '--kyro-scope', 'demo', '--summary', 'Recovery summary.', '--yes']);
    assertFailure(resumeAttempt, 'DIVERGED');
    assert(readFileSync(paths2.shared, 'utf-8') === tamperedBytes, "a diverged resume must not lose the concurrent writer's change");
    assert(digestTree(scopePath(root2, 'archive')) === archiveBefore2, 'a diverged resume must never touch archive/');
  }

  // Scope completion: a concurrent writer that changes sprint.json between the read-only --dry-run
  // preview and the real --yes apply must be caught by fresh in-lock precondition re-validation, and
  // its change must not be lost.
  {
    const root = workspace();
    const preview = run(root, ['scope', 'complete', '--kyro-scope', 'demo', '--summary', 'Preview summary.', '--dry-run']);
    assert(preview.status === 0, `dry-run preview must succeed: ${output(preview)}`);

    const sprint = json(scopePath(root));
    sprint.debt = [{ id: 'D-9', title: 'Concurrent debt', origin: 1, priority: 'high', status: 'open', targetSprint: 2, note: 'concurrent writer' }];
    writeJson(scopePath(root), sprint);

    const applyAfterConcurrentEdit = run(root, ['scope', 'complete', '--kyro-scope', 'demo', '--summary', 'Preview summary.', '--yes']);
    assertFailure(applyAfterConcurrentEdit, 'NOT_READY_TO_COMPLETE');
    const stillPresent = json(scopePath(root));
    assert(stillPresent.debt.some((d) => d.id === 'D-9'), 'concurrent debt introduced after the preview must not be lost');
  }

  // Explicit scope reopen (T2.3): the lawful, auditable route from a completed scope back into
  // planning. Reopen is not retirement reversal, preserves completion history, and never rewrites
  // archive/.
  {
    const root = workspace();
    const archiveBefore = digestTree(scopePath(root, 'archive'));
    const paths = projectPaths(root);
    const reason = 'A regression needs a follow-up sprint.';

    // An open scope has no completion to supersede: refuse without writing.
    const treeBeforeOpenRefusal = digestTree(join(root, '.agents'));
    const refusedOpen = run(root, ['scope', 'reopen', '--kyro-scope', 'demo', '--reason', reason, '--yes']);
    assertFailure(refusedOpen, 'SCOPE_ALREADY_OPEN');
    assert(digestTree(join(root, '.agents')) === treeBeforeOpenRefusal, 'refusing an open scope must not write');

    const completed = run(root, ['scope', 'complete', '--kyro-scope', 'demo', '--summary', 'Original scope work done.', '--yes']);
    assert(completed.status === 0, `completion must succeed: ${output(completed)}`);
    const completionRecord = json(scopePath(root)).completion;

    // A completed scope refuses planning, and the remedy names reopen as the lawful route.
    const leanSprint = join(root, 'lean-sprint.json');
    writeJson(leanSprint, {
      sprint: { n: 2, slug: 'follow-up', title: 'Follow-up', objective: 'Fix the regression.' },
      phases: [{
        id: 'P1',
        title: 'Phase 1',
        objective: 'Fix it.',
        tasks: [{
          id: 'T2.1',
          title: 'Fix the regression',
          description: 'Repair the regression found after completion.',
          files_to_touch: ['src/x.ts'],
          context: 'Follow-up work after an explicit completion.',
          acceptance_criteria: ['The regression is gone.'],
          depends_on: [],
          scenario_refs: [],
        }],
      }],
      definitionOfDone: ['Regression fixed.'],
      scenarios: [],
    });
    const planWhileCompleted = run(root, ['plan', '--from', leanSprint, '--kyro-scope', 'demo']);
    assertFailure(planWhileCompleted, 'NOT_READY_TO_PLAN');
    assert(output(planWhileCompleted).includes('scope reopen'), `plan remedy must name reopen: ${output(planWhileCompleted)}`);

    // Missing reason and missing confirmation both fail closed.
    const noReason = run(root, ['scope', 'reopen', '--kyro-scope', 'demo', '--yes']);
    assertFailure(noReason, 'INVALID_INPUT');
    const unconfirmed = run(root, ['scope', 'reopen', '--kyro-scope', 'demo', '--reason', reason]);
    assertFailure(unconfirmed, 'CONFIRMATION_REQUIRED');

    // Dry-run previews without writing.
    const treeBeforeDryRun = digestTree(join(root, '.agents'));
    const dry = run(root, ['scope', 'reopen', '--kyro-scope', 'demo', '--reason', reason, '--dry-run']);
    assert(dry.status === 0, `reopen dry-run must succeed: ${output(dry)}`);
    assert(digestTree(join(root, '.agents')) === treeBeforeDryRun, 'reopen dry-run must not write');

    // Happy path: the scope returns to planning with its completion preserved as history.
    const reopened = run(root, ['scope', 'reopen', '--kyro-scope', 'demo', '--reason', reason, '--yes']);
    assert(reopened.status === 0, `reopen must succeed: ${output(reopened)}`);
    const reopenedSprint = json(scopePath(root));
    assert(reopenedSprint.completion === undefined, 'reopen must clear the live completion');
    assert(reopenedSprint.status === 'planning', 'reopened scope must return to planning');
    assert(reopenedSprint.handoff.nextAction === 'plan_sprint', 'reopen must hand off to plan_sprint');
    assert(reopenedSprint.retirement === undefined, 'reopen must never mint retirement metadata');
    assert(reopenedSprint.completionHistory?.length === 1, 'reopen must append exactly one history record');
    const record = reopenedSprint.completionHistory[0];
    assert(record.reason === reason, 'history must preserve the auditable reason');
    assert(
      JSON.stringify(record.completion) === JSON.stringify(completionRecord),
      'history must preserve the superseded completion verbatim',
    );
    assert(digestTree(scopePath(root, 'archive')) === archiveBefore, 'reopen must never rewrite archive/');
    const entry = json(paths.shared).scopes.find((candidate) => candidate.id === 'demo');
    assert(entry.status === 'planning' && entry.completion === undefined, 'registry must show the scope open again');
    assert(
      JSON.stringify(entry.completionHistory) === JSON.stringify(reopenedSprint.completionHistory),
      'registry and sprint history must match exactly',
    );

    // Completion history stays visible to readers after the scope is open again.
    const inspected = run(root, ['scope', 'inspect', 'demo']);
    assert(inspected.status === 0, `inspect must succeed after reopen: ${output(inspected)}`);
    assert(output(inspected).includes('Reopened at:') && output(inspected).includes(reason), `inspect must show reopen history: ${output(inspected)}`);
    const context = run(root, ['context-pack', '--kyro-scope', 'demo', '--json']);
    assert(context.status === 0, `context-pack must succeed after reopen: ${output(context)}`);
    const pack = JSON.parse(context.stdout);
    assert(pack.nextAction === 'plan_sprint', 'pack must route a reopened scope to plan_sprint');
    assert(pack.completion === null, 'pack must not report a reopened scope as completed');
    assert(pack.reopenHistory.length === 1 && pack.reopenHistory[0].reason === reason, 'pack must surface reopen history');
    assert(pack.retirement === null, 'reopen must never be conflated with retirement');
    const statusAfter = run(root, ['status', 'brief', '--kyro-scope', 'demo', '--json']);
    assert(statusAfter.status === 0, `status must succeed after reopen: ${output(statusAfter)}`);
    assert(JSON.parse(statusAfter.stdout).status === 'planning', 'status must report a reopened scope as planning');

    // The point of reopening: a later sprint plans through the normal tool-owned route (S3, S7).
    const planned = run(root, ['plan', '--from', leanSprint, '--kyro-scope', 'demo']);
    assert(planned.status === 0, `planning after reopen must succeed: ${output(planned)}`);
    const plannedSprint = json(scopePath(root));
    assert(plannedSprint.activeSprint?.n === 2, 'the later sprint must be materialized');
    assert(plannedSprint.handoff.nextAction === 'execute_task', 'planning must route to execution');
    assert(plannedSprint.completionHistory?.length === 1, 'planning must preserve completion history');
    assert(digestTree(scopePath(root, 'archive')) === archiveBefore, 'planning after reopen must never rewrite archive/');
  }

  // Reopen refuses everything that is not an explicitly completed, well-formed, non-retired scope,
  // and refuses a second reopen of an already-reopened scope — each without writing.
  {
    const root = workspace();
    const paths = projectPaths(root);

    // Retired scopes are terminal and human-gated: reopen is never a retirement reversal.
    addSuccessor(root);
    const prepared = prepare(root);
    const retired = apply(root, prepared.digest);
    assert(retired.status === 0, `retirement must succeed: ${output(retired)}`);
    const treeAfterRetire = digestTree(join(root, '.agents'));
    const refusedRetired = run(root, ['scope', 'reopen', '--kyro-scope', 'demo', '--reason', 'Changed my mind.', '--yes']);
    assertFailure(refusedRetired, 'SCOPE_RETIRED');
    assert(digestTree(join(root, '.agents')) === treeAfterRetire, 'refusing a retired scope must not write');

    // Malformed state fails closed rather than being repaired by a lifecycle command.
    const malformed = workspace();
    writeFileSync(scopePath(malformed), '{ not json', 'utf-8');
    const refusedMalformed = run(malformed, ['scope', 'reopen', '--kyro-scope', 'demo', '--reason', 'Try anyway.', '--yes']);
    assertFailure(refusedMalformed, 'INVALID_JSON');
    assert(readFileSync(scopePath(malformed), 'utf-8') === '{ not json', 'a malformed sprint.json must not be overwritten');

    // An unknown scope is not silently created.
    const unknown = run(malformed, ['scope', 'reopen', '--kyro-scope', 'nope', '--reason', 'Try anyway.', '--yes']);
    assert(unknown.status !== 0, `reopening an unknown scope must fail: ${output(unknown)}`);

    // A second reopen of an already-open scope is refused, whatever the reason.
    const twice = workspace();
    const completedTwice = run(twice, ['scope', 'complete', '--kyro-scope', 'demo', '--summary', 'Done.', '--yes']);
    assert(completedTwice.status === 0, `completion must succeed: ${output(completedTwice)}`);
    const firstReopen = run(twice, ['scope', 'reopen', '--kyro-scope', 'demo', '--reason', 'First reopen.', '--yes']);
    assert(firstReopen.status === 0, `first reopen must succeed: ${output(firstReopen)}`);
    const treeAfterFirst = digestTree(join(twice, '.agents'));
    const identicalRetry = run(twice, ['scope', 'reopen', '--kyro-scope', 'demo', '--reason', 'First reopen.', '--yes']);
    assert(identicalRetry.status === 0, `an identical retry must be a safe no-op: ${output(identicalRetry)}`);
    assert(output(identicalRetry).includes('resumed=true'), `an identical retry must report resumed=true: ${output(identicalRetry)}`);
    assert(digestTree(join(twice, '.agents')) === treeAfterFirst, 'an identical retry must write zero new bytes');
    const differentReason = run(twice, ['scope', 'reopen', '--kyro-scope', 'demo', '--reason', 'Second reopen.', '--yes']);
    assertFailure(differentReason, 'SCOPE_ALREADY_OPEN');
    assert(digestTree(join(twice, '.agents')) === treeAfterFirst, 'a refused second reopen must not write');
    assert(json(paths.shared) !== null, 'project state must remain readable');
  }

  // Scope reopen recovery: one locked transaction, revalidated and resumable. A fault injected after
  // the sprint write must leave sprint.json durably reopened and the registry untouched; the
  // identical retry must resume by writing only the registry.
  {
    const root = workspace();
    const archiveBefore = digestTree(scopePath(root, 'archive'));
    const paths = projectPaths(root);
    const reason = 'Recovery reopen.';

    const completed = run(root, ['scope', 'complete', '--kyro-scope', 'demo', '--summary', 'Done for now.', '--yes']);
    assert(completed.status === 0, `completion must succeed: ${output(completed)}`);

    const interrupted = run(
      root,
      ['scope', 'reopen', '--kyro-scope', 'demo', '--reason', reason, '--yes'],
      { KYRO_TEST_REOPEN_FAIL_AFTER: 'sprint' },
    );
    assert(interrupted.status !== 0, `injected sprint-boundary failure must fail: ${output(interrupted)}`);
    const afterFault = json(scopePath(root));
    assert(afterFault.completion === undefined && afterFault.completionHistory?.length === 1, 'sprint write must be durable before interruption');
    const sprintBytesAfterFault = readFileSync(scopePath(root), 'utf-8');
    const registryAfterFault = json(paths.shared).scopes.find((s) => s.id === 'demo');
    assert(registryAfterFault?.status === 'completed', 'registry must still be pre-transition after the injected failure');
    assert(digestTree(scopePath(root, 'archive')) === archiveBefore, 'an interrupted reopen must never touch archive/');

    const resumed = run(root, ['scope', 'reopen', '--kyro-scope', 'demo', '--reason', reason, '--yes']);
    assert(resumed.status === 0, `resume must succeed: ${output(resumed)}`);
    assert(output(resumed).includes('resumed=true'), `resume must report resumed=true: ${output(resumed)}`);
    assert(readFileSync(scopePath(root), 'utf-8') === sprintBytesAfterFault, 'resume must not rewrite sprint.json');
    const registryAfterResume = json(paths.shared).scopes.find((s) => s.id === 'demo');
    assert(registryAfterResume?.status === 'planning' && registryAfterResume.completion === undefined, 'resume must finish the registry update');
    assert(
      JSON.stringify(registryAfterResume.completionHistory) === JSON.stringify(afterFault.completionHistory),
      'resumed registry history must exactly match the authorized sprint history',
    );
    assert(digestTree(scopePath(root, 'archive')) === archiveBefore, 'resume must never touch archive/');

    // A concurrent writer that changes the registry entry between the fault and the resume must fail
    // closed rather than silently overwriting the other writer.
    const root2 = workspace();
    const completed2 = run(root2, ['scope', 'complete', '--kyro-scope', 'demo', '--summary', 'Done for now.', '--yes']);
    assert(completed2.status === 0, `completion must succeed: ${output(completed2)}`);
    const interrupted2 = run(
      root2,
      ['scope', 'reopen', '--kyro-scope', 'demo', '--reason', reason, '--yes'],
      { KYRO_TEST_REOPEN_FAIL_AFTER: 'sprint' },
    );
    assert(interrupted2.status !== 0, `injected sprint-boundary failure must fail: ${output(interrupted2)}`);
    const paths2 = projectPaths(root2);
    const shared = json(paths2.shared);
    shared.scopes.find((s) => s.id === 'demo').title = 'Renamed by a concurrent writer';
    writeJson(paths2.shared, shared);
    const tamperedBytes = readFileSync(paths2.shared, 'utf-8');
    const divergedResume = run(root2, ['scope', 'reopen', '--kyro-scope', 'demo', '--reason', reason, '--yes']);
    assertFailure(divergedResume, 'DIVERGED');
    assert(readFileSync(paths2.shared, 'utf-8') === tamperedBytes, "a diverged resume must not lose the concurrent writer's change");
  }

  // S1/S2/S3/S6/S7 — the original rigidity failure, exercised through the compiled CLI only:
  // unfinished work is explicitly disposed, the sprint closes truthfully, normal planning creates
  // follow-up work, and completion/reopen remains a separate deliberate lifecycle decision.
  {
    const root = workspace({ close: false, layered: true });
    const emergent = run(root, [
      'add-emergent', '--kyro-scope', 'demo',
      '--title', 'Cancelled acceptance-path work',
      '--description', 'A product decision makes this slice unnecessary.',
      '--acceptance', 'The disposition remains traceable through close.',
    ]);
    assert(emergent.status === 0, `the acceptance path must create work through the CLI: ${output(emergent)}`);
    const disposed = run(root, [
      'record-evidence', 'E1', '--kyro-scope', 'demo',
      '--summary', 'Product decision recorded.', '--validation', 'product decision',
      '--disposition', 'cancelled', '--reason', 'This slice is no longer needed.',
    ]);
    assert(disposed.status === 0, `the acceptance path must disposition unfinished work through the CLI: ${output(disposed)}`);
    const beforePartialClose = json(scopePath(root));
    assert(beforePartialClose.activeSprint?.emergentTasks[0]?.disposition?.reason === 'This slice is no longer needed.',
      'the CLI disposition must remain attached to unfinished work before close');
    const partialClose = run(root, ['close-sprint', '--kyro-scope', 'demo', '--outcome', 'partial', '--yes']);
    assert(partialClose.status === 0, `a disposed sprint must close partially: ${output(partialClose)}`);
    const partial = json(scopePath(root));
    assert(partial.ledger.at(-1)?.outcome === 'partial' && partial.handoff.nextAction === 'plan_sprint',
      'a partial final sprint must stay open and route to normal planning');
    const partialCheckpoint = readdirSync(scopePath(root, 'archive')).find((file) => file.endsWith('.checkpoint.json'));
    assert(partialCheckpoint, 'the partial close must create an immutable checkpoint');
    const partialBeforeClose = json(join(scopePath(root, 'archive'), partialCheckpoint)).beforeClose;
    assert(partialBeforeClose.activeSprint?.emergentTasks[0]?.disposition?.reason === 'This slice is no longer needed.',
      'the immutable partial-close checkpoint must preserve the disposed task rather than representing it as done');
    const archiveAfterPartialClose = digestTree(scopePath(root, 'archive'));

    const followUp = join(root, 'follow-up.json');
    writeJson(followUp, {
      sprint: { n: 2, slug: 'follow-up', title: 'Follow-up', objective: 'Finish the replacement path.' },
      phases: [{
        id: 'P1', title: 'Replacement', objective: 'Complete the replacement.', tasks: [{
          id: 'T2.1', title: 'Complete replacement', description: 'Finish the revised approach.',
          files_to_touch: ['src/replacement.ts'], context: 'Normal post-close planning.',
          acceptance_criteria: ['Replacement is complete.'], depends_on: [], scenario_refs: [],
        }],
      }],
      definitionOfDone: ['Replacement is complete.'], scenarios: [],
    });
    const planned = run(root, ['plan', '--from', followUp, '--kyro-scope', 'demo']);
    assert(planned.status === 0, `a post-partial scope must plan normally: ${output(planned)}`);
    const evidence = run(root, [
      'record-evidence', 'T2.1', '--kyro-scope', 'demo', '--summary', 'Replacement completed.',
      '--validation', 'acceptance-path proof', '--file', 'src/replacement.ts',
    ]);
    assert(evidence.status === 0, `follow-up evidence must be recorded through the CLI: ${output(evidence)}`);
    const review = run(root, ['review', 'T2.1', '--kyro-scope', 'demo', '--verdict', 'pass', '--yes']);
    assert(review.status === 0, `follow-up work must be reviewed through the CLI: ${output(review)}`);
    const followUpClose = run(root, ['close-sprint', '--kyro-scope', 'demo', '--outcome', 'shipped', '--yes']);
    assert(followUpClose.status === 0, `the fully verified follow-up sprint must close: ${output(followUpClose)}`);
    assert(json(scopePath(root)).handoff.nextAction === 'plan_sprint', 'closing the follow-up must still not infer scope completion');
    assert(digestTree(scopePath(root, 'archive')) !== archiveAfterPartialClose, 'the later close must add its own immutable checkpoint');
    const archiveBeforeCompletion = digestTree(scopePath(root, 'archive'));

    const completed = run(root, ['scope', 'complete', '--kyro-scope', 'demo', '--summary', 'Objective explicitly accepted.', '--yes']);
    assert(completed.status === 0, `completion remains an explicit successful decision: ${output(completed)}`);
    const completedSprint = json(scopePath(root));
    assert(completedSprint.completion && completedSprint.retirement === undefined,
      'completion must be recorded distinctly from retirement');
    const reopened = run(root, ['scope', 'reopen', '--kyro-scope', 'demo', '--reason', 'A later improvement is warranted.', '--yes']);
    assert(reopened.status === 0, `a completed scope must reopen deliberately: ${output(reopened)}`);
    const finalSprint = json(scopePath(root));
    assert(finalSprint.handoff.nextAction === 'plan_sprint' && finalSprint.completionHistory?.length === 1,
      'reopen must preserve the completion history and route back to planning');
    assert(finalSprint.retirement === undefined, 'reopen must not be interpreted as retirement reversal');
    assert(digestTree(scopePath(root, 'archive')) === archiveBeforeCompletion,
      'completion and reopen must preserve every pre-existing archive byte');
  }

  // S4 — lawful lifecycle evolution must be distinguishable from tampering and from corrupt
  // immutable artifacts. Doctor replays the recorded completion/reopen transitions from the close
  // after-image; it never takes a lifecycle record at face value.
  {
    const reason = 'Follow-up work found after completion.';
    const completeAndReopen = (root) => {
      const completed = run(root, ['scope', 'complete', '--kyro-scope', 'demo', '--summary', 'Demo work done.', '--yes']);
      assert(completed.status === 0, `completion must succeed: ${output(completed)}`);
      const reopened = run(root, ['scope', 'reopen', '--kyro-scope', 'demo', '--reason', reason, '--yes']);
      assert(reopened.status === 0, `reopen must succeed: ${output(reopened)}`);
    };

    // Lawful evolution: the scope stays healthy and the checkpoint names why it moved.
    const lawful = workspace();
    const archiveBefore = digestTree(scopePath(lawful, 'archive'));
    completeAndReopen(lawful);
    const healthy = run(lawful, ['scope', 'inspect', 'demo']);
    assert(healthy.status === 0, `a lawfully reopened scope must stay healthy: ${output(healthy)}`);
    assert(output(healthy).includes('actor identity unverified'),
      `checkpoint and verification lenses must disclose the structural trust boundary: ${output(healthy)}`);
    const lawfulIntegrity = integrityPrepare(lawful);
    assert(lawfulIntegrity.result.status === 0, `Integrity must accept an exactly replayable lifecycle: ${output(lawfulIntegrity.result)}`);
    assert(lawfulIntegrity.plan?.blockers?.length === 0 && lawfulIntegrity.plan?.findings?.length === 0,
      `an exactly replayable lifecycle must not propose repair: ${output(lawfulIntegrity.result)}`);
    assert(digestTree(scopePath(lawful, 'archive')) === archiveBefore, 'lawful evolution must not touch archive/');

    // Completing again after a reopen is lawful too: history and the new completion coexist, and the
    // replayed chain still reproduces live state exactly.
    const recompleted = run(lawful, ['scope', 'complete', '--kyro-scope', 'demo', '--summary', 'Follow-up finished.', '--yes']);
    assert(recompleted.status === 0, `completing again after a reopen must succeed: ${output(recompleted)}`);
    const recompletedSprint = json(scopePath(lawful));
    assert(recompletedSprint.completion?.summary === 'Follow-up finished.', 'the later completion must be recorded');
    assert(recompletedSprint.completionHistory?.length === 1, 'the superseded completion must remain in history');
    const healthyAgain = run(lawful, ['scope', 'inspect', 'demo']);
    assert(healthyAgain.status === 0, `a completed-reopened-completed scope must stay healthy: ${output(healthyAgain)}`);
    assert(digestTree(scopePath(lawful, 'archive')) === archiveBefore, 'a later completion must not touch archive/');

    // Tampering: live state edited beyond what a lifecycle transition can produce still diverges.
    const tampered = workspace();
    completeAndReopen(tampered);
    const driftedSprint = json(scopePath(tampered));
    driftedSprint.objective = 'Silently rewritten objective.';
    writeJson(scopePath(tampered), driftedSprint);
    const drifted = run(tampered, ['scope', 'inspect', 'demo']);
    assert(drifted.status !== 0, `state edited beyond the lifecycle transition must fail closed: ${output(drifted)}`);
    assert(output(drifted).includes('DIVERGED'), `tampering must be reported as DIVERGED: ${output(drifted)}`);
    const tamperedIntegrity = integrityPrepare(tampered);
    assert(tamperedIntegrity.result.status !== 0 || tamperedIntegrity.plan?.blockers?.length > 0,
      `Integrity must reject unexplainable lifecycle drift: ${output(tamperedIntegrity.result)}`);
    assert(tamperedIntegrity.plan?.operations?.length === 0,
      `Integrity must never propose canonicalization or repair for unexplainable lifecycle drift: ${output(tamperedIntegrity.result)}`);

    // A lifecycle record is evidence, not authority: a record whose reason no longer matches the
    // state it claims to have produced cannot replay, so it diverges.
    const forged = workspace();
    completeAndReopen(forged);
    const forgedSprint = json(scopePath(forged));
    forgedSprint.completionHistory[0].reason = 'A reason nobody ever applied.';
    writeJson(scopePath(forged), forgedSprint);
    const forgedResult = run(forged, ['scope', 'inspect', 'demo']);
    assert(forgedResult.status !== 0, `a rewritten lifecycle record must fail closed: ${output(forgedResult)}`);
    assert(output(forgedResult).includes('DIVERGED'), `a rewritten lifecycle record must be reported as DIVERGED: ${output(forgedResult)}`);
    const forgedIntegrity = integrityPrepare(forged);
    assert(forgedIntegrity.result.status !== 0 || forgedIntegrity.plan?.blockers?.length > 0,
      `Integrity must reject a forged lifecycle record: ${output(forgedIntegrity.result)}`);
    assert(forgedIntegrity.plan?.operations?.length === 0,
      `Integrity must not offer repair for a forged lifecycle record: ${output(forgedIntegrity.result)}`);

    // Corrupt immutable artifacts stay fail-closed for the affected scope even when the live
    // lifecycle evolution itself is lawful.
    const corrupt = workspace();
    completeAndReopen(corrupt);
    const narrative = readdirSync(scopePath(corrupt, 'archive')).find((file) => file.endsWith('.md'));
    assert(narrative, 'the fixture close must have produced a narrative');
    writeFileSync(join(scopePath(corrupt, 'archive'), narrative), '# Rewritten narrative\n', 'utf-8');
    const corrupted = run(corrupt, ['scope', 'inspect', 'demo']);
    assert(corrupted.status !== 0, `a corrupt immutable artifact must fail closed: ${output(corrupted)}`);
    assert(
      output(corrupted).includes('narrative=conflict') || output(corrupted).includes('narrative'),
      `the failure must name the corrupt immutable artifact: ${output(corrupted)}`,
    );
  }

  // S5 — multi-cycle lifecycle and the structural bindings a replayed record must carry.
  //
  // A scope that completes, reopens, runs another sprint to close, and completes again is lawful.
  // The later checkpoint already seals the earlier completion history inside its after-image, so a
  // replay may only apply the suffix the live state adds on top of that image. Re-applying the
  // sealed prefix doubles every earlier transition and reports a lawful scope as DIVERGED — the
  // failure this block exists to catch. The mirror property is that the suffix must be structurally
  // bound: a record whose public digests are missing or do not re-derive from its own content cannot
  // replay. Those public digests do not authenticate the writer, a boundary proved below.
  {
    const planAndClose = (root, n, slug) => {
      const planFile = join(root, `${slug}.json`);
      writeJson(planFile, {
        sprint: { n, slug, title: `Cycle ${n}`, objective: `Deliver cycle ${n}.` },
        phases: [{
          id: 'P1', title: `Cycle ${n}`, objective: `Complete cycle ${n}.`, tasks: [{
            id: `T${n}.1`, title: `Cycle ${n} work`, description: `Carry out cycle ${n}.`,
            files_to_touch: [`src/cycle-${n}.ts`], context: 'Ordinary post-reopen planning.',
            acceptance_criteria: [`Cycle ${n} is complete.`], depends_on: [], scenario_refs: [],
          }],
        }],
        definitionOfDone: [`Cycle ${n} is complete.`], scenarios: [],
      });
      const planned = run(root, ['plan', '--from', planFile, '--kyro-scope', 'demo']);
      assert(planned.status === 0, `a reopened scope must plan the next sprint normally: ${output(planned)}`);
      const evidence = run(root, [
        'record-evidence', `T${n}.1`, '--kyro-scope', 'demo', '--summary', `Cycle ${n} completed.`,
        '--validation', 'multi-cycle proof', '--file', `src/cycle-${n}.ts`,
      ]);
      assert(evidence.status === 0, `cycle ${n} evidence must be recorded through the CLI: ${output(evidence)}`);
      const reviewed = run(root, ['review', `T${n}.1`, '--kyro-scope', 'demo', '--verdict', 'pass', '--yes']);
      assert(reviewed.status === 0, `cycle ${n} must be reviewed through the CLI: ${output(reviewed)}`);
      const closed = run(root, ['close-sprint', '--kyro-scope', 'demo', '--outcome', 'shipped', '--yes']);
      assert(closed.status === 0, `cycle ${n} must close: ${output(closed)}`);
    };
    const completeScope = (root, summary) => {
      const result = run(root, ['scope', 'complete', '--kyro-scope', 'demo', '--summary', summary, '--yes']);
      assert(result.status === 0, `completion must succeed: ${output(result)}`);
    };
    const reopenScope = (root, reason) => {
      const result = run(root, ['scope', 'reopen', '--kyro-scope', 'demo', '--reason', reason, '--yes']);
      assert(result.status === 0, `reopen must succeed: ${output(result)}`);
    };
    const readRegistry = (root) => {
      const shared = projectPaths(root).shared;
      const project = json(shared);
      const entry = project.scopes.find((candidate) => candidate.id === 'demo');
      assert(entry, 'the registry must carry the demo scope');
      return { shared, project, entry };
    };
    const assertDiverged = (root, what) => {
      const inspected = run(root, ['scope', 'inspect', 'demo']);
      assert(inspected.status !== 0, `${what} must fail closed: ${output(inspected)}`);
      assert(output(inspected).includes('DIVERGED'), `${what} must be reported as DIVERGED: ${output(inspected)}`);
      const integrity = integrityPrepare(root);
      assert(integrity.result.status !== 0 || integrity.plan?.blockers?.length > 0,
        `Integrity must reject ${what}: ${output(integrity.result)}`);
      assert(integrity.plan?.operations?.length === 0,
        `Integrity must never propose repair that would legitimise ${what}: ${output(integrity.result)}`);
    };

    // A full second cycle: complete → reopen → plan → close → complete. The close in the middle is
    // what makes this a regression rather than a restatement of S4 — it seals the first reopen into
    // the checkpoint the next replay starts from.
    const cycles = workspace();
    completeScope(cycles, 'First objective met.');
    reopenScope(cycles, 'Follow-up work found after completion.');
    planAndClose(cycles, 2, 'second-cycle');
    const sealedHistoryIntegrity = integrityPrepare(cycles);
    assert(sealedHistoryIntegrity.result.status === 0,
      `Integrity must accept a checkpoint-exact scope whose after-image seals lifecycle history: ${output(sealedHistoryIntegrity.result)}`);
    assert(sealedHistoryIntegrity.plan?.blockers?.length === 0 && sealedHistoryIntegrity.plan?.operations?.length === 0,
      `sealed lifecycle history needs neither replay nor repair: ${output(sealedHistoryIntegrity.result)}`);
    completeScope(cycles, 'Second objective met.');
    const secondCycle = run(cycles, ['scope', 'inspect', 'demo']);
    assert(secondCycle.status === 0,
      `a completed → reopened → closed → completed scope must stay healthy: ${output(secondCycle)}`);
    assert(output(secondCycle).includes('actor identity unverified'),
      `the multi-cycle checkpoint must disclose the structural trust boundary: ${output(secondCycle)}`);

    // A third cycle proves prefix exactness holds past the first sealed record, not just at n=1.
    reopenScope(cycles, 'A second follow-up is warranted.');
    planAndClose(cycles, 3, 'third-cycle');
    completeScope(cycles, 'Third objective met.');
    const thirdCycle = run(cycles, ['scope', 'inspect', 'demo']);
    assert(thirdCycle.status === 0, `a scope on its third lifecycle cycle must stay healthy: ${output(thirdCycle)}`);
    const cycledSprint = json(scopePath(cycles));
    assert(cycledSprint.completionHistory?.length === 2,
      'both superseded completions must survive in append-only history');
    assert(cycledSprint.completion?.summary === 'Third objective met.', 'the newest completion must be live');
    const cyclesIntegrity = integrityPrepare(cycles);
    assert(cyclesIntegrity.result.status === 0,
      `Integrity must accept a multi-cycle lifecycle: ${output(cyclesIntegrity.result)}`);
    assert(cyclesIntegrity.plan?.blockers?.length === 0 && cyclesIntegrity.plan?.findings?.length === 0,
      `a multi-cycle lifecycle must not propose repair: ${output(cyclesIntegrity.result)}`);

    // The sealed prefix is not editable after the fact: rewriting an already-checkpointed record is
    // not an append, so the live history stops being an extension of the image and nothing replays.
    const rewrittenPrefix = workspace();
    completeScope(rewrittenPrefix, 'First objective met.');
    reopenScope(rewrittenPrefix, 'Follow-up work found after completion.');
    planAndClose(rewrittenPrefix, 2, 'second-cycle');
    completeScope(rewrittenPrefix, 'Second objective met.');
    const rewrittenSprint = json(scopePath(rewrittenPrefix));
    rewrittenSprint.completionHistory[0].reason = 'A reason that was never the sealed one.';
    writeJson(scopePath(rewrittenPrefix), rewrittenSprint);
    assertDiverged(rewrittenPrefix, 'a rewritten sealed lifecycle prefix');

    // Truncation is the other way to break the prefix: dropping sealed history claims transitions
    // never happened, which the checkpoint already proves they did.
    const truncated = workspace();
    completeScope(truncated, 'First objective met.');
    reopenScope(truncated, 'Follow-up work found after completion.');
    planAndClose(truncated, 2, 'second-cycle');
    const truncatedSprint = json(scopePath(truncated));
    truncatedSprint.completionHistory = [];
    writeJson(scopePath(truncated), truncatedSprint);
    assertDiverged(truncated, 'a truncated lifecycle history');

    // Structural binding, case 1: a completion with no digests at all. The current writer always
    // emits the pair, so a new unbound suffix cannot replay into a lawful position.
    const unsigned = workspace();
    completeScope(unsigned, 'Objective met.');
    const unsignedSprint = json(scopePath(unsigned));
    delete unsignedSprint.completion.requestDigest;
    delete unsignedSprint.completion.beforeEntryDigest;
    writeJson(scopePath(unsigned), unsignedSprint);
    const unsignedRegistry = readRegistry(unsigned);
    delete unsignedRegistry.entry.completion.requestDigest;
    delete unsignedRegistry.entry.completion.beforeEntryDigest;
    writeJson(unsignedRegistry.shared, unsignedRegistry.project);
    assertDiverged(unsigned, 'a completion with no structural binding');

    // Structural binding, case 2: the digests are present but the record's own content was restated
    // underneath them. Everything a shape check can see still agrees — including the handoff note a
    // lawful completion would have derived — so only re-deriving the request digest catches it.
    const restated = workspace();
    completeScope(restated, 'Objective met.');
    const restatedSprint = json(scopePath(restated));
    restatedSprint.completion.summary = 'A summary nobody ever approved.';
    restatedSprint.handoff.note = `Scope explicitly completed: ${restatedSprint.completion.summary}`;
    writeJson(scopePath(restated), restatedSprint);
    const restatedRegistry = readRegistry(restated);
    restatedRegistry.entry.completion.summary = restatedSprint.completion.summary;
    writeJson(restatedRegistry.shared, restatedRegistry.project);
    assertDiverged(restated, 'a completion restated underneath its request digest');

    // Structural binding, case 3: the request digest re-derives, but the record claims a registry state it
    // never started from. The sprint half of the replay succeeds and only the entry step can refuse,
    // so this exercises the registry commitment specifically.
    const misbound = workspace();
    completeScope(misbound, 'Objective met.');
    const foreignDigest = createHash('sha256').update('a registry entry this completion never saw').digest('hex');
    const misboundSprint = json(scopePath(misbound));
    misboundSprint.completion.beforeEntryDigest = foreignDigest;
    writeJson(scopePath(misbound), misboundSprint);
    const misboundRegistry = readRegistry(misbound);
    misboundRegistry.entry.completion.beforeEntryDigest = foreignDigest;
    writeJson(misboundRegistry.shared, misboundRegistry.project);
    assertDiverged(misbound, 'a completion bound to a registry state it never started from');

    // Trust-boundary case: both digests are public and deterministic. An editor with write access to
    // both durable layers can restate a completion and recompute the same request binding the CLI
    // uses. The state is structurally indistinguishable from the writer's projection, so readers may
    // accept the replay but must say explicitly that actor identity is unverified. Calling this
    // provenance or authentication would promise a guarantee the repository cannot provide.
    const recomputed = workspace();
    completeScope(recomputed, 'Objective met.');
    const recomputedSprint = json(scopePath(recomputed));
    recomputedSprint.completion.summary = 'A fully recomputed public binding.';
    recomputedSprint.completion.requestDigest = scopeCompletionRequestDigest(
      'demo',
      recomputedSprint.completion.summary,
    );
    recomputedSprint.handoff.note = `Scope explicitly completed: ${recomputedSprint.completion.summary}`;
    writeJson(scopePath(recomputed), recomputedSprint);
    const recomputedRegistry = readRegistry(recomputed);
    recomputedRegistry.entry.completion = structuredClone(recomputedSprint.completion);
    writeJson(recomputedRegistry.shared, recomputedRegistry.project);

    const recomputedInspect = run(recomputed, ['scope', 'inspect', 'demo']);
    assert(recomputedInspect.status === 0,
      `a fully recomputed public binding is structurally replayable: ${output(recomputedInspect)}`);
    assert(output(recomputedInspect).includes('actor identity unverified'),
      `a structurally replayed lifecycle must disclose its trust boundary: ${output(recomputedInspect)}`);
    const recomputedIntegrity = integrityPrepare(recomputed);
    assert(recomputedIntegrity.result.status === 0,
      `Integrity must accept the structurally coherent replay: ${output(recomputedIntegrity.result)}`);
    assert(recomputedIntegrity.plan?.blockers?.length === 0 && recomputedIntegrity.plan?.operations?.length === 0,
      `a structurally coherent replay must need neither repair nor false provenance: ${output(recomputedIntegrity.result)}`);
  }


  console.log('check:scope-retire — lifecycle, approval, digest, reopen, recovery, consumers, and router isolation passed');
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
