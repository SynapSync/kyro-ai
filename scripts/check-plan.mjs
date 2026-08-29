#!/usr/bin/env node
// Verifies `kyro plan --from <file>`, both modes — tool-owned and validated, so the agent never
// hand-writes the full v4 sprint.json. Mode is auto-detected from scope state, not file shape:
//   - init mode (no sprint.json yet): materializes a scope's initial sprint.json (spec + roadmap,
//     activeSprint: null). Covers the happy path, [NEEDS CLARIFICATION] routing (allowed here,
//     unlike execute-phase commands), SCOPE_ALREADY_INITIALIZED-shaped refusal on replay (no
//     overwrite — see case 3), input validation, scope-mismatch rejection, and --dry-run.
//   - sprint mode (sprint.json ready to plan: activeSprint null, handoff.nextAction plan_sprint):
//     materializes the next activeSprint from a lean sprint-plan file. Covers the happy path,
//     marker routing to clarify, SPRINT_ALREADY_ACTIVE refusal, wrong sprint.n, bad depends_on /
//     scenario_refs references, and --dry-run.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(fileURLToPath(import.meta.url), '../..');
const cli = resolve(repo, 'dist/cli.js');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sandbox() {
  const root = join(tmpdir(), `kyro-plan-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(join(root, '.home'), { recursive: true });
  mkdirSync(join(root, '.agents/kyro'), { recursive: true });
  // Seed legacy monolito; plan registry writes migrate to project.json + local.json.
  writeFileSync(
    kyroJsonPath(root),
    `${JSON.stringify(
      {
        schemaVersion: 4,
        artifactRoot: '.agents/kyro/scopes',
        scopes: [],
        activeScope: null,
        runtimePath: '~/.agents/kyro/current',
        installedAdapters: [],
      },
      null,
      2,
    )}\n`,
  );
  return root;
}

function kyroJsonPath(root) {
  return join(root, '.agents/kyro/kyro.json');
}

function projectJsonPath(root) {
  return join(root, '.agents/kyro/project.json');
}

function localJsonPath(root) {
  return join(root, '.agents/kyro/local.json');
}

function sprintPath(root, scope) {
  return join(root, `.agents/kyro/scopes/${scope}/sprint.json`);
}

function readSprint(root, scope) {
  return JSON.parse(readFileSync(sprintPath(root, scope), 'utf-8'));
}

/** Effective project state: layered merge when present, else legacy monolito. */
function readKyroJson(root) {
  const projectPath = projectJsonPath(root);
  const localPath = localJsonPath(root);
  if (existsSync(projectPath) || existsSync(localPath)) {
    const shared = existsSync(projectPath)
      ? JSON.parse(readFileSync(projectPath, 'utf-8'))
      : { schemaVersion: 4, artifactRoot: '.agents/kyro/scopes', scopes: [] };
    const local = existsSync(localPath)
      ? JSON.parse(readFileSync(localPath, 'utf-8'))
      : { schemaVersion: 4, activeScope: null, installedAdapters: [] };
    return {
      schemaVersion: 4,
      artifactRoot: shared.artifactRoot ?? '.agents/kyro/scopes',
      scopes: shared.scopes ?? [],
      activeScope: local.activeScope ?? null,
      runtimePath: local.runtimePath ?? '~/.agents/kyro/current',
      installedAdapters: local.installedAdapters ?? [],
      ...(shared.principles !== undefined ? { principles: shared.principles } : {}),
    };
  }
  return JSON.parse(readFileSync(kyroJsonPath(root), 'utf-8'));
}

/**
 * Isolate git identity from the host machine so author capture is deterministic.
 * Pass `gitConfig` as a path to a gitconfig file (with user.name/email) to enable author.
 * Default: empty global + no system config → no author.
 */
function run(args, root, { gitConfig = null } = {}) {
  const emptyConfig = join(root, '.home', 'gitconfig-empty');
  if (!existsSync(emptyConfig)) writeFileSync(emptyConfig, '');
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    env: {
      ...process.env,
      HOME: join(root, '.home'),
      GIT_CONFIG_GLOBAL: gitConfig ?? emptyConfig,
      GIT_CONFIG_SYSTEM: emptyConfig,
      GIT_CONFIG_NOSYSTEM: '1',
    },
    encoding: 'utf-8',
  });
}

function writeGitConfig(root, { name, email } = {}) {
  const path = join(root, '.home', 'gitconfig-author');
  const body = ['[user]'];
  if (name !== undefined) body.push(`\tname = ${name}`);
  if (email !== undefined) body.push(`\temail = ${email}`);
  writeFileSync(path, `${body.join('\n')}\n`);
  return path;
}

function assertAuthorShape(author, expectedName, expectedEmail) {
  assert(author && typeof author === 'object', 'author must be an object');
  if (expectedName === undefined) {
    assert(!Object.hasOwn(author, 'name'), 'author.name must be omitted when not provided');
  } else {
    assert(author.name === expectedName, `author.name expected ${expectedName}, got ${author.name}`);
  }
  if (expectedEmail === undefined) {
    assert(!Object.hasOwn(author, 'email'), 'author.email must be omitted when not provided');
  } else {
    assert(author.email === expectedEmail, `author.email expected ${expectedEmail}, got ${author.email}`);
  }
  assert(author.source === 'git', `author.source must be git, got ${author.source}`);
  assert(typeof author.capturedAt === 'string' && !Number.isNaN(Date.parse(author.capturedAt)), 'author.capturedAt must be ISO-parseable');
}

function validLeanPlan(overrides = {}) {
  return {
    scope: 'demo-scope',
    title: 'Demo Scope',
    objective: 'Ship the demo feature end to end.',
    successCriteria: ['A user completes the demo flow in under 2 minutes.'],
    spec: {
      requirements: [{ id: 'R1', statement: 'The system must do the demo thing.', priority: 'must', rationale: 'Core value.' }],
      nonGoals: ['Not doing the other thing.'],
      openQuestions: [],
    },
    roadmap: {
      plannedSprintCount: 2,
      sizingRationale: 'Split foundation from hardening.',
      sprints: [
        { n: 1, slug: 'foundation', title: 'Foundation' },
        { n: 2, slug: 'hardening', title: 'Hardening' },
      ],
    },
    ...overrides,
  };
}

function writeLeanPlan(root, data, name = 'lean-plan.json') {
  const path = join(root, name);
  writeFileSync(path, JSON.stringify(data, null, 2));
  return path;
}

function validLeanSprintPlan(overrides = {}) {
  return {
    sprint: { n: 1, slug: 'foundation', title: 'Foundation', objective: 'Ship the foundation.' },
    phases: [
      {
        id: 'P1',
        title: 'Phase 1',
        objective: 'Build the core.',
        tasks: [
          {
            id: 'T1.1',
            title: 'Task 1',
            description: 'Do the thing.',
            files_to_touch: ['src/x.ts'],
            context: 'Context for the task.',
            acceptance_criteria: ['It works.'],
            depends_on: [],
            scenario_refs: [],
          },
        ],
      },
    ],
    definitionOfDone: ['All tasks done.'],
    scenarios: [],
    ...overrides,
  };
}

function writeLeanSprintPlan(root, data, name = 'lean-sprint.json') {
  const path = join(root, name);
  writeFileSync(path, JSON.stringify(data, null, 2));
  return path;
}

// Bootstraps a scope into the "ready to plan Sprint 1" state (sprint.json exists, activeSprint:
// null, handoff.nextAction: plan_sprint) so sprint-mode cases can start from there.
function initScope(root, scope = 'demo-scope') {
  const leanPath = writeLeanPlan(root, validLeanPlan({ scope }));
  const result = run(['plan', '--from', leanPath], root);
  assert(result.status === 0, `init (sprint-mode setup) should succeed: ${result.stdout}${result.stderr}`);
}

// 1) Happy path: materializes sprint.json (spec + roadmap, activeSprint: null), routes to
//    plan_sprint, registers the scope in kyro.json, and the result passes doctor + analyze clean.
{
  const root = sandbox();
  try {
    const leanPath = writeLeanPlan(root, validLeanPlan());
    const result = run(['plan', '--from', leanPath], root);
    assert(result.status === 0, `kyro plan should succeed: ${result.stdout}${result.stderr}`);

    const sprint = readSprint(root, 'demo-scope');
    assert(sprint.schemaVersion === 4, 'schemaVersion should be 4');
    assert(sprint.status === 'planning', 'status should be planning');
    assert(sprint.activeSprint === null, 'activeSprint must be null in init mode');
    assert(sprint.handoff.nextAction === 'plan_sprint', `nextAction should be plan_sprint, got ${sprint.handoff.nextAction}`);
    assert(sprint.handoff.nextTaskId === null, 'nextTaskId should be null');
    assert(sprint.spec.requirements.length === 1 && sprint.spec.requirements[0].id === 'R1', 'spec.requirements should match input');
    assert(Array.isArray(sprint.spec.scenarios) && sprint.spec.scenarios.length === 0, 'spec.scenarios must always be empty in init mode');
    assert(sprint.roadmap.plannedSprintCount === 2 && sprint.roadmap.sprints.length === 2, 'roadmap should match input');
    assert(sprint.roadmap.sprints.every((s) => s.state === 'planned'), 'roadmap sprints should be state: planned');
    // Default sandbox isolates git config → author key must be omitted (not null).
    assert(!Object.hasOwn(sprint, 'author'), 'author must be omitted when git identity is unavailable');

    const kyroJson = readKyroJson(root);
    assert(kyroJson.scopes.some((entry) => entry.id === 'demo-scope'), 'kyro.json should register the new scope');
    assert(kyroJson.activeScope === 'demo-scope', 'kyro.json activeScope should be set to the initialized scope');

    const doctorResult = run(['doctor', '--artifacts', '--kyro-scope', 'demo-scope'], root);
    assert(doctorResult.status === 0, `doctor --artifacts should be clean: ${doctorResult.stdout}${doctorResult.stderr}`);

    const analyzeResult = run(['analyze', '--kyro-scope', 'demo-scope'], root);
    assert(analyzeResult.status === 0, `analyze should be clean (no CRITICAL/HIGH): ${analyzeResult.stdout}${analyzeResult.stderr}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// 1b) Initializing a second scope explicitly selects it locally, without adding the local-only
//     activeScope key to the shared project registry. This prevents commands without
//     --kyro-scope from silently continuing to target the previous scope.
{
  const root = sandbox();
  try {
    initScope(root, 'previous-scope');
    const secondScope = 'newly-initialized-scope';
    const leanPath = writeLeanPlan(root, validLeanPlan({ scope: secondScope }), 'second-lean.json');
    const result = run(['plan', '--from', leanPath, '--kyro-scope', secondScope], root);
    assert(result.status === 0, `second scope init should succeed: ${result.stdout}${result.stderr}`);

    const effective = readKyroJson(root);
    assert(effective.activeScope === secondScope, 'newly initialized scope must become the active scope');
    assert(effective.scopes.some((entry) => entry.id === 'previous-scope'), 'previous scope must remain registered');
    assert(effective.scopes.some((entry) => entry.id === secondScope), 'new scope must be registered');

    const shared = JSON.parse(readFileSync(projectJsonPath(root), 'utf-8'));
    const local = JSON.parse(readFileSync(localJsonPath(root), 'utf-8'));
    assert(!Object.hasOwn(shared, 'activeScope'), 'shared project.json must not store activeScope');
    assert(local.activeScope === secondScope, 'local.json must select the newly initialized scope');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// 2) A [NEEDS CLARIFICATION] marker in the lean plan routes to "clarify" (exit 0, file written) —
//    init mode legitimately writes markers; this is not the execute-phase O5 gate.
{
  const root = sandbox();
  try {
    const leanPath = writeLeanPlan(root, validLeanPlan({
      scope: 'clarify-scope',
      objective: 'Ship the demo feature [NEEDS CLARIFICATION: which store backs the demo?].',
    }));
    const result = run(['plan', '--from', leanPath], root);
    assert(result.status === 0, `kyro plan with a marker should still succeed: ${result.stdout}${result.stderr}`);
    const sprint = readSprint(root, 'clarify-scope');
    assert(sprint.handoff.nextAction === 'clarify', `nextAction should be clarify, got ${sprint.handoff.nextAction}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// 2b) Non-empty spec.openQuestions alone (no markers) routes init to "clarify".
{
  const root = sandbox();
  try {
    const leanPath = writeLeanPlan(root, validLeanPlan({
      scope: 'open-q-scope',
      spec: {
        requirements: [
          { id: 'R1', statement: 'Users can complete the happy path.', priority: 'must', rationale: 'Core value.' },
        ],
        nonGoals: ['Out of scope for v1.'],
        openQuestions: ['Which allergen taxonomy is canonical for phase one?'],
      },
    }));
    const result = run(['plan', '--from', leanPath], root);
    assert(result.status === 0, `kyro plan with openQuestions should succeed: ${result.stdout}${result.stderr}`);
    const sprint = readSprint(root, 'open-q-scope');
    assert(sprint.handoff.nextAction === 'clarify', `openQuestions should route to clarify, got ${sprint.handoff.nextAction}`);
    assert(
      String(sprint.handoff.note || '').toLowerCase().includes('open question'),
      `handoff note should mention open questions: ${sprint.handoff.note}`,
    );
    assert(Array.isArray(sprint.spec?.openQuestions) && sprint.spec.openQuestions.length === 1, 'openQuestions must be preserved');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// 3) Already initialized: mode is auto-detected from scope state, not file shape. Once a scope has a
//    sprint.json ready to plan (nextAction: plan_sprint, activeSprint: null), re-running plan routes
//    to SPRINT MODE regardless of the file passed — so replaying the same init-shaped lean file now
//    fails INVALID_INPUT (it isn't a valid lean sprint plan: no "sprint" object), not
//    SCOPE_ALREADY_INITIALIZED. Either way, sprint.json is never touched by the refused second call.
{
  const root = sandbox();
  try {
    const leanPath = writeLeanPlan(root, validLeanPlan());
    const first = run(['plan', '--from', leanPath], root);
    assert(first.status === 0, `first plan should succeed: ${first.stdout}${first.stderr}`);
    const before = readFileSync(sprintPath(root, 'demo-scope'), 'utf-8');

    const second = run(['plan', '--from', leanPath], root);
    assert(second.status === 1, 'second plan on the same scope should fail');
    assert((second.stderr + second.stdout).includes('INVALID_INPUT'), `should report INVALID_INPUT (routed to sprint mode): ${second.stdout}${second.stderr}`);

    const after = readFileSync(sprintPath(root, 'demo-scope'), 'utf-8');
    assert(before === after, 'sprint.json must be byte-identical after the refused re-init');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// 4) Invalid input: empty successCriteria fails INVALID_INPUT and writes nothing.
{
  const root = sandbox();
  try {
    const leanPath = writeLeanPlan(root, validLeanPlan({ successCriteria: [] }));
    const result = run(['plan', '--from', leanPath], root);
    assert(result.status === 1, 'empty successCriteria should fail');
    assert((result.stderr + result.stdout).includes('INVALID_INPUT'), `should report INVALID_INPUT: ${result.stdout}${result.stderr}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// 4b) Invalid input: plannedSprintCount mismatched against roadmap.sprints.length.
{
  const root = sandbox();
  try {
    const leanPath = writeLeanPlan(root, validLeanPlan({ roadmap: { plannedSprintCount: 3, sizingRationale: 'x', sprints: [{ n: 1, slug: 'a', title: 'A' }] } }));
    const result = run(['plan', '--from', leanPath], root);
    assert(result.status === 1, 'mismatched plannedSprintCount should fail');
    assert((result.stderr + result.stdout).includes('INVALID_INPUT'), `should report INVALID_INPUT: ${result.stdout}${result.stderr}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// 5) Scope mismatch: --kyro-scope disagrees with the lean plan file's "scope" — fails INVALID_INPUT,
//    nothing written.
{
  const root = sandbox();
  try {
    const leanPath = writeLeanPlan(root, validLeanPlan({ scope: 'b' }));
    const result = run(['plan', '--from', leanPath, '--kyro-scope', 'a'], root);
    assert(result.status === 1, 'scope mismatch should fail');
    assert((result.stderr + result.stdout).includes('INVALID_INPUT'), `should report INVALID_INPUT: ${result.stdout}${result.stderr}`);
    const kyroJson = readKyroJson(root);
    assert(kyroJson.scopes.length === 0, 'kyro.json must not be mutated on scope mismatch');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// 6) --dry-run prints a plan, writes no sprint.json, and does not mutate kyro.json.
{
  const root = sandbox();
  try {
    const leanPath = writeLeanPlan(root, validLeanPlan());
    const beforeKyroJson = readFileSync(kyroJsonPath(root), 'utf-8');
    const result = run(['plan', '--from', leanPath, '--dry-run'], root);
    assert(result.status === 0, `dry-run should succeed: ${result.stdout}${result.stderr}`);
    assert(result.stdout.includes('write'), 'dry-run should print the write operation plan');
    assert(readFileSync(kyroJsonPath(root), 'utf-8') === beforeKyroJson, 'dry-run must not mutate kyro.json');

    let sprintWritten = true;
    try { readSprint(root, 'demo-scope'); } catch { sprintWritten = false; }
    assert(!sprintWritten, 'dry-run must not write sprint.json');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// 6b) Init with complete git identity captures optional sprint.json.author.
{
  const root = sandbox();
  try {
    const gitConfig = writeGitConfig(root, { name: 'Ada Lovelace', email: 'ada@example.com' });
    const leanPath = writeLeanPlan(root, validLeanPlan({ scope: 'author-scope' }));
    const result = run(['plan', '--from', leanPath], root, { gitConfig });
    assert(result.status === 0, `plan with git identity should succeed: ${result.stdout}${result.stderr}`);
    const sprint = readSprint(root, 'author-scope');
    assertAuthorShape(sprint.author, 'Ada Lovelace', 'ada@example.com');
    // Registry must not carry author (cache stays id/title/status only).
    const kyroJson = readKyroJson(root);
    const entry = kyroJson.scopes.find((s) => s.id === 'author-scope');
    assert(entry && !Object.hasOwn(entry, 'author'), 'project scopes registry must not store author');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// 6c) Partial git identity (name only) captures author without email.
{
  const root = sandbox();
  try {
    const gitConfig = writeGitConfig(root, { name: 'Only Name' });
    const leanPath = writeLeanPlan(root, validLeanPlan({ scope: 'partial-author' }));
    const result = run(['plan', '--from', leanPath], root, { gitConfig });
    assert(result.status === 0, `plan with name-only git should succeed: ${result.stdout}${result.stderr}`);
    const sprint = readSprint(root, 'partial-author');
    assertAuthorShape(sprint.author, 'Only Name', undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// 6d) Partial git identity (email only) captures author without name.
{
  const root = sandbox();
  try {
    const gitConfig = writeGitConfig(root, { email: 'only@example.com' });
    const leanPath = writeLeanPlan(root, validLeanPlan({ scope: 'partial-email' }));
    const result = run(['plan', '--from', leanPath], root, { gitConfig });
    assert(result.status === 0, `plan with email-only git should succeed: ${result.stdout}${result.stderr}`);
    const sprint = readSprint(root, 'partial-email');
    assertAuthorShape(sprint.author, undefined, 'only@example.com');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// 6e) Sprint mode preserves author from init (immutable after create).
{
  const root = sandbox();
  try {
    const gitConfig = writeGitConfig(root, { name: 'Ada Lovelace', email: 'ada@example.com' });
    const leanPath = writeLeanPlan(root, validLeanPlan({ scope: 'preserve-author' }));
    const initResult = run(['plan', '--from', leanPath], root, { gitConfig });
    assert(initResult.status === 0, `init should succeed: ${initResult.stdout}${initResult.stderr}`);
    const afterInit = readSprint(root, 'preserve-author');
    assertAuthorShape(afterInit.author, 'Ada Lovelace', 'ada@example.com');
    const authorSnapshot = JSON.stringify(afterInit.author);

    const sprintLean = writeLeanSprintPlan(root, validLeanSprintPlan());
    // Sprint mode without git identity must still keep the stored author.
    const sprintResult = run(['plan', '--from', sprintLean, '--kyro-scope', 'preserve-author'], root);
    assert(sprintResult.status === 0, `sprint plan should succeed: ${sprintResult.stdout}${sprintResult.stderr}`);
    const afterSprint = readSprint(root, 'preserve-author');
    assert(JSON.stringify(afterSprint.author) === authorSnapshot, 'sprint mode must preserve author byte-for-byte');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// 6f) Malformed author on disk fails validateSprintFile / doctor --artifacts.
{
  const root = sandbox();
  try {
    const leanPath = writeLeanPlan(root, validLeanPlan({ scope: 'bad-author' }));
    const result = run(['plan', '--from', leanPath], root);
    assert(result.status === 0, `init should succeed: ${result.stdout}${result.stderr}`);
    const sprint = readSprint(root, 'bad-author');
    sprint.author = { name: '', email: 'x@y.com', source: 'git', capturedAt: '2026-07-24T00:00:00.000Z' };
    writeFileSync(sprintPath(root, 'bad-author'), `${JSON.stringify(sprint, null, 2)}\n`);
    const doctorResult = run(['doctor', '--artifacts', '--kyro-scope', 'bad-author'], root);
    assert(doctorResult.status !== 0, 'doctor --artifacts should fail on empty author.name');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// 6g) Invalid git email alone must NOT block init — omit author entirely.
{
  const root = sandbox();
  try {
    const gitConfig = writeGitConfig(root, { email: 'not-an-email' });
    const leanPath = writeLeanPlan(root, validLeanPlan({ scope: 'bad-git-email' }));
    const result = run(['plan', '--from', leanPath], root, { gitConfig });
    assert(result.status === 0, `init must succeed with invalid git email: ${result.stdout}${result.stderr}`);
    const sprint = readSprint(root, 'bad-git-email');
    assert(!Object.hasOwn(sprint, 'author'), 'author must be omitted when git email is schema-invalid');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// 6h) Valid name + invalid git email: keep name, drop email, init succeeds.
{
  const root = sandbox();
  try {
    const gitConfig = writeGitConfig(root, { name: 'Ada', email: 'not-an-email' });
    const leanPath = writeLeanPlan(root, validLeanPlan({ scope: 'name-bad-email' }));
    const result = run(['plan', '--from', leanPath], root, { gitConfig });
    assert(result.status === 0, `init must succeed with name + invalid email: ${result.stdout}${result.stderr}`);
    const sprint = readSprint(root, 'name-bad-email');
    assertAuthorShape(sprint.author, 'Ada', undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// --- sprint mode ---

// 7) Sprint mode happy path: init a scope, then materialize Sprint 1 from a lean sprint-plan file.
{
  const root = sandbox();
  try {
    initScope(root);
    const leanPath = writeLeanSprintPlan(root, validLeanSprintPlan());
    const result = run(['plan', '--from', leanPath, '--kyro-scope', 'demo-scope'], root);
    assert(result.status === 0, `sprint plan should succeed: ${result.stdout}${result.stderr}`);

    const sprint = readSprint(root, 'demo-scope');
    assert(sprint.activeSprint !== null, 'activeSprint must be non-null after sprint mode');
    assert(sprint.activeSprint.status === 'planned', `activeSprint.status should be derived "planned", got ${sprint.activeSprint.status}`);
    const tasks = sprint.activeSprint.phases.flatMap((phase) => phase.tasks);
    assert(tasks.length === 1 && tasks[0].id === 'T1.1', 'should materialize the one input task');
    assert(tasks.every((t) => t.status === 'pending' && t.evidence === null && t.verdict === null), 'all tasks should be pending/evidence null/verdict null');
    assert(sprint.handoff.nextAction === 'execute_task', `nextAction should be execute_task, got ${sprint.handoff.nextAction}`);
    assert(sprint.handoff.nextTaskId === 'T1.1', `nextTaskId should be the first task, got ${sprint.handoff.nextTaskId}`);
    const roadmapEntry = sprint.roadmap.sprints.find((s) => s.n === 1);
    assert(roadmapEntry && roadmapEntry.state === 'active', `roadmap sprint 1 state should be active, got ${roadmapEntry && roadmapEntry.state}`);

    // Sprint mode reconciles the kyro.json status cache so the artifact is fully coherent — no stale
    // status finding. Without reconciliation this would be a guaranteed MEDIUM on every sprint-mode run.
    const kyroJson = readKyroJson(root);
    assert(kyroJson.scopes.find((entry) => entry.id === 'demo-scope').status === 'active', `kyro.json scope status should reconcile to "active", got ${kyroJson.scopes.find((entry) => entry.id === 'demo-scope').status}`);

    const analyzeResult = run(['analyze', '--kyro-scope', 'demo-scope'], root);
    assert(analyzeResult.status === 0, `analyze should show no CRITICAL/HIGH findings: ${analyzeResult.stdout}${analyzeResult.stderr}`);
    assert(!analyzeResult.stdout.includes('[CRITICAL]') && !analyzeResult.stdout.includes('[HIGH]'), `analyze output unexpectedly has a CRITICAL/HIGH finding: ${analyzeResult.stdout}`);
    // The reconciliation fix specifically removes the kyro.json stale-status coherence finding.
    assert(!analyzeResult.stdout.includes('is stale'), `sprint mode should not leave a stale kyro.json status finding: ${analyzeResult.stdout}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// 8) A [NEEDS CLARIFICATION] marker in a sprint-mode task routes handoff.nextAction to "clarify".
{
  const root = sandbox();
  try {
    initScope(root);
    const leanPath = writeLeanSprintPlan(root, validLeanSprintPlan({
      phases: [
        {
          id: 'P1',
          title: 'Phase 1',
          objective: 'Build the core.',
          tasks: [
            {
              id: 'T1.1',
              title: 'Task 1',
              description: 'Do the thing [NEEDS CLARIFICATION: which api?].',
              files_to_touch: [],
              context: 'ctx',
              acceptance_criteria: ['It works.'],
              depends_on: [],
              scenario_refs: [],
            },
          ],
        },
      ],
    }));
    const result = run(['plan', '--from', leanPath, '--kyro-scope', 'demo-scope'], root);
    assert(result.status === 0, `sprint plan with a marker should still succeed: ${result.stdout}${result.stderr}`);
    const sprint = readSprint(root, 'demo-scope');
    assert(sprint.handoff.nextAction === 'clarify', `nextAction should be clarify, got ${sprint.handoff.nextAction}`);
    assert(sprint.handoff.nextTaskId === null, 'nextTaskId should be null when routed to clarify');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// 9) Active sprint present: running sprint mode a second time fails SPRINT_ALREADY_ACTIVE and
//    leaves sprint.json byte-identical.
{
  const root = sandbox();
  try {
    initScope(root);
    const leanPath = writeLeanSprintPlan(root, validLeanSprintPlan());
    const first = run(['plan', '--from', leanPath, '--kyro-scope', 'demo-scope'], root);
    assert(first.status === 0, `first sprint plan should succeed: ${first.stdout}${first.stderr}`);
    const before = readFileSync(sprintPath(root, 'demo-scope'), 'utf-8');

    const second = run(['plan', '--from', leanPath, '--kyro-scope', 'demo-scope'], root);
    assert(second.status === 1, 'second sprint plan call should fail');
    assert((second.stderr + second.stdout).includes('SPRINT_ALREADY_ACTIVE'), `should report SPRINT_ALREADY_ACTIVE: ${second.stdout}${second.stderr}`);

    const after = readFileSync(sprintPath(root, 'demo-scope'), 'utf-8');
    assert(before === after, 'sprint.json must be byte-identical after the refused second sprint plan');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// 10) Wrong N: sprint.n not equal to the expected next number (1, empty ledger) fails INVALID_INPUT,
//     nothing written.
{
  const root = sandbox();
  try {
    initScope(root);
    const leanPath = writeLeanSprintPlan(root, validLeanSprintPlan({ sprint: { n: 2, slug: 'foundation', title: 'Foundation', objective: 'Ship the foundation.' } }));
    const result = run(['plan', '--from', leanPath, '--kyro-scope', 'demo-scope'], root);
    assert(result.status === 1, 'wrong sprint.n should fail');
    assert((result.stderr + result.stdout).includes('INVALID_INPUT'), `should report INVALID_INPUT: ${result.stdout}${result.stderr}`);
    const sprint = readSprint(root, 'demo-scope');
    assert(sprint.activeSprint === null, 'activeSprint must remain null after the refused wrong-N plan');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// 11) Bad depends_on: a task depends_on a task id that does not exist in the sprint fails
//     INVALID_INPUT, nothing written.
{
  const root = sandbox();
  try {
    initScope(root);
    const leanPath = writeLeanSprintPlan(root, validLeanSprintPlan({
      phases: [
        {
          id: 'P1',
          title: 'Phase 1',
          objective: 'Build the core.',
          tasks: [
            {
              id: 'T1.1',
              title: 'Task 1',
              description: 'Do the thing.',
              files_to_touch: [],
              context: 'ctx',
              acceptance_criteria: ['It works.'],
              depends_on: ['T9.9'],
              scenario_refs: [],
            },
          ],
        },
      ],
    }));
    const result = run(['plan', '--from', leanPath, '--kyro-scope', 'demo-scope'], root);
    assert(result.status === 1, 'bad depends_on should fail');
    assert((result.stderr + result.stdout).includes('INVALID_INPUT'), `should report INVALID_INPUT: ${result.stdout}${result.stderr}`);
    const sprint = readSprint(root, 'demo-scope');
    assert(sprint.activeSprint === null, 'activeSprint must remain null after the refused bad-depends_on plan');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// 12) Bad scenario_refs: a task scenario_refs a scenario id that does not exist (neither in
//     spec.scenarios nor this file's scenarios) fails INVALID_INPUT, nothing written.
{
  const root = sandbox();
  try {
    initScope(root);
    const leanPath = writeLeanSprintPlan(root, validLeanSprintPlan({
      phases: [
        {
          id: 'P1',
          title: 'Phase 1',
          objective: 'Build the core.',
          tasks: [
            {
              id: 'T1.1',
              title: 'Task 1',
              description: 'Do the thing.',
              files_to_touch: [],
              context: 'ctx',
              acceptance_criteria: ['It works.'],
              depends_on: [],
              scenario_refs: ['S404'],
            },
          ],
        },
      ],
    }));
    const result = run(['plan', '--from', leanPath, '--kyro-scope', 'demo-scope'], root);
    assert(result.status === 1, 'bad scenario_refs should fail');
    assert((result.stderr + result.stdout).includes('INVALID_INPUT'), `should report INVALID_INPUT: ${result.stdout}${result.stderr}`);
    const sprint = readSprint(root, 'demo-scope');
    assert(sprint.activeSprint === null, 'activeSprint must remain null after the refused bad-scenario_refs plan');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// 13) --dry-run in sprint mode prints a plan and writes nothing.
{
  const root = sandbox();
  try {
    initScope(root);
    const leanPath = writeLeanSprintPlan(root, validLeanSprintPlan());
    const before = readFileSync(sprintPath(root, 'demo-scope'), 'utf-8');
    const result = run(['plan', '--from', leanPath, '--kyro-scope', 'demo-scope', '--dry-run'], root);
    assert(result.status === 0, `sprint dry-run should succeed: ${result.stdout}${result.stderr}`);
    assert(result.stdout.includes('write'), 'dry-run should print the write operation plan');
    const after = readFileSync(sprintPath(root, 'demo-scope'), 'utf-8');
    assert(before === after, 'dry-run must not mutate sprint.json');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// 14) S3 — a scope whose original roadmap is fully closed and which has NO active sprint can plan a
//     later sprint through the normal tool-owned route (plan sprint mode), without any recovery.
//     This falsifies the prior "roadmap exhausted => done" behavior end-to-end: the post-close
//     handoff stays plan_sprint and plan materializes the next sprint directly.
{
  const root = sandbox();
  try {
    const leanPath = writeLeanPlan(root, validLeanPlan());
    const initResult = run(['plan', '--from', leanPath], root);
    assert(initResult.status === 0, `init should succeed: ${initResult.stdout}${initResult.stderr}`);

    const sprintLean = writeLeanSprintPlan(root, validLeanSprintPlan());
    const sprintResult = run(['plan', '--from', sprintLean, '--kyro-scope', 'demo-scope'], root);
    assert(sprintResult.status === 0, `sprint 1 plan should succeed: ${sprintResult.stdout}${sprintResult.stderr}`);

    // Disposition the only task so the close is a truthful partial close.
    const sprint = readSprint(root, 'demo-scope');
    sprint.activeSprint.phases[0].tasks[0].disposition = {
      kind: 'cancelled',
      reason: 'Dropped before close.',
      by: 'maker',
      recordedAt: '2026-07-02T00:02:00.000Z',
    };
    writeFileSync(sprintPath(root, 'demo-scope'), `${JSON.stringify(sprint, null, 2)}\n`);

    const closeResult = run(['close-sprint', '--kyro-scope', 'demo-scope', '--outcome', 'partial', '--yes'], root);
    assert(closeResult.status === 0, `partial close should succeed: ${closeResult.stdout}${closeResult.stderr}`);
    const closed = readSprint(root, 'demo-scope');
    assert(closed.handoff.nextAction === 'plan_sprint', `post-close handoff must be plan_sprint, got ${closed.handoff.nextAction}`);
    assert(closed.status === 'planning', `post-close scope must remain planning, got ${closed.status}`);
    assert(closed.activeSprint === null, 'activeSprint must be null after close');

    // Simulate an old/stale stored scope status. Context-pack must expose the canonical derived
    // lifecycle state instead of blindly rendering this field: the scope is still open to plan.
    closed.status = 'completed';
    writeFileSync(sprintPath(root, 'demo-scope'), `${JSON.stringify(closed, null, 2)}\n`);
    const packResult = run(['context-pack', '--kyro-scope', 'demo-scope', '--json'], root);
    assert(packResult.status === 0, `post-close context-pack should succeed: ${packResult.stdout}${packResult.stderr}`);
    const envelope = JSON.parse(packResult.stdout);
    assert(envelope.schemaVersion === 1 && envelope.ok === true, 'context-pack must return a successful CLI envelope');
    const pack = envelope.data;
    assert(pack.status === 'planning', `context-pack must derive planning instead of stale completed, got ${pack.status}`);
    assert(pack.nextAction === 'plan_sprint', `context-pack must preserve plan_sprint routing, got ${pack.nextAction}`);

    // Now plan Sprint 2 (outside the original roadmap) through the normal route.
    const second = writeLeanSprintPlan(root, validLeanSprintPlan({
      sprint: { n: 2, slug: 'hardening', title: 'Hardening', objective: 'Harden it.' },
      phases: [
        {
          id: 'P1',
          title: 'Phase 1',
          objective: 'Harden the core.',
          tasks: [
            {
              id: 'T2.1',
              title: 'Task 2',
              description: 'Harden the thing.',
              files_to_touch: ['src/harden.ts'],
              context: 'ctx',
              acceptance_criteria: ['It is hardened.'],
              depends_on: [],
              scenario_refs: [],
            },
          ],
        },
      ],
    }), 'second-sprint.json');
    const planResult = run(['plan', '--from', second, '--kyro-scope', 'demo-scope'], root);
    assert(planResult.status === 0, `planning sprint 2 after exhausted roadmap should succeed: ${planResult.stdout}${planResult.stderr}`);
    assert(planResult.stdout.includes('Sprint 2 planned'), `expected Sprint 2 to be planned: ${planResult.stdout}`);

    const planned = readSprint(root, 'demo-scope');
    assert(planned.activeSprint && planned.activeSprint.n === 2, `activeSprint should be sprint 2, got ${planned.activeSprint && planned.activeSprint.n}`);
    assert(planned.handoff.nextAction === 'execute_task' && planned.handoff.nextTaskId === 'T2.1', `handoff should route to T2.1, got ${planned.handoff.nextAction}/${planned.handoff.nextTaskId}`);
    assert(planned.roadmap.sprints.some((s) => s.n === 2 && s.state === 'active'), 'roadmap must record sprint 2 as active');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// 15) S7 — an explicitly completed scope cannot be planned into silently. Planning refuses it
//     without writing and the remedy names the lawful route (reopen), so completion can never be
//     bypassed by simply supplying a later plan.
{
  const root = sandbox();
  try {
    const leanPath = writeLeanPlan(root, validLeanPlan());
    assert(run(['plan', '--from', leanPath], root).status === 0, 'init should succeed');

    // Mark the scope explicitly completed exactly as `kyro scope complete` does.
    const sprint = readSprint(root, 'demo-scope');
    sprint.status = 'completed';
    sprint.completion = { completedAt: '2026-07-02T00:00:00.000Z', by: 'maker', summary: 'Initial goal met.' };
    sprint.handoff = { nextAction: 'done', nextTaskId: null, blockers: [], note: '', lastUpdated: '2026-07-02' };
    writeFileSync(sprintPath(root, 'demo-scope'), `${JSON.stringify(sprint, null, 2)}\n`);
    const before = readFileSync(sprintPath(root, 'demo-scope'), 'utf-8');

    const sprintLean = writeLeanSprintPlan(root, validLeanSprintPlan());
    const refused = run(['plan', '--from', sprintLean, '--kyro-scope', 'demo-scope'], root);
    const text = `${refused.stdout}${refused.stderr}`;
    assert(refused.status !== 0, `planning a completed scope must fail: ${text}`);
    assert(text.includes('NOT_READY_TO_PLAN'), `expected NOT_READY_TO_PLAN, got: ${text}`);
    assert(text.includes('scope reopen'), `the remedy must name the lawful reopen route, got: ${text}`);
    assert(readFileSync(sprintPath(root, 'demo-scope'), 'utf-8') === before, 'a refused plan must not write');

    // A retired scope is terminal: the remedy must never offer reopen for it.
    const retiredSprint = JSON.parse(before);
    delete retiredSprint.completion;
    retiredSprint.status = 'retired';
    retiredSprint.retirement = { reason: 'Superseded.', retiredAt: '2026-07-02T00:00:00.000Z', planDigest: 'a'.repeat(64) };
    writeFileSync(sprintPath(root, 'demo-scope'), `${JSON.stringify(retiredSprint, null, 2)}\n`);
    const retiredResult = run(['plan', '--from', sprintLean, '--kyro-scope', 'demo-scope'], root);
    const retiredText = `${retiredResult.stdout}${retiredResult.stderr}`;
    assert(retiredResult.status !== 0, `planning a retired scope must fail: ${retiredText}`);
    assert(!retiredText.includes('scope reopen'), `a retired scope must never be offered reopen: ${retiredText}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

console.log('check:plan — tool-owned scope bootstrap (init) and sprint materialization (sprint) verified end-to-end');
