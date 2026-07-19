#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
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

function sandbox(caseName = 'route-review-task') {
  const root = join(tmpdir(), `kyro-maker-checker-${Date.now()}-${Math.random().toString(16).slice(2)}`);
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

function prepareDoneTask(root, overrides = {}) {
  const sprint = readSprint(root);
  const task = sprint.activeSprint.phases[0].tasks[0];
  task.acceptance_criteria = ['Criterion A', 'Criterion B'];
  task.status = 'done';
  task.evidence = {
    summary: 'Implemented the demo task.',
    validation: 'npm test -- demo',
    files_changed: ['src/demo.ts'],
    by: 'maker',
    recordedAt: '2026-07-02T00:00:00.000Z',
  };
  task.verdict = null;
  Object.assign(task, overrides);
  writeSprint(root, sprint);
}

function writePolicy(root, policy) {
  writeFileSync(join(root, '.agents/kyro/policy.json'), `${JSON.stringify(policy, null, 2)}\n`);
}

function assertCoverageVetoAndZeroWrite() {
  const root = sandbox();
  try {
    prepareDoneTask(root);
    const before = sig(sprintPath(root));
    const result = run(['review', 'T1.1', '--kyro-scope', 'demo', '--verdict', 'pass', '--checked-criterion', 'Criterion A', '--yes'], root);
    assert(result.status === 1, `incomplete criteria pass should fail: ${result.stdout}${result.stderr}`);
    assert((result.stderr + result.stdout).includes('CHECKER_FAILED'), 'coverage veto should expose CHECKER_FAILED');
    const after = sig(sprintPath(root));
    assert(before.bytes === after.bytes && before.mtimeMs === after.mtimeMs, 'coverage veto must not write sprint.json');

    const analyze = run(['analyze', '--kyro-scope', 'demo'], root);
    assert(analyze.status === 1, 'done task missing verdict should block analyze before review');
    assert(analyze.stdout.includes('checker'), 'analyze should surface checker category');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function assertHappyPathTraceAndCloseGate() {
  const root = sandbox();
  try {
    prepareDoneTask(root);
    const reviewed = run(['review', 'T1.1', '--kyro-scope', 'demo', '--verdict', 'pass', '--yes'], root);
    assert(reviewed.status === 0, `coherent review should pass: ${reviewed.stdout}${reviewed.stderr}`);
    const sprint = readSprint(root);
    const task = sprint.activeSprint.phases[0].tasks[0];
    assert(task.verdict.result === 'pass' && task.verdict.by === 'checker', 'review command should write pass verdict');
    assert(sprint.handoff.nextAction === 'close_sprint', 'review should advance to close_sprint when all tasks passed');
    const trace = readFileSync(join(root, '.agents/kyro/scopes/demo/trace/events.ndjson'), 'utf-8');
    assert(trace.includes('gate_approved') && trace.includes('checker'), 'review pass should emit gate_approved checker trace');

    const close = run(['close-sprint', '--kyro-scope', 'demo', '--outcome', 'shipped', '--yes'], root);
    assert(close.status === 0, `coherent close should pass: ${close.stdout}${close.stderr}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function assertEvidenceAndTimeChecks() {
  const root = sandbox();
  try {
    prepareDoneTask(root, { evidence: null });
    let analyze = run(['analyze', '--kyro-scope', 'demo'], root);
    assert(analyze.status === 1 && analyze.stdout.includes('missing or malformed evidence'), 'done without evidence should be CRITICAL');

    prepareDoneTask(root, { verdict: { result: 'pass', checked_criteria: ['Criterion A', 'Criterion B'], findings: [], by: 'checker', reviewedAt: '2026-07-01T00:00:00.000Z' } });
    analyze = run(['analyze', '--kyro-scope', 'demo'], root);
    assert(analyze.status === 1 && analyze.stdout.includes('verdict predates its evidence'), 'verdict before evidence should be HIGH');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function assertSelfReviewPolicy() {
  const root = sandbox();
  try {
    prepareDoneTask(root);
    writePolicy(root, { policyVersion: 1, operations: {}, allow: [], maker_checker: { requireSeparateChecker: true } });
    const self = run(['review', 'T1.1', '--kyro-scope', 'demo', '--verdict', 'pass', '--by', 'maker', '--yes'], root);
    assert(self.status === 1 && (self.stderr + self.stdout).includes('SELF_REVIEW_BLOCKED'), 'requireSeparateChecker should block self-review pass');
    const separate = run(['review', 'T1.1', '--kyro-scope', 'demo', '--verdict', 'pass', '--by', 'checker-2', '--yes'], root);
    assert(separate.status === 0, `separate checker should pass: ${separate.stdout}${separate.stderr}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function assertReviewConfirmationPolicy() {
  // Default is tool_owned: per-task review is reversible and gated by the deterministic checker
  // (coverage/evidence/self-review veto), so a pass must not need --yes. Requiring confirmation on
  // every task only re-fires CONFIRMATION_REQUIRED in autonomous loops without adding real oversight.
  {
    const root = sandbox();
    try {
      prepareDoneTask(root);
      const result = run(['review', 'T1.1', '--kyro-scope', 'demo', '--verdict', 'pass'], root);
      assert(result.status === 0, `review_task default (tool_owned) should pass without --yes: ${result.stdout}${result.stderr}`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
  // Opt-in confirm still works: a project that sets review_task=confirm in policy.json gets the gate
  // back — an unconfirmed pass is blocked and writes nothing.
  {
    const root = sandbox();
    try {
      prepareDoneTask(root);
      writePolicy(root, { policyVersion: 1, operations: { review_task: { level: 'confirm' } }, allow: [], maker_checker: { requireSeparateChecker: false } });
      const before = sig(sprintPath(root));
      const result = run(['review', 'T1.1', '--kyro-scope', 'demo', '--verdict', 'pass'], root);
      assert(result.status === 1 && (result.stderr + result.stdout).includes('CONFIRMATION_REQUIRED'), 'review_task=confirm should require --yes');
      const after = sig(sprintPath(root));
      assert(before.bytes === after.bytes && before.mtimeMs === after.mtimeMs, 'unconfirmed review must not write');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
}

function assertNormalizedCriterionMatching() {
  // Normalized match passes: backticks/whitespace/case variants of both criteria should be treated as
  // covering the real acceptance_criteria strings, since agents paraphrase supplied criteria constantly.
  {
    const root = sandbox();
    try {
      prepareDoneTask(root);
      const result = run(
        ['review', 'T1.1', '--kyro-scope', 'demo', '--verdict', 'pass', '--checked-criterion', '`criterion a`', '--checked-criterion', 'CRITERION   B', '--yes'],
        root,
      );
      assert(result.status === 0, `normalized-variant criteria should pass: ${result.stdout}${result.stderr}`);
      const analyze = run(['analyze', '--kyro-scope', 'demo'], root);
      assert(!(analyze.stdout + analyze.stderr).includes('CHECKER'), `analyze should show no CHECKER finding after normalized pass: ${analyze.stdout}${analyze.stderr}`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  // No-match errors actionably: an invented criterion must fail fast with the real expected list, not
  // silently sink into "uncovered" and loop the agent through opaque rejections.
  {
    const root = sandbox();
    try {
      prepareDoneTask(root);
      const result = run(
        ['review', 'T1.1', '--kyro-scope', 'demo', '--verdict', 'pass', '--checked-criterion', 'Totally invented criterion', '--yes'],
        root,
      );
      assert(result.status === 1, `invented criterion should fail: ${result.stdout}${result.stderr}`);
      const combined = result.stdout + result.stderr;
      assert(combined.includes('Criterion A'), `actionable error should list real acceptance criteria: ${combined}`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  // Waiver via normalized form: a backtick-wrapped waiver criterion should still resolve to the real
  // acceptance criterion it waives.
  {
    const root = sandbox();
    try {
      prepareDoneTask(root);
      const result = run(
        ['review', 'T1.1', '--kyro-scope', 'demo', '--verdict', 'pass', '--checked-criterion', 'Criterion A', '--waive-criterion', '`Criterion B`::not applicable', '--yes'],
        root,
      );
      assert(result.status === 0, `normalized waiver should pass: ${result.stdout}${result.stderr}`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  // Existing partial-coverage behavior must be unchanged: Criterion B is genuinely neither checked nor
  // waived here, so the pass must still be vetoed.
  {
    const root = sandbox();
    try {
      prepareDoneTask(root);
      const result = run(['review', 'T1.1', '--kyro-scope', 'demo', '--verdict', 'pass', '--checked-criterion', 'Criterion A', '--yes'], root);
      assert(result.status === 1, `genuinely uncovered criterion should still fail: ${result.stdout}${result.stderr}`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
}

function assertSingleDecisionSite() {
  const lines = scanLines('missingCheckedCriteria|principle-gate|nonNegotiableViolations|checked_criteria.*acceptance_criteria', 'src/cli', { cwd: repo });
  const offenders = lines.filter((line) => {
    if (line.startsWith('src/cli/core/analysis.ts:')) return false;
    if (line.startsWith('src/cli/commands/review.ts:') && line.includes('checked_criteria:')) return false;
    if (line.startsWith('src/cli/commands/doctor.ts:') && line.includes('principle-gate-on-pass=enforced')) return false;
    return true;
  });
  assert(offenders.length === 0, `checker decision logic outside core/analysis.ts:\n${offenders.join('\n')}`);
}

function main() {
  assertSingleDecisionSite();
  assertCoverageVetoAndZeroWrite();
  assertHappyPathTraceAndCloseGate();
  assertEvidenceAndTimeChecks();
  assertSelfReviewPolicy();
  assertReviewConfirmationPolicy();
  assertNormalizedCriterionMatching();
  console.log('check:maker-checker — deterministic maker/checker invariants passed');
}

main();
