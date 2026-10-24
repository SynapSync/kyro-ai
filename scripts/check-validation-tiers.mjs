#!/usr/bin/env node
// Validation tiers: context-pack exposes focused task validation from .agents/kyro/validation.json and the
// once-per-sprint close tier; analyze flags aggregate-suite task criteria as advisory MEDIUM only.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const repo = resolve(fileURLToPath(import.meta.url), '../..');
const cli = resolve(repo, 'dist/cli.js');
const { resolveValidation, aggregateValidationMentions, validateValidationMap } = createRequire(import.meta.url)(resolve(repo, 'dist/cli/core/validation.js'));
const failures = [];
const roots = [];

function check(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push(name);
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function same(actual, expected, label) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function sandbox() {
  const root = join(tmpdir(), `kyro-validation-tiers-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  roots.push(root);
  mkdirSync(join(root, '.home'), { recursive: true });
  cpSync(resolve(repo, 'fixtures/evals/route-execute-task/state'), root, { recursive: true });
  return root;
}

function run(root, args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: root, env: { ...process.env, HOME: join(root, '.home') }, encoding: 'utf-8' });
}

function json(root, args) {
  const result = run(root, args);
  assert(result.status === 0 || args[0] === 'analyze', `${args.join(' ')} exited ${result.status}: ${result.stderr}`);
  return JSON.parse(result.stdout).data;
}

function sprintPath(root) {
  return join(root, '.agents/kyro/scopes/demo/sprint.json');
}

function editTask(root, edit) {
  const sprint = JSON.parse(readFileSync(sprintPath(root), 'utf-8'));
  edit(sprint.activeSprint.phases[0].tasks[0]);
  writeFileSync(sprintPath(root), `${JSON.stringify(sprint, null, 2)}\n`);
}

function writeMap(root, map) {
  writeFileSync(join(root, '.agents/kyro/validation.json'), typeof map === 'string' ? map : `${JSON.stringify(map, null, 2)}\n`);
}

const MAP = {
  validationVersion: 1,
  task: [
    { id: 'demo', paths: ['src/**/*.ts'], commands: ['npm run build', 'npm run test:demo'] },
    { id: 'docs', paths: ['docs/'], commands: ['npm run check:links'] },
  ],
  fallback: ['npm run typecheck'],
  close: ['npm run build', 'npm run check'],
};

const taskPack = (root) => json(root, ['context-pack', '--kyro-scope', 'demo', '--task', 'T1.1', '--json']);
const tierFindings = (root) => json(root, ['analyze', '--kyro-scope', 'demo', '--json']).findings.filter((f) => f.category === 'validation-tier');

const NONE = { source: 'none', task: [], matchedRules: [], uncoveredFiles: [], close: [], issues: [] };
const loaded = (map) => ({ map, issues: [] });

check('no map: pack reports source none, no commands, no warning', () => {
  const root = sandbox();
  const pack = taskPack(root);
  same(pack.validation, NONE, 'validation');
  assert(!pack.warnings.some((w) => w.startsWith('validation')), `absent map must not warn: ${JSON.stringify(pack.warnings)}`);
});

check('task pack maps taskFiles to matching rule commands, deduplicated, plus close tier', () => {
  const root = sandbox();
  writeMap(root, MAP);
  editTask(root, (task) => { task.files_to_touch = ['src/demo.ts (new)', 'docs/guide.md']; });
  const { validation } = taskPack(root);
  same(validation.source, 'validation.json', 'source');
  same(validation.matchedRules, ['demo', 'docs'], 'matchedRules');
  same(validation.uncoveredFiles, [], 'uncoveredFiles');
  same(validation.task, ['npm run build', 'npm run test:demo', 'npm run check:links'], 'task');
  same(validation.close, ['npm run build', 'npm run check'], 'close');
});

check('F1: mixed covered + uncovered files keep rule commands and add fallback', () => {
  const root = sandbox();
  writeMap(root, MAP);
  editTask(root, (task) => { task.files_to_touch = ['docs/guide.md', 'README.md']; });
  const { validation } = taskPack(root);
  same(validation.task, ['npm run check:links', 'npm run typecheck'], 'task');
  same(validation.uncoveredFiles, ['README.md'], 'uncoveredFiles');
  // Astra probe F1 on the shipped dogfood map: README must not drop types.ts build/typecheck.
  const dogfood = JSON.parse(readFileSync(resolve(repo, '.agents/kyro/validation.json'), 'utf-8'));
  const single = resolveValidation(['src/cli/types.ts'], loaded(dogfood)).task;
  const mixed = resolveValidation(['README.md', 'src/cli/types.ts'], loaded(dogfood)).task;
  for (const command of single) assert(mixed.includes(command), `mixed set lost ${command}: ${JSON.stringify(mixed)}`);
});

check('ordering: rule order, then fallback, global dedupe; overlapping rules and shared fallback', () => {
  const map = { validationVersion: 1, task: [
    { id: 'a', paths: ['src/**'], commands: ['lint', 'unit'] },
    { id: 'b', paths: ['src/api/**'], commands: ['unit', 'api'] },
  ], fallback: ['lint', 'typecheck'], close: ['all'] };
  const result = resolveValidation(['src/api/x.ts', 'other.md'], loaded(map));
  same(result.task, ['lint', 'unit', 'api', 'typecheck'], 'task');
  same(result.matchedRules, ['a', 'b'], 'matchedRules');
  same(result.uncoveredFiles, ['other.md'], 'uncoveredFiles');
  same(resolveValidation(['src/api/x.ts'], loaded(map)).task, ['lint', 'unit', 'api'], 'fully covered: no fallback');
});

check('empty file list → fallback; empty fallback + uncovered → warning, rule commands only', () => {
  const map = { validationVersion: 1, task: [{ id: 'a', paths: ['src/**'], commands: ['unit'] }], fallback: ['typecheck'], close: [] };
  const empty = resolveValidation([], loaded(map));
  same(empty.task, ['typecheck'], 'empty list task');
  same(empty.uncoveredFiles, [], 'empty list uncovered');
  const noFallback = resolveValidation(['src/a.ts', 'README.md'], loaded({ ...map, fallback: [] }));
  same(noFallback.task, ['unit'], 'no-fallback task');
  same(noFallback.uncoveredFiles, ['README.md'], 'no-fallback uncovered');
  assert(noFallback.issues.some((i) => i.includes('README.md') && i.includes('choose focused checks')), JSON.stringify(noFallback.issues));
});

check('unmatched files fall back; scope pack carries only the close tier', () => {
  const root = sandbox();
  writeMap(root, MAP);
  editTask(root, (task) => { task.files_to_touch = ['README.md']; });
  const task = taskPack(root).validation;
  same(task.task, ['npm run typecheck'], 'fallback');
  same(task.uncoveredFiles, ['README.md'], 'uncoveredFiles');
  const scope = json(root, ['context-pack', '--kyro-scope', 'demo', '--json']).validation;
  same(scope.task, [], 'scope task tier');
  same(scope.uncoveredFiles, [], 'scope uncoveredFiles');
  same(scope.close, ['npm run build', 'npm run check'], 'scope close tier');
});

check('F2: paths keep spaces and only recognized markers are stripped; normalizations kept', () => {
  const map = { validationVersion: 1, task: [
    { id: 'component', paths: ['src/my component/**'], commands: ['test:component'] },
    { id: 'docs', paths: ['docs/'], commands: ['lint:md'] },
    { id: 'src', paths: ['src/**'], commands: ['unit'] },
  ], fallback: ['typecheck'], close: [] };
  const other = resolveValidation(['src/my other/private.ts'], loaded(map));
  assert(!other.matchedRules.includes('component'), `space collision: ${JSON.stringify(other.matchedRules)}`);
  same(resolveValidation(['src/my component/a.ts (new)'], loaded(map)).matchedRules, ['component', 'src'], 'spaced path + marker');
  same(resolveValidation(['docs/guide (draft)'], loaded(map)).uncoveredFiles, [], 'parenthesized name in docs/ still matched');
  same(resolveValidation(['notes (draft)'], loaded(map)).uncoveredFiles, ['notes (draft)'], 'unrecognized suffix preserved');
  same(resolveValidation(['README.md (DELETED)'], loaded(map)).uncoveredFiles, ['README.md'], 'marker case-insensitive');
  same(resolveValidation(['./src/a.ts', 'src\\b.ts'], loaded(map)).uncoveredFiles, [], './ and backslash normalized');
});

check('map validity: omitted close/fallback/task invalid; explicit close [] valid', () => {
  for (const key of ['task', 'fallback', 'close']) {
    const map = { validationVersion: 1, task: [], fallback: [], close: [] };
    delete map[key];
    assert(validateValidationMap(map).some((i) => i.startsWith(`${key}: required`)), `omitted ${key} must be invalid`);
  }
  same(validateValidationMap({ validationVersion: 1, task: [], fallback: [], close: [] }), [], 'explicit empty lists valid');
  const root = sandbox();
  writeMap(root, { validationVersion: 1, task: [], fallback: [] });
  const pack = taskPack(root);
  same(pack.validation.source, 'none', 'omitted close → invalid map');
  assert(pack.warnings.some((w) => w.startsWith('validation map ignored:') && w.includes('close: required')), JSON.stringify(pack.warnings));
  writeMap(root, { validationVersion: 1, task: [], fallback: [], close: [] });
  same(json(root, ['context-pack', '--kyro-scope', 'demo', '--json']).validation.close, [], 'explicit close []');
});

check('invalid map never blocks routing: warning in pack, MEDIUM in analyze', () => {
  const root = sandbox();
  writeMap(root, { validationVersion: 2, task: [{ id: 'x', paths: [], commands: ['a'] }], extra: true });
  const pack = taskPack(root);
  same(pack.validation.source, 'none', 'source');
  assert(pack.warnings.some((w) => w.startsWith('validation map ignored:')), 'pack warning missing');
  const findings = tierFindings(root);
  assert(findings.length >= 1 && findings.every((f) => f.severity === 'MEDIUM'), `expected MEDIUM map findings, got ${JSON.stringify(findings)}`);
  writeMap(root, '{ not json');
  assert(taskPack(root).warnings.some((w) => w.includes('invalid JSON')), 'invalid JSON warning missing');
});

check('analyze flags aggregate-suite task criteria as advisory MEDIUM without blocking', () => {
  const root = sandbox();
  writeMap(root, MAP);
  editTask(root, (task) => { task.acceptance_criteria = ['Demo renders.', 'npm run check passes.']; });
  const result = run(root, ['analyze', '--kyro-scope', 'demo', '--json']);
  const parsed = JSON.parse(result.stdout).data;
  const findings = parsed.findings.filter((f) => f.category === 'validation-tier');
  same(findings.length, 1, 'finding count');
  same(findings[0].severity, 'MEDIUM', 'severity');
  assert(findings[0].detail.includes('T1.1') && findings[0].detail.includes('npm run check'), findings[0].detail);
  assert(!parsed.findings.some((f) => (f.severity === 'CRITICAL' || f.severity === 'HIGH') && f.category === 'validation-tier'), 'validation-tier must never block');
});

check('focused commands and namespaced checks are not aggregate', () => {
  const root = sandbox();
  writeMap(root, MAP);
  editTask(root, (task) => { task.acceptance_criteria = ['npm run build passes.', 'npm run check:demo passes.', 'npm run test:demo covers the demo.']; });
  same(tierFindings(root).length, 0, 'findings');
});

check('F4: phrase heuristic boundary (focused "all tests in <file>" is not aggregate)', () => {
  same(aggregateValidationMentions('All tests in test/domain.test.js pass.', null), [], 'F4a focused');
  same(aggregateValidationMentions('Todas las pruebas de test/x.test.js pasan.', null), [], 'F4a focused (es)');
  assert(aggregateValidationMentions('The full test suite passes.', null).length > 0, 'full suite phrase');
  // F4b documented non-goal: without a map Kyro cannot know a project's aggregate command.
  same(aggregateValidationMentions('npm run check passes.', null), [], 'F4b unmapped command not inferred');
});

check('aggregate phrases are flagged without a map; done tasks are not', () => {
  const root = sandbox();
  editTask(root, (task) => { task.acceptance_criteria = ['The full test suite passes.']; });
  same(tierFindings(root).length, 1, 'phrase finding');
  editTask(root, (task) => { task.acceptance_criteria = ['La suite completa pasa.']; });
  same(tierFindings(root).length, 1, 'spanish phrase finding');
  editTask(root, (task) => { task.status = 'done'; });
  same(tierFindings(root).length, 0, 'done task finding');
});

check('policy consumers reference the validation protocol; executor close paths share close validation', () => {
  const read = (path) => readFileSync(resolve(repo, path), 'utf-8');
  const base = 'internal/skills/sprint-forge/assets/';
  const consumers = {
    [`${base}modes/execute-task.md`]: '../protocols/validation.md',
    [`${base}modes/review-task.md`]: '../protocols/validation.md',
    [`${base}modes/close-sprint.md`]: '../protocols/validation.md',
    [`${base}modes/qa-or-close.md`]: '../protocols/validation.md',
    [`${base}modes/plan-sprint.md`]: '../protocols/validation.md',
    [`${base}delegates/implementer.md`]: '../protocols/validation.md',
    [`${base}delegates/checker.md`]: '../protocols/validation.md',
    [`${base}helpers/reviewer.md`]: '../protocols/validation.md',
    'agents/orchestrator.md': 'assets/protocols/validation.md',
    'internal/skills/kyro-sprint-executor/SKILL.md': 'sprint-forge/assets/protocols/validation.md',
  };
  for (const [path, ref] of Object.entries(consumers)) assert(read(path).includes(ref), `${path} must reference ${ref}`);
  const protocol = read(`${base}protocols/validation.md`);
  for (const phrase of ['uncoveredFiles', 'Live criteria win', 'verifiable tested-state reference', 'are not proof', '`close: []`', 'Avoid redundant aggregate runs']) {
    assert(protocol.includes(phrase), `protocol must state: ${phrase}`);
  }
  const work = read('internal/skills/organic-work/SKILL.md');
  assert(!work.includes('protocols/validation.md') && work.includes('work amend-task') && work.includes('aggregate check once before close'), 'Work must carry its own lifecycle-specific validation rule, not the Forge protocol');
  const executor = read('internal/skills/kyro-sprint-executor/SKILL.md');
  assert(executor.includes('## Close validation') && executor.includes("map absent or invalid → the project's full check"), 'executor must define close validation with fallback');
  const qa = executor.slice(executor.indexOf('## QA or close'), executor.indexOf('## Close validation'));
  const close = executor.slice(executor.indexOf('## Sprint close'), executor.indexOf('## Hard rules'));
  assert(qa.includes('**Close validation**') && close.includes('**Close validation**'), 'both executor close paths must run close validation');
});

check('kyro-ai dogfood map is valid and routes its own validation code', () => {
  const map = JSON.parse(readFileSync(resolve(repo, '.agents/kyro/validation.json'), 'utf-8'));
  same(validateValidationMap(map), [], 'dogfood map valid');
  assert(map.task.some((rule) => rule.commands.includes('npm run check:validation-tiers')), 'dogfood map must route validation-tier code');
  assert(map.close.includes('npm run check'), 'close tier must run the aggregate check');
});

for (const root of roots) rmSync(root, { recursive: true, force: true });
if (failures.length) {
  console.error(`\n${failures.length} validation-tier check(s) failed`);
  process.exit(1);
}
console.log('\nvalidation tiers OK');
