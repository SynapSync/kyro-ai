#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(fileURLToPath(import.meta.url), '../..');
const read = (path) => readFileSync(resolve(repo, path), 'utf8');
const failures = [];
const requireText = (path, needles) => {
  const text = read(path);
  for (const needle of needles) if (!text.includes(needle)) failures.push(`${path}: missing ${JSON.stringify(needle)}`);
};

const assertionMarkers = {
  'ask-one-material-question': ['internal/skills/seedbed/assets/helpers/material-questions.md', 'Ask only when the answer changes'],
  'no-write-before-sufficient': ['internal/skills/seedbed/assets/modes/idea.md', 'Exit the loop when all are true'],
  'read-reference-first': ['internal/skills/seedbed/assets/modes/idea.md', 'Do not draft from memory while references remain unread'],
  'preserve-decisions': ['internal/skills/seedbed/assets/helpers/classification-and-synthesis.md', 'decision | choice, rationale, tradeoff, consequence'],
  'synthesize-implications': ['internal/skills/seedbed/assets/helpers/classification-and-synthesis.md', 'Synthesis chain'],
  'surface-contradiction': ['internal/skills/seedbed/assets/helpers/classification-and-synthesis.md', 'Mark conflicting claims'],
  'block-persistence': ['internal/skills/seedbed/assets/helpers/quality-rubric.md', 'zero unresolved material contradictions'],
  'retain-rationale': ['internal/skills/seedbed/assets/templates/matured-idea.md', 'evidence/rationale'],
  'retain-tradeoff': ['internal/skills/seedbed/assets/templates/matured-idea.md', 'tradeoff'],
  'do-not-reask': ['internal/skills/seedbed/SKILL.md', 'Never re-ask known facts'],
  'define-empty-state': ['internal/skills/seedbed/assets/templates/matured-idea.md', 'empty state'],
  'define-partial-state': ['internal/skills/seedbed/assets/templates/matured-idea.md', 'partial data'],
  'define-fatal-state': ['internal/skills/seedbed/assets/templates/matured-idea.md', 'unrecoverable failure'],
  'recover-product-need': ['internal/skills/seedbed/assets/helpers/classification-and-synthesis.md', 'causal problem and beneficiary'],
  'treat-stack-as-hypothesis': ['internal/skills/seedbed/assets/modes/idea.md', 'hypotheses'],
  'respect-sufficiency-gate': ['internal/skills/seedbed/assets/modes/idea.md', 'does not waive this gate'],
  'return-blocked-report': ['internal/skills/seedbed/assets/modes/idea.md', 'blocked maturity report'],
  'report-unreadable-source': ['internal/skills/seedbed/assets/modes/idea.md', 'path is missing or unreadable'],
  'mark-dependent-claims-ungrounded': ['internal/skills/seedbed/assets/modes/idea.md', 'claims dependent on it as ungrounded'],
};

requireText('commands/idea.md', ['rough', 'mature', 'read-only toward Kyro state', 'quality threshold']);
requireText('internal/skills/seedbed/SKILL.md', ['## Activation Contract', '## Hard Rules', '## Decision Gates', '## Execution Steps', '## Output Contract', '90/100']);
requireText('internal/skills/seedbed/assets/modes/idea.md', ['single source of truth for classification', 'one question per turn', 'no material contradiction', 'one corrective overwrite']);
requireText('internal/skills/seedbed/assets/helpers/classification-and-synthesis.md', ['single canonical lane classifier', 'at least three dimensions', 'solution detail only']);
requireText('internal/skills/seedbed/assets/helpers/quality-rubric.md', ['90/100', 'Thesis and causality', 'Executable handoff']);
requireText('internal/skills/seedbed/assets/templates/matured-idea.md', [
  'docType:', 'date:', 'slug:', 'title:', 'maturedFrom:', 'agents:',
  '## Problem / Motivation', "## Who it's for", '## What success looks like',
  '## Core thesis', '## Current-state evidence', '## Product laws / invariants',
  '## Execution blueprint', '## Acceptance and validation matrix', '## Forge handoff',
]);
requireText('internal/skills/sprint-forge/assets/modes/INIT.md', ['Plan-grade Seedbed mapping', '../helpers/seedbed-init-mapping.md', 'normal one-line INIT path', '.agents/kyro/scopes/{scope}/sprint.json', 'Artifact Write Contract', 'Do not touch project state until']);
requireText('internal/skills/sprint-forge/assets/helpers/seedbed-init-mapping.md', ['spec.requirements[].rationale', 'spec.scenarios[]', 'roadmap.sizingRationale', 'unmapped blocker', 'Never fabricate executed']);
requireText('src/cli/adapters/command-skills.ts', ['rough or mature idea', 'execution-ready pre-scope plan']);
requireText('src/cli/adapters/opencode.ts', ['rough or mature idea', 'execution-ready plan']);

for (const [assertion, [path, marker]] of Object.entries(assertionMarkers)) {
  if (!existsSync(resolve(repo, path)) || !read(path).includes(marker)) failures.push(`assertion ${assertion}: contract marker missing in ${path}`);
}

const dimensionNames = ['problem', 'audience', 'success', 'boundaries', 'decisions', 'evidence'];
const classify = (input) => {
  const substantiveDimensions = dimensionNames.filter((name) => input.dimensions[name] === true).length;
  const readableReference = input.references.some((reference) => reference.readable === true);
  if (input.solutionOnly) return 'rough';
  return readableReference || substantiveDimensions >= 3 ? 'mature' : 'rough';
};
const isStructuredInput = (input) => input && typeof input.summary === 'string'
  && input.dimensions && dimensionNames.every((name) => typeof input.dimensions[name] === 'boolean')
  && Array.isArray(input.references)
  && input.references.every((reference) => typeof reference.path === 'string' && typeof reference.readable === 'boolean')
  && typeof input.solutionOnly === 'boolean';
const fixturesDir = resolve(repo, 'internal/skills/seedbed/assets/fixtures');
const fixtureFiles = readdirSync(fixturesDir).filter((name) => name.endsWith('.json')).sort();
if (fixtureFiles.length !== 8) failures.push(`fixtures: expected 8, found ${fixtureFiles.length}`);
for (const file of fixtureFiles) {
  try {
    const fixture = JSON.parse(readFileSync(resolve(fixturesDir, file), 'utf8'));
    if (!fixture.id || !['rough', 'mature'].includes(fixture.lane) || !isStructuredInput(fixture.input) || !Array.isArray(fixture.expected) || fixture.expected.length < 2) {
      failures.push(`fixtures/${file}: invalid scenario contract`);
      continue;
    }
    if (classify(fixture.input) !== fixture.lane) failures.push(`fixtures/${file}: canonical classifier does not produce ${fixture.lane}`);
    for (const assertion of fixture.expected) if (!(assertion in assertionMarkers)) failures.push(`fixtures/${file}: unknown assertion ${assertion}`);
  } catch (error) {
    failures.push(`fixtures/${file}: ${error.message}`);
  }
}

if (failures.length) {
  console.error(`check:seedbed failed:\n${failures.map((item) => `  - ${item}`).join('\n')}`);
  process.exit(1);
}
console.log(`check:seedbed — deterministic structural contract, canonical classifier, ${Object.keys(assertionMarkers).length} assertion markers, and ${fixtureFiles.length} scenario fixtures validated; no model outputs were executed or scored`);
