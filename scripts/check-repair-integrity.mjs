#!/usr/bin/env node
/**
 * Integrity repair: warrant-first resume, fail-closed prepare, overlay commitment, portable fixtures.
 */
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(fileURLToPath(import.meta.url), '../..');
const cli = resolve(repo, 'dist/cli.js');
const require = createRequire(import.meta.url);
const { executeRemediationOperations } = require(join(repo, 'dist/cli/remediation/plan.js'));
const { deriveSprintCloseTransition } = require(join(repo, 'dist/cli/checkpoints/sprint-close.js'));
const family = JSON.parse(readFileSync(join(repo, 'fixtures/integrity-repair/family.json'), 'utf8'));

let passed = 0;
function assert(condition, message) {
  if (!condition) throw new Error(message);
  passed += 1;
}

function run(cwd, args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', env: process.env });
}

function sha256(value) {
  const input = typeof value === 'string' ? value : JSON.stringify(value);
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value);
}

function makeActive(n, slug) {
  return {
    n,
    slug,
    title: slug,
    objective: 'Close the sprint.',
    status: 'complete',
    phases: [{
      id: 'P1',
      title: 'Phase',
      objective: 'Complete work.',
      status: 'done',
      tasks: [{
        id: 'T1.1',
        title: 'Implement',
        description: 'Implement the task.',
        files_to_touch: ['src/demo.ts'],
        context: 'Use the existing pattern.',
        acceptance_criteria: ['Validation passes.'],
        depends_on: [],
        status: 'done',
        evidence: {
          summary: 'done',
          validation: 'ok',
          files_changed: ['src/demo.ts'],
          notes: '',
          by: 'maker',
          recordedAt: '2026-01-01T00:00:00.000Z',
        },
        verdict: {
          result: 'pass',
          checked_criteria: ['Validation passes.'],
          findings: [],
          by: 'checker',
          reviewedAt: '2026-01-01T00:00:01.000Z',
        },
      }],
    }],
    emergentTasks: [],
    definitionOfDone: ['All tasks done.'],
  };
}

function makeSprint(scope, n, slug, extras = {}) {
  const active = extras.activeSprint === undefined ? makeActive(n, slug) : extras.activeSprint;
  return {
    schemaVersion: 4,
    scope,
    title: extras.title ?? scope,
    status: extras.status ?? (active ? 'active' : 'completed'),
    objective: extras.objective ?? 'Objective',
    successCriteria: extras.successCriteria ?? ['Works.'],
    clarifications: extras.clarifications ?? [],
    conventions: extras.conventions ?? [],
    roadmap: extras.roadmap ?? {
      plannedSprintCount: n,
      sizingRationale: 'Enough.',
      sprints: [{ n, slug, title: slug, state: active ? 'active' : 'completed' }],
    },
    ledger: extras.ledger ?? [],
    previousSprint: extras.previousSprint ?? null,
    activeSprint: active,
    debt: extras.debt ?? [],
    handoff: extras.handoff ?? {
      nextAction: active ? 'close_sprint' : 'done',
      nextTaskId: active ? 'T1.1' : null,
      blockers: [],
      note: 'Resume.',
      lastUpdated: '2026-01-01',
    },
    ...(extras.adrs ? { adrs: extras.adrs } : {}),
    ...(extras.remediations ? { remediations: extras.remediations } : {}),
  };
}

function materializeLegacyCheckpoint(root, scope, n, slug) {
  const pad = String(n).padStart(3, '0');
  const base = `sprint-${pad}-${slug}`;
  const archiveRel = `.agents/kyro/scopes/${scope}/archive/${base}`;
  const checkpointPath = join(root, `${archiveRel}.checkpoint.json`);
  const snapshotPath = join(root, `${archiveRel}.json`);
  const narrativePath = join(root, `${archiveRel}.md`);
  const active = makeActive(n, slug);
  const before = makeSprint(scope, n, slug, { activeSprint: active, status: 'active' });
  const close = { outcome: 'shipped', note: null, summary: 'Closed.', recommendations: [], learnings: [] };
  const createdAt = '2026-01-01T00:00:00.000Z';
  const derived = deriveSprintCloseTransition(
    before,
    { id: scope, title: scope, status: 'active' },
    close,
    createdAt,
    `${archiveRel}.json`,
    `${archiveRel}.md`,
    `${archiveRel}.checkpoint.json`,
  );
  const after = derived.intendedAfterClose;
  const last = after.ledger[after.ledger.length - 1];
  if (last) last.checkpointSha256 = '0'.repeat(64);
  const checkpoint = {
    schemaVersion: 1,
    kind: 'kyro.sprint-close-checkpoint',
    checkpointId: sha256(`${scope}\0${n}\0${slug}`),
    createdAt,
    identity: { scope, sprintN: n, sprintSlug: slug },
    close,
    paths: { legacySnapshot: `${archiveRel}.json`, narrative: `${archiveRel}.md` },
    beforeClose: before,
    intendedAfterClose: after,
    projectScopeBefore: { id: scope, title: scope, status: 'active' },
    projectScopeAfter: derived.projectScopeAfter,
    digests: {
      beforeClose: '0'.repeat(64),
      intendedAfterClose: '0'.repeat(64),
      projectScopeBefore: '0'.repeat(64),
      projectScopeAfter: '0'.repeat(64),
      legacySnapshot: '0'.repeat(64),
      narrative: '0'.repeat(64),
    },
  };
  writeJson(checkpointPath, checkpoint);
  writeText(snapshotPath, `${JSON.stringify(active, null, 2)}\n`);
  writeText(narrativePath, `# Sprint ${n}: ${slug}\n\n## Objective\n\nClose the sprint.\n`);
  return { checkpoint, after, checkpointPath, snapshotPath, narrativePath, archiveRel };
}

