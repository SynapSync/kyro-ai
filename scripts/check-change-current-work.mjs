#!/usr/bin/env node
// Regression fixtures for Sprint 1 live-work fixes.
// Red baseline: npm run check:change-current-work:red (built 36c3897 worktree only).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGuardedProbeRoot, removeGuardedProbeRoot, runGuardedCliProbe } from './lib/guarded-cli-probe.mjs';

const repo = resolve(fileURLToPath(import.meta.url), '../..');
const expectRed = process.argv.includes('--expect-red');
const baselineFlag = process.argv.indexOf('--baseline-cli');
const baselineCli = baselineFlag === -1 ? null : process.argv[baselineFlag + 1];
if (baselineFlag !== -1 && (!baselineCli || baselineCli.startsWith('-'))) throw new Error('--baseline-cli requires an absolute dist/cli.js path');
const cli = expectRed ? resolve(baselineCli ?? '') : resolve(repo, 'dist/cli.js');
const fixtureRepo = expectRed ? resolve(cli, '..', '..') : repo;
if (expectRed && !baselineCli) throw new Error('--expect-red requires --baseline-cli pointing to a built 36c3897 worktree CLI');
if (expectRed && !existsSync(cli)) throw new Error(`baseline CLI does not exist: ${cli}; build the 36c3897 worktree first`);
if (expectRed) {
  const baselineRoot = resolve(cli, '..', '..');
  const head = spawnSync('git', ['-C', baselineRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  assert.equal(head.status, 0, `cannot resolve baseline worktree HEAD: ${head.stderr}`);
  assert.equal(head.stdout.trim(), '36c3897b2d2fbd074fde5e44849b0dc6fa30b533', '--expect-red must execute the 36c3897 baseline CLI');
}
const routingOnly = process.argv.includes('--routing-only');
const activePlanOnly = process.argv.includes('--active-plan-only');
const roadmapOnly = process.argv.includes('--roadmap-only');
const roots = [];
const scope = 'demo';
const sprintPath = (root) => join(root, '.agents/kyro/scopes/demo/sprint.json');
const read = (root) => JSON.parse(readFileSync(sprintPath(root), 'utf8'));
const write = (root, value) => writeFileSync(sprintPath(root), `${JSON.stringify(value, null, 2)}\n`);

function sandbox(name) {
  const root = createGuardedProbeRoot(name); roots.push(root);
  cpSync(join(repo, 'fixtures/evals/route-review-task/state'), root, { recursive: true });
  mkdirSync(join(root, '.home'));
  return root;
}
function run(root, args) { return runGuardedCliProbe({ root, cli, expectedCli: cli, args: [...args, '--json'] }); }
function data(result) { return JSON.parse(result.stdout).data; }
function assertDesired(result, message) { if (expectRed) assert.notEqual(result.status, 0, `36c3897 unexpectedly satisfies: ${message}`); else assert.equal(result.status, 0, `${message}: ${result.stdout}${result.stderr}`); }
function check(label, fn) { fn(); console.log(`  ok ${label}`); }

try {
  check('guard rejects real workspace roots and only permits an absolute checkout CLI', () => {
    assert.throws(() => runGuardedCliProbe({ root: repo, cli, expectedCli: cli, args: ['status'] }), /rejected non-fixture root/);
    assert.throws(() => runGuardedCliProbe({ root: repo, cli: 'kyro', expectedCli: cli, args: ['status'] }), /absolute root and CLI/);
    const root = sandbox('guard');
    assert.throws(() => runGuardedCliProbe({ root, cli: '/tmp/other/dist/cli.js', expectedCli: cli, args: ['status'] }), /outside the selected checkout/);
  });

  check('S1: disposing a blocked task retains an independent ready task', () => {
    const root = sandbox('s1'); const sprint = read(root); const first = sprint.activeSprint.phases[0].tasks[0];
    const independent = structuredClone(first); independent.id = 'T1.2'; independent.depends_on = []; independent.status = 'pending'; independent.verdict = null; independent.evidence = [];
    sprint.activeSprint.phases[0].tasks.push(independent); write(root, sprint);
    const result = run(root, ['record-evidence', 'T1.1', '--kyro-scope', scope, '--summary', 'fixture block', '--validation', 'fixture', '--status', 'blocked']);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(data(run(root, ['context-pack', '--kyro-scope', scope])).nextTaskId, 'T1.2');
  });

  check('S2: disposing the final task exposes no_ready_work rather than execute_task/null', () => {
    const root = sandbox('s2');
    const result = run(root, ['record-evidence', 'T1.1', '--kyro-scope', scope, '--summary', 'fixture cancellation', '--validation', 'fixture', '--disposition', 'cancelled', '--reason', 'fixture']);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const pack = run(root, ['context-pack', '--kyro-scope', scope]);
    if (expectRed) { const value = data(pack); assert.equal(value.nextAction, 'execute_task'); assert.equal(value.nextTaskId, null); }
    else { assertDesired(pack, 'context pack must remain readable'); const value = data(pack); assert.notEqual(value.nextAction, 'execute_task'); assert(value.blockers.some((b) => b.code === 'no_ready_work' && b.remedyCommand)); }
  });

  if (!routingOnly) check('S3: one digest/apply request removes a requirement while cancelling its live consumer', () => {
    const root = sandbox('s3'); const sprint = read(root); const task = sprint.activeSprint.phases[0].tasks[0]; task.scenario_refs = ['S1'];
    sprint.spec = { requirements: [{ id: 'R1', statement: 'remove me' }], scenarios: [{ id: 'S1', requirement: 'R1', given: 'g', when: 'w', then: 't' }], nonGoals: [], openQuestions: [] }; write(root, sprint);
    const input = { sprint: { n: sprint.activeSprint.n, slug: sprint.activeSprint.slug }, reason: 'fixture remove and cancel', requirements: [{ id: 'R1', action: 'remove' }], tasks: [{ id: 'T1.1', action: 'cancel', reason: 'fixture' }] };
    writeFileSync(join(root, 'input.json'), JSON.stringify(input));
    const before = readFileSync(sprintPath(root), 'utf8');
    const preview = run(root, ['plan', '--update-active', '--kyro-scope', scope, '--from', 'input.json', '--dry-run']);
    assertDesired(preview, 'update-active must support combined requirement removal and task cancellation');
    if (!expectRed) {
      assert.equal(readFileSync(sprintPath(root), 'utf8'), before, 'preview must not write managed state');
      const result = run(root, ['plan', '--update-active', '--kyro-scope', scope, '--from', 'input.json', '--digest', data(preview).digest, '--yes']);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      const next = read(root); assert.equal(next.spec.requirements.length, 0); assert.equal(next.spec.scenarios.length, 0);
      assert.equal(next.activeSprint.phases[0].tasks[0].disposition.kind, 'cancelled');
      const doctor = run(root, ['doctor', '--artifacts', '--kyro-scope', scope]); assert.equal(doctor.status, 0, doctor.stdout + doctor.stderr);
      assert.equal(next.schemaVersion, 4);
    }
  });

  if ((!routingOnly && !activePlanOnly) || roadmapOnly) check('S4: planned roadmap changes require the dedicated digest-protected writer', () => {
    const root = sandbox('roadmap'); const sprint = read(root);
    sprint.roadmap.sprints.push(
      { n: 2, slug: 'future-one', title: 'Future one', state: 'planned' },
      { n: 3, slug: 'future-two', title: 'Future two', state: 'planned' },
    );
    sprint.roadmap.plannedSprintCount = 3;
    write(root, sprint);
    const input = {
      reason: 'fixture reorganize planned roadmap',
      updates: [{ n: 2, title: 'Retitled future one' }],
      add: [{ slug: 'future-three', title: 'Future three' }],
      cancel: [3],
      order: [2, 4],
    };
    writeFileSync(join(root, 'roadmap.json'), JSON.stringify(input));
    const before = readFileSync(sprintPath(root), 'utf8');
    const preview = run(root, ['plan', '--roadmap', '--kyro-scope', scope, '--from', 'roadmap.json', '--dry-run']);
    assertDesired(preview, 'plan --roadmap must edit planned entries only');
    if (!expectRed) {
      assert.equal(readFileSync(sprintPath(root), 'utf8'), before, 'roadmap preview must not write managed state');
      const apply = run(root, ['plan', '--roadmap', '--kyro-scope', scope, '--from', 'roadmap.json', '--digest', data(preview).digest, '--yes']);
      assert.equal(apply.status, 0, apply.stdout + apply.stderr);
      const next = read(root); const active = next.roadmap.sprints.find((entry) => entry.n === 1);
      assert.deepEqual(active, JSON.parse(before).roadmap.sprints[0], 'active roadmap identity must remain unchanged');
      assert.equal(next.roadmap.sprints.find((entry) => entry.n === 2)?.title, 'Retitled future one');
      assert.equal(next.roadmap.sprints.find((entry) => entry.n === 3)?.state, 'cancelled');
      assert.equal(next.schemaVersion, 4);
      assert.equal(next.roadmap.plannedSprintCount, 3, 'cancelled entries must not count as planned materialization');
      assert.equal(run(root, ['doctor', '--artifacts', '--kyro-scope', scope]).status, 0, 'roadmap write must leave artifacts healthy');
      const beforeRejected = readFileSync(sprintPath(root), 'utf8');
      writeFileSync(join(root, 'reject-active.json'), JSON.stringify({ reason: 'must not mutate active', cancel: [1] }));
      const rejected = run(root, ['plan', '--roadmap', '--kyro-scope', scope, '--from', 'reject-active.json', '--dry-run']);
      assert.notEqual(rejected.status, 0, 'active roadmap identities must be rejected');
      assert.equal(readFileSync(sprintPath(root), 'utf8'), beforeRejected, 'rejected roadmap mutation must not write managed state');
    }
  });

  if (!roadmapOnly && !routingOnly && !activePlanOnly) check('S5: scope discard is a single digest-protected lifecycle operation', () => {
    const root = sandbox('discard'); const before = readFileSync(sprintPath(root), 'utf8');
    const unconfirmed = run(root, ['scope', 'discard', '--kyro-scope', scope, '--reason', 'fixture discard']);
    assert.notEqual(unconfirmed.status, 0, 'discard without --digest/--yes must require confirmation');
    assert.equal(readFileSync(sprintPath(root), 'utf8'), before, 'unconfirmed discard must not write managed state');
    const preview = run(root, ['scope', 'discard', '--kyro-scope', scope, '--reason', 'fixture discard', '--dry-run']);
    assertDesired(preview, 'scope discard must preview an active scope');
    if (!expectRed) {
      assert.equal(readFileSync(sprintPath(root), 'utf8'), before, 'discard preview must not write managed state');
      const apply = run(root, ['scope', 'discard', '--kyro-scope', scope, '--reason', 'fixture discard', '--digest', data(preview).digest, '--yes']);
      assert.equal(apply.status, 0, apply.stdout + apply.stderr);
      const next = read(root); assert.equal(next.activeSprint, null); assert.equal(next.retirement?.status, 'retired');
      assert.equal(next.previousSprint?.outcome, 'abandoned'); assert.equal(next.schemaVersion, 4);
      const after = readFileSync(sprintPath(root), 'utf8');
      const retry = run(root, ['scope', 'discard', '--kyro-scope', scope, '--reason', 'fixture discard', '--digest', data(preview).digest, '--yes']);
      assert.equal(retry.status, 0, `same digest must resume/no-op safely: ${retry.stdout}${retry.stderr}`);
      assert.equal(readFileSync(sprintPath(root), 'utf8'), after, 'same digest retry must not diverge or rewrite the retired state');
      assert.equal(run(root, ['doctor', '--artifacts', '--kyro-scope', scope]).status, 0, 'discard must leave artifacts healthy');
    }
  });

  if (!roadmapOnly && !routingOnly && !activePlanOnly) check('S6: shipped live-work helper applies remedyCommand and runs doctor-after', () => {
    const helper = join(fixtureRepo, 'internal/skills/sprint-forge/assets/helpers/live-work.md');
    if (expectRed) {
      assert(!existsSync(helper), '36c3897 unexpectedly ships the live-work helper');
      return;
    }
    assert(existsSync(helper), 'live-work helper must be shipped');
    const text = readFileSync(helper, 'utf8');
    assert.match(text, /remedyCommand/); assert.match(text, /doctor --artifacts/);
    assert.doesNotMatch(text, /plan --revise|schema 5|live-revision|--global/);
  });

  if (!roadmapOnly && !routingOnly && !activePlanOnly) check('scope-local rule update/remove/replace are digest-protected and never global', () => {
    const root = sandbox('rule'); const sprint = read(root); sprint.conventions = [{ id: 'process-1', rule: 'Old local rule.', tags: ['process'], addedSprint: 1 }]; write(root, sprint);
    const projectPath = join(root, '.agents/kyro/project.json'); const projectBefore = existsSync(projectPath) ? readFileSync(projectPath, 'utf8') : null;
    const result = run(root, ['rule', 'replace', 'process-1', '--rule', 'New local rule.', '--tag', 'process', '--kyro-scope', scope, '--dry-run']);
    assertDesired(result, 'local rule replace must be available through the CLI');
    if (!expectRed) {
      const apply = run(root, ['rule', 'replace', 'process-1', '--rule', 'New local rule.', '--tag', 'process', '--kyro-scope', scope, '--digest', data(result).digest, '--yes']);
      assert.equal(apply.status, 0, apply.stdout + apply.stderr);
      assert.equal(existsSync(projectPath) ? readFileSync(projectPath, 'utf8') : null, projectBefore, 'local replacement must not write project.json');
      const pack = data(run(root, ['context-pack', '--kyro-scope', scope]));
      assert(!pack.conventions.some((rule) => rule.id === 'process-1'), 'retired rule must not be effective');
      assert(pack.conventions.some((rule) => rule.rule === 'New local rule.'), 'replacement rule must be effective');
    }
  });
} finally { for (const root of roots) removeGuardedProbeRoot(root); }
console.log(`check:change-current-work — ${expectRed ? '36c3897 red fixtures recorded' : 'live-work fixtures passed'}`);
