import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repo = resolve(new URL('..', import.meta.url).pathname);
const cli = join(repo, 'dist/cli.js');
const artifactFixtures = join(repo, 'fixtures/artifact-integrity');
const contextPackFixtures = join(repo, 'fixtures/context-pack');
const scopeGoldenPath = join(contextPackFixtures, 'valid-demo.json');
const taskGoldenPath = join(contextPackFixtures, 'task-demo.json');
const budgetsPath = join(contextPackFixtures, 'budgets.json');

function run(cwd, args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    env: { ...process.env, HOME: join(cwd, '.home') },
    encoding: 'utf-8',
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parsePack(result, label) {
  assert(result.status === 0, `${label}: expected exit 0, got ${result.status}\n${result.stdout}\n${result.stderr}`);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label}: invalid JSON output: ${message}\n${result.stdout}`);
  }
}

function normalizePack(pack) {
  return {
    ...pack,
    estimatedTokens: typeof pack.estimatedTokens === 'number' ? 'number' : pack.estimatedTokens,
    rules: Array.isArray(pack.rules)
      ? pack.rules
        .map((rule) => ({ id: rule.id, category: rule.category, summary: rule.summary }))
        .sort((a, b) => a.id.localeCompare(b.id))
      : [],
    warnings: Array.isArray(pack.warnings) ? [...pack.warnings].sort() : [],
    taskFiles: Array.isArray(pack.taskFiles) ? [...pack.taskFiles].sort() : [],
    evidencePaths: Array.isArray(pack.evidencePaths) ? [...pack.evidencePaths].sort() : [],
  };
}

function assertGolden(actual, goldenPath, label) {
  const golden = JSON.parse(readFileSync(goldenPath, 'utf-8'));
  const normalizedActual = JSON.stringify(normalizePack(actual));
  const normalizedGolden = JSON.stringify(normalizePack(golden));
  assert(normalizedActual === normalizedGolden, `${label}: output drifted from golden snapshot\nactual=${normalizedActual}\ngolden=${normalizedGolden}`);
}

function assertBudget(pack, maxTokens, label) {
  assert(typeof pack.estimatedTokens === 'number', `${label}: estimatedTokens must be a number`);
  assert(pack.estimatedTokens <= maxTokens, `${label}: estimatedTokens ${pack.estimatedTokens} exceeds budget ${maxTokens}`);
}

function assertBudgetRouting(pack, budgets, label) {
  assert(typeof pack.budgetClass === 'string', `${label}: budgetClass must be a string`);
  assert(typeof pack.reasoningTier === 'string', `${label}: reasoningTier must be a string`);
  assert(typeof pack.maxContextTokens === 'number', `${label}: maxContextTokens must be a number`);
  assert(typeof pack.budgetGuidance === 'string' && pack.budgetGuidance.length > 0, `${label}: budgetGuidance must be non-empty`);
  if (budgets.expectedBudgetClass) {
    assert(pack.budgetClass === budgets.expectedBudgetClass, `${label}: budgetClass must be ${budgets.expectedBudgetClass}`);
  }
  if (budgets.expectedReasoningTier) {
    assert(pack.reasoningTier === budgets.expectedReasoningTier, `${label}: reasoningTier must be ${budgets.expectedReasoningTier}`);
  }
}

function assertNoEmbeddedMarkdown(pack, label) {
  const serialized = JSON.stringify(pack);
  const forbidden = ['What Went Well', 'Recommendations for Sprint 2', 'Deferred recommendation', '## Retro'];
  for (const snippet of forbidden) {
    assert(!serialized.includes(snippet), `${label}: pack must not embed sprint markdown body containing ${snippet}`);
  }
}

const budgets = JSON.parse(readFileSync(budgetsPath, 'utf-8'));
const validCwd = join(artifactFixtures, 'valid');

const valid = run(validCwd, ['context-pack', '--kyro-scope', 'demo', '--json']);
const validPack = parsePack(valid, 'scope-pack');
assert(validPack.packMode === 'scope', 'scope-pack: packMode must be scope');
assertGolden(validPack, scopeGoldenPath, 'scope-pack');
assertBudget(validPack, budgets.scopePackMaxEstimatedTokens, 'scope-pack');
assertBudgetRouting(validPack, budgets, 'scope-pack');

const task = run(validCwd, ['context-pack', '--kyro-scope', 'demo', '--task', 'T1.2', '--json']);
const taskPack = parsePack(task, 'task-pack');
assert(taskPack.packMode === 'task', 'task-pack: packMode must be task');
assert(taskPack.taskId === 'T1.2', 'task-pack: taskId must be T1.2');
assertGolden(taskPack, taskGoldenPath, 'task-pack');
assertBudget(taskPack, budgets.taskPackMaxEstimatedTokens, 'task-pack');
assertBudgetRouting(taskPack, budgets, 'task-pack');
assertNoEmbeddedMarkdown(taskPack, 'task-pack');
assert(!taskPack.rules.some((rule) => rule.id === 'plan-1'), 'task-pack: planning-only rules must be filtered out');
assert(taskPack.rules.length < validPack.rules.length, 'task-pack: filtered rules must be fewer than scope pack rules');

const taskDefault = run(validCwd, ['context-pack', '--kyro-scope', 'demo', '--task', '--json']);
const taskDefaultPack = parsePack(taskDefault, 'task-default');
assert(taskDefaultPack.taskId === 'T1.2', 'task-default: must resolve index.nextTask');
assert(taskDefaultPack.warnings.some((warning) => warning.includes('index.nextTask')), 'task-default: must warn about nextTask fallback');

const missingSummaryCwd = join(artifactFixtures, 'missing-summary');
const missingSummary = run(missingSummaryCwd, ['context-pack', '--kyro-scope', 'demo', '--json']);
const missingSummaryPack = parsePack(missingSummary, 'missing-summary');
assert(missingSummaryPack.warnings.some((warning) => warning.includes('ROADMAP.summary.json')), 'missing-summary: expected ROADMAP.summary.json warning');
assert(missingSummaryPack.roadmapSummary === 'Demo roadmap', 'missing-summary: index roadmapSummary should still be available');

const unknownScope = run(validCwd, ['context-pack', '--kyro-scope', 'does-not-exist']);
assert(unknownScope.status !== 0, 'unknown-scope: expected non-zero exit');
assert(`${unknownScope.stdout}${unknownScope.stderr}`.includes('Scope not found'), 'unknown-scope: expected actionable error message');

console.log('Context-pack fixtures passed');