function writeProject(root, scopes, activeScope = '') {
  writeJson(join(root, '.agents/kyro/project.json'), {
    schemaVersion: 4,
    artifactRoot: '.agents/kyro/scopes',
    scopes,
  });
  writeJson(join(root, '.agents/kyro/local.json'), {
    schemaVersion: 4,
    activeScope,
    installedAdapters: [],
  });
}

function registrySandbox() {
  const root = mkdtempSync(join(tmpdir(), 'kyro-integrity-'));
  writeProject(root, [
    { id: 'present', title: 'Present', status: 'completed' },
    { id: 'ghost', title: 'Ghost', status: 'completed', legacyOnly: { owner: 'historical' } },
  ], 'ghost');
  const demo = JSON.parse(readFileSync(join(repo, 'fixtures/evals/close-sprint-happy/state/.agents/kyro/scopes/demo/sprint.json'), 'utf8'));
  writeJson(join(root, '.agents/kyro/scopes/present/sprint.json'), { ...demo, scope: 'present', title: 'Present' });
  writeJson(join(root, '.agents/kyro/scopes/disk-only/sprint.json'), { ...demo, scope: 'disk-only', title: 'Disk Only' });
  return root;
}

function legacyCompletionSandbox() {
  const root = mkdtempSync(join(tmpdir(), 'kyro-legacy-completion-'));
  const scope = 'legacy-completion';
  writeJson(join(root, '.agents/kyro/kyro.json'), {
    schemaVersion: 4,
    artifactRoot: '.agents/kyro/scopes',
    scopes: [{ id: scope, title: scope, status: 'planning' }],
    activeScope: scope,
    runtimePath: '~/.agents/kyro/current',
    installedAdapters: [],
  });
  writeJson(join(root, `.agents/kyro/scopes/${scope}/sprint.json`), makeSprint(scope, 1, scope));
  const close = run(root, ['close-sprint', '--kyro-scope', scope, '--outcome', 'shipped', '--yes']);
  if (close.status !== 0) throw new Error(`fixture close failed: ${close.stderr}\n${close.stdout}`);
  const sprintPath = join(root, `.agents/kyro/scopes/${scope}/sprint.json`);
  const closedSprint = readFileSync(sprintPath);
  const completion = run(root, ['scope', 'complete', '--kyro-scope', scope, '--summary', 'Legacy completion.', '--yes']);
  if (completion.status !== 0) throw new Error(`fixture completion failed: ${completion.stderr}\n${completion.stdout}`);
  const projectPath = join(root, '.agents/kyro/project.json');
  const project = JSON.parse(readFileSync(projectPath, 'utf8'));
  const completedSprint = JSON.parse(readFileSync(sprintPath, 'utf8'));
  const legacyEntry = {
    id: scope,
    title: completedSprint.title,
    status: 'completed',
    completion: completedSprint.completion,
  };
  if (!legacyEntry.completion) throw new Error('fixture did not persist the completion');
  project.scopes = [legacyEntry];
  writeJson(projectPath, project);
  // Recreate the old partial-write state: registry completion exists, sprint completion is absent.
  writeFileSync(sprintPath, closedSprint);
  return { root, scope, completion: legacyEntry.completion };
}

