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

function run(args, cwd) {
  return spawnSync(process.execPath, [cli, ...args], { cwd, env: { ...process.env, HOME: join(cwd, '.home') }, encoding: 'utf-8' });
}

function runNode(script, cwd) {
  return spawnSync(process.execPath, ['-e', script], { cwd, env: { ...process.env, HOME: join(cwd, '.home') }, encoding: 'utf-8' });
}

function sandbox(caseName = 'maker-checker-happy') {
  const root = join(tmpdir(), `kyro-status-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(join(root, '.home'), { recursive: true });
  cpSync(resolve(repo, `fixtures/evals/${caseName}/state`), root, { recursive: true });
  return root;
}

function sprintPath(root) {
  return join(root, '.agents/kyro/scopes/demo/sprint.json');
}

// 1. core/status.ts must be a pure module — no I/O, no state reads. Derivation cannot depend on the
//    filesystem or it stops being a single, trivially-correct source of truth.
function assertStatusCoreIsPure() {
  const text = readFileSync(resolve(repo, 'src/cli/core/status.ts'), 'utf-8');
  const forbidden = /from 'node:fs'|readJsonSafely|from '\.\.\/state'|console\./;
  const hits = text.split('\n').map((line, i) => ({ line, i: i + 1 })).filter(({ line }) => forbidden.test(line));
  assert(hits.length === 0, `core/status.ts must have no I/O imports; found:\n${hits.map((h) => `${h.i}: ${h.line}`).join('\n')}`);
}

// 2. analyze must report stale activeSprint.status as advisory coherence drift.
function assertAnalyzeReportsActiveSprintStatusDrift() {
  const root = sandbox();
  try {
    const sprint = JSON.parse(readFileSync(sprintPath(root), 'utf-8'));
    sprint.activeSprint.status = 'planned';
    writeFileSync(sprintPath(root), `${JSON.stringify(sprint, null, 2)}\n`);
    const result = run(['analyze', '--kyro-scope', 'demo', '--json'], root);
    assert(result.stdout.trim().startsWith('{'), `analyze --json should write JSON: ${result.stderr || result.stdout}`);
    const report = JSON.parse(result.stdout);
    const drift = report.findings.find((finding) => finding.detail === 'activeSprint status "planned" contradicts task states (should be "complete")');
    assert(drift && drift.severity === 'MEDIUM', `analyze should report MEDIUM activeSprint drift, got ${JSON.stringify(report.findings)}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// 3. repair must normalize stale phase.status and activeSprint.status to derived values.
function assertRepairNormalizesPhaseStatus() {
  const root = sandbox();
  try {
    const sprint = JSON.parse(readFileSync(sprintPath(root), 'utf-8'));
    // Force drift: all tasks are done in this fixture, but mark status as still executing/planned.
    sprint.activeSprint.phases[0].status = 'executing';
    sprint.activeSprint.status = 'planned';
    writeFileSync(sprintPath(root), `${JSON.stringify(sprint, null, 2)}\n`);
    const result = run(['repair', '--kyro-scope', 'demo', '--yes'], root);
    assert(result.status === 0, `repair should succeed: ${result.stderr || result.stdout}`);
    const after = JSON.parse(readFileSync(sprintPath(root), 'utf-8'));
    assert(after.activeSprint.phases[0].status === 'done', `repair should derive phase status to "done", got "${after.activeSprint.phases[0].status}"`);
    assert(after.activeSprint.status === 'complete', `repair should derive activeSprint status to "complete", got "${after.activeSprint.status}"`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// 4. context-pack must surface review debt (done tasks without a pass verdict) on the read path.
function assertContextPackSurfacesReviewDebt() {
  const root = sandbox();
  try {
    const result = run(['context-pack', '--kyro-scope', 'demo', '--task', 'T1.1', '--json'], root);
    assert(result.status === 0, `context-pack should succeed: ${result.stderr || result.stdout}`);
    const pack = JSON.parse(result.stdout);
    assert(Array.isArray(pack.reviewPending), 'context-pack output must declare reviewPending[]');
    assert(pack.reviewPending.includes('T1.1'), `reviewPending should include the done/no-verdict task, got ${JSON.stringify(pack.reviewPending)}`);
    assert(pack.nextTaskReview && pack.nextTaskReview.hasPassVerdict === false, 'nextTaskReview should report the missing pass verdict');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// 5. MCP review_task must accept the same waiver format as the CLI and persist structured waivers.
function assertMcpReviewTaskAcceptsWaivers() {
  const root = sandbox('review-waived-criterion');
  try {
    const script = `
      const { readFileSync } = require('node:fs');
      const { callTool } = require(${JSON.stringify(resolve(repo, 'dist/cli/mcp/handlers.js'))});
      const result = callTool('review_task', {
        scope: 'demo',
        task_id: 'T1.1',
        verdict: 'pass',
        waived_criteria: ['Validation passes.::superseded by an approved scope change'],
        by: 'checker',
        confirm: true
      });
      if (result.isError) {
        console.error(JSON.stringify(result.structuredContent));
        process.exit(1);
      }
      const sprint = JSON.parse(readFileSync('.agents/kyro/scopes/demo/sprint.json', 'utf-8'));
      const verdict = sprint.activeSprint.phases[0].tasks[0].verdict;
      if (!verdict || verdict.result !== 'pass') throw new Error('missing pass verdict');
      if (verdict.checked_criteria.length !== 0) throw new Error('waived criterion should not be auto-checked');
      const waiver = verdict.waived_criteria && verdict.waived_criteria[0];
      if (!waiver || waiver.criterion !== 'Validation passes.' || waiver.reason !== 'superseded by an approved scope change') {
        throw new Error(\`waiver was not persisted as structured data: \${JSON.stringify(verdict)}\`);
      }
    `;
    const result = runNode(script, root);
    assert(result.status === 0, `MCP review_task should accept waived_criteria: ${result.stderr || result.stdout}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// 6. /kyro:status router must include review debt on the direct brief path, not only in the mode file.
function assertStatusRouterDocumentsReviewDebt() {
  const text = readFileSync(resolve(repo, 'commands/status.md'), 'utf-8');
  assert(/review debt/i.test(text), 'commands/status.md must mention review debt');
  assert(text.includes('reviewPending'), 'commands/status.md must point agents to context-pack reviewPending');
}

function main() {
  assertStatusCoreIsPure();
  assertAnalyzeReportsActiveSprintStatusDrift();
  assertRepairNormalizesPhaseStatus();
  assertContextPackSurfacesReviewDebt();
  assertMcpReviewTaskAcceptsWaivers();
  assertStatusRouterDocumentsReviewDebt();
  console.log('check:status — status coherence invariants passed');
}

try {
  main();
} catch (error) {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
