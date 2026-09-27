import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// T4.3: stage a validated Forge destination without changing the active scope.
// (T4.4/T4.5 extend this file with commit/recovery and reopen-barrier sections.)
const root = mkdtempSync(join(tmpdir(), 'kyro-work-promotion-'));
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
  writeFileSync(join(root, '.agents/kyro/project.json'), '{"sentinel":"project"}\n');
  writeFileSync(join(root, '.agents/kyro/local.json'), '{"sentinel":"local","activeScope":"forge-existing"}\n');
  writeFileSync(join(root, '.agents/kyro/scopes/forge-existing/sprint.json'), '{"sentinel":"sprint"}\n');
  const forgeSentinels = ['.agents/kyro/project.json', '.agents/kyro/local.json', '.agents/kyro/scopes/forge-existing/sprint.json'];
  let forgeBefore = forgeSentinels.map((entry) => readFileSync(join(root, entry)));
  const forgeUnchanged = (label) => forgeSentinels.forEach((entry, index) => assert.deepEqual(readFileSync(join(root, entry)), forgeBefore[index], `${label} must preserve Forge layer ${entry}`));
  writeFileSync(join(root, 'brief.md'), '# Promotion staging fixture\n\nStage a validated Forge destination without switching the active scope.\n');
  data(run('work', 'create', '--id', 'stage-work', '--from', 'brief.md', '--json'));
  writeFileSync(join(root, 'proposal.json'), JSON.stringify({ tasks: [
    { id: 'W1', title: 'Verified history', description: 'Verified history stays behind.', context: '', filesToTouch: ['src/verified.ts'], acceptanceCriteria: ['History is recorded.'], dependsOn: [] },
    { id: 'W2', title: 'Pending transfer', description: 'Transfer pending work with its criteria.', context: 'Keep the adapter isolated.', filesToTouch: ['src/pending.ts'], acceptanceCriteria: ['Pending output stands alone.', 'Criteria travel with the task.'], dependsOn: ['W1'] },
    { id: 'W3', title: 'Active transfer', description: 'Approval resets to pending.', context: '', filesToTouch: [], acceptanceCriteria: ['Active output is pending again.'], dependsOn: [] },
  ] }));
  data(run('work', 'plan', '--work', 'stage-work', '--from', 'proposal.json', '--expect-revision', '1', '--json'));
  data(run('work', 'start', '--work', 'stage-work', '--task', 'W1', '--expect-revision', '2', '--json'));
  writeFileSync(join(root, 'evidence.json'), JSON.stringify({ summary: 'Implemented by fixture.', validations: [{ command: 'fixture', result: 'passed', note: null }], filesChanged: [], notes: null }));
  data(run('work', 'record-evidence', '--work', 'stage-work', '--task', 'W1', '--from', 'evidence.json', '--by', 'fixture-maker', '--expect-revision', '3', '--json'));
  writeFileSync(join(root, 'review.json'), JSON.stringify({ checkedCriteria: ['History is recorded.'], findings: [] }));
  data(run('work', 'review', '--work', 'stage-work', '--task', 'W1', '--from', 'review.json', '--verdict', 'pass', '--by', 'fixture-checker', '--expect-revision', '4', '--json'));
  data(run('work', 'start', '--work', 'stage-work', '--task', 'W3', '--expect-revision', '5', '--json'));
  const preview = data(run('work', 'promote', '--work', 'stage-work', '--to-scope', 'staged-target', '--expect-revision', '6', '--by', 'fixture-owner', '--dry-run', '--json'));
  assert.deepEqual(preview.transferred.map((transfer) => [transfer.sourceId, transfer.targetId]), [['W2', 'T1.1'], ['W3', 'T1.2']]);

  const promotionModule = pathToFileURL(resolve('dist/cli/work/promotion.js')).href;
  const schemaModule = pathToFileURL(resolve('dist/cli/work/schema.js')).href;
  const forgeSchemaModule = pathToFileURL(resolve('dist/cli/artifacts/schema.js')).href;
  const storeModule = pathToFileURL(resolve('dist/cli/work/store.js')).href;
  const lockModule = pathToFileURL(resolve('dist/cli/pipeline/state-writer-lock.js')).href;
  const probeSource = `
    const promotion = await import(${JSON.stringify(promotionModule)});
    const schema = await import(${JSON.stringify(schemaModule)});
    const forgeSchema = await import(${JSON.stringify(forgeSchemaModule)});
    const store = await import(${JSON.stringify(storeModule)});
    const lock = await import(${JSON.stringify(lockModule)});
    const { readFileSync } = await import('node:fs');
    const [workId, toScope, revisionRaw, actor, sourceDigest, promotedAt, mode] = process.argv.slice(2);
    const outcome = {};
    try {
      const work = store.readWork(workId);
      const request = { toScope, actor, expectedRevision: Number(revisionRaw) };
      const planned = promotion.planPromotionPreview(work, request);
      outcome.previewMatchesCli = JSON.stringify({ ...planned, dryRun: true }) === readFileSync('preview.json', 'utf8').trim();
      let effective = planned;
      if (mode === 'tampered-dep') effective = { ...planned, transferred: planned.transferred.map((transfer, index) => index === 0 ? { ...transfer, dependsOn: ['T9.9'] } : transfer) };
      if (mode === 'tampered-source') effective = { ...planned, transferred: planned.transferred.map((transfer, index) => index === 0 ? { ...transfer, sourceId: 'W9' } : transfer) };
      const staged = lock.withStateWriterLock(() => promotion.stagePromotionDestination(work, effective, { sourceDigest, promotedAt }));
      const stagedSprint = JSON.parse(readFileSync(staged.stagedSprintPath, 'utf8'));
      const stagedSidecar = JSON.parse(readFileSync(staged.stagedSidecarPath, 'utf8'));
      outcome.forgeValid = forgeSchema.validateSprintFile(stagedSprint, 'staged/sprint.json').length === 0;
      outcome.sidecarValid = schema.validatePromotionSidecar(stagedSidecar).length === 0;
      outcome.tasks = stagedSprint.activeSprint.phases.flatMap((phase) => phase.tasks).map((task) => ({ id: task.id, status: task.status, evidence: task.evidence, verdict: task.verdict, context: task.context }));
      outcome.sidecar = stagedSidecar;
      outcome.targetDigestMatches = staged.targetDigest === stagedSidecar.targetDigest;
      outcome.title = stagedSprint.title;
      outcome.objective = stagedSprint.objective;
      outcome.stagedSprintPath = staged.stagedSprintPath;
      console.log(JSON.stringify({ ok: true, outcome }));
    } catch (error) {
      console.log(JSON.stringify({ ok: false, code: error.code ?? error.name, message: error.message }));
      process.exit(2);
    }
  `;
  const probePath = join(root, 'stage-probe.mjs');
  writeFileSync(probePath, probeSource);
  writeFileSync(join(root, 'preview.json'), JSON.stringify(preview));
  const workBefore = readFileSync(join(root, '.agents/kyro/work/stage-work/work.json'));
  const sourceDigest = createHash('sha256').update('staged-source').digest('hex');
  const stage = (mode = 'stage', env = {}) => spawnSync(process.execPath, [probePath, 'stage-work', 'staged-target', '6', 'fixture-owner', sourceDigest, '2026-09-27T12:00:00.000Z', mode], { cwd: root, encoding: 'utf8', env: { ...process.env, ...env } });
  const staged = stage();
  assert.equal(staged.status, 0, staged.stdout || staged.stderr);
  const stagedResult = JSON.parse(staged.stdout);
  assert.equal(stagedResult.ok, true, staged.stdout);
  assert.equal(stagedResult.outcome.previewMatchesCli, true, 'the staging adapter must reproduce the CLI preview exactly');
  assert.equal(stagedResult.outcome.forgeValid, true, 'the staged Forge document must be schema-valid');
  assert.equal(stagedResult.outcome.sidecarValid, true, 'the staged reciprocal sidecar must validate');
  assert.deepEqual(stagedResult.outcome.tasks.map((task) => [task.id, task.status, task.evidence, task.verdict]), [['T1.1', 'pending', null, null], ['T1.2', 'pending', null, null]], 'no task may be marked done or reviewed because it passed in Work');
  assert.match(stagedResult.outcome.tasks[0].context, /Source: Work stage-work task W2 \(Work status pending at promotion; no Work approval is carried\)\./);
  assert.match(stagedResult.outcome.tasks[0].context, /Keep the adapter isolated\./, 'original context must be preserved ahead of provenance');
  assert.equal(stagedResult.outcome.sidecar.sourceWorkId, 'stage-work');
  assert.equal(stagedResult.outcome.sidecar.sourceRevision, 7, 'the sidecar must bind the post-promotion revision');
  assert.equal(stagedResult.outcome.sidecar.sourceDigest, sourceDigest);
  assert.equal(stagedResult.outcome.sidecar.targetScope, 'staged-target');
  assert.equal(stagedResult.outcome.sidecar.targetPath, '.agents/kyro/scopes/staged-target/sprint.json');
  assert.equal(stagedResult.outcome.sidecar.requestDigest, preview.requestDigest);
  assert.deepEqual(stagedResult.outcome.sidecar.promotedTaskIds, ['W2', 'W3']);
  assert.equal(stagedResult.outcome.targetDigestMatches, true);
  const liveWork = JSON.parse(readFileSync(join(root, '.agents/kyro/work/stage-work/work.json'), 'utf8'));
  assert.equal(stagedResult.outcome.title, liveWork.title, 'the target scope must preserve the source title');
  assert.equal(stagedResult.outcome.objective, liveWork.objective, 'the target scope must preserve the source objective');
  assert(!existsSync(join(root, '.agents/kyro/scopes/staged-target')), 'staging must not expose a runnable scope');
  assert.deepEqual(readFileSync(join(root, '.agents/kyro/work/stage-work/work.json')), workBefore, 'staging must not write the live Work');
  forgeUnchanged('staging');
  assert.equal(JSON.parse(readFileSync(join(root, '.agents/kyro/local.json'), 'utf8')).activeScope, 'forge-existing', 'staging must never switch the active scope');

  // --- Failure safety: collision, symlink, malformed mapping, injected failure ---
  const stageFails = (label, mode, env, code, pattern) => {
    const before = readFileSync(join(root, '.agents/kyro/work/stage-work/work.json'));
    const scopeExisted = existsSync(join(root, '.agents/kyro/scopes/staged-target'));
    const result = stage(mode, env);
    assert.equal(result.status, 2, `${label} must fail closed`);
    const failure = JSON.parse(result.stdout);
    assert.equal(failure.ok, false);
    assert.equal(failure.code, code, `${label}: expected ${code}; got ${failure.code}: ${failure.message}`);
    assert.match(failure.message, pattern);
    assert.deepEqual(readFileSync(join(root, '.agents/kyro/work/stage-work/work.json')), before, `${label} must preserve Work bytes`);
    assert.equal(existsSync(join(root, '.agents/kyro/scopes/staged-target')), scopeExisted, `${label} must not publish a new scope`);
    forgeUnchanged(label);
  };
  mkdirSync(join(root, '.agents/kyro/scopes/staged-target'), { recursive: true });
  writeFileSync(join(root, '.agents/kyro/scopes/staged-target/sprint.json'), '{"retired":true}\n');
  stageFails('existing target', 'stage', {}, 'CHECKPOINT_CONFLICT', /already exists/);
  rmSync(join(root, '.agents/kyro/scopes/staged-target'), { recursive: true, force: true });
  mkdirSync(join(root, 'outside-target'), { recursive: true });
  symlinkSync(join(root, 'outside-target'), join(root, '.agents/kyro/scopes/staged-target'));
  stageFails('symlinked target path', 'stage', {}, 'INVALID_INPUT', /symbolic link/);
  rmSync(join(root, '.agents/kyro/scopes/staged-target'));
  const stagedSprintBefore = readFileSync(join(root, '.agents/kyro/work/stage-work/.promotion-stage/staged-target/sprint.json'));
  stageFails('malformed dependency mapping', 'tampered-dep', {}, 'INVALID_INPUT', /unknown Forge task/);
  stageFails('stale source mapping', 'tampered-source', {}, 'INVALID_INPUT', /missing Work task/);
  assert.deepEqual(readFileSync(join(root, '.agents/kyro/work/stage-work/.promotion-stage/staged-target/sprint.json')), stagedSprintBefore, 'a rejected mapping must not clobber staged scratch');
  stageFails('injected staging failure', 'stage', { KYRO_WORK_INJECT_FAILURE: 'promote-after-stage' }, 'INTERNAL', /promote-after-stage/);
  forgeUnchanged('staging failures');

  // --- The ordinary plan/init path keeps its routing and active-scope behavior ---
  const planRoot = mkdtempSync(join(tmpdir(), 'kyro-plan-init-'));
  try {
    writeFileSync(join(planRoot, '.agents-kyro-placeholder'), '');
    mkdirSync(join(planRoot, '.agents/kyro'), { recursive: true });
    writeFileSync(join(planRoot, '.agents/kyro/project.json'), JSON.stringify({ schemaVersion: 4, artifactRoot: '.agents/kyro/scopes' }, null, 2) + '\n');
    writeFileSync(join(planRoot, '.agents/kyro/local.json'), JSON.stringify({ schemaVersion: 4, activeScope: null, installedAdapters: [] }, null, 2) + '\n');
    writeFileSync(join(planRoot, 'lean.json'), JSON.stringify({
      scope: 'ordinary-scope',
      title: 'Ordinary scope',
      objective: 'Prove the ordinary plan path still switches the active scope.',
      successCriteria: ['Scope initializes through plan init.'],
      roadmap: { plannedSprintCount: 1, sizingRationale: 'Single sprint.', sprints: [{ n: 1, slug: 'ordinary-sprint', title: 'Ordinary sprint' }] },
    }));
    const initialized = spawnSync(process.execPath, [cli, 'plan', '--from', 'lean.json'], { cwd: planRoot, encoding: 'utf8' });
    assert.equal(initialized.status, 0, initialized.stderr || initialized.stdout);
    assert.equal(JSON.parse(readFileSync(join(planRoot, '.agents/kyro/local.json'), 'utf8')).activeScope, 'ordinary-scope', 'ordinary plan init must still switch the active scope');
    assert(existsSync(join(planRoot, '.agents/kyro/scopes/ordinary-scope/sprint.json')), 'ordinary plan init must still publish its scope');
  } finally { rmSync(planRoot, { recursive: true, force: true }); }
  forgeUnchanged('ordinary plan init');
  console.log('Work promotion staging fixtures passed.');

  // --- T4.4 commit and recovery through the Work CLI ---
  const workSchema = await import(pathToFileURL(resolve('dist/cli/work/schema.js')).href);
  const forgeSchema = await import(pathToFileURL(resolve('dist/cli/artifacts/schema.js')).href);
  const workPathFor = (id) => join(root, '.agents/kyro/work', id, 'work.json');
  const journalPathFor = (id) => join(root, '.agents/kyro/work', id, '.pending-promotion.json');
  const planSimpleWork = (id, tasks = [{ id: 'W1', title: 'Only task', description: 'Transfer one task.', context: '', filesToTouch: [], acceptanceCriteria: ['Output is transferred.'], dependsOn: [] }]) => {
    data(run('work', 'create', '--id', id, '--from', 'brief.md', '--json'));
    writeFileSync(join(root, `proposal-${id}.json`), JSON.stringify({ tasks }));
    data(run('work', 'plan', '--work', id, '--from', `proposal-${id}.json`, '--expect-revision', '1', '--json'));
  };
  const applyArgs = (id, scope, revision, actor = 'fixture-owner', extra = []) => ['work', 'promote', '--work', id, '--to-scope', scope, '--expect-revision', String(revision), '--by', actor, '--yes', '--json', ...extra];
  const applyWithInjection = (id, scope, revision, boundary) => spawnSync(process.execPath, [cli, ...applyArgs(id, scope, revision)], { cwd: root, encoding: 'utf8', env: { ...process.env, KYRO_WORK_INJECT_FAILURE: boundary } });
  const failInternal = (result, label) => {
    assert.notEqual(result.status, 0, `${label} must fail`);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.ok, false);
    assert.equal(envelope.error.code, 'INTERNAL', `${label}: expected INTERNAL; got ${envelope.error.code}`);
  };

  // Valid apply on an active Work.
  const stageWorkBefore = readFileSync(workPathFor('stage-work'));
  const stagePreview = data(run('work', 'promote', '--work', 'stage-work', '--to-scope', 'staged-target', '--expect-revision', '6', '--by', 'fixture-owner', '--dry-run', '--json'));
  // The direct staging probe used a deliberately synthetic digest and time;
  // it is not a CLI transaction and must not be reused as one.
  rmSync(join(root, '.agents/kyro/work/stage-work/.promotion-stage/staged-target'), { recursive: true });
  const applied = run(...applyArgs('stage-work', 'staged-target', 6));
  assert.equal(applied.status, 0, applied.stderr || applied.stdout);
  const appliedEnvelope = JSON.parse(applied.stdout);
  assert.equal(appliedEnvelope.command, 'work promote');
  assert.equal(appliedEnvelope.phase, 'applied');
  const commit = appliedEnvelope.data;
  assert.equal(commit.revision, 7);
  assert.equal(commit.state, 'promoted');
  assert.equal(commit.targetScope, 'staged-target');
  assert.equal(commit.targetPath, '.agents/kyro/scopes/staged-target/sprint.json');
  assert.deepEqual(commit.promotedTaskIds, ['W2', 'W3']);
  assert.equal(commit.requestDigest, stagePreview.requestDigest);
  assert.match(commit.targetDigest, /^[a-f0-9]{64}$/);
  assert.equal(commit.recovered, false);
  assert.equal(commit.handoff.nextAction, 'done');
  assert.equal(commit.dryRun, false);
  const promotedWork = JSON.parse(readFileSync(workPathFor('stage-work'), 'utf8'));
  assert.deepEqual(workSchema.validateWorkFile(promotedWork, workPathFor('stage-work')), [], 'the promoted Work must be schema-valid');
  assert.equal(promotedWork.promotion.sourceRevision, 7);
  assert.equal(promotedWork.promotion.sourceDigest, createHash('sha256').update(stageWorkBefore).digest('hex'), 'sourceDigest must bind the exact pre-promotion source bytes');
  assert.equal(promotedWork.promotion.promotedAt, promotedWork.updatedAt);
  assert.equal(promotedWork.promotion.by, 'fixture-owner');
  assert.deepEqual(promotedWork.activity.slice(-2).map((entry) => entry.event), ['promotion_prepared', 'work_promoted']);
  const publishedSprint = JSON.parse(readFileSync(join(root, '.agents/kyro/scopes/staged-target/sprint.json'), 'utf8'));
  assert.deepEqual(forgeSchema.validateSprintFile(publishedSprint, 'staged-target/sprint.json'), [], 'the published destination must be schema-valid');
  assert(publishedSprint.activeSprint.phases.flatMap((phase) => phase.tasks).every((task) => task.status === 'pending' && task.evidence === null && task.verdict === null), 'the destination must hold only pending Forge tasks');
  const publishedSidecar = JSON.parse(readFileSync(join(root, '.agents/kyro/scopes/staged-target/promotion-source.json'), 'utf8'));
  assert.deepEqual(workSchema.validatePromotionSidecar(publishedSidecar), [], 'the published reciprocal link must validate');
  assert.equal(publishedSidecar.sourceDigest, promotedWork.promotion.sourceDigest, 'both documents must agree on the source digest');
  assert.equal(publishedSidecar.targetDigest, createHash('sha256').update(readFileSync(join(root, '.agents/kyro/scopes/staged-target/sprint.json'))).digest('hex'), 'the sidecar must bind the published target bytes');
  assert.deepEqual(readFileSync(join(root, '.agents/kyro/scopes/staged-target/promotion-initial-sprint.json')), readFileSync(join(root, '.agents/kyro/scopes/staged-target/sprint.json')), 'the origin copy must be byte-identical to the initially published Forge sprint');
  assert.equal(publishedSidecar.requestDigest, commit.requestDigest);
  assert.equal(publishedSidecar.sourceRevision, 7);
  assert.deepEqual(publishedSidecar.promotedTaskIds, ['W2', 'W3']);
  assert(!existsSync(journalPathFor('stage-work')), 'a successful apply must clear its intent');
  assert.equal(data(run('work', 'status', '--work', 'stage-work', '--json')).nextAction, 'done', 'a promoted Work reads as done, not blocked');
  assert.equal(data(run('work', 'context-pack', '--work', 'stage-work', '--json')).nextAction, 'done');
  fail(run(...applyArgs('stage-work', 'other-target', 7)), 'INVALID_INPUT', /already promoted/);
  forgeUnchanged('promotion apply');
  assert.equal(JSON.parse(readFileSync(join(root, '.agents/kyro/local.json'), 'utf8')).activeScope, 'forge-existing', 'promotion apply must never switch the active scope');

  // Stopped Work promotes with its closure history preserved.
  planSimpleWork('stopped-commit', [
    { id: 'W1', title: 'Keep one', description: 'Transfer one task.', context: '', filesToTouch: [], acceptanceCriteria: ['Output is transferred.'], dependsOn: [] },
    { id: 'W2', title: 'Leave one', description: 'Stopped work stays unfinished.', context: '', filesToTouch: [], acceptanceCriteria: ['Output stays unfinished.'], dependsOn: [] },
  ]);
  data(run('work', 'close', '--work', 'stopped-commit', '--outcome', 'stopped', '--reason', 'Pause explicitly.', '--by', 'fixture-owner', '--expect-revision', '2', '--yes', '--json'));
  data(run(...applyArgs('stopped-commit', 'stopped-target', 3)));
  const stoppedPromoted = JSON.parse(readFileSync(workPathFor('stopped-commit'), 'utf8'));
  assert.equal(stoppedPromoted.closure.outcome, 'stopped', 'promotion must preserve the original closure metadata');
  assert.equal(stoppedPromoted.closure.finalRevision, 3, 'the historical closure revision must survive the later promotion revision');
  assert.equal(stoppedPromoted.promotion.sourceRevision, 4);
  assert.deepEqual(workSchema.validateWorkFile(stoppedPromoted, workPathFor('stopped-commit')), [], 'a promoted stopped Work must validate with its historical closure');

  // Pending intent blocks reads-as-healthy and every non-recovery mutation.
  planSimpleWork('pending-work');
  failInternal(applyWithInjection('pending-work', 'pending-target', 2, 'promote-after-journal'), 'journal interruption');
  assert(existsSync(journalPathFor('pending-work')), 'an interrupted apply must leave its intent');
  const pendingStatus = data(run('work', 'status', '--work', 'pending-work', '--json'));
  assert.equal(pendingStatus.nextAction, 'resolve_blocker', 'a pending promotion must read as a blocker, never done');
  assert.match(pendingStatus.blockedReason, /pending promotion.*--yes/, 'the blocker must carry the exact retry remedy');
  assert.equal(data(run('work', 'context-pack', '--work', 'pending-work', '--json')).nextAction, 'resolve_blocker');
  fail(run('work', 'start', '--work', 'pending-work', '--task', 'W1', '--expect-revision', '2', '--json'), 'STATE_DIVERGED', /pending promotion/);
  writeFileSync(join(root, 'pending-amend.md'), '# Pending amendment\n\nBlocked by the promotion intent.\n');
  fail(run('work', 'amend-brief', '--work', 'pending-work', '--from', 'pending-amend.md', '--reason', 'Blocked.', '--expect-revision', '2', '--by', 'fixture-owner', '--json'), 'STATE_DIVERGED', /pending promotion/);
  const recoveredPending = data(run(...applyArgs('pending-work', 'pending-target', 2)));
  assert.equal(recoveredPending.revision, 3);
  assert.equal(recoveredPending.recovered, true, 'a matching retry must complete the transaction');
  assert(!existsSync(journalPathFor('pending-work')), 'recovery must clear the intent');

  // Every injected publication boundary is resumable by an exact retry.
  const boundaries = ['promote-before-journal', 'promote-after-journal', 'promote-during-stage', 'promote-after-stage', 'promote-after-work', 'promote-before-target-rename', 'promote-after-target-rename', 'promote-after-target', 'promote-before-cleanup'];
  for (const [index, boundary] of boundaries.entries()) {
    const id = `boundary-${index}`;
    const scope = `boundary-scope-${index}`;
    planSimpleWork(id);
    failInternal(applyWithInjection(id, scope, 2, boundary), boundary);
    if (boundary === 'promote-before-journal') assert(!existsSync(journalPathFor(id)), `${boundary} must record no intent`);
    else assert(existsSync(journalPathFor(id)), `${boundary} must leave an intent`);
    if (boundary === 'promote-during-stage') assert(!existsSync(join(root, '.agents/kyro/work', id, '.promotion-stage', scope)), 'a partial stage must never become the named staged destination');
    const targetDirectory = join(root, '.agents/kyro/scopes', scope);
    if (boundary === 'promote-before-target-rename') {
      assert(!existsSync(targetDirectory), 'Forge must not discover a scope before the atomic rename');
      assert.notEqual(run('status', 'full', '--kyro-scope', scope, '--json').status, 0, 'Forge status must not route to an unpublished target');
    }
    if (boundary === 'promote-after-target-rename') {
      for (const name of ['sprint.json', 'promotion-source.json', 'promotion-initial-sprint.json']) {
        assert(existsSync(join(targetDirectory, name)), `the visible scope must contain ${name} immediately after the rename`);
      }
      assert.equal(run('status', 'full', '--kyro-scope', scope, '--json').status, 0, 'Forge status must discover only the complete target directory');
    }
    const recovered = data(run(...applyArgs(id, scope, 2)));
    assert.equal(recovered.state, 'promoted', `${boundary} retry must promote`);
    assert(!existsSync(journalPathFor(id)), `${boundary} retry must clear the intent`);
    assert.deepEqual(workSchema.validateWorkFile(JSON.parse(readFileSync(workPathFor(id), 'utf8')), workPathFor(id)), [], `${boundary} recovery must leave a valid Work`);
    assert.deepEqual(forgeSchema.validateSprintFile(JSON.parse(readFileSync(join(root, '.agents/kyro/scopes', scope, 'sprint.json'), 'utf8')), `${scope}/sprint.json`), [], `${boundary} recovery must publish a valid scope`);
    assert.deepEqual(workSchema.validatePromotionSidecar(JSON.parse(readFileSync(join(root, '.agents/kyro/scopes', scope, 'promotion-source.json'), 'utf8'))), [], `${boundary} recovery must publish a valid link`);
  }

  // Conflicting retry, corrupt journal, changed brief, and edited Work fail closed.
  planSimpleWork('conflict-work');
  failInternal(applyWithInjection('conflict-work', 'conflict-target', 2, 'promote-after-journal'), 'conflict setup');
  const conflictBefore = readFileSync(workPathFor('conflict-work'));
  fail(run(...applyArgs('conflict-work', 'conflict-target', 2, 'other-owner')), 'STATE_DIVERGED', /does not match/);
  assert.deepEqual(readFileSync(workPathFor('conflict-work')), conflictBefore, 'a conflicting retry must not overwrite the intent');
  data(run(...applyArgs('conflict-work', 'conflict-target', 2)));
  planSimpleWork('corrupt-work');
  failInternal(applyWithInjection('corrupt-work', 'corrupt-target', 2, 'promote-after-journal'), 'corrupt setup');
  const corruptBefore = readFileSync(workPathFor('corrupt-work'));
  writeFileSync(journalPathFor('corrupt-work'), '{broken');
  fail(run(...applyArgs('corrupt-work', 'corrupt-target', 2)), 'STATE_DIVERGED', /unreadable|invalid/);
  assert.deepEqual(readFileSync(workPathFor('corrupt-work')), corruptBefore, 'a corrupt journal must not publish Work');
  planSimpleWork('brief-change-work');
  failInternal(applyWithInjection('brief-change-work', 'brief-change-target', 2, 'promote-after-journal'), 'brief setup');
  const briefChangePath = join(root, '.agents/kyro/work/brief-change-work/brief.md');
  const briefChangeBefore = readFileSync(briefChangePath);
  writeFileSync(briefChangePath, '# Changed outside CLI\n\nNot authoritative.\n');
  fail(run(...applyArgs('brief-change-work', 'brief-change-target', 2)), 'STATE_DIVERGED', /brief changed/);
  writeFileSync(briefChangePath, briefChangeBefore);
  data(run(...applyArgs('brief-change-work', 'brief-change-target', 2)));
  planSimpleWork('edited-work');
  failInternal(applyWithInjection('edited-work', 'edited-target', 2, 'promote-after-journal'), 'edit setup');
  const editedBefore = readFileSync(workPathFor('edited-work'));
  const editedDoc = JSON.parse(editedBefore.toString('utf8'));
  editedDoc.title = 'Hand-edited title';
  writeFileSync(workPathFor('edited-work'), `${JSON.stringify(editedDoc, null, 2)}\n`);
  fail(run(...applyArgs('edited-work', 'edited-target', 2)), 'STATE_DIVERGED', /recoverable publication boundary/);
  writeFileSync(workPathFor('edited-work'), editedBefore);
  data(run(...applyArgs('edited-work', 'edited-target', 2)));
  planSimpleWork('staged-tamper-work');
  failInternal(applyWithInjection('staged-tamper-work', 'staged-tamper-target', 2, 'promote-after-stage'), 'staged tamper setup');
  const stagedTamperPath = join(root, '.agents/kyro/work/staged-tamper-work/.promotion-stage/staged-tamper-target/promotion-initial-sprint.json');
  const stagedTamperBefore = readFileSync(stagedTamperPath);
  const stagedTamperWorkBefore = readFileSync(workPathFor('staged-tamper-work'));
  writeFileSync(stagedTamperPath, '{tampered');
  fail(run(...applyArgs('staged-tamper-work', 'staged-tamper-target', 2)), 'STATE_DIVERGED', /Staged promotion destination differs/);
  assert(!existsSync(join(root, '.agents/kyro/scopes/staged-tamper-target')), 'tampered staging must not publish a scope');
  assert.deepEqual(readFileSync(workPathFor('staged-tamper-work')), stagedTamperWorkBefore, 'tampered staging must not rewrite Work');
  writeFileSync(stagedTamperPath, stagedTamperBefore);
  data(run(...applyArgs('staged-tamper-work', 'staged-tamper-target', 2)));
  planSimpleWork('terminal-work');
  data(run('work', 'start', '--work', 'terminal-work', '--task', 'W1', '--expect-revision', '2', '--json'));
  data(run('work', 'record-evidence', '--work', 'terminal-work', '--task', 'W1', '--from', 'evidence.json', '--by', 'fixture-maker', '--expect-revision', '3', '--json'));
  writeFileSync(join(root, 'review-terminal.json'), JSON.stringify({ checkedCriteria: ['Output is transferred.'], findings: [] }));
  data(run('work', 'review', '--work', 'terminal-work', '--task', 'W1', '--from', 'review-terminal.json', '--verdict', 'pass', '--by', 'fixture-checker', '--expect-revision', '4', '--json'));
  fail(run(...applyArgs('terminal-work', 'terminal-target', 5)), 'INVALID_INPUT', /no transferable/);
  assert(!existsSync(journalPathFor('terminal-work')), 'a refused apply must record no intent');

  // Target collision at apply and tampering after publication fail closed.
  planSimpleWork('collision-work');
  mkdirSync(join(root, '.agents/kyro/scopes/collision-target'), { recursive: true });
  writeFileSync(join(root, '.agents/kyro/scopes/collision-target/sprint.json'), '{"unrelated":true}\n');
  fail(run(...applyArgs('collision-work', 'collision-target', 2)), 'CHECKPOINT_CONFLICT', /already exists/);
  assert(!existsSync(journalPathFor('collision-work')), 'a target collision must record no intent');
  planSimpleWork('tamper-work');
  failInternal(applyWithInjection('tamper-work', 'tamper-target', 2, 'promote-after-target'), 'tamper setup');
  const tamperSprintPath = join(root, '.agents/kyro/scopes/tamper-target/sprint.json');
  const tamperBytes = readFileSync(tamperSprintPath);
  const tamperDoc = JSON.parse(tamperBytes.toString('utf8'));
  tamperDoc.title = 'Tampered title';
  writeFileSync(tamperSprintPath, `${JSON.stringify(tamperDoc, null, 2)}\n`);
  const tamperWorkBefore = readFileSync(workPathFor('tamper-work'));
  fail(run(...applyArgs('tamper-work', 'tamper-target', 2)), 'CHECKPOINT_CONFLICT', /differs from its pending intent/);
  assert.deepEqual(readFileSync(workPathFor('tamper-work')), tamperWorkBefore, 'a tampered target must not rewrite the Work');
  assert(existsSync(journalPathFor('tamper-work')), 'a tampered target must keep the intent until the destination is restored');

  // Pending intent is git-ignored; final Work and reciprocal link stay trackable.
  const git = (...args) => spawnSync('git', args, { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(git('check-ignore', '-q', '.agents/kyro/work/demo/.pending-promotion.json').status, 0, 'the pending journal must be ignored by Git');
  assert.equal(git('check-ignore', '-q', '.agents/kyro/work/demo/.promotion-stage/demo/sprint.json').status, 0, 'staged scratch must be ignored by Git');
  assert.equal(git('check-ignore', '-q', '.agents/kyro/work/demo/work.json').status, 1, 'the final Work must stay trackable');
  assert.equal(git('check-ignore', '-q', '.agents/kyro/scopes/demo/promotion-source.json').status, 1, 'the reciprocal link must stay trackable');
  assert.equal(git('check-ignore', '-q', '.agents/kyro/scopes/demo/promotion-initial-sprint.json').status, 1, 'the immutable origin copy must stay trackable');
  forgeUnchanged('promotion commit and recovery');
  console.log('Work promotion commit and recovery fixtures passed.');

  // --- T4.5 reciprocal diagnostics: status and doctor fail closed on broken links ---
  planSimpleWork('diagnosed-work');
  data(run(...applyArgs('diagnosed-work', 'diagnosed-target', 2)));
  const diagnosedPaths = {
    sidecar: join(root, '.agents/kyro/scopes/diagnosed-target/promotion-source.json'),
    origin: join(root, '.agents/kyro/scopes/diagnosed-target/promotion-initial-sprint.json'),
    sprint: join(root, '.agents/kyro/scopes/diagnosed-target/sprint.json'),
    work: workPathFor('diagnosed-work'),
  };
  const diagnosedBefore = Object.fromEntries(Object.entries(diagnosedPaths).map(([key, entry]) => [key, readFileSync(entry)]));
  const diagnosedStatus = () => data(run('work', 'status', '--work', 'diagnosed-work', '--json'));
  assert.equal(diagnosedStatus().nextAction, 'done', 'a verified promotion must read as done');
  writeFileSync(join(root, '.agents/kyro/project.json'), JSON.stringify({ schemaVersion: 4, artifactRoot: '.agents/kyro/scopes' }, null, 2) + '\n');
  writeFileSync(join(root, '.agents/kyro/local.json'), JSON.stringify({ schemaVersion: 4, activeScope: null, installedAdapters: [] }, null, 2) + '\n');
  // The doctor setup above intentionally replaces the sentinel project layers;
  // re-baseline so later sections still prove byte isolation from here on.
  forgeBefore = forgeSentinels.map((entry) => readFileSync(join(root, entry)));
  const doctorChecks = () => {
    const result = spawnSync(process.execPath, [cli, 'doctor', '--artifacts', '--json'], { cwd: root, encoding: 'utf8' });
    // Doctor exits nonzero when unrelated sentinel scopes fail and wraps its
    // human-readable lines in the envelope; parse the [STATUS] line format.
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.ok, true);
    const lines = envelope.data.output ?? envelope.data.checks ?? envelope.data;
    assert(Array.isArray(lines), 'doctor must report output lines');
    return lines.map((line) => String(line));
  };
  const doctorWork = (id) => {
    const lines = doctorChecks();
    const index = lines.findIndex((line) => line.includes(`Work ${id} promotion:`));
    assert.notEqual(index, -1, `doctor must report Work ${id} promotion`);
    const status = lines[index].startsWith('[PASS]') ? 'pass' : lines[index].startsWith('[FAIL]') ? 'fail' : 'warn';
    const detail = lines[index];
    const remedy = lines[index + 1] && lines[index + 1].startsWith('Remedy:') ? lines[index + 1] : '';
    return { status, detail, remedy };
  };
  assert.equal(doctorWork('diagnosed-work').status, 'pass', 'doctor must verify a healthy promotion link');
  const forgeProgress = run('record-evidence', 'T1.1', '--kyro-scope', 'diagnosed-target', '--summary', 'Completed the promoted task.', '--validation', 'fixture validation passed', '--by', 'forge-maker', '--json');
  data(forgeProgress);
  assert.equal(diagnosedStatus().nextAction, 'done', 'ordinary Forge CLI progress must not invalidate promotion provenance');
  assert.equal(doctorWork('diagnosed-work').status, 'pass', 'doctor must accept a valid progressed Forge sprint');
  const breakLink = (label, mutate, pattern) => {
    mutate();
    const status = diagnosedStatus();
    assert.equal(status.nextAction, 'resolve_blocker', `${label} must read as a blocker, never done`);
    assert.match(status.blockedReason, pattern, `${label} must name the defect`);
    const check = doctorWork('diagnosed-work');
    assert.equal(check.status, 'fail', `${label} must fail the doctor audit`);
    assert.match(check.detail, pattern, `${label} doctor detail must name the defect`);
    assert.match(check.remedy, /CLI-published|retry|repair/i, `${label} doctor must carry a concrete remedy`);
    assert.deepEqual(readFileSync(diagnosedPaths.work), diagnosedBefore.work, `${label} must not rewrite the Work while reporting`);
  };
  const restoreLink = () => {
    writeFileSync(diagnosedPaths.sidecar, diagnosedBefore.sidecar);
    writeFileSync(diagnosedPaths.origin, diagnosedBefore.origin);
    writeFileSync(diagnosedPaths.sprint, diagnosedBefore.sprint);
  };
  rmSync(diagnosedPaths.sidecar);
  breakLink('missing link', () => {}, /reciprocal target link is missing/);
  restoreLink();
  writeFileSync(diagnosedPaths.sidecar, '{broken');
  breakLink('corrupt link', () => {}, /unreadable/);
  restoreLink();
  rmSync(diagnosedPaths.origin);
  breakLink('missing origin', () => {}, /promotion origin is missing/);
  restoreLink();
  writeFileSync(diagnosedPaths.origin, '{broken');
  breakLink('corrupt origin', () => {}, /promotion origin is missing or its digest disagrees/);
  restoreLink();
  const invalidSprint = JSON.parse(diagnosedBefore.sprint.toString('utf8'));
  invalidSprint.scope = 'different-scope';
  writeFileSync(diagnosedPaths.sprint, `${JSON.stringify(invalidSprint, null, 2)}\n`);
  breakLink('invalid current Forge scope', () => {}, /current Forge sprint has invalid shape or scope identity/);
  restoreLink();
  const tamperedSidecar = JSON.parse(diagnosedBefore.sidecar.toString('utf8'));
  tamperedSidecar.sourceDigest = createHash('sha256').update('foreign').digest('hex');
  writeFileSync(diagnosedPaths.sidecar, `${JSON.stringify(tamperedSidecar, null, 2)}\n`);
  breakLink('mismatched link digest', () => {}, /disagrees on source digest/);
  restoreLink();
  for (const [field, replacement, diagnostic] of [
    ['sourcePath', '.agents/kyro/work/foreign/work.json', /disagrees on source path/],
    ['actor', 'other-actor', /disagrees on actor/],
    ['promotedAt', '2026-01-02T00:00:00.000Z', /disagrees on promoted timestamp/],
    ['preparedAt', '2026-01-02T00:00:00.000Z', /disagrees on prepared timestamp/],
    ['requestDigest', createHash('sha256').update('foreign request').digest('hex'), /disagrees on request digest/],
  ]) {
    const altered = JSON.parse(diagnosedBefore.sidecar.toString('utf8'));
    altered[field] = replacement;
    writeFileSync(diagnosedPaths.sidecar, `${JSON.stringify(altered, null, 2)}\n`);
    breakLink(`schema-valid ${field} substitution`, () => {}, diagnostic);
    restoreLink();
  }
  assert.equal(diagnosedStatus().nextAction, 'done', 'restored link material must read as done again');
  assert.equal(doctorWork('diagnosed-work').status, 'pass', 'restored link material must pass doctor again');
  planSimpleWork('diagnosed-pending');
  failInternal(applyWithInjection('diagnosed-pending', 'diagnosed-pending-target', 2, 'promote-after-journal'), 'diagnostic pending setup');
  const diagnosedPendingStatus = data(run('work', 'status', '--work', 'diagnosed-pending', '--json'));
  assert.equal(diagnosedPendingStatus.nextAction, 'resolve_blocker');
  assert.match(diagnosedPendingStatus.blockedReason, /pending promotion/);
  const pendingCheck = doctorWork('diagnosed-pending');
  assert.equal(pendingCheck.status, 'fail', 'a pending intent must fail the doctor audit, never read healthy');
  assert.match(pendingCheck.detail, /pending promotion/);
  data(run(...applyArgs('diagnosed-pending', 'diagnosed-pending-target', 2)));
  assert.equal(doctorWork('diagnosed-pending').status, 'pass', 'a recovered promotion must pass doctor again');
  console.log('Work promotion reciprocal diagnostic fixtures passed.');

  // --- T4.6 two-clone divergence, symlink escape, and apply-level guards ---
  fail(run(...applyArgs('collision-work', '../escape', 2)), 'INVALID_INPUT', /unsafe/);
  assert(!existsSync(journalPathFor('collision-work')), 'an unsafe target must record no intent');
  mkdirSync(join(root, 'outside-link'), { recursive: true });
  symlinkSync(join(root, 'outside-link'), join(root, '.agents/kyro/scopes/linked-target'));
  fail(run('work', 'promote', '--work', 'collision-work', '--to-scope', 'linked-target', '--expect-revision', '2', '--by', 'fixture-owner', '--dry-run', '--json'), 'INVALID_INPUT', /symbolic link/);
  rmSync(join(root, '.agents/kyro/scopes/linked-target'));
  const cloneA = mkdtempSync(join(tmpdir(), 'kyro-clone-a-'));
  const cloneB = mkdtempSync(join(tmpdir(), 'kyro-clone-b-'));
  try {
    const runIn = (cwd, ...args) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });
    const dataIn = (cwd, ...args) => {
      const result = runIn(cwd, ...args);
      assert.equal(result.status, 0, `clone CLI status=${result.status}, output=${(result.stderr || result.stdout).slice(0, 400)}`);
      return JSON.parse(result.stdout).data;
    };
    const briefText = '# Clone fixture\n\nProve two clones stay independent and diverged same-ID promotion fails.\n';
    for (const clone of [cloneA, cloneB]) writeFileSync(join(clone, 'brief.md'), briefText);
    dataIn(cloneA, 'work', 'create', '--id', 'clone-work', '--from', 'brief.md', '--json');
    writeFileSync(join(cloneA, 'plan.json'), JSON.stringify({ tasks: [
      { id: 'W1', title: 'Clone task one', description: 'First clone task.', context: '', filesToTouch: [], acceptanceCriteria: ['First is transferred.'], dependsOn: [] },
      { id: 'W2', title: 'Clone task two', description: 'Second clone task.', context: '', filesToTouch: [], acceptanceCriteria: ['Second is transferred.'], dependsOn: [] },
    ] }));
    dataIn(cloneA, 'work', 'plan', '--work', 'clone-work', '--from', 'plan.json', '--expect-revision', '1', '--json');
    dataIn(cloneA, 'work', 'promote', '--work', 'clone-work', '--to-scope', 'shared-target', '--expect-revision', '2', '--by', 'clone-owner', '--yes', '--json');
    assert.equal(dataIn(cloneA, 'work', 'status', '--work', 'clone-work', '--json').nextAction, 'done');
    // A diverged same-ID Work transplanted into the clone fails by digest, not by merge.
    dataIn(cloneB, 'work', 'create', '--id', 'clone-work', '--from', 'brief.md', '--json');
    writeFileSync(join(cloneB, 'plan-b.json'), JSON.stringify({ tasks: [
      { id: 'W1', title: 'Diverged task', description: 'A different plan under the same ID.', context: '', filesToTouch: [], acceptanceCriteria: ['Divergence is detected.'], dependsOn: [] },
    ] }));
    dataIn(cloneB, 'work', 'plan', '--work', 'clone-work', '--from', 'plan-b.json', '--expect-revision', '1', '--json');
    const promotedA = readFileSync(join(cloneA, '.agents/kyro/work/clone-work/work.json'));
    writeFileSync(join(cloneB, '.agents/kyro/work/clone-work/work.json'), promotedA);
    writeFileSync(join(cloneB, '.agents/kyro/work/clone-work/brief.md'), `${briefText}\nDiverged clone outcome.\n`);
    const divergedStatus = JSON.parse(runIn(cloneB, 'work', 'status', '--work', 'clone-work', '--json').stdout);
    assert.equal(divergedStatus.ok, true);
    assert.equal(divergedStatus.data.nextAction, 'resolve_blocker', 'a transplanted same-ID state must read as blocked on digest mismatch');
    assert.match(divergedStatus.data.blockedReason, /digest does not match/);
    const divergedPromote = runIn(cloneB, 'work', 'promote', '--work', 'clone-work', '--to-scope', 'other-target', '--expect-revision', '3', '--by', 'clone-owner', '--dry-run', '--json');
    assert.notEqual(divergedPromote.status, 0, 'a diverged same-ID promotion must fail');
    // A colliding target scope in the clone fails without merging approvals.
    mkdirSync(join(cloneB, '.agents/kyro/scopes/shared-target'), { recursive: true });
    rmSync(join(cloneB, '.agents/kyro/work/clone-work/work.json'));
    dataIn(cloneB, 'work', 'create', '--id', 'clone-fresh', '--from', 'brief.md', '--json');
    dataIn(cloneB, 'work', 'plan', '--work', 'clone-fresh', '--from', 'plan-b.json', '--expect-revision', '1', '--json');
    writeFileSync(join(cloneB, '.agents/kyro/scopes/shared-target/sprint.json'), '{"foreign":true}\n');
    const collided = runIn(cloneB, 'work', 'promote', '--work', 'clone-fresh', '--to-scope', 'shared-target', '--expect-revision', '2', '--by', 'clone-owner', '--yes', '--json');
    assert.notEqual(collided.status, 0, 'a colliding target must fail closed');
    assert.match(JSON.parse(collided.stdout).error.message, /already exists/);
    // Two distinct Work IDs across clones stay independent and healthy.
    dataIn(cloneB, 'work', 'promote', '--work', 'clone-fresh', '--to-scope', 'clone-fresh-target', '--expect-revision', '2', '--by', 'clone-owner', '--yes', '--json');
    assert.equal(dataIn(cloneB, 'work', 'status', '--work', 'clone-fresh', '--json').nextAction, 'done');
    assert.equal(dataIn(cloneA, 'work', 'status', '--work', 'clone-work', '--json').nextAction, 'done', 'the first clone must stay healthy');
  } finally {
    rmSync(cloneA, { recursive: true, force: true });
    rmSync(cloneB, { recursive: true, force: true });
  }
  forgeUnchanged('two-clone certification');
  console.log('Work promotion two-clone and escape fixtures passed.');
} finally { rmSync(root, { recursive: true, force: true }); }
