import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repo = resolve(new URL('..', import.meta.url).pathname);
const configPath = join(repo, 'config.json');
const goldenPath = join(repo, 'fixtures/context-pack/budget-manifest.json');

const REQUIRED_CLASS_IDS = ['brief', 'execute', 'review', 'close'];
const PROVIDER_PATTERNS = [/gpt-/i, /claude-/i, /gemini-/i, /o1-/i, /o3-/i];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function assertNoProviderNames(value, label) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  for (const pattern of PROVIDER_PATTERNS) {
    assert(!pattern.test(text), `${label}: must not contain provider model name pattern ${pattern}`);
  }
}

const config = readJson(configPath);
const golden = readJson(goldenPath);
const classes = config.budgetClasses;

assert(classes && typeof classes === 'object', 'config.json must define budgetClasses object');

for (const id of REQUIRED_CLASS_IDS) {
  const definition = classes[id];
  assert(definition && typeof definition === 'object', `budgetClasses.${id} is missing`);
  assert(typeof definition.maxContextTokens === 'number' && definition.maxContextTokens > 0, `budgetClasses.${id}.maxContextTokens must be a positive number`);
  assert(typeof definition.reasoningTier === 'string' && definition.reasoningTier.length > 0, `budgetClasses.${id}.reasoningTier must be non-empty`);
  assert(typeof definition.guidance === 'string' && definition.guidance.trim().length > 0, `budgetClasses.${id}.guidance must be non-empty`);
  assertNoProviderNames(definition, `budgetClasses.${id}`);
}

const serializedConfig = JSON.stringify(classes, Object.keys(classes).sort());
const serializedGolden = JSON.stringify(golden, Object.keys(golden).sort());
assert(serializedConfig === serializedGolden, 'config.json budgetClasses drifted from fixtures/context-pack/budget-manifest.json');

console.log('Budget manifest fixtures passed');