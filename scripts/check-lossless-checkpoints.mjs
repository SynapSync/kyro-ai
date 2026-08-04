#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = resolve(fileURLToPath(import.meta.url), '../..');
const cli = resolve(repo, 'dist/cli.js');
const fixture = resolve(repo, 'fixtures/evals/close-sprint-happy/state');
const closeArgs = ['close-sprint', '--kyro-scope', 'demo', '--outcome', 'shipped', '--note', 'Continue safely.', '--summary', 'Closed safely.', '--learning', 'Keep complete history.', '--recommendation', 'Use checkpoints.', '--confirm'];
const PROCESS_STARTUP_BUDGET_MS = 15_000;
// CI runners under load can delay Worker heartbeat renewals past a 300ms lease; keep event waits
// generous so readiness polls do not race a single slow fsync/rename.
const LEASE_EVENT_BUDGET_MS = 20_000;
/** Short but CI-safe test lease: worker interval is lease/3 and must survive one delayed tick. */
const CI_SAFE_TEST_LEASE_MS = '1000';

function assert(condition, message) { if (!condition) throw new Error(message); }
function readJson(path) { return JSON.parse(readFileSync(path, 'utf8')); }
function writeJson(path, value) { writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`); }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
function digest(value) { return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }
function checkpointCommitment(value) {
  const payload = JSON.parse(JSON.stringify(value));
  delete payload.digests;
  delete payload.intendedAfterClose.ledger.at(-1).checkpointSha256;
  return digest(payload);
}
function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  assert(JSON.stringify(actual) === JSON.stringify(wanted), `${label} keys mismatch:\nexpected ${wanted.join(', ')}\nactual   ${actual.join(', ')}`);
}
function assertContainsKeys(value, expected, label) {
  for (const key of expected) assert(Object.hasOwn(value, key), `${label} missing ${key}`);
}

const checkpointEnvelopeKeys = [
  'schemaVersion',
  'kind',
  'checkpointId',
  'createdAt',
  'identity',
  'close',
  'paths',
  'beforeClose',
  'intendedAfterClose',
  'projectScopeBefore',
  'projectScopeAfter',
  'digests',
];
const checkpointIdentityKeys = ['scope', 'sprintN', 'sprintSlug'];
const checkpointCloseKeys = ['outcome', 'note', 'summary', 'recommendations', 'learnings'];
const checkpointPathsKeys = ['legacySnapshot', 'narrative'];
const checkpointDigestKeys = ['beforeClose', 'intendedAfterClose', 'projectScopeBefore', 'projectScopeAfter', 'legacySnapshot', 'narrative'];
const sprintFileKeys = [
  'schemaVersion',
  'scope',
  'title',
  'status',
  'objective',
  'successCriteria',
  'spec',
  'clarifications',
  'conventions',
  'adrs',
  'roadmap',
  'ledger',
  'previousSprint',
  'activeSprint',
  'debt',
  'handoff',
];

function makeSandbox({ intermediate = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'kyro-lossless-'));
  cpSync(fixture, root, { recursive: true });
  mkdirSync(join(root, '.home'), { recursive: true });
  const sprintPath = join(root, '.agents/kyro/scopes/demo/sprint.json');
  const sprint = readJson(sprintPath);
  sprint.spec = {
    requirements: [{ id: 'REQ-1', statement: 'Preserve complete state.', priority: 'must', rationale: 'Recovery.' }],
    scenarios: [{ id: 'SC-1', requirement: 'REQ-1', given: 'a scope', when: 'it closes', then: 'state is preserved' }],
    nonGoals: ['Backfill legacy history.'],
    openQuestions: [],
  };
  sprint.clarifications = [{ q: 'Preserve debt?', a: 'Yes.', sprint: 1, date: '2026-07-13' }];
  sprint.conventions = [{ id: 'C-1', rule: 'Keep complete checkpoints.', tags: ['archive'], addedSprint: 1 }];
  sprint.adrs = [{
    id: 'ADR-0001',
    title: 'Keep lossless close checkpoints',
    status: 'accepted',
    date: '2026-07-15',
    context: 'Sprint close must preserve complete scope state for recovery.',
    decision: 'Store durable architectural decisions in sprint.json.adrs[] so checkpoint before/after images retain them.',
    consequences: ['Close recovery keeps ADR history with the rest of the scope state.'],
    alternatives: ['Write separate markdown ADR files outside the checkpoint contract.'],
    links: { docs: ['docs/sprint-close-checkpoints.md'] },
  }];
  sprint.debt = [{ id: 'D-1', title: 'Legacy history is limited', origin: 1, priority: 'low', status: 'deferred', targetSprint: null, note: 'Do not fabricate.' }];
  sprint.activeSprint.phases[0].tasks[0].scenario_refs = ['SC-1'];
  sprint.extensionState = { retained: true, nested: { value: 7 } };
  if (intermediate) {
    sprint.roadmap.plannedSprintCount = 2;
    sprint.roadmap.sprints.push({ n: 2, slug: 'next', title: 'Next', state: 'planned' });
  }
  writeJson(sprintPath, sprint);
  const statePath = join(root, '.agents/kyro/kyro.json');
  const state = readJson(statePath);
  state.scopes.push({ id: 'unrelated', title: 'Unrelated', status: 'blocked', custom: 'preserve-me' });
  state.runtimeExtension = { keep: true };
  writeJson(statePath, state);
  return root;
}

function testEnv(root, env = {}) {
  const home = join(root, '.home');
  return { ...process.env, HOME: home, USERPROFILE: home, ...env };
}

function run(root, args = closeArgs, env = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: testEnv(root, env),
  });
}

function output(result) { return `${result.stdout ?? ''}${result.stderr ?? ''}`; }
function assertNoLockDebris(root, label) {
  const debris = readdirSync(root).filter((name) => name.startsWith('.kyro-state-writer.lock'));
  assert(debris.length === 0, `${label} left state-writer lock debris: ${debris.join(', ')}`);
}
function runAsync(root, args, env = {}, input = null) {
  const child = spawn(process.execPath, [cli, ...args], { cwd: root, env: testEnv(root, env), stdio: ['pipe', 'pipe', 'pipe'] });
  let text = '';
  let settled = null;
  child.stdout.on('data', (chunk) => { text += chunk; });
  child.stderr.on('data', (chunk) => { text += chunk; });
  if (input !== null) child.stdin.end(input);
  const completed = new Promise((resolveRun) => child.on('close', (status, signal) => {
    settled = { status, signal, text };
    resolveRun(settled);
  }));
  return { child, completed, text: () => text, result: () => settled, command: [process.execPath, cli, ...args].join(' ') };
}
async function waitForChild(runState, predicate, message, timeoutMs = PROCESS_STARTUP_BUDGET_MS) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    const earlyExit = runState.result();
    if (earlyExit) throw readinessError(message, runState, earlyExit, `child exited before readiness`);
    if (Date.now() >= deadline) {
      runState.child.kill('SIGKILL');
      const terminated = await runState.completed;
      throw readinessError(message, runState, terminated, `startup budget ${timeoutMs}ms exhausted; child terminated and awaited`);
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
}
function readinessError(message, runState, result, reason) {
  const buffered = result?.text ?? runState.text();
  return new Error(`${message}\nReason: ${reason}\nCommand: ${runState.command}\nExit: status=${String(result?.status ?? 'running')} signal=${String(result?.signal ?? 'none')}\nBuffered output:\n${buffered || '(none)'}`);
}
function paths(root) {
  const archive = join(root, '.agents/kyro/scopes/demo/archive');
  return {
    sprint: join(root, '.agents/kyro/scopes/demo/sprint.json'),
    /** Legacy monolito (fixture dual-read). Prefer readProjectStateFiles() after layer writers. */
    project: join(root, '.agents/kyro/kyro.json'),
    shared: join(root, '.agents/kyro/project.json'),
    local: join(root, '.agents/kyro/local.json'),
    checkpoint: join(archive, 'sprint-001-demo-sprint.checkpoint.json'),
    snapshot: join(archive, 'sprint-001-demo-sprint.json'),
    narrative: join(archive, 'sprint-001-demo-sprint.md'),
  };
}

/** Effective project state for assertions: layers when present, else monolito. */
function readProjectStateFiles(root) {
  const p = paths(root);
  if (existsSync(p.shared) || existsSync(p.local)) {
    const shared = existsSync(p.shared) ? readJson(p.shared) : { schemaVersion: 4, artifactRoot: '.agents/kyro/scopes', scopes: [] };
    const local = existsSync(p.local) ? readJson(p.local) : { schemaVersion: 4, activeScope: null, installedAdapters: [] };
    return {
      schemaVersion: 4,
      artifactRoot: shared.artifactRoot ?? '.agents/kyro/scopes',
      scopes: Array.isArray(shared.scopes) ? shared.scopes : [],
      activeScope: local.activeScope ?? null,
      installedAdapters: Array.isArray(local.installedAdapters) ? local.installedAdapters : [],
      runtimePath: local.runtimePath,
      principles: shared.principles,
      team: shared.team,
      layered: true,
    };
  }
  if (existsSync(p.project)) {
    return { ...readJson(p.project), layered: false };
  }
  throw new Error(`no project state under ${root}`);
}

function closeSuccessfully(root) {
  const result = run(root);
  assert(result.status === 0, `close failed:\n${output(result)}`);
  return readJson(paths(root).checkpoint);
}

// Complete final close preserves every scope field and unrelated project data.
{
  const root = makeSandbox();
  try {
    const before = readJson(paths(root).sprint);
    const projectBefore = readJson(paths(root).project);
    const checkpoint = closeSuccessfully(root);
    const after = readJson(paths(root).sprint);
    const projectAfter = readJson(paths(root).project);
    assert(checkpoint.schemaVersion === 1 && checkpoint.kind === 'kyro.sprint-close-checkpoint', 'checkpoint v1 envelope missing');
    assertExactKeys(checkpoint, checkpointEnvelopeKeys, 'checkpoint envelope');
    assertExactKeys(checkpoint.identity, checkpointIdentityKeys, 'checkpoint.identity');
    assertExactKeys(checkpoint.close, checkpointCloseKeys, 'checkpoint.close');
    assertExactKeys(checkpoint.paths, checkpointPathsKeys, 'checkpoint.paths');
    assertExactKeys(checkpoint.digests, checkpointDigestKeys, 'checkpoint.digests');
    assert(JSON.stringify(checkpoint.beforeClose) === JSON.stringify(before), 'beforeClose must preserve the complete original SprintFile');
    assert(JSON.stringify(checkpoint.intendedAfterClose) === JSON.stringify(after), 'live sprint must equal intendedAfterClose');
    assertContainsKeys(checkpoint.beforeClose, sprintFileKeys, 'checkpoint.beforeClose');
    assertContainsKeys(checkpoint.intendedAfterClose, sprintFileKeys, 'checkpoint.intendedAfterClose');
    assertContainsKeys(checkpoint.beforeClose, ['spec', 'debt', 'roadmap', 'handoff', 'ledger', 'conventions', 'adrs', 'clarifications', 'successCriteria', 'extensionState'], 'checkpoint.beforeClose');
    assertContainsKeys(checkpoint.intendedAfterClose, ['spec', 'debt', 'roadmap', 'handoff', 'ledger', 'conventions', 'adrs', 'clarifications', 'successCriteria', 'extensionState'], 'checkpoint.intendedAfterClose');
    assertContainsKeys(checkpoint.projectScopeBefore, ['id', 'title', 'status'], 'checkpoint.projectScopeBefore');
    assertContainsKeys(checkpoint.projectScopeAfter, ['id', 'title', 'status'], 'checkpoint.projectScopeAfter');
    assert(after.ledger[0].snapshot === 'archive/sprint-001-demo-sprint.json', 'legacy snapshot link changed');
    assert(after.ledger[0].checkpoint === 'archive/sprint-001-demo-sprint.checkpoint.json', 'checkpoint ledger link missing');
    assert(/^[a-f0-9]{64}$/.test(after.ledger[0].checkpointSha256), 'external checkpoint ledger commitment missing');
    assert(projectAfter.scopes.find((scope) => scope.id === 'demo').status === 'completed', 'final close must complete project scope');
    assert(JSON.stringify(projectAfter.scopes.find((scope) => scope.id === 'unrelated')) === JSON.stringify(projectBefore.scopes.find((scope) => scope.id === 'unrelated')), 'unrelated scope entry changed');
    assert(JSON.stringify(projectAfter.runtimeExtension) === JSON.stringify(projectBefore.runtimeExtension), 'unrelated top-level project state changed');
    assert(existsSync(paths(root).snapshot) && existsSync(paths(root).narrative), 'dual-write artifacts missing');
    const doctor = run(root, ['doctor', '--artifacts', '--kyro-scope', 'demo']);
    assert(doctor.status === 0 && output(doctor).includes('APPLIED:'), `doctor must classify applied checkpoint:\n${output(doctor)}`);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

// Intermediate close retains active project scope status.
{
  const root = makeSandbox({ intermediate: true });
  try {
    const checkpoint = closeSuccessfully(root);
    assert(checkpoint.projectScopeBefore.status === 'active' && checkpoint.projectScopeAfter.status === 'active', 'intermediate close must not complete scope');
    assert(readJson(paths(root).sprint).handoff.nextAction === 'plan_sprint', 'intermediate close must route to plan_sprint');
    const doctor = run(root, ['doctor', '--artifacts', '--kyro-scope', 'demo']);
    assert(doctor.status === 0 && output(doctor).includes('APPLIED:'), `intermediate checkpoint must classify APPLIED:\n${output(doctor)}`);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

// CLI dry run performs no writes.
{
  const root = makeSandbox();
  try {
    const beforeSprint = readFileSync(paths(root).sprint, 'utf8');
    const result = run(root, [...closeArgs.filter((arg) => arg !== '--confirm'), '--dry-run']);
    assert(result.status === 0, `dry run failed: ${output(result)}`);
    assert(readFileSync(paths(root).sprint, 'utf8') === beforeSprint && !existsSync(paths(root).checkpoint), 'dry run wrote state');
  } finally { rmSync(root, { recursive: true, force: true }); }
}

// Every publication boundary is resumable with frozen metadata and stable checkpoint identity/time.
for (const boundary of ['checkpoint', 'snapshot', 'narrative', 'sprint', 'project']) {
  const root = makeSandbox();
  try {
    const failed = run(root, closeArgs, { KYRO_TEST_CLOSE_FAIL_AFTER: boundary });
    assert(failed.status === 1 && existsSync(paths(root).checkpoint), `${boundary}: injected failure did not preserve checkpoint`);
    const prepared = readJson(paths(root).checkpoint);
    const doctorBeforeRetry = run(root, ['doctor', '--artifacts', '--kyro-scope', 'demo']);
    const expectedState = boundary === 'checkpoint' ? 'PREPARED:' : boundary === 'project' ? 'APPLIED:' : 'PARTIAL:';
    assert(output(doctorBeforeRetry).includes(expectedState), `${boundary}: doctor should report ${expectedState}\n${output(doctorBeforeRetry)}`);
    const retried = run(root);
    assert(retried.status === 0, `${boundary}: retry failed:\n${output(retried)}`);
    const applied = readJson(paths(root).checkpoint);
    assert(prepared.createdAt === applied.createdAt && prepared.checkpointId === applied.checkpointId, `${boundary}: retry changed frozen metadata`);
    const again = run(root);
    assert(again.status === 0, `${boundary}: completed retry was not idempotent`);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

// Divergent live state and conflicting artifacts fail without overwrite.
{
  const root = makeSandbox();
  try {
    run(root, closeArgs, { KYRO_TEST_CLOSE_FAIL_AFTER: 'checkpoint' });
    const conflicting = run(root, closeArgs.map((arg) => arg === 'shipped' ? 'partial' : arg));
    assert(conflicting.status === 1 && output(conflicting).includes('CHECKPOINT_CONFLICT'), 'different close inputs must conflict with frozen checkpoint metadata');
  } finally { rmSync(root, { recursive: true, force: true }); }
}
{
  const root = makeSandbox();
  try {
    run(root, closeArgs, { KYRO_TEST_CLOSE_FAIL_AFTER: 'checkpoint' });
    const sprint = readJson(paths(root).sprint);
    sprint.objective = 'Concurrent user edit';
    writeJson(paths(root).sprint, sprint);
    const retry = run(root);
    assert(retry.status === 1 && output(retry).includes('STATE_DIVERGED'), `divergence must stop safely:\n${output(retry)}`);
    assert(readJson(paths(root).sprint).objective === 'Concurrent user edit', 'divergent live state was overwritten');
  } finally { rmSync(root, { recursive: true, force: true }); }
}
{
  const root = makeSandbox();
  try {
    run(root, closeArgs, { KYRO_TEST_CLOSE_FAIL_AFTER: 'checkpoint' });
    mkdirSync(join(paths(root).snapshot, '..'), { recursive: true });
    writeFileSync(paths(root).snapshot, 'conflict\n');
    const retry = run(root);
    assert(retry.status === 1 && output(retry).includes('CHECKPOINT_CONFLICT'), 'conflicting legacy snapshot must not be overwritten');
    assert(readFileSync(paths(root).snapshot, 'utf8') === 'conflict\n', 'conflicting artifact was overwritten');
  } finally { rmSync(root, { recursive: true, force: true }); }
}

// Corrupt and unsupported checkpoints are explicit failures.
for (const mode of ['corrupt', 'unsupported']) {
  const root = makeSandbox();
  try {
    run(root, closeArgs, { KYRO_TEST_CLOSE_FAIL_AFTER: 'checkpoint' });
    if (mode === 'corrupt') writeFileSync(paths(root).checkpoint, '{broken');
    else { const checkpoint = readJson(paths(root).checkpoint); checkpoint.schemaVersion = 99; writeJson(paths(root).checkpoint, checkpoint); }
    const retry = run(root);
    const expected = mode === 'corrupt' ? 'CHECKPOINT_CORRUPT' : 'CHECKPOINT_UNSUPPORTED_VERSION';
    assert(retry.status === 1 && output(retry).includes(expected), `${mode} checkpoint should expose ${expected}`);
    const doctor = run(root, ['doctor', '--artifacts', '--kyro-scope', 'demo']);
    const doctorStatus = mode === 'corrupt' ? 'CORRUPT:' : 'UNSUPPORTED_VERSION:';
    assert(doctor.status === 1 && output(doctor).includes(doctorStatus), `${mode}: doctor should classify ${doctorStatus}`);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

// Doctor scans checkpoints even when sprint.json is missing, and legacy-only history is warn-only.
{
  const root = makeSandbox();
  try {
    run(root, closeArgs, { KYRO_TEST_CLOSE_FAIL_AFTER: 'checkpoint' });
    unlinkSync(paths(root).sprint);
    const doctor = run(root, ['doctor', '--artifacts', '--kyro-scope', 'demo']);
    assert(output(doctor).includes('sprint-001-demo-sprint.checkpoint.json'), 'doctor returned before checkpoint inspection');
  } finally { rmSync(root, { recursive: true, force: true }); }
}

// Missing live sprint and affected project scope entry are safely restored from the checkpoint.
{
  const root = makeSandbox();
  try {
    run(root, closeArgs, { KYRO_TEST_CLOSE_FAIL_AFTER: 'checkpoint' });
    const checkpoint = readJson(paths(root).checkpoint);
    unlinkSync(paths(root).sprint);
    const project = readJson(paths(root).project);
    project.scopes = project.scopes.filter((scope) => scope.id !== 'demo');
    writeJson(paths(root).project, project);
    const retry = run(root);
    assert(retry.status === 0, `missing state recovery failed:\n${output(retry)}`);
    assert(JSON.stringify(readJson(paths(root).sprint)) === JSON.stringify(checkpoint.intendedAfterClose), 'missing sprint was not restored to intendedAfterClose');
    const restoredProject = readJson(paths(root).project);
    assert(restoredProject.scopes.some((scope) => scope.id === 'demo' && scope.status === 'completed'), 'missing affected project scope was not restored');
    assert(restoredProject.scopes.some((scope) => scope.id === 'unrelated' && scope.custom === 'preserve-me'), 'missing-scope recovery damaged unrelated project state');
  } finally { rmSync(root, { recursive: true, force: true }); }
}

// A self-consistent but unauthorized intended-after image is rejected semantically.
{
  const root = makeSandbox();
  try {
    run(root, closeArgs, { KYRO_TEST_CLOSE_FAIL_AFTER: 'checkpoint' });
    const checkpoint = readJson(paths(root).checkpoint);
    checkpoint.intendedAfterClose.objective = 'Unauthorized objective rewrite';
    checkpoint.digests.intendedAfterClose = digest(checkpoint.intendedAfterClose);
    writeJson(paths(root).checkpoint, checkpoint);
    const retry = run(root);
    assert(retry.status === 1 && output(retry).includes('CHECKPOINT_CORRUPT') && (output(retry).includes('authorized transition') || output(retry).includes('checkpoint commitment')), `semantic tampering was not rejected:\n${output(retry)}`);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

// Coordinated checkpoint edits with recomputed internal digests still fail the external ledger anchor.
{
  const root = makeSandbox();
  try {
    closeSuccessfully(root);
    const checkpoint = readJson(paths(root).checkpoint);
    checkpoint.beforeClose.objective = 'Coordinated archive rewrite';
    checkpoint.intendedAfterClose.objective = 'Coordinated archive rewrite';
    checkpoint.digests.beforeClose = digest(checkpoint.beforeClose);
    checkpoint.digests.intendedAfterClose = digest(checkpoint.intendedAfterClose);
    checkpoint.intendedAfterClose.ledger.at(-1).checkpointSha256 = checkpointCommitment(checkpoint);
    checkpoint.digests.intendedAfterClose = digest(checkpoint.intendedAfterClose);
    writeJson(paths(root).checkpoint, checkpoint);
    const doctor = run(root, ['doctor', '--artifacts', '--kyro-scope', 'demo']);
    assert(doctor.status === 1 && output(doctor).includes('checkpoint commitment'), `external ledger anchor did not detect coordinated archive tampering:\n${output(doctor)}`);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

// Every ledger checkpoint reference is enforced, not inferred from directory scans.
{
  const root = makeSandbox();
  try {
    closeSuccessfully(root);
    unlinkSync(paths(root).checkpoint);
    const doctor = run(root, ['doctor', '--artifacts', '--kyro-scope', 'demo']);
    assert(doctor.status === 1 && output(doctor).includes('referenced checkpoint is missing'), `dangling ledger checkpoint must fail:\n${output(doctor)}`);
  } finally { rmSync(root, { recursive: true, force: true }); }
}
{
  const root = makeSandbox();
  try {
    closeSuccessfully(root);
    writeFileSync(paths(root).checkpoint, '{broken');
    const doctor = run(root, ['doctor', '--artifacts', '--kyro-scope', 'demo']);
    assert(doctor.status === 1 && output(doctor).includes('referenced checkpoint is unreadable'), `unreadable ledger checkpoint must fail:\n${output(doctor)}`);
  } finally { rmSync(root, { recursive: true, force: true }); }
}
{
  const root = makeSandbox();
  try {
    closeSuccessfully(root);
    const sprint = readJson(paths(root).sprint);
    sprint.ledger[0].checkpoint = 'archive/sprint-001-wrong.checkpoint.json';
    writeJson(paths(root).sprint, sprint);
    const doctor = run(root, ['doctor', '--artifacts', '--kyro-scope', 'demo']);
    assert(doctor.status === 1 && output(doctor).includes('does not match ledger identity'), `mismatched ledger checkpoint must fail:\n${output(doctor)}`);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

// Historical checkpoints are integrity-checked without comparing old after-state to current live state.
{
  const root = makeSandbox({ intermediate: true });
  try {
    closeSuccessfully(root);
    const sprint = readJson(paths(root).sprint);
    const templateTask = sprint.previousSprint ? readJson(paths(root).checkpoint).beforeClose.activeSprint.phases[0].tasks[0] : null;
    sprint.activeSprint = {
      n: 2, slug: 'next', title: 'Next', objective: 'Finish next sprint.', status: 'complete',
      phases: [{ id: 'P2', title: 'Next', objective: 'Finish.', status: 'done', tasks: [{ ...templateTask, id: 'T2.1', title: 'Finish next', scenario_refs: ['SC-1'] }] }],
      emergentTasks: [], definitionOfDone: ['Done.'],
    };
    sprint.roadmap.sprints = sprint.roadmap.sprints.map((item) => item.n === 2 ? { ...item, state: 'active' } : item);
    sprint.handoff = { ...sprint.handoff, nextAction: 'close_sprint', nextTaskId: 'T2.1' };
    writeJson(paths(root).sprint, sprint);
    const project = readJson(paths(root).project);
    project.scopes = project.scopes.map((scope) => scope.id === 'demo' ? { ...scope, status: 'active' } : scope);
    writeJson(paths(root).project, project);
    const second = run(root, closeArgs);
    assert(second.status === 0, `second sprint close failed:\n${output(second)}`);
    const doctor = run(root, ['doctor', '--artifacts', '--kyro-scope', 'demo']);
    assert(doctor.status === 0, `historical checkpoint was compared to later live state:\n${output(doctor)}`);
    assert(!output(doctor).includes('sprint-001-demo-sprint.checkpoint.json: DIVERGED'), 'valid historical Sprint 1 marked divergent');
  } finally { rmSync(root, { recursive: true, force: true }); }
}

// The newest valid prepared transaction wins over an older ledgered checkpoint.
{
  const root = makeSandbox({ intermediate: true });
  try {
    closeSuccessfully(root);
    const sprint = readJson(paths(root).sprint);
    const templateTask = readJson(paths(root).checkpoint).beforeClose.activeSprint.phases[0].tasks[0];
    sprint.activeSprint = {
      n: 2, slug: 'next', title: 'Next', objective: 'Finish next sprint.', status: 'complete',
      phases: [{ id: 'P2', title: 'Next', objective: 'Finish.', status: 'done', tasks: [{ ...templateTask, id: 'T2.1', title: 'Finish next', scenario_refs: ['SC-1'] }] }],
      emergentTasks: [], definitionOfDone: ['Done.'],
    };
    sprint.roadmap.sprints = sprint.roadmap.sprints.map((item) => item.n === 2 ? { ...item, state: 'active' } : item);
    sprint.handoff = { ...sprint.handoff, nextAction: 'close_sprint', nextTaskId: 'T2.1' };
    writeJson(paths(root).sprint, sprint);
    const failed = run(root, closeArgs, { KYRO_TEST_CLOSE_FAIL_AFTER: 'checkpoint' });
    assert(failed.status === 1, `Sprint 2 prepared failure was not injected: ${output(failed)}`);
    const doctor = run(root, ['doctor', '--artifacts', '--kyro-scope', 'demo']);
    const text = output(doctor);
    assert(text.includes('sprint-002-next.checkpoint.json: PREPARED:'), `newest unledgered checkpoint was not selected:\n${text}`);
    assert(text.includes('sprint-001-demo-sprint.checkpoint.json: APPLIED: historical integrity'), `older checkpoint was not historical:\n${text}`);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

// Managed archive symlinks cannot redirect checkpoint writes outside the workspace.
{
  const root = makeSandbox();
  const external = mkdtempSync(join(tmpdir(), 'kyro-symlink-target-'));
  try {
    const archive = join(root, '.agents/kyro/scopes/demo/archive');
    symlinkSync(external, archive);
    const result = run(root);
    assert(result.status === 1 && (output(result).includes('symbolic link') || output(result).includes('outside the workspace')), `symlink escape was not rejected:\n${output(result)}`);
    assert(readdirSync(external).length === 0, 'close wrote through archive symlink outside workspace');
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(external, { recursive: true, force: true }); }
}

// Close and generic OperationPlan writers share one serialization lock.
{
  const root = makeSandbox();
  try {
    const closeReady = join(root, 'close-ready');
    const releaseGate = join(root, 'release-close');
    const writerWaiting = join(root, 'writer-waiting');
    const writerReady = join(root, 'writer-ready');
    const close = runAsync(root, closeArgs, { KYRO_TEST_LOCK_READY_FILE: closeReady, KYRO_TEST_LOCK_RELEASE_GATE: releaseGate });
    await waitForChild(close, () => existsSync(closeReady), 'close never acquired writer lock');
    const lockOwnerPath = join(root, '.kyro-state-writer.lock/owner.json');
    const owner = readFileSync(lockOwnerPath, 'utf8');
    const repair = runAsync(root, ['repair', '--kyro-scope', 'demo', '--confirm'], { KYRO_TEST_LOCK_WAITING_FILE: writerWaiting, KYRO_TEST_LOCK_READY_FILE: writerReady });
    await waitForChild(repair, () => existsSync(writerWaiting), 'repair never contended for writer lock');
    assert(readFileSync(lockOwnerPath, 'utf8') === owner && !existsSync(writerReady), 'waiting writer removed or replaced the live lock owner');
    writeFileSync(releaseGate, 'release\n');
    const [closeResult, repairResult] = await Promise.all([close.completed, repair.completed]);
    assert(closeResult.status === 0, `serialized close failed: ${closeResult.text}`);
    assert(repairResult.status === 0 && existsSync(writerReady), `generic writer did not acquire after release: ${repairResult.text}`);
    assert(readJson(paths(root).sprint).activeSprint === null, 'serialized writers corrupted sprint state');
  } finally { rmSync(root, { recursive: true, force: true }); }
}

// Interactive confirmation never holds the state-writer lock.
{
  const root = makeSandbox();
  try {
    const interactiveArgs = closeArgs.filter((arg) => arg !== '--confirm');
    // Outside a TTY close-sprint now refuses rather than prompting into a pipe that may never answer,
    // so opt this pipe-driven case back into the interactive path to keep exercising the prompt.
    const close = runAsync(root, interactiveArgs, { KYRO_TEST_ASSUME_TTY: '1' });
    await waitForChild(close, () => close.text().includes('[y/N]'), 'interactive close did not reach confirmation prompt');
    assert(!existsSync(join(root, '.kyro-state-writer.lock')), 'interactive prompt held the writer lock');
    const ready = join(root, 'repair-ready');
    const repair = runAsync(root, ['repair', '--kyro-scope', 'demo', '--confirm'], { KYRO_TEST_LOCK_READY_FILE: ready });
    await waitForChild(repair, () => existsSync(ready), 'another mutator could not acquire while close awaited input');
    const repairResult = await repair.completed;
    assert(repairResult.status === 0, `repair failed while close awaited confirmation: ${repairResult.text}`);
    close.child.stdin.end('n\n');
    const closeResult = await close.completed;
    assert(closeResult.status === 0 && closeResult.text.includes('No changes made.'), `interactive cancellation failed: ${closeResult.text}`);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

// Partial/malformed lock initialization is reclaimable, and injected init failure cleans up.
{
  const root = makeSandbox();
  try {
    const lock = join(root, '.kyro-state-writer.lock');
    mkdirSync(lock);
    writeFileSync(join(lock, 'owner.json'), '{partial');
    const old = new Date(Date.now() - 10_000);
    utimesSync(lock, old, old);
    const reclaimed = run(root, ['repair', '--kyro-scope', 'demo', '--confirm']);
    assert(reclaimed.status === 0 && !existsSync(lock), `malformed stale lock was not reclaimed: ${output(reclaimed)}`);
    const failedInit = run(root, ['repair', '--kyro-scope', 'demo', '--confirm'], { KYRO_TEST_LOCK_INIT_FAIL: '1' });
    assert(failedInit.status === 1 && !existsSync(lock), `failed lock initialization left a permanent lock: ${output(failedInit)}`);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

// Directory-fsync injection stays strict unless the explicit Windows portability policy is active.
{
  const root = makeSandbox();
  try {
    const result = run(root, ['repair', '--kyro-scope', 'demo', '--confirm'], {
      KYRO_TEST_LOCK_DIRSYNC_ERROR: 'EPERM',
      KYRO_TEST_LOCK_WIN32_POLICY: '0',
    });
    assert(result.status === 1 && output(result).includes('EPERM'), `directory-fsync injection did not fail closed outside Windows policy: ${output(result)}`);
    assertNoLockDebris(root, 'strict directory-fsync failure cleanup');
  } finally { rmSync(root, { recursive: true, force: true }); }
}

// Windows treats EPERM from directory fsync as a portability limitation in both owner and worker.
{
  const root = makeSandbox();
  try {
    const result = run(root, ['repair', '--kyro-scope', 'demo', '--confirm'], {
      KYRO_TEST_LOCK_DIRSYNC_ERROR: 'EPERM',
      KYRO_TEST_LOCK_WIN32_POLICY: '1',
    });
    assert(result.status === 0, `Windows directory-fsync policy did not complete a lock round-trip: ${output(result)}`);
    assertNoLockDebris(root, 'Windows directory-fsync round-trip');
  } finally { rmSync(root, { recursive: true, force: true }); }
}

// Cleanup attempts directory removal even when an unexpected sync error follows an init failure.
{
  const root = makeSandbox();
  try {
    const result = run(root, ['repair', '--kyro-scope', 'demo', '--confirm'], {
      KYRO_TEST_LOCK_INIT_FAIL: '1',
      KYRO_TEST_LOCK_DIRSYNC_ERROR: 'EIO',
    });
    assert(result.status === 1 && output(result).includes('Injected state-writer lock initialization failure'), `init failure was not preserved: ${output(result)}`);
    assertNoLockDebris(root, 'failed initialization cleanup');
  } finally { rmSync(root, { recursive: true, force: true }); }
}

// An empty partial lock remains reclaimable when Windows rejects directory fsync.
// Use the CI-safe lease: a 500ms lease expires under Windows runner load during reclaim+repair
// (Worker start + first renew), which is not what this case is testing.
{
  const root = makeSandbox();
  try {
    const lock = join(root, '.kyro-state-writer.lock');
    mkdirSync(lock);
    const old = new Date(Date.now() - 10_000);
    utimesSync(lock, old, old);
    const result = run(root, ['repair', '--kyro-scope', 'demo', '--confirm'], {
      KYRO_TEST_LOCK_DIRSYNC_ERROR: 'EPERM',
      KYRO_TEST_LOCK_WIN32_POLICY: '1',
      KYRO_TEST_LOCK_LEASE_MS: CI_SAFE_TEST_LEASE_MS,
    });
    assert(result.status === 0, `Windows policy could not reclaim an empty partial lock: ${output(result)}`);
    assertNoLockDebris(root, 'Windows empty-lock reclaim');
  } finally { rmSync(root, { recursive: true, force: true }); }
}

// A reclaim claimant crash is itself recoverable; no ownership-less .reclaim directory can wedge writers.
{
  const root = makeSandbox();
  try {
    const lock = join(root, '.kyro-state-writer.lock');
    mkdirSync(lock);
    const token = 'expired-owner';
    const old = Date.now() - 10_000;
    writeJson(join(lock, 'owner.json'), { pid: process.pid, token, createdAt: old });
    writeJson(join(lock, 'heartbeat.json'), { token, renewedAt: old, leaseUntil: old + 100 });
    const crashed = run(root, ['repair', '--kyro-scope', 'demo', '--confirm'], {
      KYRO_TEST_LOCK_LEASE_MS: '500',
      KYRO_TEST_LOCK_CRASH_AFTER_RECLAIM_CLAIM: '1',
    });
    assert(crashed.status === 86, `reclaim crash hook did not terminate after durable claim publication: ${output(crashed)}`);
    assert(readdirSync(root).some((name) => name.startsWith('.kyro-state-writer.lock.reclaim-')), 'crashed reclaimer left no recoverable claim fixture');
    const recovered = run(root, ['repair', '--kyro-scope', 'demo', '--confirm'], { KYRO_TEST_LOCK_LEASE_MS: '500' });
    assert(recovered.status === 0, `next writer could not recover a crashed reclaim claim: ${output(recovered)}`);
    assert(!existsSync(lock) && !readdirSync(root).some((name) => name.startsWith('.kyro-state-writer.lock.reclaim-')), `reclaim recovery left lock/claim debris: ${readdirSync(root).join(', ')}`);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

// PID reuse cannot keep an expired lease alive; heartbeat token/expiry is authoritative.
// Use a compact owner/heartbeat shape (production writes one-line JSON) and a reclaim-friendly
// lease env so slow CI fsync cannot drop the reclaim claim before winner selection.
{
  const root = makeSandbox();
  try {
    const lock = join(root, '.kyro-state-writer.lock');
    mkdirSync(lock);
    const token = 'pid-reuse-simulation';
    const old = Date.now() - 10_000;
    writeFileSync(join(lock, 'owner.json'), `${JSON.stringify({ pid: process.pid, token, createdAt: old })}\n`);
    writeFileSync(join(lock, 'heartbeat.json'), `${JSON.stringify({ token, renewedAt: old, leaseUntil: old + 100 })}\n`);
    const recovered = run(root, ['repair', '--kyro-scope', 'demo', '--confirm'], { KYRO_TEST_LOCK_LEASE_MS: '500' });
    assert(
      recovered.status === 0 && !existsSync(lock),
      `live reused PID incorrectly protected an expired token lease (status=${recovered.status}, lock=${existsSync(lock)}): ${output(recovered)}`,
    );
  } finally { rmSync(root, { recursive: true, force: true }); }
}

// The independent heartbeat renews during a stalled main thread and prevents premature reclaim.
{
  const root = makeSandbox();
  try {
    const ready = join(root, 'lease-ready');
    const gate = join(root, 'lease-release');
    const waiting = join(root, 'lease-waiting');
    const holder = runAsync(root, closeArgs, { KYRO_TEST_LOCK_LEASE_MS: CI_SAFE_TEST_LEASE_MS, KYRO_TEST_LOCK_READY_FILE: ready, KYRO_TEST_LOCK_RELEASE_GATE: gate });
    await waitForChild(holder, () => existsSync(ready), 'lease holder never acquired lock');
    const heartbeatPath = join(root, '.kyro-state-writer.lock/heartbeat.json');
    const firstLease = readJson(heartbeatPath).leaseUntil;
    await waitForChild(holder, () => {
      try { return readJson(heartbeatPath).leaseUntil > firstLease; } catch { return false; }
    }, 'lease heartbeat did not renew while main thread was stalled', LEASE_EVENT_BUDGET_MS);
    const contender = runAsync(root, ['repair', '--kyro-scope', 'demo', '--confirm'], { KYRO_TEST_LOCK_LEASE_MS: CI_SAFE_TEST_LEASE_MS, KYRO_TEST_LOCK_WAITING_FILE: waiting });
    await waitForChild(contender, () => existsSync(waiting), 'lease contender never observed holder');
    assert(existsSync(join(root, '.kyro-state-writer.lock')), 'contender reclaimed a renewed live lease');
    writeFileSync(gate, 'release\n');
    const [holderResult, contenderResult] = await Promise.all([holder.completed, contender.completed]);
    assert(holderResult.status === 0 && contenderResult.status === 0, `renewed lease serialization failed: ${holderResult.text}\n${contenderResult.text}`);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

// Heartbeat renewal failure fail-stops a blocked holder before a contender can take ownership.
{
  const root = makeSandbox();
  try {
    const ready = join(root, 'fenced-ready');
    const gate = join(root, 'never-released');
    const waiting = join(root, 'fenced-waiting');
    const holder = runAsync(root, closeArgs, {
      KYRO_TEST_LOCK_LEASE_MS: CI_SAFE_TEST_LEASE_MS,
      KYRO_TEST_LOCK_READY_FILE: ready,
      KYRO_TEST_LOCK_RELEASE_GATE: gate,
      KYRO_TEST_LOCK_HEARTBEAT_FAIL_AFTER: '1',
    });
    await waitForChild(holder, () => existsSync(ready), 'fenced holder never acquired lock');
    const contender = runAsync(root, ['repair', '--kyro-scope', 'demo', '--confirm'], {
      KYRO_TEST_LOCK_LEASE_MS: CI_SAFE_TEST_LEASE_MS,
      KYRO_TEST_LOCK_WAITING_FILE: waiting,
    });
    await waitForChild(contender, () => existsSync(waiting), 'contender never observed the soon-to-fail lease');
    const [holderResult, contenderResult] = await Promise.all([holder.completed, contender.completed]);
    assert(holderResult.status !== 0, `heartbeat-failed holder resumed or reported success: ${holderResult.text}`);
    assert(contenderResult.status === 0, `contender did not proceed after fenced holder lease expired: ${contenderResult.text}`);
    assert(!existsSync(paths(root).checkpoint), 'fenced holder resumed and published checkpoint side effects');
  } finally { rmSync(root, { recursive: true, force: true }); }
}

// A stale resumed holder cannot renew or write into a successor lock with the same pathname.
{
  const root = makeSandbox();
  try {
    const oldReady = join(root, 'old-ready');
    const oldMainGate = join(root, 'old-main-gate');
    const oldHeartbeatGate = join(root, 'old-heartbeat-gate');
    const oldHolder = runAsync(root, closeArgs, {
      KYRO_TEST_LOCK_LEASE_MS: '300',
      KYRO_TEST_LOCK_READY_FILE: oldReady,
      KYRO_TEST_LOCK_RELEASE_GATE: oldMainGate,
      KYRO_TEST_LOCK_HEARTBEAT_PAUSE_FILE: oldHeartbeatGate,
    });
    await waitForChild(oldHolder, () => existsSync(oldReady), 'old holder never acquired lock');

    const successorReady = join(root, 'successor-ready');
    const successorMainGate = join(root, 'successor-main-gate');
    const successor = runAsync(root, ['repair', '--kyro-scope', 'demo', '--confirm'], {
      KYRO_TEST_LOCK_LEASE_MS: '5000',
      KYRO_TEST_LOCK_READY_FILE: successorReady,
      KYRO_TEST_LOCK_RELEASE_GATE: successorMainGate,
    });
    await waitForChild(successor, () => existsSync(successorReady), 'successor never reclaimed expired paused lease');
    const ownerPath = join(root, '.kyro-state-writer.lock/owner.json');
    const heartbeatPath = join(root, '.kyro-state-writer.lock/heartbeat.json');
    const successorOwner = readFileSync(ownerPath, 'utf8');
    const successorHeartbeat = readFileSync(heartbeatPath, 'utf8');

    writeFileSync(oldHeartbeatGate, 'resume stale heartbeat\n');
    const oldResult = await oldHolder.completed;
    assert(oldResult.status !== 0, `stale resumed holder was not fenced: ${oldResult.text}`);
    assert(readFileSync(ownerPath, 'utf8') === successorOwner, 'stale holder changed successor owner record');
    assert(readFileSync(heartbeatPath, 'utf8') === successorHeartbeat, 'stale holder changed successor heartbeat');
    assert(!existsSync(paths(root).checkpoint), 'stale main thread resumed and published a checkpoint');

    writeFileSync(successorMainGate, 'release successor\n');
    const successorResult = await successor.completed;
    assert(successorResult.status === 0, `successor failed after stale holder fencing: ${successorResult.text}`);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

// Exact heartbeat-temp symlinks are never followed or truncated by a live renewal.
{
  const root = makeSandbox();
  const victim = mkdtempSync(join(tmpdir(), 'kyro-heartbeat-victim-'));
  try {
    const victimFile = join(victim, 'keep.txt');
    writeFileSync(victimFile, 'untouched\n');
    const ready = join(root, 'temp-symlink-ready');
    const mainGate = join(root, 'temp-symlink-main-gate');
    const tempToken = '44444444-4444-4444-8444-444444444444';
    const holder = runAsync(root, closeArgs, {
      KYRO_TEST_LOCK_LEASE_MS: '3000',
      KYRO_TEST_LOCK_READY_FILE: ready,
      KYRO_TEST_LOCK_RELEASE_GATE: mainGate,
      KYRO_TEST_LOCK_HEARTBEAT_TEMP_TOKEN: tempToken,
    });
    await waitForChild(holder, () => existsSync(ready), 'temp-symlink holder never acquired lock');
    symlinkSync(victimFile, join(root, `.kyro-state-writer.lock/heartbeat.json.tmp-${tempToken}`));
    const result = await holder.completed;
    assert(result.status !== 0, `heartbeat renewal ignored exclusive temp collision: ${result.text}`);
    assert(readFileSync(victimFile, 'utf8') === 'untouched\n', 'heartbeat renewal followed/truncated exact-temp symlink victim');
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(victim, { recursive: true, force: true }); }
}

// Unexpected worker exceptions are handled inside the worker and fail-stop the owner.
{
  const root = makeSandbox();
  try {
    const ready = join(root, 'unexpected-worker-ready');
    const mainGate = join(root, 'unexpected-worker-main-gate');
    const holder = runAsync(root, closeArgs, {
      KYRO_TEST_LOCK_LEASE_MS: '500',
      KYRO_TEST_LOCK_READY_FILE: ready,
      KYRO_TEST_LOCK_RELEASE_GATE: mainGate,
      KYRO_TEST_LOCK_HEARTBEAT_UNEXPECTED_AFTER: '2',
    });
    await waitForChild(holder, () => existsSync(ready), 'unexpected-exit holder never acquired lock');
    const result = await holder.completed;
    assert(result.status !== 0, `unexpected heartbeat worker exception did not fence owner: ${result.text}`);
    assert(!existsSync(paths(root).checkpoint), 'owner resumed after unexpected heartbeat worker termination');
  } finally { rmSync(root, { recursive: true, force: true }); }
}

// A raw unexpected worker exit is fenced by parent liveness checks/exit handlers before work resumes.
{
  const root = makeSandbox();
  try {
    const ready = join(root, 'raw-exit-holder-ready');
    const mainGate = join(root, 'raw-exit-main-gate');
    const rawExitReady = join(root, 'raw-worker-exited');
    const holder = runAsync(root, closeArgs, {
      KYRO_TEST_LOCK_LEASE_MS: '1000',
      KYRO_TEST_LOCK_READY_FILE: ready,
      KYRO_TEST_LOCK_RELEASE_GATE: mainGate,
      KYRO_TEST_LOCK_HEARTBEAT_RAW_EXIT_AFTER: '2',
      KYRO_TEST_LOCK_HEARTBEAT_RAW_EXIT_READY_FILE: rawExitReady,
    });
    await waitForChild(holder, () => existsSync(ready), 'raw-exit holder never acquired lock');
    await waitForChild(holder, () => existsSync(rawExitReady), 'heartbeat worker did not perform injected raw exit', LEASE_EVENT_BUDGET_MS);
    writeFileSync(mainGate, 'resume owner after worker exit\n');
    const result = await holder.completed;
    assert(result.status !== 0, `owner reported success after raw heartbeat worker exit: ${result.text}`);
    assert(!existsSync(paths(root).checkpoint), 'owner mutated checkpoint state after raw heartbeat worker exit');
  } finally { rmSync(root, { recursive: true, force: true }); }
}

// Reclaim discovery never follows prefix symlinks or symlinked owner/temp entries.
{
  const root = makeSandbox();
  const victim = mkdtempSync(join(tmpdir(), 'kyro-reclaim-victim-'));
  try {
    const victimFile = join(victim, 'keep.txt');
    writeFileSync(victimFile, 'untouched\n');
    const lock = join(root, '.kyro-state-writer.lock');
    mkdirSync(lock);
    const token = 'expired-symlink-audit';
    const old = Date.now() - 10_000;
    writeJson(join(lock, 'owner.json'), { pid: process.pid, token, createdAt: old });
    writeJson(join(lock, 'heartbeat.json'), { token, renewedAt: old, leaseUntil: old + 100 });

    const symlinkClaim = join(root, '.kyro-state-writer.lock.reclaim-11111111-1111-4111-8111-111111111111');
    symlinkSync(victim, symlinkClaim);
    const ownerSymlinkClaim = join(root, '.kyro-state-writer.lock.reclaim-22222222-2222-4222-8222-222222222222');
    mkdirSync(ownerSymlinkClaim);
    symlinkSync(victimFile, join(ownerSymlinkClaim, 'owner.json'));
    const stale = new Date(old);
    utimesSync(ownerSymlinkClaim, stale, stale);
    symlinkSync(victimFile, join(lock, 'heartbeat.json.tmp-33333333-3333-4333-8333-333333333333'));

    const recovered = run(root, ['repair', '--kyro-scope', 'demo', '--confirm'], { KYRO_TEST_LOCK_LEASE_MS: '500' });
    assert(recovered.status === 0, `safe reclaim was blocked by malicious prefix symlinks: ${output(recovered)}`);
    assert(readFileSync(victimFile, 'utf8') === 'untouched\n' && existsSync(victim), 'reclaim cleanup followed a symlink and modified the victim');
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(victim, { recursive: true, force: true }); }
}

// TUI prompts are unlocked, and the install plan is rebuilt after concurrent state changes.
{
  const root = makeSandbox();
  try {
    const tui = runAsync(root, ['tui']);
    await waitForChild(tui, () => tui.text().includes('Select an option:'), 'TUI did not reach its prompt');
    const changed = run(root, ['scope', 'set-active', 'unrelated', '--confirm']);
    assert(changed.status === 0, `concurrent scope mutation failed: ${output(changed)}`);
    tui.child.stdin.end('1\n');
    const tuiResult = await tui.completed;
    assert(tuiResult.status === 0, `TUI install failed: ${tuiResult.text}`);
    // set-active migrates monolito → layers; install must not clobber local activeScope or shared scopes.
    const state = readProjectStateFiles(root);
    assert(state.layered === true, 'set-active/install should leave layered project state');
    assert(state.activeScope === 'unrelated', 'TUI install applied a stale plan and clobbered activeScope');
    assert(
      state.scopes.some((scope) => scope.id === 'unrelated' && scope.status === 'blocked'),
      'TUI install clobbered unrelated scope registry entry',
    );
    assert(
      state.scopes.some((scope) => scope.id === 'demo'),
      'TUI install dropped demo scope from shared registry',
    );
  } finally { rmSync(root, { recursive: true, force: true }); }
}

// Layered-only workspace: close-sprint CAS updates project.json (not monolito).
{
  const root = makeSandbox();
  try {
    const mono = readJson(paths(root).project);
    writeJson(paths(root).shared, {
      schemaVersion: 4,
      artifactRoot: mono.artifactRoot ?? '.agents/kyro/scopes',
      scopes: mono.scopes.map(({ id, title, status }) => ({ id, title, status })),
    });
    writeJson(paths(root).local, {
      schemaVersion: 4,
      activeScope: mono.activeScope ?? 'demo',
      installedAdapters: mono.installedAdapters ?? [],
      ...(mono.runtimePath ? { runtimePath: mono.runtimePath } : {}),
    });
    unlinkSync(paths(root).project);
    const checkpoint = closeSuccessfully(root);
    assert(checkpoint.projectScopeAfter.status === 'completed', 'layered final close must complete scope');
    assert(existsSync(paths(root).shared), 'layered close must keep project.json');
    assert(!existsSync(paths(root).project), 'layered close must not recreate live monolito kyro.json');
    const shared = readJson(paths(root).shared);
    assert(shared.scopes.find((scope) => scope.id === 'demo')?.status === 'completed', 'layered close must mark demo completed on project.json');
    assert(shared.scopes.some((scope) => scope.id === 'unrelated'), 'layered close must preserve unrelated scopes on project.json');
    assert(!('activeScope' in shared), 'shared project.json must never gain activeScope on close');
  } finally { rmSync(root, { recursive: true, force: true }); }
}

// Durability helper works on real parent directories, and public package exports compile.
{
  const module = await import(pathToFileURL(resolve(repo, 'dist/cli/pipeline/state-writer-lock.js')).href);
  const root = mkdtempSync(join(tmpdir(), 'kyro-fsync-contract-'));
  try {
    const file = join(root, 'state.json');
    module.ensureDurableDirectory(join(root, 'nested', 'state'));
    writeFileSync(file, '{}\n');
    module.fsyncParentDirectory(file);
  } finally { rmSync(root, { recursive: true, force: true }); }
  const publicApi = await import(pathToFileURL(resolve(repo, 'dist/index.js')).href);
  assert(publicApi.SPRINT_CLOSE_CHECKPOINT_SCHEMA_VERSION === 1, 'checkpoint schema constant is not exported publicly');
  const consumerRoot = mkdtempSync(join(tmpdir(), 'kyro-type-consumer-'));
  try {
    const importPath = resolve(repo, 'dist/index').replaceAll('\\', '/');
    writeFileSync(join(consumerRoot, 'consumer.ts'), `import { SPRINT_CLOSE_CHECKPOINT_SCHEMA_VERSION, type SprintCloseCheckpointV1 } from '${importPath}';\nconst value: SprintCloseCheckpointV1['schemaVersion'] = SPRINT_CLOSE_CHECKPOINT_SCHEMA_VERSION;\nvoid value;\n`);
    const tsc = resolve(repo, 'node_modules/typescript/bin/tsc');
    const result = spawnSync(process.execPath, [tsc, '--noEmit', '--strict', '--skipLibCheck', '--moduleResolution', 'node', '--target', 'ES2022', join(consumerRoot, 'consumer.ts')], { encoding: 'utf8' });
    assert(result.status === 0, `public checkpoint type import failed:\n${output(result)}`);
  } finally { rmSync(consumerRoot, { recursive: true, force: true }); }
}
{
  const root = makeSandbox();
  try {
    closeSuccessfully(root);
    unlinkSync(paths(root).checkpoint);
    const sprint = readJson(paths(root).sprint);
    delete sprint.ledger[0].checkpoint;
    writeJson(paths(root).sprint, sprint);
    const doctor = run(root, ['doctor', '--artifacts', '--kyro-scope', 'demo']);
    assert(doctor.status === 0 && output(doctor).includes('legacy active-sprint snapshots only'), `legacy-only archive must warn, not fail:\n${output(doctor)}`);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

// Concurrent close attempts cannot produce different checkpoint content.
{
  const root = makeSandbox();
  try {
    const prepared = run(root, closeArgs, { KYRO_TEST_CLOSE_FAIL_AFTER: 'checkpoint' });
    assert(prepared.status === 1, `could not prepare resumable checkpoint: ${output(prepared)}`);
    const frozen = readFileSync(paths(root).checkpoint, 'utf8');
    const ready = join(root, 'retry-ready');
    const gate = join(root, 'retry-release');
    const waiting = join(root, 'retry-waiting');
    const first = runAsync(root, closeArgs, { KYRO_TEST_LOCK_READY_FILE: ready, KYRO_TEST_LOCK_RELEASE_GATE: gate });
    await waitForChild(first, () => existsSync(ready), 'first retry never acquired lock');
    const second = runAsync(root, closeArgs, { KYRO_TEST_LOCK_WAITING_FILE: waiting });
    await waitForChild(second, () => existsSync(waiting), 'second matching retry never waited on first');
    writeFileSync(gate, 'release\n');
    const results = await Promise.all([first.completed, second.completed]);
    assert(results.every((result) => result.status === 0), `matching concurrent retries must both resume successfully: ${JSON.stringify(results)}`);
    assert(readFileSync(paths(root).checkpoint, 'utf8') === frozen, 'matching retries changed frozen checkpoint bytes');
    const checkpoint = readJson(paths(root).checkpoint);
    assert(checkpoint.checkpointId && readdirSync(join(paths(root).checkpoint, '..')).filter((name) => name.endsWith('.checkpoint.json')).length === 1, 'concurrent close duplicated or clobbered checkpoint');
  } finally { rmSync(root, { recursive: true, force: true }); }
}

// Checkpoint recency is numeric, not lexical (sprint 1000 is newer than sprint 999).
{
  const module = await import(pathToFileURL(resolve(repo, 'dist/cli/commands/close-sprint.js')).href);
  const make = (sprintN, createdAt) => ({ identity: { sprintN }, createdAt, checkpointId: String(sprintN) });
  assert(module.compareCheckpointRecency(make(1000, '2026-01-01T00:00:00Z'), make(999, '2027-01-01T00:00:00Z')) > 0, 'checkpoint ordering regressed to lexical filename order');
}

/** Wait until `count` distinct heartbeat renewals have been published under the held lock. */
async function waitForRenewals(runState, root, count, message) {
  const heartbeatPath = join(root, '.kyro-state-writer.lock', 'heartbeat.json');
  const seen = new Set();
  await waitForChild(runState, () => {
    try { seen.add(JSON.parse(readFileSync(heartbeatPath, 'utf8')).renewedAt); }
    catch { /* A renewal is mid-rename; the next poll observes it. */ }
    return seen.size >= count;
  }, message, LEASE_EVENT_BUDGET_MS);
}

// Windows returns EPERM/EACCES/EBUSY from rename-over-existing while another handle holds the
// target. That is an I/O hiccup, not lease loss, so the owner must survive it — and the failed
// renewal must not leave its heartbeat temporary behind, or release rmdir()s into ENOTEMPTY.
{
  const root = makeSandbox();
  try {
    const ready = join(root, 'transient-ready');
    const gate = join(root, 'transient-gate');
    const holder = runAsync(root, closeArgs, {
      KYRO_TEST_LOCK_LEASE_MS: CI_SAFE_TEST_LEASE_MS,
      KYRO_TEST_LOCK_READY_FILE: ready,
      KYRO_TEST_LOCK_RELEASE_GATE: gate,
      KYRO_TEST_LOCK_WIN32_POLICY: '1',
      KYRO_TEST_LOCK_HEARTBEAT_TRANSIENT_AFTER: '1',
      KYRO_TEST_LOCK_HEARTBEAT_TRANSIENT_TIMES: '2',
    });
    await waitForChild(holder, () => existsSync(ready), 'transient-retry holder never acquired lock');
    // Two published renewals bracket the injected failures, so the retry path definitely ran.
    await waitForRenewals(holder, root, 2, 'holder never renewed past the injected transient errors');
    writeFileSync(gate, 'release\n');
    const result = await holder.completed;
    assert(result.status === 0, `transient renewal error must be retried, not fail-stop: ${result.text}`);
    assertNoLockDebris(root, 'transient renewal retry');
  } finally { rmSync(root, { recursive: true, force: true }); }
}

// First renewal must also retry: the main thread already published a lease, so margin is the
// on-disk heartbeat — not an in-memory counter that used to start at 0 and always fail-stop.
{
  const root = makeSandbox();
  try {
    const ready = join(root, 'first-renew-ready');
    const gate = join(root, 'first-renew-gate');
    const holder = runAsync(root, closeArgs, {
      KYRO_TEST_LOCK_LEASE_MS: CI_SAFE_TEST_LEASE_MS,
      KYRO_TEST_LOCK_READY_FILE: ready,
      KYRO_TEST_LOCK_RELEASE_GATE: gate,
      KYRO_TEST_LOCK_WIN32_POLICY: '1',
      KYRO_TEST_LOCK_HEARTBEAT_TRANSIENT_AFTER: '0',
      KYRO_TEST_LOCK_HEARTBEAT_TRANSIENT_TIMES: '2',
    });
    await waitForChild(holder, () => existsSync(ready), 'first-renewal transient holder never acquired lock');
    await waitForRenewals(holder, root, 1, 'holder never completed a first renewal past injected EPERM');
    writeFileSync(gate, 'release\n');
    const result = await holder.completed;
    assert(result.status === 0, `first-renewal transient error must be retried from published lease: ${result.text}`);
    assertNoLockDebris(root, 'first-renewal transient retry');
  } finally { rmSync(root, { recursive: true, force: true }); }
}

// The same injected error without the Windows policy still fail-stops: POSIX behaviour is unchanged.
// POSIX-only: forcing the policy off on Windows also drops the EPERM tolerance that directory
// fsync genuinely needs there, so the lock could not even be acquired.
if (process.platform !== 'win32') {
  const root = makeSandbox();
  try {
    const ready = join(root, 'posix-ready');
    const gate = join(root, 'posix-never-released');
    const holder = runAsync(root, closeArgs, {
      KYRO_TEST_LOCK_LEASE_MS: CI_SAFE_TEST_LEASE_MS,
      KYRO_TEST_LOCK_READY_FILE: ready,
      KYRO_TEST_LOCK_RELEASE_GATE: gate,
      KYRO_TEST_LOCK_WIN32_POLICY: '0',
      KYRO_TEST_LOCK_HEARTBEAT_TRANSIENT_AFTER: '1',
      KYRO_TEST_LOCK_HEARTBEAT_TRANSIENT_TIMES: '1000',
    });
    await waitForChild(holder, () => existsSync(ready), 'posix holder never acquired lock');
    const result = await holder.completed;
    assert(result.status !== 0, `POSIX must still fail-stop on a renewal error: ${result.text}`);
    assert(!existsSync(paths(root).checkpoint), 'fail-stopped POSIX holder still published checkpoint side effects');
  } finally { rmSync(root, { recursive: true, force: true }); }
}

// Retrying is bounded by the published lease: failures that outlive the margin still fail-stop
// under the Windows policy, so a wedged writer can never outlive its own lease.
{
  const root = makeSandbox();
  try {
    const ready = join(root, 'exhaust-ready');
    const gate = join(root, 'exhaust-never-released');
    const holder = runAsync(root, closeArgs, {
      KYRO_TEST_LOCK_LEASE_MS: CI_SAFE_TEST_LEASE_MS,
      KYRO_TEST_LOCK_READY_FILE: ready,
      KYRO_TEST_LOCK_RELEASE_GATE: gate,
      KYRO_TEST_LOCK_WIN32_POLICY: '1',
      KYRO_TEST_LOCK_HEARTBEAT_TRANSIENT_AFTER: '1',
      KYRO_TEST_LOCK_HEARTBEAT_TRANSIENT_TIMES: '1000',
    });
    await waitForChild(holder, () => existsSync(ready), 'lease-exhaustion holder never acquired lock');
    const result = await holder.completed;
    assert(result.status !== 0, `unbounded transient failures must exhaust the lease and fail-stop: ${result.text}`);
    assert(!existsSync(paths(root).checkpoint), 'lease-exhausted holder still published checkpoint side effects');
  } finally { rmSync(root, { recursive: true, force: true }); }
}

console.log('check:lossless-checkpoints — all cases passed');
