#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(fileURLToPath(import.meta.url), '../..');
const cli = resolve(repo, 'dist/cli.js');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function run(args, cwd, env = {}) {
  return spawnSync(process.execPath, [cli, ...args], { cwd, env: { ...process.env, HOME: join(cwd, '.home'), ...env }, encoding: 'utf-8' });
}

function sandbox(caseName = 'close-sprint-happy') {
  const root = join(tmpdir(), `kyro-analyze-metadata-${Date.now()}-${Math.random().toString(16).slice(2)}`);
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

/**
 * The fixture ships with no author (as most hand-authored fixtures do). analyze must surface a
 * LOW/metadata finding — advisory only, never blocking — so drift from the INIT-mode CLI path
 * (kyro plan --from, which captures git identity) stays visible without gating anything.
 */
function assertMissingAuthorIsLowAdvisory() {
  const root = sandbox();
  try {
    const sprint = readSprint(root);
    assert(!('author' in sprint), 'fixture precondition: sprint.json must not already carry author');
    writeSprint(root, sprint);

    const result = run(['analyze', '--kyro-scope', 'demo', '--json'], root);
    assert(result.status === 0, `missing author alone must not block analyze: ${result.stdout}${result.stderr}`);
    const report = JSON.parse(result.stdout);
    const finding = report.findings.find((f) => f.category === 'metadata' && f.detail.includes('scope has no author'));
    assert(finding, `analyze should report a metadata finding for missing author: ${JSON.stringify(report.findings)}`);
    assert(finding.severity === 'LOW', `missing-author finding must be LOW, got ${finding.severity}`);
    assert(report.blocking === false, `missing-author finding alone must not set blocking: ${JSON.stringify(report)}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** Once author is present (regardless of source), the finding must not appear. */
function assertPresentAuthorSuppressesFinding() {
  const root = sandbox();
  try {
    const sprint = readSprint(root);
    sprint.author = { name: 'Ada Lovelace', email: 'ada@example.com', source: 'git', capturedAt: '2026-01-01T00:00:00.000Z' };
    writeSprint(root, sprint);

    const result = run(['analyze', '--kyro-scope', 'demo', '--json'], root);
    assert(result.status === 0, `analyze should succeed: ${result.stdout}${result.stderr}`);
    const report = JSON.parse(result.stdout);
    const finding = report.findings.find((f) => f.category === 'metadata' && f.detail.includes('scope has no author'));
    assert(!finding, `analyze must not report missing-author finding once author is present: ${JSON.stringify(report.findings)}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function main() {
  assertMissingAuthorIsLowAdvisory();
  assertPresentAuthorSuppressesFinding();
  console.log('check:analyze-metadata — missing-author advisory finding passed');
}

main();
