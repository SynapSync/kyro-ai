import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const root = mkdtempSync(join(tmpdir(), 'kyro-work-promotion-contract-'));
const cli = resolve('dist/cli.js');
const run = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' });
const data = (result) => {
  assert.equal(result.status, 0, `CLI status=${result.status}, output=${(result.stderr || result.stdout).slice(0, 800)}`);
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.ok, true);
  return envelope.data;
};
const fail = (result, code, pattern) => {
  assert.notEqual(result.status, 0, 'expected the CLI to reject this input');
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.ok, false, 'rejection must use the CLI error envelope');
  if (code) assert.equal(envelope.error.code, code, `expected error code ${code}; got ${envelope.error.code}: ${envelope.error.message}`);
  if (pattern) assert.match(envelope.error.message, pattern);
  return envelope;
};
try {
  mkdirSync(join(root, '.agents/kyro/scopes/forge-existing'), { recursive: true });
  const forgeSentinels = ['.agents/kyro/project.json', '.agents/kyro/local.json', '.agents/kyro/scopes/forge-existing/sprint.json'];
  forgeSentinels.forEach((entry) => writeFileSync(join(root, entry), `{"sentinel":"${entry}"}\n`));
  const forgeBefore = forgeSentinels.map((entry) => readFileSync(join(root, entry)));
  const forgeUnchanged = (label) => forgeSentinels.forEach((entry, index) => assert.deepEqual(readFileSync(join(root, entry)), forgeBefore[index], `${label} must preserve Forge layer ${entry}`));
  writeFileSync(join(root, 'brief.md'), '# Promotion contract fixture\n\nPreview an exact Work to Forge translation without writing either workflow.\n');
  const briefDigest = createHash('sha256').update(readFileSync(join(root, 'brief.md'))).digest('hex');
  const tasks = [
    { id: 'W1', title: 'Verified task', description: 'Verified history stays behind.', context: '', filesToTouch: ['src/verified.ts'], acceptanceCriteria: ['Verified output is recorded.'], dependsOn: [] },
    { id: 'W2', title: 'Disposed task', description: 'Disposed history stays behind.', context: '', filesToTouch: [], acceptanceCriteria: ['Disposal is explicit.'], dependsOn: [] },
    { id: 'W3', title: 'Pending with verified prerequisite', description: 'A verified dependency is adjudicated explicitly.', context: '', filesToTouch: ['src/pending.ts'], acceptanceCriteria: ['Pending output stands alone.'], dependsOn: ['W1'] },
    { id: 'W4', title: 'In progress task', description: 'Approval resets to pending.', context: '', filesToTouch: ['src/active.ts'], acceptanceCriteria: ['Active output is pending again.'], dependsOn: [] },
    { id: 'W5', title: 'Awaiting review task', description: 'Review state resets to pending.', context: '', filesToTouch: ['src/review.ts'], acceptanceCriteria: ['Review output is pending again.'], dependsOn: [] },
    { id: 'W6', title: 'Pending chained task', description: 'Edges among transferred tasks are preserved.', context: '', filesToTouch: ['src/chained.ts'], acceptanceCriteria: ['Chained output follows.'], dependsOn: ['W4'] },
  ];
  writeFileSync(join(root, 'proposal.json'), JSON.stringify({ tasks }));
  const evidence = { summary: 'Implemented by fixture.', validations: [{ command: 'fixture', result: 'passed', note: null }], filesChanged: [], notes: null };
  const planNewWork = (id) => {
    data(run('work', 'create', '--id', id, '--from', 'brief.md', '--json'));
    writeFileSync(join(root, 'proposal.json'), JSON.stringify({ tasks }));
    data(run('work', 'plan', '--work', id, '--from', 'proposal.json', '--expect-revision', '1', '--json'));
  };
  const workSnapshot = (id) => readFileSync(join(root, '.agents/kyro/work', id, 'work.json'));
  planNewWork('contract');
  data(run('work', 'start', '--work', 'contract', '--task', 'W1', '--expect-revision', '2', '--json'));
  writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence));
  data(run('work', 'record-evidence', '--work', 'contract', '--task', 'W1', '--from', 'evidence.json', '--by', 'fixture-maker', '--expect-revision', '3', '--json'));
  writeFileSync(join(root, 'review.json'), JSON.stringify({ checkedCriteria: ['Verified output is recorded.'], findings: [] }));
  data(run('work', 'review', '--work', 'contract', '--task', 'W1', '--from', 'review.json', '--verdict', 'pass', '--by', 'fixture-checker', '--expect-revision', '4', '--json'));
  data(run('work', 'dispose', '--work', 'contract', '--task', 'W2', '--kind', 'cancelled', '--reason', 'No longer needed.', '--by', 'fixture-owner', '--expect-revision', '5', '--json'));
  data(run('work', 'start', '--work', 'contract', '--task', 'W4', '--expect-revision', '6', '--json'));
  data(run('work', 'start', '--work', 'contract', '--task', 'W5', '--expect-revision', '7', '--json'));
  data(run('work', 'record-evidence', '--work', 'contract', '--task', 'W5', '--from', 'evidence.json', '--by', 'fixture-maker', '--expect-revision', '8', '--json'));

  // --- Valid preview: exact fields, deterministic mapping, explicit adjudication ---
  const workBefore = workSnapshot('contract');
  const previewArgs = ['work', 'promote', '--work', 'contract', '--to-scope', 'promoted-target', '--expect-revision', '9', '--by', 'fixture-owner', '--dry-run', '--json'];
  const first = run(...previewArgs);
  assert.equal(first.status, 0, first.stderr || first.stdout);
  const previewEnvelope = JSON.parse(first.stdout);
  assert.equal(previewEnvelope.command, 'work promote');
  assert.equal(previewEnvelope.phase, 'preview');
  const preview = previewEnvelope.data;
  assert.deepEqual(Object.keys(preview).sort(), ['actor', 'dependencyAdjudications', 'dryRun', 'expectedRevision', 'forgeTasksStartPending', 'kind', 'omittedDisposed', 'omittedVerified', 'requestDigest', 'schemaVersion', 'sourceBriefDigest', 'sourceRevision', 'sourceWorkId', 'targetPath', 'toScope', 'transferred', 'workVerdictsImportedAsForgePass'].sort(), 'preview must expose exact documented fields');
  assert.equal(preview.schemaVersion, 1);
  assert.equal(preview.kind, 'work-promotion-preview');
  assert.equal(preview.sourceWorkId, 'contract');
  assert.equal(preview.sourceRevision, 9);
  assert.equal(preview.sourceBriefDigest, briefDigest);
  assert.equal(preview.toScope, 'promoted-target');
  assert.equal(preview.targetPath, '.agents/kyro/scopes/promoted-target/sprint.json');
  assert.equal(preview.actor, 'fixture-owner');
  assert.match(preview.requestDigest, /^[a-f0-9]{64}$/);
  assert.equal(preview.workVerdictsImportedAsForgePass, false, 'preview must never import Work verdicts as Forge passes');
  assert.equal(preview.forgeTasksStartPending, true);
  assert.equal(preview.dryRun, true);
  assert.deepEqual(preview.transferred.map((transfer) => [transfer.sourceId, transfer.targetId]), [['W3', 'T1.1'], ['W4', 'T1.2'], ['W5', 'T1.3'], ['W6', 'T1.4']], 'Wn must map deterministically to T1.n in source order');
  const w3 = preview.transferred[0];
  assert.deepEqual(w3.acceptanceCriteria, ['Pending output stands alone.']);
  assert.deepEqual(w3.filesToTouch, ['src/pending.ts']);
  assert.deepEqual(w3.dependsOn, [], 'the verified-source edge must not transfer silently');
  assert.match(w3.approvalReset, /starts pending with no evidence, no verdict/);
  assert.deepEqual(preview.transferred[3].dependsOn, ['T1.2'], 'edges among transferred tasks must be preserved');
  assert.deepEqual(preview.omittedVerified.map((entry) => entry.sourceId), ['W1'], 'verified history must be disclosed as omitted');
  assert.deepEqual(preview.omittedDisposed.map((entry) => entry.sourceId), ['W2'], 'disposed history must be disclosed as omitted');
  assert.equal(preview.dependencyAdjudications.length, 1, 'exactly one verified-source edge needs adjudication');
  assert.equal(preview.dependencyAdjudications[0].task, 'T1.1');
  assert.match(preview.dependencyAdjudications[0].detail, /W1 is verified Work history/);
  const second = run(...previewArgs);
  assert.equal(second.stdout, first.stdout, 'the pure preview must be byte-deterministic');
  assert.deepEqual(workSnapshot('contract'), workBefore, 'preview must not write the Work');
  assert(!existsSync(join(root, '.agents/kyro/scopes/promoted-target')), 'preview must not stage a target scope');
  forgeUnchanged('read-only preview');

  // --- Fail-closed preview rejections leave both workflows untouched ---
  const rejectUnchanged = (label, args, code, pattern) => {
    const before = workSnapshot('contract');
    const targetDir = join(root, '.agents/kyro/scopes', args[args.indexOf('--to-scope') + 1] ?? '');
    const targetExisted = existsSync(targetDir);
    fail(run(...args), code, pattern);
    assert.deepEqual(workSnapshot('contract'), before, `${label} must not write the Work`);
    assert.equal(existsSync(targetDir), targetExisted, `${label} must not stage a new target`);
    forgeUnchanged(label);
  };
  mkdirSync(join(root, '.agents/kyro/scopes/taken-scope'), { recursive: true });
  writeFileSync(join(root, '.agents/kyro/scopes/taken-scope/sprint.json'), '{"retired":true}\n');
  const withScope = (scope, revision = '9') => ['work', 'promote', '--work', 'contract', '--to-scope', scope, '--expect-revision', revision, '--by', 'fixture-owner', '--dry-run', '--json'];
  rejectUnchanged('target collision', withScope('taken-scope'), 'CHECKPOINT_CONFLICT', /already exists/);
  rmSync(join(root, '.agents/kyro/scopes/taken-scope'), { recursive: true, force: true });
  rejectUnchanged('unsafe slug', withScope('../escape'), 'INVALID_INPUT', /unsafe/);
  rejectUnchanged('stale revision', withScope('fresh-scope', '8'), 'STATE_DIVERGED', /does not match expected/);
  rejectUnchanged('missing actor', ['work', 'promote', '--work', 'contract', '--to-scope', 'fresh-scope', '--expect-revision', '9', '--dry-run', '--json'], 'INVALID_INPUT', /--by/);
  const applyAttempt = run('work', 'promote', '--work', 'contract', '--to-scope', 'fresh-scope', '--expect-revision', '9', '--by', 'fixture-owner', '--json');
  fail(applyAttempt, 'INVALID_INPUT', /requires --yes to confirm/);
  assert.deepEqual(workSnapshot('contract'), workBefore, 'an apply attempt must not write without confirmation support');

  planNewWork('blocked-work');
  data(run('work', 'start', '--work', 'blocked-work', '--task', 'W1', '--expect-revision', '2', '--json'));
  data(run('work', 'block', '--work', 'blocked-work', '--task', 'W1', '--reason', 'Explicit blocker.', '--expect-revision', '3', '--json'));
  fail(run('work', 'promote', '--work', 'blocked-work', '--to-scope', 'blocked-target', '--expect-revision', '4', '--by', 'fixture-owner', '--dry-run', '--json'), 'INVALID_INPUT', /W1/);

  writeFileSync(join(root, 'disposed-dep.json'), JSON.stringify({ tasks: [
    { id: 'W1', title: 'Prerequisite', description: 'Disposed prerequisite.', context: '', filesToTouch: [], acceptanceCriteria: ['Prerequisite is explicit.'], dependsOn: [] },
    { id: 'W2', title: 'Dependent', description: 'Depends on disposed work.', context: '', filesToTouch: [], acceptanceCriteria: ['Dependent is explicit.'], dependsOn: ['W1'] },
  ] }));
  data(run('work', 'create', '--id', 'disposed-dep', '--from', 'brief.md', '--json'));
  data(run('work', 'plan', '--work', 'disposed-dep', '--from', 'disposed-dep.json', '--expect-revision', '1', '--json'));
  data(run('work', 'dispose', '--work', 'disposed-dep', '--task', 'W1', '--kind', 'cancelled', '--reason', 'Dropped.', '--by', 'fixture-owner', '--expect-revision', '2', '--json'));
  fail(run('work', 'promote', '--work', 'disposed-dep', '--to-scope', 'disposed-target', '--expect-revision', '3', '--by', 'fixture-owner', '--dry-run', '--json'), 'INVALID_INPUT', /disposed prerequisite W1/);

  planNewWork('all-verified');
  for (const [taskId, revision, criteria] of [['W1', 2, ['Verified output is recorded.']], ['W2', 5, ['Disposal is explicit.']], ['W3', 6, ['Pending output stands alone.']], ['W4', 9, ['Active output is pending again.']], ['W5', 12, ['Review output is pending again.']], ['W6', 15, ['Chained output follows.']]]) {
    if (taskId === 'W2') {
      data(run('work', 'dispose', '--work', 'all-verified', '--task', taskId, '--kind', 'cancelled', '--reason', 'Dropped.', '--by', 'fixture-owner', '--expect-revision', String(revision), '--json'));
      continue;
    }
    data(run('work', 'start', '--work', 'all-verified', '--task', taskId, '--expect-revision', String(revision), '--json'));
    data(run('work', 'record-evidence', '--work', 'all-verified', '--task', taskId, '--from', 'evidence.json', '--by', 'fixture-maker', '--expect-revision', String(revision + 1), '--json'));
    writeFileSync(join(root, 'review-one.json'), JSON.stringify({ checkedCriteria: criteria, findings: [] }));
    data(run('work', 'review', '--work', 'all-verified', '--task', taskId, '--from', 'review-one.json', '--verdict', 'pass', '--by', 'fixture-checker', '--expect-revision', String(revision + 2), '--json'));
  }
  fail(run('work', 'promote', '--work', 'all-verified', '--to-scope', 'empty-target', '--expect-revision', '18', '--by', 'fixture-owner', '--dry-run', '--json'), 'INVALID_INPUT', /no transferable/);
  data(run('work', 'create', '--id', 'draft-work', '--from', 'brief.md', '--json'));
  fail(run('work', 'promote', '--work', 'draft-work', '--to-scope', 'draft-target', '--expect-revision', '1', '--by', 'fixture-owner', '--dry-run', '--json'), 'INVALID_INPUT', /no transferable/);

  const briefPath = join(root, '.agents/kyro/work/contract/brief.md');
  const briefBytes = readFileSync(briefPath);
  writeFileSync(briefPath, '# Changed outside CLI\n\nNot authoritative.\n');
  fail(run(...previewArgs), 'STATE_DIVERGED', /digest does not match/);
  writeFileSync(briefPath, briefBytes);
  rmSync(briefPath);
  fail(run(...previewArgs), 'INVALID_INPUT', /brief is missing/);
  writeFileSync(briefPath, briefBytes);
  assert.deepEqual(workSnapshot('contract'), workBefore, 'brief failures must not write the Work');

  // --- Stopped Work with unfinished tasks stays eligible; closure is preserved ---
  data(run('work', 'close', '--work', 'contract', '--outcome', 'stopped', '--reason', 'Pause explicitly.', '--by', 'fixture-owner', '--expect-revision', '9', '--yes', '--json'));
  const stoppedPreview = data(run('work', 'promote', '--work', 'contract', '--to-scope', 'stopped-target', '--expect-revision', '10', '--by', 'fixture-owner', '--dry-run', '--json'));
  assert.equal(stoppedPreview.sourceRevision, 10);
  assert.deepEqual(stoppedPreview.transferred.map((transfer) => transfer.sourceId), ['W3', 'W4', 'W5', 'W6']);
  const stoppedWork = JSON.parse(workSnapshot('contract'));
  assert.equal(stoppedWork.closure.outcome, 'stopped', 'preview must preserve the original closure metadata');
  forgeUnchanged('stopped preview');

  // --- Pure planner units: validator coherence, request digest, sidecar/journal ---
  const promotionModule = await import(pathToFileURL(resolve('dist/cli/work/promotion.js')).href);
  const schemaModule = await import(pathToFileURL(resolve('dist/cli/work/schema.js')).href);
  const firstDigest = promotionModule.promotionRequestDigest('contract', { toScope: 'stopped-target', actor: 'fixture-owner', expectedRevision: 10 });
  assert.equal(firstDigest, stoppedPreview.requestDigest, 'the CLI preview must carry the canonical request digest');
  assert.equal(promotionModule.promotionRequestDigest('contract', { toScope: 'stopped-target', actor: 'fixture-owner', expectedRevision: 10 }), firstDigest, 'the request digest must be deterministic');
  assert.notEqual(promotionModule.promotionRequestDigest('contract', { toScope: 'stopped-target', actor: 'other-owner', expectedRevision: 10 }), firstDigest, 'a different actor must change the request digest');
  const promotedLike = {
    ...stoppedWork,
    state: 'promoted',
    revision: 11,
    handoff: { nextAction: 'done', nextTaskId: null, blockedReason: null },
    promotion: { targetScope: 'stopped-target', targetPath: '.agents/kyro/scopes/stopped-target/sprint.json', sourceRevision: 11, sourceDigest: createHash('sha256').update('promoted').digest('hex'), promotedTaskIds: ['W3'], promotedAt: stoppedWork.updatedAt, by: 'fixture-owner' },
    activity: [...stoppedWork.activity, { seq: stoppedWork.activity.length + 1, at: stoppedWork.updatedAt, event: 'work_promoted', taskId: null, by: 'fixture-owner', reason: 'Promoted.', revision: 11 }],
  };
  assert.deepEqual(schemaModule.validateWorkFile(promotedLike), [], 'a stopped Work promoted to a later revision must validate with its historical closure');
  assert.throws(() => promotionModule.planPromotionPreview(promotedLike, { toScope: 'again-target', actor: 'fixture-owner', expectedRevision: 11 }), /already promoted/, 'a promoted Work cannot promote again');
  const sidecar = promotionModule.buildPromotionSidecar(stoppedPreview, { sourceDigest: createHash('sha256').update('work').digest('hex'), targetDigest: createHash('sha256').update('sprint').digest('hex'), promotedAt: stoppedWork.updatedAt });
  assert.deepEqual(schemaModule.validatePromotionSidecar(sidecar), [], 'a built sidecar must validate');
  assert.equal(sidecar.sourceRevision, 11, 'the sidecar must bind the post-promotion revision');
  const journal = promotionModule.buildPromotionJournal(stoppedPreview, { oldWorkDigest: createHash('sha256').update('old').digest('hex'), newWorkDigest: createHash('sha256').update('new').digest('hex'), stagedTargetDigest: sidecar.targetDigest, preparedAt: stoppedWork.updatedAt });
  assert.deepEqual(schemaModule.validatePromotionJournal(journal), [], 'a built journal must validate');
  const sidecarField = (mutate, field) => {
    const issues = schemaModule.validatePromotionSidecar(mutate({ ...sidecar }));
    assert(issues.some((entry) => entry.field.includes(field)), `sidecar must diagnose ${field}; got ${JSON.stringify(issues)}`);
  };
  sidecarField((record) => ({ ...record, targetScope: 'Bad Scope' }), 'targetScope');
  sidecarField((record) => ({ ...record, targetPath: 'elsewhere.json' }), 'targetPath');
  sidecarField((record) => ({ ...record, sourceDigest: 'bad' }), 'sourceDigest');
  sidecarField((record) => ({ ...record, kind: 'other' }), 'kind');
  sidecarField((record) => ({ ...record, extra: true }), 'extra');
  const journalField = (mutate, field) => {
    const issues = schemaModule.validatePromotionJournal(mutate({ ...journal }));
    assert(issues.some((entry) => entry.field.includes(field)), `journal must diagnose ${field}; got ${JSON.stringify(issues)}`);
  };
  journalField((record) => ({ ...record, requestDigest: 'bad' }), 'requestDigest');
  journalField((record) => ({ ...record, kind: 'other' }), 'kind');
  journalField((record) => ({ ...record, expectedRevision: 0 }), 'expectedRevision');
  journalField((record) => ({ ...record, extra: true }), 'extra');
  forgeUnchanged('contract units');
  console.log('Work promotion contract fixtures passed.');
} finally { rmSync(root, { recursive: true, force: true }); }
