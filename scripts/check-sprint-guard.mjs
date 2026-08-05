#!/usr/bin/env node
// Verifies the PreToolUse guard (hooks/guard-sprint-close.mjs), all three protections:
//
// 1. Hand-close: Write/Edit that flips an existing scope's `activeSprint` non-null -> null.
// 2. Hand-authored scope: creating a scope's sprint.json with a non-routable shape.
// 3. Hand-written project state: Write/Edit leaving project.json or local.json invalid.
//
// The ALLOW matrix is the important half. `kyro plan`/`close-sprint` write via Node fs and never
// reach this hook, but INIT.md authorizes a narrow hand-write fallback and recover.md rebuilds
// sprint.json through Write — a false positive on either would strand a scope with no way out.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(fileURLToPath(import.meta.url), '../..');
const hook = resolve(repo, 'hooks/guard-sprint-close.mjs');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function decide(payload) {
  const res = spawnSync(process.execPath, [hook], { input: JSON.stringify(payload), encoding: 'utf-8' });
  if (res.status === 2) return { verdict: 'block', stderr: res.stderr };
  if (res.status === 0) return { verdict: 'allow', stderr: res.stderr };
  throw new Error(`unexpected exit ${res.status}: ${res.stderr}`);
}

/** A minimal but routable v4 document — what a legitimate hand-write fallback must produce. */
function validV4(overrides = {}) {
  return {
    schemaVersion: 4,
    scope: 'demo',
    title: 'Demo scope',
    status: 'planning',
    objective: 'Prove the guard accepts a routable document.',
    successCriteria: [],
    spec: { requirements: [], scenarios: [], nonGoals: [], openQuestions: [] },
    clarifications: [],
    conventions: [],
    adrs: [],
    roadmap: { plannedSprintCount: 0, sizingRationale: '', sprints: [] },
    ledger: [],
    previousSprint: null,
    activeSprint: null,
    debt: [],
    handoff: { nextAction: 'plan_sprint', nextTaskId: null, blockers: [], note: '', lastUpdated: '2026-08-05' },
    ...overrides,
  };
}

/**
 * The artifact that motivated this guard: a full scope hand-written in the field with no
 * schemaVersion, no handoff, and activeSprint as an integer. Reproduced structurally.
 */
const HAND_AUTHORED_FIELD_ARTIFACT = {
  scopeId: 'phase-1-backend',
  scopeName: 'Phase 1: OurGarden Control Backend (MVP)',
  version: '1.0',
  created: '2026-08-04T00:00:00Z',
  activeSprint: 1,
  sourceOfTruth: 'docs/plans/phase1.md',
  timeline: { phase: 'Phase 1 (MVP)', estimatedDuration: '2-3 weeks' },
  sprints: [{ id: 1, name: 'Scaffolding', status: 'pending', tasks: [] }],
  successCriteria: { phase: 'Phase 1', requirements: [] },
  debt: [],
  adr: [],
  ledger: [],
};

const root = mkdtempSync(join(tmpdir(), 'kyro-sprint-guard-'));
const scopeDir = join(root, '.agents/kyro/scopes/demo');
const archiveDir = join(scopeDir, 'archive');
mkdirSync(archiveDir, { recursive: true });

const newScopePath = join(root, '.agents/kyro/scopes/fresh/sprint.json'); // deliberately not created
mkdirSync(join(root, '.agents/kyro/scopes/fresh'), { recursive: true });

// An existing scope mid-sprint, for the hand-close protection.
const existingPath = join(scopeDir, 'sprint.json');
const openSprint = validV4({
  activeSprint: { n: 1, slug: 'bootstrap', title: 'Bootstrap', objective: 'x', status: 'in_progress', phases: [] },
  handoff: { nextAction: 'execute_task', nextTaskId: 'T1.1', blockers: [], note: '', lastUpdated: '2026-08-05' },
});
writeFileSync(existingPath, `${JSON.stringify(openSprint, null, 2)}\n`);

// A sprint.json outside the scopes tree — not ours to police.
const unrelatedDir = join(root, 'some-other-tool');
mkdirSync(unrelatedDir, { recursive: true });
const unrelatedPath = join(unrelatedDir, 'sprint.json');

// Layered project state (CLI-owned).
const projectStatePath = join(root, '.agents/kyro/project.json');
const localStatePath = join(root, '.agents/kyro/local.json');

function write(path, doc) {
  return {
    tool_name: 'Write',
    tool_input: { file_path: path, content: typeof doc === 'string' ? doc : JSON.stringify(doc, null, 2) },
  };
}

