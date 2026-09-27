import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = mkdtempSync(join(tmpdir(), 'kyro-work-closure-'));
const cli = resolve('dist/cli.js');
try {
  const write = (path, value) => { const target = join(root, path); mkdirSync(join(target, '..'), { recursive: true }); writeFileSync(target, value); };
  const run = (args, env = {}) => spawnSync(process.execPath, [cli, 'work', ...args, '--json'], { cwd: root, encoding: 'utf8', env: { ...process.env, ...env } });
  const ok = (args, env) => { const result = run(args, env); assert.equal(result.status, 0, result.stdout || result.stderr); return JSON.parse(result.stdout).data; };
  const bad = (pattern, args, env) => { const result = run(args, env); assert.notEqual(result.status, 0); assert.match(JSON.parse(result.stdout).error.message, pattern); };
  const path = (id) => join(root, '.agents/kyro/work', id, 'work.json');
  const close = (id, outcome, revision, tail = ['--yes']) => ['close', '--work', id, '--outcome', outcome, '--reason', 'Outcome recorded explicitly.', '--by', 'fixture-owner', '--expect-revision', String(revision), ...tail];
  const reopen = (id, revision, tail = ['--yes']) => ['reopen', '--work', id, '--reason', 'Resume this Work deliberately.', '--by', 'fixture-owner', '--expect-revision', String(revision), ...tail];
  write('brief.md', '# Closure fixture\n\nVerify honest close and reopen behavior.\n');
  write('.agents/kyro/project.json', '{"unchanged":true}\n');
  write('.agents/kyro/local.json', '{"unchanged":true}\n');
  write('.agents/kyro/scopes/existing/sprint.json', '{"unchanged":true}\n');
  const forge = ['.agents/kyro/project.json', '.agents/kyro/local.json', '.agents/kyro/scopes/existing/sprint.json'];
  const forgeBefore = forge.map((entry) => readFileSync(join(root, entry)));
  write('plan.json', JSON.stringify({ tasks: [
    { id: 'W1', title: 'First', description: 'First task.', context: '', filesToTouch: [], acceptanceCriteria: ['First is complete.'], dependsOn: [] },
    { id: 'W2', title: 'Second', description: 'Second task.', context: '', filesToTouch: [], acceptanceCriteria: ['Second is complete.'], dependsOn: [] },
  ] }));
  const setup = (id) => { ok(['create', '--id', id, '--from', 'brief.md']); ok(['plan', '--work', id, '--from', 'plan.json', '--expect-revision', '1']); };
  setup('partial');
  const before = readFileSync(path('partial'));
  bad(/require --yes/i, close('partial', 'stopped', 2, []));
  bad(/unresolved task/i, close('partial', 'completed', 2));
  assert.deepEqual(readFileSync(path('partial')), before);
  const preview = ok(close('partial', 'stopped', 2, ['--dry-run']));
  assert.deepEqual(preview.summary.unresolved, ['W1', 'W2']);
  assert.deepEqual(preview.summary.verified, []);
  assert.deepEqual(preview.summary.disposed, []);
  assert.deepEqual(readFileSync(path('partial')), before);
  bad(/Injected Work close failure/i, close('partial', 'stopped', 2), { KYRO_WORK_INJECT_FAILURE: 'close-before-write' });
  assert.deepEqual(readFileSync(path('partial')), before);
  const closed = ok(close('partial', 'stopped', 2));
  assert.equal(closed.closure.finalRevision, 3);
  assert.equal(closed.closure.briefDigest, JSON.parse(readFileSync(path('partial'))).brief.digest);
  assert.equal(closed.handoff.nextAction, 'done');
  const status = ok(['status', '--work', 'partial']);
  assert.equal(status.closure.outcome, 'stopped');
  assert.deepEqual(status.summary.unresolved, ['W1', 'W2']);
  const closedBytes = readFileSync(path('partial'));
  bad(/revision .* does not match expected/i, close('partial', 'stopped', 2));
  bad(/cannot be closed/i, close('partial', 'stopped', 3));
  assert.deepEqual(readFileSync(path('partial')), closedBytes);
  const reopenPreview = ok(reopen('partial', 3, ['--dry-run']));
  assert.equal(reopenPreview.state, 'active');
  assert.deepEqual(readFileSync(path('partial')), closedBytes);
  assert.equal(existsSync(join(root, reopenPreview.closureHistoryPath)), false);
  bad(/Injected Work reopen failure/i, reopen('partial', 3), { KYRO_WORK_INJECT_FAILURE: 'reopen-after-history' });
  assert.deepEqual(readFileSync(path('partial')), closedBytes);
  assert.equal(existsSync(join(root, reopenPreview.closureHistoryPath)), true);
  const opened = ok(reopen('partial', 3));
  assert.equal(opened.revision, 4);
  assert.equal(opened.handoff.nextAction, 'execute_task');
  const history = JSON.parse(readFileSync(join(root, opened.closureHistoryPath), 'utf8'));
  assert.equal(history.closedRevision, 3);
  assert.deepEqual(history.closure, closed.closure);
  const live = JSON.parse(readFileSync(path('partial'), 'utf8'));
  assert.equal(live.closure, null);
  assert.equal(live.activity.at(-1).event, 'work_reopened');
  bad(/revision .* does not match expected/i, reopen('partial', 3));

  setup('completed');
  ok(['dispose', '--work', 'completed', '--task', 'W1', '--kind', 'cancelled', '--reason', 'No longer needed.', '--by', 'fixture-owner', '--expect-revision', '2']);
  ok(['dispose', '--work', 'completed', '--task', 'W2', '--kind', 'cancelled', '--reason', 'No longer needed.', '--by', 'fixture-owner', '--expect-revision', '3']);
  const completed = ok(close('completed', 'completed', 4));
  assert.equal(completed.closure.outcome, 'completed');
  assert.deepEqual(completed.summary.disposed, ['W1', 'W2']);
  assert.deepEqual(completed.summary.verified, []);
  assert.deepEqual(completed.summary.unresolved, []);

  write('mixed-plan.json', JSON.stringify({ tasks: ['W1', 'W2', 'W3', 'W4', 'W5'].map((id) => ({
    id, title: id, description: `Task ${id}.`, context: '', filesToTouch: [], acceptanceCriteria: [`${id} is complete.`], dependsOn: [],
  })) }));
  ok(['create', '--id', 'mixed', '--from', 'brief.md']);
  ok(['plan', '--work', 'mixed', '--from', 'mixed-plan.json', '--expect-revision', '1']);
  ok(['start', '--work', 'mixed', '--task', 'W1', '--expect-revision', '2']);
  write('evidence.json', JSON.stringify({ summary: 'Verified by fixture.', validations: [{ command: 'fixture', result: 'passed', note: null }], filesChanged: [], notes: null }));
  ok(['record-evidence', '--work', 'mixed', '--task', 'W1', '--from', 'evidence.json', '--by', 'fixture-maker', '--expect-revision', '3']);
  write('review.json', JSON.stringify({ checkedCriteria: ['W1 is complete.'], findings: [] }));
  ok(['review', '--work', 'mixed', '--task', 'W1', '--from', 'review.json', '--verdict', 'pass', '--by', 'fixture-checker', '--expect-revision', '4']);
  ok(['block', '--work', 'mixed', '--task', 'W2', '--reason', 'Explicit blocker.', '--expect-revision', '5']);
  ok(['start', '--work', 'mixed', '--task', 'W3', '--expect-revision', '6']);
  ok(['record-evidence', '--work', 'mixed', '--task', 'W3', '--from', 'evidence.json', '--by', 'fixture-maker', '--expect-revision', '7']);
  ok(['start', '--work', 'mixed', '--task', 'W4', '--expect-revision', '8']);
  const mixed = ok(close('mixed', 'stopped', 9, ['--dry-run']));
  assert.deepEqual(mixed.summary.verified, ['W1']);
  assert.deepEqual(mixed.summary.blocked, ['W2']);
  assert.deepEqual(mixed.summary.awaitingReview, ['W3']);
  assert.deepEqual(mixed.summary.inProgress, ['W4']);
  assert.deepEqual(mixed.summary.pending, ['W5']);
  assert.deepEqual(mixed.summary.unresolved, ['W2', 'W3', 'W4', 'W5']);
  bad(/unresolved task/i, close('mixed', 'completed', 9));

  setup('history-conflict');
  ok(close('history-conflict', 'stopped', 2));
  const conflictBefore = readFileSync(path('history-conflict'));
  write('.agents/kyro/work/history-conflict/closure-history/closure-r3.json', '{"external":"corruption"}\n');
  bad(/closure history conflicts/i, reopen('history-conflict', 3));
  assert.deepEqual(readFileSync(path('history-conflict')), conflictBefore);

  setup('mismatch');
  write('.agents/kyro/work/mismatch/brief.md', '# Changed outside CLI\n\nNot authoritative.\n');
  const mismatchBefore = readFileSync(path('mismatch'));
  bad(/brief digest does not match/i, close('mismatch', 'stopped', 2));
  assert.deepEqual(readFileSync(path('mismatch')), mismatchBefore);
  for (const [index, entry] of forge.entries()) assert.deepEqual(readFileSync(join(root, entry)), forgeBefore[index]);

  // --- T4.5 promoted Work reopen refusal on a real CLI-promoted artifact ---
  ok(['create', '--id', 'promoted-reopen', '--from', 'brief.md']);
  write('promote-plan.json', JSON.stringify({ tasks: [
    { id: 'W1', title: 'First', description: 'First task.', context: '', filesToTouch: [], acceptanceCriteria: ['First is complete.'], dependsOn: [] },
    { id: 'W2', title: 'Second', description: 'Second task.', context: '', filesToTouch: [], acceptanceCriteria: ['Second is complete.'], dependsOn: [] },
  ] }));
  ok(['plan', '--work', 'promoted-reopen', '--from', 'promote-plan.json', '--expect-revision', '1']);
  const promoted = ok(['promote', '--work', 'promoted-reopen', '--to-scope', 'reopen-target', '--expect-revision', '2', '--by', 'fixture-owner', '--yes']);
  assert.equal(promoted.state, 'promoted');
  const promotedEntries = [path('promoted-reopen'), join(root, '.agents/kyro/scopes/reopen-target/sprint.json'), join(root, '.agents/kyro/scopes/reopen-target/promotion-source.json')];
  const promotedFiles = promotedEntries.map((entry) => readFileSync(entry));
  bad(/not closed and cannot be reopened/i, reopen('promoted-reopen', 3, ['--dry-run']));
  bad(/not closed and cannot be reopened/i, reopen('promoted-reopen', 3));
  assert.deepEqual(promotedEntries.map((entry) => readFileSync(entry)), promotedFiles, 'reopening a promoted Work must change neither Work nor Forge bytes');
  assert.equal(existsSync(join(root, '.agents/kyro/work/promoted-reopen/closure-history/closure-r3.json')), false, 'a refused reopen must not write closure history');
  // A stopped but non-promoted Work still reopens with its closure history.
  setup('reopen-contrast');
  ok(close('reopen-contrast', 'stopped', 2));
  const contrastOpened = ok(reopen('reopen-contrast', 3));
  assert.equal(contrastOpened.revision, 4);
  assert.equal(JSON.parse(readFileSync(path('reopen-contrast'), 'utf8')).state, 'active');
  assert(existsSync(join(root, contrastOpened.closureHistoryPath)), 'a stopped reopen must preserve its closure history');
  for (const [index, entry] of forge.entries()) assert.deepEqual(readFileSync(join(root, entry)), forgeBefore[index]);
  console.log('Work close/reopen provenance, failure retry, honest summary, and Forge isolation fixtures passed.');
} finally { rmSync(root, { recursive: true, force: true }); }
