#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanLines } from './lib/scan.mjs';

const repo = resolve(fileURLToPath(import.meta.url), '../..');
const cli = resolve(repo, 'dist/cli.js');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function run(args, cwd, env = {}) {
  return spawnSync(process.execPath, [cli, ...args], { cwd, env: { ...process.env, HOME: join(cwd, '.home'), ...env }, encoding: 'utf-8' });
}

function sandbox(caseName = 'close-sprint-happy') {
  const root = join(tmpdir(), `kyro-spec-trace-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(root, { recursive: true });
  mkdirSync(join(root, '.home'), { recursive: true });
  cpSync(resolve(repo, `fixtures/evals/${caseName}/state`), root, { recursive: true });
  return root;
}

function sprintPath(root) {
  return join(root, '.agents/kyro/scopes/demo/sprint.json');
}

function readSprint(root) {
  return JSON.parse(readFileSync(sprintPath(root), 'utf-8'));
}

function writeSprint(root, sprint) {
  writeFileSync(sprintPath(root), `${JSON.stringify(sprint, null, 2)}\n`);
}

function sig(path) {
  const stat = statSync(path);
  return { mtimeMs: stat.mtimeMs, bytes: readFileSync(path, 'utf-8') };
}

function withSprint(mutator, caseName = 'close-sprint-happy') {
  const root = sandbox(caseName);
  try {
    const sprint = readSprint(root);
    mutator(sprint);
    writeSprint(root, sprint);
    return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

function addSpec(sprint, overrides = {}) {
  sprint.spec = {
    requirements: [{ id: 'R1', statement: 'Demo requirement.', priority: 'must' }],
    scenarios: [{ id: 'S1', requirement: 'R1', given: 'a demo scope', when: 'the task runs', then: 'the demo works' }],
    nonGoals: [],
    openQuestions: [],
    ...overrides,
  };
  const task = sprint.activeSprint.phases[0].tasks[0];
  task.scenario_refs = ['S1'];
}

function assertAnalyze({ mutate, status, includes, excludes = [], caseName }) {
  const { root, cleanup } = withSprint(mutate, caseName);
  try {
    const result = run(['analyze', '--kyro-scope', 'demo'], root);
    assert(result.status === status, `analyze exit ${result.status}, expected ${status}: ${result.stdout}${result.stderr}`);
    for (const text of includes) assert(result.stdout.includes(text), `analyze output missing ${text}: ${result.stdout}`);
    for (const text of excludes) assert(!result.stdout.includes(text), `analyze output unexpectedly included ${text}: ${result.stdout}`);
  } finally {
    cleanup();
  }
}

function assertDanglingRequirementBlocksCloseZeroWrite() {
  const { root, cleanup } = withSprint((sprint) => {
    addSpec(sprint, { scenarios: [{ id: 'S1', requirement: 'R404', given: 'x', when: 'y', then: 'z' }] });
  });
  try {
    const before = sig(sprintPath(root));
    const analyze = run(['analyze', '--kyro-scope', 'demo'], root);
    assert(analyze.status === 1 && analyze.stdout.includes('HIGH') && analyze.stdout.includes('missing requirement'), `dangling requirement should be HIGH: ${analyze.stdout}${analyze.stderr}`);
    const close = run(['close-sprint', '--kyro-scope', 'demo', '--outcome', 'shipped', '--yes'], root);
    assert(close.status === 1 && (close.stderr + close.stdout).includes('BLOCKING_FINDINGS'), `close should refuse dangling requirement: ${close.stdout}${close.stderr}`);
    const after = sig(sprintPath(root));
    assert(before.bytes === after.bytes && before.mtimeMs === after.mtimeMs, 'close refusal must not write sprint.json');
  } finally {
    cleanup();
  }
}

function assertContextPackAndDoctor() {
  const { root, cleanup } = withSprint((sprint) => addSpec(sprint), 'route-review-task');
  try {
    const scopePack = run(['context-pack', '--kyro-scope', 'demo', '--json'], root);
    assert(scopePack.status === 0, `scope context-pack should pass: ${scopePack.stdout}${scopePack.stderr}`);
    const scopeJson = JSON.parse(scopePack.stdout);
    assert(scopeJson.specRequirements.length === 1 && scopeJson.specNonGoals.length === 0 && scopeJson.specOpenQuestions.length === 0, 'scope pack should expose spec arrays');

    const taskPack = run(['context-pack', '--kyro-scope', 'demo', '--task', 'T1.1', '--json'], root);
    assert(taskPack.status === 0, `task context-pack should pass: ${taskPack.stdout}${taskPack.stderr}`);
    const taskJson = JSON.parse(taskPack.stdout);
    assert(taskJson.taskScenarios.length === 1 && taskJson.taskScenarios[0].id === 'S1', 'task pack should resolve task scenarios');

    const doctor = run(['doctor', '--adapters'], root);
    assert(doctor.status === 0, `doctor --adapters should pass: ${doctor.stdout}${doctor.stderr}`);
    assert(doctor.stdout.includes('spec traceability') && doctor.stdout.includes('task-implements-scenario=advisory'), 'doctor should report spec traceability tiers');
  } finally {
    cleanup();
  }
}

function assertSingleDecisionSite() {
  const lines = scanLines('missing requirement|has no scenario coverage|has no task coverage|shipped without a scenario reference|scenario_refs .*does not exist', 'src/cli', { cwd: repo });
  const offenders = lines.filter((line) => !line.startsWith('src/cli/core/analysis.ts:'));
  assert(offenders.length === 0, `spec graph decision logic outside core/analysis.ts:\n${offenders.join('\n')}`);
}

function main() {
  assertSingleDecisionSite();
  assertDanglingRequirementBlocksCloseZeroWrite();
  assertAnalyze({
    mutate: (sprint) => { addSpec(sprint); sprint.activeSprint.phases[0].tasks[0].scenario_refs = ['S404']; },
    status: 1,
    includes: ['HIGH', 'scenario_refs', 'does not exist'],
  });
  assertAnalyze({
    mutate: (sprint) => addSpec(sprint, { requirements: [{ id: 'R1', statement: 'A' }, { id: 'R1', statement: 'B' }] }),
    status: 0,
    includes: ['MEDIUM', 'duplicate spec requirement id'],
  });
  assertAnalyze({
    mutate: (sprint) => addSpec(sprint, { requirements: [{ id: 'R1', statement: 'A' }, { id: 'R2', statement: 'B' }] }),
    status: 0,
    includes: ['MEDIUM', 'requirement R2 has no scenario coverage'],
  });
  assertAnalyze({
    mutate: (sprint) => addSpec(sprint, { scenarios: [{ id: 'S1', requirement: 'R1', given: 'x', when: 'y', then: 'z' }, { id: 'S2', requirement: 'R1', given: 'a', when: 'b', then: 'c' }] }),
    status: 0,
    includes: ['MEDIUM', 'scenario S2 has no task coverage'],
  });
  assertAnalyze({
    mutate: (sprint) => addSpec(sprint, { openQuestions: ['Which edge case matters?'] }),
    status: 0,
    includes: ['MEDIUM', 'spec open question'],
  });
  assertAnalyze({
    mutate: (sprint) => { sprint.spec = { requirements: [], scenarios: [], nonGoals: [], openQuestions: [] }; sprint.activeSprint.phases[0].tasks[0].scenario_refs = []; },
    status: 0,
    includes: ['MEDIUM', 'shipped without a scenario reference'],
  });
  assertAnalyze({
    mutate: () => {},
    status: 0,
    includes: ['no semantic issues found'],
    excludes: ['scenario', 'requirement'],
  });
  assertContextPackAndDoctor();
  console.log('check:spec-traceability — spec graph invariants passed');
}

main();