const cases = [
  // --- Protection 2: hand-authored scope (file does not exist yet) ---
  ['block', 'field artifact: no schemaVersion, no handoff, activeSprint as int',
    write(newScopePath, HAND_AUTHORED_FIELD_ARTIFACT)],
  ['block', 'missing handoff only',
    write(newScopePath, (() => { const d = validV4(); delete d.handoff; return d; })())],
  ['block', 'missing schemaVersion only',
    write(newScopePath, (() => { const d = validV4(); delete d.schemaVersion; return d; })())],
  ['block', 'handoff present but nextAction empty',
    write(newScopePath, validV4({ handoff: { nextAction: '', nextTaskId: null } }))],
  ['block', 'activeSprint is an integer',
    write(newScopePath, validV4({ activeSprint: 1 }))],
  ['block', 'scope missing',
    write(newScopePath, (() => { const d = validV4(); delete d.scope; return d; })())],
  ['block', 'content is not valid JSON', write(newScopePath, '{ this is not json')],
  ['allow', 'legitimate hand-write fallback: complete routable v4', write(newScopePath, validV4())],
  ['allow', 'recover.md rebuild: activeSprint null, handoff set to resume point',
    write(newScopePath, validV4({ handoff: { nextAction: 'plan_sprint', nextTaskId: null } }))],
  ['allow', 'recover.md rebuild with an open sprint restored',
    write(newScopePath, validV4({
      activeSprint: { n: 2, slug: 'resume', title: 'Resume', objective: 'x', status: 'in_progress', phases: [] },
      handoff: { nextAction: 'execute_task', nextTaskId: 'T2.1' },
    }))],
  ['allow', 'Edit against a missing file (fails on its own)',
    { tool_name: 'Edit', tool_input: { file_path: newScopePath, old_string: 'a', new_string: 'b' } }],

  // --- Protection 1: hand-close (file exists) — regression guard ---
  ['block', 'Write nulls activeSprint on an existing scope',
    write(existingPath, validV4({ activeSprint: null }))],
  ['block', 'Edit nulls activeSprint on an existing scope',
    {
      tool_name: 'Edit',
      tool_input: {
        file_path: existingPath,
        old_string: JSON.stringify(openSprint.activeSprint, null, 2).split('\n').map((l, i) => (i === 0 ? l : `  ${l}`)).join('\n'),
        new_string: 'null',
      },
    }],
  ['allow', 'additive debt edit keeps activeSprint intact',
    write(existingPath, { ...openSprint, debt: [{ id: 'D1', status: 'open', note: 'x' }] })],
  ['allow', 'malformed shape on an existing file is not our gate (repair/analyze own it)',
    write(existingPath, { ...openSprint, roadmap: 'nonsense' })],

  // --- Scoping: not a Kyro scope artifact ---
  ['allow', 'sprint.json outside .agents/kyro/scopes/', write(unrelatedPath, HAND_AUTHORED_FIELD_ARTIFACT)],
  ['allow', 'archive snapshot is not named sprint.json',
    write(join(archiveDir, 'sprint-001-bootstrap.json'), HAND_AUTHORED_FIELD_ARTIFACT)],

  // --- Protection 3: hand-writing the layered project state ---
  // Reproduces the second field incident: after misreading a CLI success message, the agent
  // hand-wrote project.json/local.json and Kyro Lens reported "schemaVersion undefined".
  ['block', 'field incident: project.json with no schemaVersion',
    write(projectStatePath, { name: 'OurGarden Platform', scopes: [{ id: 'phase-1-backend', name: 'Phase 1' }] })],
  ['block', 'project.json missing artifactRoot',
    write(projectStatePath, { schemaVersion: 4, scopes: [] })],
  ['block', 'project.json carrying local-only activeScope',
    write(projectStatePath, { schemaVersion: 4, artifactRoot: '.agents/kyro/scopes', scopes: [], activeScope: 'demo' })],
  ['block', 'project.json carrying kyroInvocation',
    write(projectStatePath, { schemaVersion: 4, artifactRoot: '.agents/kyro/scopes', scopes: [], kyroInvocation: 'kyro' })],
  ['block', 'local.json with no schemaVersion',
    write(localStatePath, { activeScope: 'demo', installedAdapters: [] })],
  ['block', 'local.json with installedAdapters as strings is fine, but principles is shared-only',
    write(localStatePath, { schemaVersion: 4, activeScope: null, installedAdapters: [], principles: [] })],
  ['allow', 'valid shared project.json',
    write(projectStatePath, { schemaVersion: 4, artifactRoot: '.agents/kyro/scopes', scopes: [{ id: 'demo', title: 'Demo', status: 'planning' }] })],
  ['allow', 'valid local.json',
    write(localStatePath, { schemaVersion: 4, activeScope: 'demo', installedAdapters: [], runtimePath: '~/.agents/kyro/current' })],
  ['allow', 'project.json outside .agents/kyro/', write(join(unrelatedDir, 'project.json'), { anything: true })],
  ['allow', 'local.json outside .agents/kyro/', write(join(unrelatedDir, 'local.json'), { anything: true })],

  // --- Fail-open on anything we do not understand ---
  ['allow', 'non-Write/Edit tool', { tool_name: 'Read', tool_input: { file_path: newScopePath } }],
  ['allow', 'empty payload', {}],
  ['allow', 'Write with no content field', { tool_name: 'Write', tool_input: { file_path: newScopePath } }],
];

const failures = [];
for (const [expected, label, payload] of cases) {
  const { verdict } = decide(payload);
  if (verdict !== expected) failures.push(`expected ${expected}, got ${verdict}: ${label}`);
}

// The block message must name the actual missing fields, not just say "invalid" — the agent reads
// stderr and has to know what to fix.
const fieldArtifact = decide(write(newScopePath, HAND_AUTHORED_FIELD_ARTIFACT));
for (const needle of ['schemaVersion', 'handoff', 'activeSprint', 'plan --from']) {
  if (!fieldArtifact.stderr.includes(needle)) {
    failures.push(`block message should mention "${needle}"`);
  }
}

rmSync(root, { recursive: true, force: true });

if (failures.length > 0) {
  console.error(`check:sprint-guard — ${failures.length} case(s) failed:\n${failures.join('\n')}`);
  process.exit(1);
}

assert(cases.length >= 30, 'check:sprint-guard: expected at least 30 cases');
console.log(`check:sprint-guard — ${cases.length} guard cases passed (hand-close + hand-authored scope + hand-written project state)`);