function main() {
  if (!existsSync(cli)) throw new Error('dist/cli.js missing; run npm run build first');
  const identities = family.scopes.flatMap((scope) => scope.sprints.map((sprint) => ({ scope: scope.id, ...sprint })));
  assert(identities.length === 11, `family must list 11 checkpoints, got ${identities.length}`);

  const root = registrySandbox();
  try {
    const beforeProject = readFileSync(join(root, '.agents/kyro/project.json'));
    const prep = run(root, ['repair', 'integrity', 'prepare', '--json', '--reason', 'directory absent']);
    assert(prep.status === 0, `prepare failed: ${prep.stderr}\n${prep.stdout}`);
    const plan = JSON.parse(prep.stdout).data;
    assert(typeof plan.digest === 'string' && plan.digest.length === 64, 'prepare digest');
    assert(plan.targets.register.length === 0 && plan.targets.unregister.length === 0,
      'disk-derived identity needs no shared registry repair');
    assert(plan.blockers.some((blocker) => blocker.code === 'legacy-registered-orphan' && blocker.summary.includes('ghost')),
      'orphaned legacy scope remains a visible blocker');
    assert(readFileSync(join(root, '.agents/kyro/project.json')).equals(beforeProject), 'prepare is read-only');
    const listed = run(root, ['scope', 'list']);
    assert(listed.status === 0 && listed.stdout.includes('disk-only') && !listed.stdout.includes('ghost'),
      'valid disk scope is visible and stale shared-only scope is absent');
    const reason = 'scope was permanently removed outside Kyro';
    const explicit = run(root, ['repair', 'integrity', 'prepare', '--kyro-scope', 'ghost', '--reason', reason, '--json']);
    assert(explicit.status === 0, `explicit legacy discard prepare failed: ${explicit.stderr}\n${explicit.stdout}`);
    const discard = JSON.parse(explicit.stdout).data;
    const operation = discard.operations.find((item) => item.kind === 'legacy-scope.discard');
    assert(operation?.sourcePath === '.agents/kyro/project.json' && operation.entry.legacyOnly.owner === 'historical',
      'preview binds the raw source and complete custom legacy entry');
    const denied = run(root, ['repair', 'integrity', 'apply', '--kyro-scope', 'ghost', '--reason', reason, '--digest', discard.digest]);
    assert(denied.status !== 0 && readFileSync(join(root, '.agents/kyro/project.json')).equals(beforeProject),
      'discard requires explicit --yes');
    const changed = JSON.parse(beforeProject.toString('utf8'));
    changed.scopes[1].legacyOnly.owner = 'changed';
    writeJson(join(root, '.agents/kyro/project.json'), changed);
    const stale = run(root, ['repair', 'integrity', 'apply', '--kyro-scope', 'ghost', '--reason', reason, '--digest', discard.digest, '--yes']);
    assert(stale.status !== 0 && readFileSync(join(root, '.agents/kyro/project.json'), 'utf8').includes('changed'),
      'approved digest rejects changes to raw legacy metadata');
    writeFileSync(join(root, '.agents/kyro/project.json'), beforeProject);
    const applied = run(root, ['repair', 'integrity', 'apply', '--kyro-scope', 'ghost', '--reason', reason, '--digest', discard.digest, '--yes']);
    assert(applied.status === 0, `explicit legacy discard apply failed: ${applied.stderr}\n${applied.stdout}`);
    const afterProject = JSON.parse(readFileSync(join(root, '.agents/kyro/project.json'), 'utf8'));
    const afterLocal = JSON.parse(readFileSync(join(root, '.agents/kyro/local.json'), 'utf8'));
    assert(afterProject.scopes.length === 1 && afterProject.scopes[0].id === 'present' && afterLocal.activeScope === '',
      'discard removes only the approved raw entry and clears stale personal selection');
    const evidenceDir = join(root, '.agents/kyro/registry-reconciliations');
    const evidence = JSON.parse(readFileSync(join(evidenceDir, readdirSync(evidenceDir)[0]), 'utf8'));
    assert(evidence.retiredEntry.legacyOnly.owner === 'historical' && evidence.sourcePath === operation.sourcePath,
      'immutable reconciliation evidence preserves the full retired entry');
    const retry = run(root, ['repair', 'integrity', 'apply', '--kyro-scope', 'ghost', '--reason', reason, '--digest', discard.digest, '--yes']);
    assert(retry.status === 0 && readdirSync(evidenceDir).length === 1,
      `approved discard retry is idempotent: ${retry.stderr}\n${retry.stdout}`);
    writeText(join(evidenceDir, 'reconciliation-001.json'), '{broken');
    const brokenEvidenceRetry = run(root, ['repair', 'integrity', 'apply', '--kyro-scope', 'ghost', '--reason', reason, '--digest', discard.digest, '--yes']);
    assert(brokenEvidenceRetry.status !== 0 && /DIVERGED/.test(`${brokenEvidenceRetry.stdout}\n${brokenEvidenceRetry.stderr}`)
      && readdirSync(evidenceDir).length === 1, 'corrupt reconciliation evidence fails closed without publishing another record');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  const damagedRoot = registrySandbox();
  try {
    writeText(join(damagedRoot, '.agents/kyro/scopes/ghost/sprint.json'), '{broken');
    const prep = run(damagedRoot, ['repair', 'integrity', 'prepare', '--kyro-scope', 'ghost', '--reason', 'discard', '--json']);
    assert(prep.status === 0, `damaged scope prepare failed: ${prep.stderr}\n${prep.stdout}`);
    const plan = JSON.parse(prep.stdout).data;
    assert(plan.operations.every((item) => item.kind !== 'legacy-scope.discard') && plan.blockers.length > 0,
      'Kyro-owned damaged scope cannot be discarded');
  } finally {
    rmSync(damagedRoot, { recursive: true, force: true });
  }

  const forgedRoot = registrySandbox();
  try {
    const reason = 'scope permanently removed';
    const prep = run(forgedRoot, ['repair', 'integrity', 'prepare', '--kyro-scope', 'ghost', '--reason', reason, '--json']);
    assert(prep.status === 0, `forged-evidence prepare failed: ${prep.stderr}\n${prep.stdout}`);
    const plan = JSON.parse(prep.stdout).data;
    const operation = plan.operations.find((item) => item.kind === 'legacy-scope.discard');
    writeJson(join(forgedRoot, '.agents/kyro/registry-reconciliations/reconciliation-001.json'), {
      schemaVersion: 1, kind: 'unrelated.record', id: 'reconciliation-001',
      sourcePath: operation.sourcePath, beforeDigest: operation.sourceSha256, afterDigest: operation.afterSha256,
      retiredEntry: operation.entry, reason, actor: 'forger', kyroVersion: '5.0.0',
      createdAt: '2026-01-01T00:00:00.000Z', previousChainHead: null,
    });
    const apply = run(forgedRoot, ['repair', 'integrity', 'apply', '--kyro-scope', 'ghost', '--reason', reason, '--digest', plan.digest, '--yes']);
    assert(apply.status !== 0 && /DIVERGED/.test(`${apply.stdout}\n${apply.stderr}`)
      && readdirSync(join(forgedRoot, '.agents/kyro/registry-reconciliations')).length === 1,
    'wrong-kind JSON cannot masquerade as discard evidence');
  } finally {
    rmSync(forgedRoot, { recursive: true, force: true });
  }

  const monolithRoot = mkdtempSync(join(tmpdir(), 'kyro-legacy-monolith-'));
  try {
    const statePath = join(monolithRoot, '.agents/kyro/kyro.json');
    writeJson(statePath, {
      schemaVersion: 4,
      artifactRoot: '.agents/kyro/scopes',
      scopes: [{ id: 'ghost', title: 'Ghost', status: 'completed', originalNote: 'preserve this' }],
      activeScope: 'ghost',
      installedAdapters: [],
    });
    writeText(join(monolithRoot, '.agents/kyro/scopes/ghost/README.txt'), 'unrelated directory');
    const reason = 'foreign directory contains no Kyro artifacts';
    const prep = run(monolithRoot, ['repair', 'integrity', 'prepare', '--kyro-scope', 'ghost', '--reason', reason, '--json']);
    assert(prep.status === 0, `foreign legacy prepare failed: ${prep.stderr}\n${prep.stdout}`);
    const plan = JSON.parse(prep.stdout).data;
    assert(plan.operations.some((item) => item.kind === 'legacy-scope.discard' && item.sourcePath === '.agents/kyro/kyro.json'),
      'foreign directory does not hide raw monolith orphan');
    const apply = run(monolithRoot, ['repair', 'integrity', 'apply', '--kyro-scope', 'ghost', '--reason', reason, '--digest', plan.digest, '--yes']);
    assert(apply.status === 0, `foreign legacy apply failed: ${apply.stderr}\n${apply.stdout}`);
    const after = JSON.parse(readFileSync(statePath, 'utf8'));
    assert(after.scopes.length === 0 && after.activeScope === '' && existsSync(join(monolithRoot, '.agents/kyro/scopes/ghost/README.txt')),
      'monolith cache and active selection are updated without deleting a foreign directory');
  } finally {
    rmSync(monolithRoot, { recursive: true, force: true });
  }

  const ckRoot = mkdtempSync(join(tmpdir(), 'kyro-ck-family-'));
  try {
    // New close transitions leave every non-retired scope open for planning. The registry must
    // match the checkpoint after-image so this fixture tests canonicalization, not stale status.
    writeProject(ckRoot, family.scopes.map((scope) => ({ id: scope.id, title: scope.id, status: 'planning' })), '');
    for (const item of identities) {
      const { after } = materializeLegacyCheckpoint(ckRoot, item.scope, item.n, item.slug);
      writeJson(join(ckRoot, `.agents/kyro/scopes/${item.scope}/sprint.json`), after);
    }
    const ckPrep = run(ckRoot, ['repair', 'integrity', 'prepare', '--json']);
    assert(ckPrep.status === 0, `family prepare failed: ${ckPrep.stderr}\n${ckPrep.stdout}`);
    const ckPlan = JSON.parse(ckPrep.stdout).data;
    assert(ckPlan.targets.canonicalize.length === 11, `expected 11 canonicalize targets, got ${ckPlan.targets.canonicalize.length}`);
    const beforeBytes = identities.map((item) => {
      const pad = String(item.n).padStart(3, '0');
      const base = join(ckRoot, `.agents/kyro/scopes/${item.scope}/archive/sprint-${pad}-${item.slug}`);
      return {
        ck: readFileSync(`${base}.checkpoint.json`),
        snap: readFileSync(`${base}.json`),
        narr: readFileSync(`${base}.md`),
      };
    });
    const ckApply = run(ckRoot, ['repair', 'integrity', 'apply', '--digest', ckPlan.digest, '--yes']);
    assert(ckApply.status === 0, `family apply failed: ${ckApply.stderr}\n${ckApply.stdout}`);
    identities.forEach((item, index) => {
      const pad = String(item.n).padStart(3, '0');
      const base = join(ckRoot, `.agents/kyro/scopes/${item.scope}/archive/sprint-${pad}-${item.slug}`);
      assert(readFileSync(`${base}.checkpoint.json`).equals(beforeBytes[index].ck), `checkpoint bytes ${item.scope}#${item.n}`);
      assert(readFileSync(`${base}.json`).equals(beforeBytes[index].snap), `snapshot bytes ${item.scope}#${item.n}`);
      assert(readFileSync(`${base}.md`).equals(beforeBytes[index].narr), `narrative bytes ${item.scope}#${item.n}`);
    });
    const ckRetry = run(ckRoot, ['repair', 'integrity', 'apply', '--digest', ckPlan.digest, '--yes']);
    assert(ckRetry.status === 0, `family retry must be idempotent: ${ckRetry.stderr}\n${ckRetry.stdout}`);

    const overlays = readdirSync(join(ckRoot, '.agents/kyro/scopes/svc-foundation/archive/checkpoint-remediations'));
    const overlayPath = join(ckRoot, '.agents/kyro/scopes/svc-foundation/archive/checkpoint-remediations', overlays[0]);
    const overlay = JSON.parse(readFileSync(overlayPath, 'utf8'));
    overlay.reason = 'tampered reason';
    writeJson(overlayPath, overlay);
    const tamperedDoctor = run(ckRoot, ['doctor', '--artifacts', '--kyro-scope', 'svc-foundation']);
    assert(tamperedDoctor.status !== 0, `tampered overlay must fail doctor: ${tamperedDoctor.stdout}\n${tamperedDoctor.stderr}`);
    assert(/DIVERGED|recordCommitment|overlay/i.test(`${tamperedDoctor.stdout}\n${tamperedDoctor.stderr}`), 'tamper diagnostic');
    const overlayCount = readdirSync(join(ckRoot, '.agents/kyro/scopes/svc-foundation/archive/checkpoint-remediations')).length;
    const tamperedApply = run(ckRoot, ['repair', 'integrity', 'apply', '--digest', ckPlan.digest, '--yes']);
    assert(tamperedApply.status !== 0 && /DIVERGED/.test(`${tamperedApply.stdout}\n${tamperedApply.stderr}`), 'same warrant must refuse a tampered overlay');
    assert(readdirSync(join(ckRoot, '.agents/kyro/scopes/svc-foundation/archive/checkpoint-remediations')).length === overlayCount, 'tampered overlay retry publishes nothing');
  } finally {
    rmSync(ckRoot, { recursive: true, force: true });
  }

  const unsupportedRoot = mkdtempSync(join(tmpdir(), 'kyro-unsupported-'));
  try {
    const scope = 'legacy-unsupported';
    writeProject(unsupportedRoot, [{ id: scope, title: scope, status: 'planning' }], '');
    const { after } = materializeLegacyCheckpoint(unsupportedRoot, scope, 1, 'future-schema');
    const ckPath = join(unsupportedRoot, '.agents/kyro/scopes', scope, 'archive/sprint-001-future-schema.checkpoint.json');
    const stored = JSON.parse(readFileSync(ckPath, 'utf8'));
    stored.schemaVersion = 99;
    writeJson(ckPath, stored);
    writeJson(join(unsupportedRoot, `.agents/kyro/scopes/${scope}/sprint.json`), after);
    const prep = run(unsupportedRoot, ['repair', 'integrity', 'prepare', '--json']);
    assert(prep.status === 0, `unsupported prepare should still diagnose: ${prep.stderr}\n${prep.stdout}`);
    const plan = JSON.parse(prep.stdout).data;
    assert(plan.findings.length > 0, 'unsupported prepare must not hide findings');
    assert(plan.blockers.some((item) => item.code === 'unsupported'), `expected unsupported blocker, got ${JSON.stringify(plan.blockers)}`);
    const apply = run(unsupportedRoot, ['repair', 'integrity', 'apply', '--digest', plan.digest, '--yes']);
    assert(apply.status !== 0, 'unsupported plan must not apply');
    const doctor = run(unsupportedRoot, ['doctor', '--artifacts', '--kyro-scope', scope]);
    assert(doctor.status !== 0 && /UNSUPPORTED/i.test(`${doctor.stdout}\n${doctor.stderr}`), 'doctor still reports UNSUPPORTED_VERSION');
  } finally {
    rmSync(unsupportedRoot, { recursive: true, force: true });
  }

  const liveRoot = mkdtempSync(join(tmpdir(), 'kyro-two-conv-'));
  try {
    const scope = 'live-scope';
    writeProject(liveRoot, [{ id: scope, title: scope, status: 'planning' }], scope);
    const { after } = materializeLegacyCheckpoint(liveRoot, scope, 1, 'closed-base');
    const live = {
      ...after,
      conventions: [
        ...(after.conventions ?? []),
        { id: 'process-1', rule: 'First post-close convention.', tags: ['process'], addedSprint: 1 },
        { id: 'process-2', rule: 'Second post-close convention.', tags: ['process'], addedSprint: 1 },
      ],
      adrs: [
        {
          id: 'ADR-0001',
          title: 'Post-close decision',
          status: 'accepted',
          date: '2026-01-02',
          context: 'Needed after close.',
          decision: 'Record it.',
          consequences: ['Traceable.'],
          alternatives: ['Ignore it.'],
        },
      ],
    };
    writeJson(join(liveRoot, `.agents/kyro/scopes/${scope}/sprint.json`), live);
    const prep = run(liveRoot, ['repair', 'integrity', 'prepare', '--json']);
    assert(prep.status === 0, `two-convention prepare failed: ${prep.stderr}\n${prep.stdout}`);
    const plan = JSON.parse(prep.stdout).data;
    const conventionOps = plan.operations.filter((op) => op.kind === 'convention.append');
    assert(conventionOps.length === 2, `expected two convention.append ops, got ${conventionOps.length}`);
    assert(conventionOps[0].expectedConventionCollectionSha256 !== conventionOps[1].expectedConventionCollectionSha256, 'progressive preconditions');
    assert(plan.targets.live[0].conventions.map((item) => item.id).join(',') === 'process-1,process-2', 'summary lists every convention');
    assert(plan.targets.live[0].adrs.some((item) => item.id === 'ADR-0001'), 'summary lists ADR');
    const apply = run(liveRoot, ['repair', 'integrity', 'apply', '--digest', plan.digest, '--yes']);
    assert(apply.status === 0, `two-convention apply failed: ${apply.stderr}\n${apply.stdout}`);
    const remediationsDir = join(liveRoot, `.agents/kyro/scopes/${scope}/archive/remediations`);
    const afterFirstApply = readdirSync(remediationsDir).filter((file) => file.endsWith('.json'));
    assert(afterFirstApply.length === 1, `first apply must publish exactly one remediation, got ${afterFirstApply.length}`);
    const firstRecordPath = join(remediationsDir, afterFirstApply[0]);
    const firstRecordBytes = readFileSync(firstRecordPath);
    const firstSprintBytes = readFileSync(join(liveRoot, `.agents/kyro/scopes/${scope}/sprint.json`));
    const retry = run(liveRoot, ['repair', 'integrity', 'apply', '--digest', plan.digest, '--yes']);
    assert(retry.status === 0, `two-convention retry failed: ${retry.stderr}\n${retry.stdout}`);
    const afterRetry = readdirSync(remediationsDir).filter((file) => file.endsWith('.json'));
    assert(afterRetry.length === 1, `same digest must not publish R-002, got ${afterRetry.length} records`);
    assert(readFileSync(firstRecordPath).equals(firstRecordBytes), 'same digest preserves remediation record bytes');
    assert(readFileSync(join(liveRoot, `.agents/kyro/scopes/${scope}/sprint.json`)).equals(firstSprintBytes), 'same digest preserves sprint bytes');
    const retryDoctor = run(liveRoot, ['doctor', '--artifacts', '--kyro-scope', scope]);
    assert(retryDoctor.status === 0, `same digest must preserve doctor PASS: ${retryDoctor.stdout}\n${retryDoctor.stderr}`);

    const liveAfter = JSON.parse(readFileSync(join(liveRoot, `.agents/kyro/scopes/${scope}/sprint.json`), 'utf8'));
    delete liveAfter.remediations;
    writeJson(join(liveRoot, `.agents/kyro/scopes/${scope}/sprint.json`), liveAfter);
    const resume = run(liveRoot, ['repair', 'integrity', 'apply', '--digest', plan.digest, '--yes']);
    assert(resume.status === 0, `write-frontier resume failed: ${resume.stderr}\n${resume.stdout}`);
    assert(readdirSync(remediationsDir).filter((file) => file.endsWith('.json')).length === 1, 'prepared resume reuses R-001');
    assert(readFileSync(firstRecordPath).equals(firstRecordBytes), 'prepared resume preserves R-001 bytes');
    const resumeDoctor = run(liveRoot, ['doctor', '--artifacts', '--kyro-scope', scope]);
    assert(resumeDoctor.status === 0, `prepared resume must restore doctor PASS: ${resumeDoctor.stdout}\n${resumeDoctor.stderr}`);

    const evolved = JSON.parse(readFileSync(join(liveRoot, `.agents/kyro/scopes/${scope}/sprint.json`), 'utf8'));
    evolved.conventions.push({ id: 'process-3', rule: 'Third post-close convention.', tags: ['process'], addedSprint: 1 });
    writeJson(join(liveRoot, `.agents/kyro/scopes/${scope}/sprint.json`), evolved);
    const secondPrep = run(liveRoot, ['repair', 'integrity', 'prepare', '--json']);
    assert(secondPrep.status === 0, `second evolution prepare failed: ${secondPrep.stderr}\n${secondPrep.stdout}`);
    const secondPlan = JSON.parse(secondPrep.stdout).data;
    const secondConventionOps = secondPlan.operations.filter((operation) => operation.kind === 'convention.append');
    assert(
      secondConventionOps.length === 1 && secondConventionOps[0].after.id === 'process-3',
      `second evolution plans only the new delta: ${JSON.stringify(secondPlan)}`,
    );
    const secondApply = run(liveRoot, ['repair', 'integrity', 'apply', '--digest', secondPlan.digest, '--yes']);
    assert(secondApply.status === 0, `second evolution apply failed: ${secondApply.stderr}\n${secondApply.stdout}`);
    const recordsAfterSecond = readdirSync(remediationsDir).filter((file) => file.endsWith('.json')).sort();
    assert(recordsAfterSecond.length === 2, `second evolution must publish R-002, got ${recordsAfterSecond.length}`);
    const firstRecord = JSON.parse(readFileSync(join(remediationsDir, recordsAfterSecond[0]), 'utf8'));
    const secondRecord = JSON.parse(readFileSync(join(remediationsDir, recordsAfterSecond[1]), 'utf8'));
    assert(secondRecord.base.stateSha256 === firstRecord.result.stateSha256, 'R-002 base must equal R-001 result');
    const secondDoctor = run(liveRoot, ['doctor', '--artifacts', '--kyro-scope', scope]);
    assert(secondDoctor.status === 0, `second evolution must preserve doctor PASS: ${secondDoctor.stdout}\n${secondDoctor.stderr}`);

    const bogus = executeRemediationOperations(after, [{
      id: 'OP-001',
      kind: 'ledger.checkpoint.reanchor',
      resolves: ['I-001'],
      sprintN: 1,
      sprintSlug: 'closed-base',
      expectedOldSha256: after.ledger[0].checkpointSha256,
      afterSha256: 'ab'.repeat(32),
      reason: 'forged destination',
    }]);
    assert('failure' in bogus, 'reanchor to a random digest must fail');
    assert(bogus.failure.code === 'CHECKPOINT_CONFLICT', `expected CHECKPOINT_CONFLICT, got ${bogus.failure?.code}`);
  } finally {
    rmSync(liveRoot, { recursive: true, force: true });
  }

  const identityRoot = mkdtempSync(join(tmpdir(), 'kyro-identity-'));
  try {
    writeProject(identityRoot, [{ id: 'folder-id', title: 'Folder', status: 'active' }], 'folder-id');
    const demo = JSON.parse(readFileSync(join(repo, 'fixtures/evals/close-sprint-happy/state/.agents/kyro/scopes/demo/sprint.json'), 'utf8'));
    writeJson(join(identityRoot, '.agents/kyro/scopes/folder-id/sprint.json'), { ...demo, scope: 'other-id', title: 'Other' });
    const prep = run(identityRoot, ['repair', 'integrity', 'prepare', '--json']);
    const plan = JSON.parse(prep.stdout).data;
    assert(plan.blockers.some((item) => item.code === 'identity-conflict'), `identity conflict must block: ${JSON.stringify(plan.blockers)}`);
  } finally {
    rmSync(identityRoot, { recursive: true, force: true });
  }

  const legacyCompletion = legacyCompletionSandbox();
  try {
    const { root: completionRoot, scope, completion } = legacyCompletion;
    const reason = 'Restore the historical completion only if its close checkpoint proves it.';
    const blocked = run(completionRoot, ['repair', 'integrity', 'prepare', '--kyro-scope', scope, '--json']);
    assert(blocked.status === 0, `legacy completion diagnosis failed: ${blocked.stderr}\n${blocked.stdout}`);
    const blockedPlan = JSON.parse(blocked.stdout).data;
    assert(blockedPlan.blockers.some((item) => item.code === 'diverged'), 'unapproved legacy completion remains blocked');
    assert(!blockedPlan.operations.some((item) => item.kind === 'scope.completion.restore-from-legacy'), 'no reason means no restore operation');

    const prep = run(completionRoot, ['repair', 'integrity', 'prepare', '--kyro-scope', scope, '--reason', reason, '--json']);
    assert(prep.status === 0, `legacy completion prepare failed: ${prep.stderr}\n${prep.stdout}`);
    const plan = JSON.parse(prep.stdout).data;
    const operation = plan.operations.find((item) => item.kind === 'scope.completion.restore-from-legacy');
    assert(operation?.completion.requestDigest === completion.requestDigest, 'plan binds the exact registry completion');
    assert(plan.blockers.length === 0, `checkpoint-proven legacy completion should be repairable: ${JSON.stringify(plan.blockers)}`);
    const denied = run(completionRoot, ['repair', 'integrity', 'apply', '--kyro-scope', scope, '--reason', reason, '--digest', plan.digest]);
    assert(denied.status !== 0, 'legacy completion restore requires --yes');
    const applied = run(completionRoot, ['repair', 'integrity', 'apply', '--kyro-scope', scope, '--reason', reason, '--digest', plan.digest, '--yes']);
    assert(applied.status === 0, `legacy completion apply failed: ${applied.stderr}\n${applied.stdout}`);
    const restored = JSON.parse(readFileSync(join(completionRoot, `.agents/kyro/scopes/${scope}/sprint.json`), 'utf8'));
    assert(restored.completion?.requestDigest === completion.requestDigest && restored.status === 'completed', 'restore writes only the proven completion into sprint.json');
    const doctor = run(completionRoot, ['doctor', '--artifacts', '--kyro-scope', scope]);
    assert(doctor.status === 0, `restored lifecycle must pass doctor: ${doctor.stderr}\n${doctor.stdout}`);
    const retry = run(completionRoot, ['repair', 'integrity', 'apply', '--kyro-scope', scope, '--reason', reason, '--digest', plan.digest, '--yes']);
    assert(retry.status === 0, `legacy completion apply retry failed: ${retry.stderr}\n${retry.stdout}`);
  } finally {
    rmSync(legacyCompletion.root, { recursive: true, force: true });
  }

  const forgedCompletion = legacyCompletionSandbox();
  try {
    const projectPath = join(forgedCompletion.root, '.agents/kyro/project.json');
    const project = JSON.parse(readFileSync(projectPath, 'utf8'));
    project.scopes.find((entry) => entry.id === forgedCompletion.scope).completion.beforeEntryDigest = 'f'.repeat(64);
    writeJson(projectPath, project);
    const prep = run(forgedCompletion.root, ['repair', 'integrity', 'prepare', '--kyro-scope', forgedCompletion.scope, '--reason', 'Test fail-closed replay.', '--json']);
    assert(prep.status === 0, `forged completion prepare failed: ${prep.stderr}\n${prep.stdout}`);
    const plan = JSON.parse(prep.stdout).data;
    assert(plan.blockers.some((item) => item.code === 'diverged')
      && !plan.operations.some((item) => item.kind === 'scope.completion.restore-from-legacy'),
    'unverifiable legacy completion fails closed without an operation');
  } finally {
    rmSync(forgedCompletion.root, { recursive: true, force: true });
  }

  console.log(`check-repair-integrity: ${passed} assertions passed`);
}

main();
