#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const repo = resolve(fileURLToPath(import.meta.url), '../..');
const cli = resolve(repo, 'dist/cli.js');
const require = createRequire(import.meta.url);

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

function addDemoAdr(root) {
  const sprint = JSON.parse(readFileSync(sprintPath(root), 'utf-8'));
  sprint.adrs = [
    {
      id: 'ADR-0001',
      title: 'Keep status read-only',
      status: 'accepted',
      date: '2026-07-15',
      context: 'Status is used by humans and scripts during active work.',
      decision: 'Status reports must derive data from sprint.json without mutating artifacts.',
      consequences: ['Status output is safe to run repeatedly in automation.'],
      alternatives: ['Reuse context-pack and accept trace side effects.'],
      links: { tasks: ['T1.1'], docs: ['docs/cli.md'] },
    },
  ];
  writeFileSync(sprintPath(root), `${JSON.stringify(sprint, null, 2)}\n`);
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

// 3. repair must normalize stale phase.status and activeSprint.status to derived values, and must
//    refuse to run without --yes/--confirm (no interactive prompt — CONFIRMATION_REQUIRED instead).
function assertRepairNormalizesPhaseStatus() {
  const root = sandbox();
  try {
    const sprint = JSON.parse(readFileSync(sprintPath(root), 'utf-8'));
    // Force drift: all tasks are done in this fixture, but mark status as still executing/planned.
    sprint.activeSprint.phases[0].status = 'executing';
    sprint.activeSprint.status = 'planned';
    writeFileSync(sprintPath(root), `${JSON.stringify(sprint, null, 2)}\n`);
    const before = readFileSync(sprintPath(root), 'utf-8');

    const unconfirmed = run(['repair', '--kyro-scope', 'demo'], root);
    assert(unconfirmed.status !== 0, `repair without --yes should exit non-zero: ${unconfirmed.stderr || unconfirmed.stdout}`);
    assert(
      `${unconfirmed.stdout}${unconfirmed.stderr}`.includes('CONFIRMATION_REQUIRED'),
      `repair without --yes should report CONFIRMATION_REQUIRED: ${unconfirmed.stderr || unconfirmed.stdout}`,
    );
    assert(readFileSync(sprintPath(root), 'utf-8') === before, 'repair without --yes must not change sprint.json');

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
    addDemoAdr(root);
    const result = run(['context-pack', '--kyro-scope', 'demo', '--task', 'T1.1', '--json'], root);
    assert(result.status === 0, `context-pack should succeed: ${result.stderr || result.stdout}`);
    const pack = JSON.parse(result.stdout);
    assert(Array.isArray(pack.reviewPending), 'context-pack output must declare reviewPending[]');
    assert(pack.reviewPending.includes('T1.1'), `reviewPending should include the done/no-verdict task, got ${JSON.stringify(pack.reviewPending)}`);
    assert(pack.nextTaskReview && pack.nextTaskReview.hasPassVerdict === false, 'nextTaskReview should report the missing pass verdict');
    assert(Array.isArray(pack.adrs) && pack.adrs[0].id === 'ADR-0001', `context-pack should include ADRs, got ${JSON.stringify(pack.adrs)}`);
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

// 7. kyro status is a direct read-only CLI command with stable brief/full/debt JSON and read-only debt failures.
function assertCliStatusCommand() {
  const root = sandbox();
  try {
    const statePath = join(root, '.agents/kyro/kyro.json');
    addDemoAdr(root);
    const initialSprintText = readFileSync(sprintPath(root), 'utf-8');
    const initialStateText = readFileSync(statePath, 'utf-8');

    const implicitBrief = run(['status', '--json'], root);
    assert(implicitBrief.status === 0, `kyro status --json should resolve the active scope: ${implicitBrief.stderr || implicitBrief.stdout}`);
    const implicitReport = JSON.parse(implicitBrief.stdout);
    assert(implicitReport.scope === 'demo', `implicit status should use activeScope demo: ${implicitBrief.stdout}`);

    const brief = run(['status', '--kyro-scope', 'demo', '--json'], root);
    assert(brief.status === 0, `kyro status --json should succeed: ${brief.stderr || brief.stdout}`);
    const report = JSON.parse(brief.stdout);
    assert(report.scope === 'demo', `brief scope should be stable: ${brief.stdout}`);
    assert(report.status === 'active', `brief status should be derived from active sprint: ${brief.stdout}`);
    assert(report.objective === 'Demo objective', `brief objective missing: ${brief.stdout}`);
    assert(report.activeSprint && report.activeSprint.slug === 'demo-sprint', `brief activeSprint missing: ${brief.stdout}`);
    assert(report.nextAction === 'review_task', `brief nextAction missing: ${brief.stdout}`);
    assert(report.nextTask && report.nextTask.id === 'T1.1', `brief nextTask missing: ${brief.stdout}`);
    assert(Array.isArray(report.blockers), `brief blockers must be an array: ${brief.stdout}`);
    assert(report.openDebtCount === 0, `brief openDebtCount mismatch: ${brief.stdout}`);
    assert(report.pendingReviewCount === 1, `brief pendingReviewCount mismatch: ${brief.stdout}`);

    const full = run(['status', 'full', '--kyro-scope', 'demo', '--json'], root);
    assert(full.status === 0, `kyro status full --json should succeed: ${full.stderr || full.stdout}`);
    const fullReport = JSON.parse(full.stdout);
    assert(Array.isArray(fullReport.phaseSummary) && fullReport.phaseSummary[0].id === 'P1', `full mode should include phase summary: ${full.stdout}`);
    assert(fullReport.taskSummary && fullReport.taskSummary.done === 1, `full mode should include task summary: ${full.stdout}`);
    assert(Array.isArray(fullReport.reviewDebt) && fullReport.reviewDebt[0].id === 'T1.1', `full mode should include review debt: ${full.stdout}`);
    assert(fullReport.adrSummary && fullReport.adrSummary.total === 1 && fullReport.adrSummary.byStatus.accepted === 1, `full mode should include ADR summary: ${full.stdout}`);
    assert(Array.isArray(fullReport.recentAdrs) && fullReport.recentAdrs[0].id === 'ADR-0001', `full mode should include recent ADRs: ${full.stdout}`);

    assert(readFileSync(sprintPath(root), 'utf-8') === initialSprintText, 'brief/full status must not mutate sprint.json');
    assert(readFileSync(statePath, 'utf-8') === initialStateText, 'brief/full status must not mutate kyro.json');

    const sprint = JSON.parse(readFileSync(sprintPath(root), 'utf-8'));
    sprint.debt = [
      { id: 'D-1', title: 'Critical open debt', origin: 1, priority: 'critical', status: 'open', targetSprint: null, note: 'guard' },
      { id: 'D-2', title: 'Deferred cleanup', origin: 1, priority: 'low', status: 'deferred', targetSprint: 2, note: 'guard' }
    ];
    writeFileSync(sprintPath(root), `${JSON.stringify(sprint, null, 2)}\n`);
    const debtSprintText = readFileSync(sprintPath(root), 'utf-8');
    const debtStateText = readFileSync(statePath, 'utf-8');
    const debt = run(['status', 'debt', '--kyro-scope', 'demo', '--json'], root);
    assert(debt.status === 0, `kyro status debt --json should succeed: ${debt.stderr || debt.stdout}`);
    const debtReport = JSON.parse(debt.stdout);
    assert(debtReport.byStatus.find((group) => group.key === 'open').count === 1, `debt mode should group by status: ${debt.stdout}`);
    assert(debtReport.byStatus.find((group) => group.key === 'deferred').count === 1, `debt mode should include deferred status: ${debt.stdout}`);
    assert(debtReport.byPriority.find((group) => group.key === 'critical').count === 1, `debt mode should group by priority: ${debt.stdout}`);
    assert(debtReport.byPriority.find((group) => group.key === 'low').count === 1, `debt mode should include low priority: ${debt.stdout}`);

    for (const command of ['debt-add', 'debt-resolve', 'debt-escalate']) {
      const readOnly = run(['status', command, '--kyro-scope', 'demo'], root);
      const readOnlyOutput = `${readOnly.stdout}\n${readOnly.stderr}`;
      assert(readOnly.status === 1, `${command} should fail: ${readOnlyOutput}`);
      assert(readOnlyOutput.includes('Code: INVALID_INPUT'), `${command} should fail with INVALID_INPUT: ${readOnlyOutput}`);
      assert(readOnlyOutput.includes('read-only'), `${command} remedy should say status is read-only: ${readOnlyOutput}`);
    }

    assert(readFileSync(sprintPath(root), 'utf-8') === debtSprintText, 'debt status and rejected debt mutations must not mutate sprint.json');
    assert(readFileSync(statePath, 'utf-8') === debtStateText, 'debt status and rejected debt mutations must not mutate kyro.json');

    const tracePath = join(root, '.agents/kyro/trace/demo/events.ndjson');
    assert(!existsSync(tracePath), `kyro status must not emit trace events: ${tracePath}`);

    const globalHelp = run(['--help'], root);
    assert(globalHelp.status === 0 && globalHelp.stdout.includes('kyro status [mode]'), `global help should list kyro status: ${globalHelp.stderr || globalHelp.stdout}`);

    const help = run(['status', '--help'], root);
    assert(help.status === 0 && help.stdout.includes('kyro status [brief|full|debt]'), `status help should document modes: ${help.stderr || help.stdout}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// 7. describeWriteFailure must classify EROFS/EACCES/ENOSPC as an actionable WRITE_NOT_PERMITTED
//    error (with a remedy) and leave every other error untouched (returns null).
function assertDescribeWriteFailureClassifiesErrno() {
  const { describeWriteFailure } = require(resolve(repo, 'dist/cli/core/errors.js'));
  for (const code of ['EROFS', 'EACCES', 'ENOSPC']) {
    const error = Object.assign(new Error('boom'), { code, path: '/managed/sprint.json' });
    const result = describeWriteFailure(error);
    assert(result && result.code === 'WRITE_NOT_PERMITTED', `describeWriteFailure(${code}) should return a WRITE_NOT_PERMITTED error, got ${JSON.stringify(result)}`);
    assert(typeof result.remedy === 'string' && result.remedy.length > 0, `describeWriteFailure(${code}) should include a remedy`);
    assert(result.message.includes(code), `describeWriteFailure(${code}) message should mention the errno code: ${result.message}`);
  }
  const benignErrno = describeWriteFailure(Object.assign(new Error('exists'), { code: 'EEXIST' }));
  assert(benignErrno === null, `describeWriteFailure(EEXIST) should return null, got ${JSON.stringify(benignErrno)}`);
  const plain = describeWriteFailure(new Error('generic failure'));
  assert(plain === null, `describeWriteFailure(generic Error) should return null, got ${JSON.stringify(plain)}`);
}

// 8. No-auto-complete mutation guard (R2): deriveScopeStatus must return "planning", not "completed",
//    for a scope whose original roadmap is exhausted but whose handoff is NOT "done". Only an explicit
//    terminal handoff mints "completed". If this derivation regresses to "roadmap closed => completed",
//    an open post-close scope would falsely read as a completed terminal scope.
function assertDeriveScopeStatusMutationGuard() {
  const { deriveScopeStatus } = require(resolve(repo, 'dist/cli/core/status.js'));
  const makeClosedRoadmapSprint = (overrides = {}) => ({
    schemaVersion: 4,
    scope: 'demo',
    title: 'Demo',
    status: 'planning',
    objective: 'Demo objective',
    successCriteria: ['Demo works.'],
    clarifications: [],
    conventions: [],
    roadmap: {
      plannedSprintCount: 1,
      sizingRationale: 'One sprint is enough.',
      sprints: [{ n: 1, slug: 'demo-sprint', title: 'Demo Sprint', state: 'closed' }],
    },
    ledger: [],
    previousSprint: null,
    activeSprint: null,
    debt: [],
    handoff: { nextAction: 'plan_sprint', nextTaskId: null, blockers: [], note: 'Resume.', lastUpdated: '2026-07-02' },
    ...overrides,
  });

  // Open post-close scope: roadmap exhausted, but nextAction is plan_sprint -> must be planning.
  const openPostClose = deriveScopeStatus(makeClosedRoadmapSprint(), false);
  assert(openPostClose === 'planning', `exhausted-roadmap + plan_sprint must derive planning, got ${openPostClose}`);

  // Explicit terminal handoff (historical completion / retirement companion) -> completed.
  const terminal = deriveScopeStatus(makeClosedRoadmapSprint({ handoff: { nextAction: 'done', nextTaskId: null, blockers: [], note: 'Retired.', lastUpdated: '2026-07-02' } }), false);
  assert(terminal === 'completed', `explicit done handoff must derive completed, got ${terminal}`);

  // Active sprint -> active (unchanged).
  const active = deriveScopeStatus(makeClosedRoadmapSprint({ activeSprint: { n: 1, slug: 's', title: 'S', objective: 'o', status: 'complete', phases: [], emergentTasks: [], definitionOfDone: [] } }), true);
  assert(active === 'active', `active sprint must derive active, got ${active}`);
}

// 9. CLI status must distinguish verified completion from disposed work in the full task summary
//    (AC1 of T1.5): a disposed task is never counted as verified, and its kind is reported.
function assertStatusTaskSummaryDistinguishesDispositions() {
  const root = sandbox();
  try {
    const sprint = JSON.parse(readFileSync(sprintPath(root), 'utf-8'));
    sprint.debt = [{ id: 'debt-1', title: 'Deferred demo work', origin: 1, priority: 'medium', status: 'open', targetSprint: 2, note: 'Carry forward.' }];
    sprint.activeSprint.phases[0].tasks[0].status = 'pending';
    sprint.activeSprint.phases[0].tasks[0].disposition = { kind: 'deferred', reason: 'Deferred to debt.', by: 'maker', recordedAt: '2026-07-15T00:00:00.000Z', target: { kind: 'debt', id: 'debt-1' } };
    sprint.activeSprint.phases[0].tasks.push({
      id: 'T1.2',
      title: 'Done demo',
      description: 'Done.',
      files_to_touch: [],
      context: 'ctx',
      acceptance_criteria: ['Done.'],
      depends_on: [],
      status: 'done',
      evidence: { summary: 'done', validation: 'ok', files_changed: [], notes: '', by: 'maker', recordedAt: '2026-07-15T00:00:00.000Z' },
      verdict: { result: 'pass', checked_criteria: ['Done.'], findings: [], by: 'checker', reviewedAt: '2026-07-15T00:00:01.000Z' },
    });
    writeFileSync(sprintPath(root), `${JSON.stringify(sprint, null, 2)}\n`);

    const full = run(['status', 'full', '--kyro-scope', 'demo', '--json'], root);
    assert(full.status === 0, `kyro status full --json should succeed: ${full.stderr || full.stdout}`);
    const report = JSON.parse(full.stdout);
    assert(report.taskSummary.verified === 1, `verified should count done+pass+no disposition (1), got ${JSON.stringify(report.taskSummary)}`);
    assert(report.taskSummary.dispositions.deferred === 1, `deferred disposition should be reported, got ${JSON.stringify(report.taskSummary.dispositions)}`);
    assert(report.taskSummary.dispositions.cancelled === 0, `cancelled disposition should be 0, got ${JSON.stringify(report.taskSummary.dispositions)}`);

    const text = run(['status', 'full', '--kyro-scope', 'demo'], root);
    assert(text.stdout.includes('Dispositions: deferred=1'), `full text output should list dispositions: ${text.stdout}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// 10. Explicit scope completion model (T2.1): deriveScopeStatus reads a `completion` record as
//     completed and retirement as retired, while a legacy `done` handoff stays readable; the
//     validator rejects contradictory/malformed completion metadata.
function assertScopeCompletionModel() {
  const { deriveScopeStatus } = require(resolve(repo, 'dist/cli/core/status.js'));
  const { validateSprintFile } = require(resolve(repo, 'dist/cli/artifacts/schema.js'));
  const base = {
    schemaVersion: 4,
    scope: 'demo',
    title: 'Demo',
    status: 'completed',
    objective: 'Demo objective',
    successCriteria: ['Demo works.'],
    clarifications: [],
    conventions: [],
    roadmap: { plannedSprintCount: 1, sizingRationale: 'x', sprints: [{ n: 1, slug: 's', title: 'S', state: 'closed' }] },
    ledger: [],
    previousSprint: null,
    activeSprint: null,
    debt: [],
    handoff: { nextAction: 'done', nextTaskId: null, blockers: [], note: '', lastUpdated: '2026-07-02' },
  };

  // Explicit completion -> completed, distinct from retirement.
  const completed = deriveScopeStatus({ ...base, completion: { completedAt: '2026-07-02T00:00:00.000Z', by: 'maker', summary: 'All done.' } }, false);
  assert(completed === 'completed', `explicit completion must derive completed, got ${completed}`);

  // Retirement wins over completion/legacy-done.
  const retired = deriveScopeStatus({ ...base, retirement: { reason: 'Replaced.', retiredAt: '2026-07-02T00:00:00.000Z', planDigest: 'a'.repeat(64) } }, false);
  assert(retired === 'retired', `retirement must derive retired, got ${retired}`);

  // Legacy terminal read: done handoff without an explicit record stays readable as completed.
  const legacy = deriveScopeStatus(base, false);
  assert(legacy === 'completed', `legacy done handoff must stay readable as completed, got ${legacy}`);

  // Open scope with no terminal signal -> planning (roadmap exhaustion is not completion).
  const open = deriveScopeStatus({ ...base, status: 'planning', handoff: { nextAction: 'plan_sprint', nextTaskId: null, blockers: [], note: '', lastUpdated: '2026-07-02' } }, false);
  assert(open === 'planning', `open scope must derive planning, got ${open}`);

  // Malformed completion metadata is rejected without any write.
  const malformed = validateSprintFile({ ...base, completion: { completedAt: 'not-a-date', by: '' } }, 'demo/sprint.json');
  assert(malformed.some((issue) => issue.field === 'completion.completedAt'), 'malformed completedAt must be rejected');
  assert(malformed.some((issue) => issue.field === 'completion.by'), 'empty completion.by must be rejected');

  // Contradictory completion+retirement is rejected.
  const both = validateSprintFile(
    { ...base, completion: { completedAt: '2026-07-02T00:00:00.000Z', by: 'maker' }, retirement: { reason: 'r', retiredAt: '2026-07-02T00:00:00.000Z', planDigest: 'a'.repeat(64) } },
    'demo/sprint.json',
  );
  assert(both.some((issue) => issue.field === 'completion' && issue.message.includes('retirement')), 'completion+retirement coexistence must be rejected');

  // A scope entry with completion metadata validates in project state.
  const { validateProjectStateShape } = require(resolve(repo, 'dist/cli/artifacts/schema.js'));
  const state = {
    schemaVersion: 4,
    artifactRoot: '.agents/kyro/scopes',
    scopes: [{ id: 'demo', title: 'Demo', status: 'completed', completion: { completedAt: '2026-07-02T00:00:00.000Z', by: 'maker' } }],
    activeScope: null,
    runtimePath: '~/.agents/kyro/current',
    installedAdapters: [],
  };
  const stateIssues = validateProjectStateShape(state, '.agents/kyro/kyro.json');
  assert(stateIssues.length === 0, `scope entry with completion must validate, got ${JSON.stringify(stateIssues)}`);
}

// 11. Explicit scope reopen model (T2.3): a reopened scope reads as open again while its superseded
//     completions stay readable as append-only history; history is audit evidence, never a status
//     signal, and malformed or reordered history is rejected without any write.
function assertScopeReopenModel() {
  const { deriveScopeStatus } = require(resolve(repo, 'dist/cli/core/status.js'));
  const { validateSprintFile, validateProjectStateShape } = require(resolve(repo, 'dist/cli/artifacts/schema.js'));
  const completion = { completedAt: '2026-07-02T00:00:00.000Z', by: 'maker', summary: 'First pass done.' };
  const record = { reopenedAt: '2026-07-03T00:00:00.000Z', by: 'maker', reason: 'A regression appeared.', completion };
  const base = {
    schemaVersion: 4,
    scope: 'demo',
    title: 'Demo',
    status: 'planning',
    objective: 'Demo objective',
    successCriteria: ['Demo works.'],
    clarifications: [],
    conventions: [],
    roadmap: { plannedSprintCount: 1, sizingRationale: 'x', sprints: [{ n: 1, slug: 's', title: 'S', state: 'closed' }] },
    ledger: [],
    previousSprint: null,
    activeSprint: null,
    debt: [],
    completionHistory: [record],
    handoff: { nextAction: 'plan_sprint', nextTaskId: null, blockers: [], note: 'reopened', lastUpdated: '2026-07-03' },
  };

  // Reopened: open again for planning, never read as completed on the strength of its history.
  const reopened = deriveScopeStatus(base, false);
  assert(reopened === 'planning', `a reopened scope must derive planning, got ${reopened}`);
  assert(validateSprintFile(base, 'demo/sprint.json').length === 0, 'a reopened scope with history must validate');

  // History survives a later completion and stays independent of the live lifecycle state.
  const completedAgain = {
    ...base,
    status: 'completed',
    completion: { completedAt: '2026-07-05T00:00:00.000Z', by: 'maker' },
    handoff: { nextAction: 'done', nextTaskId: null, blockers: [], note: '', lastUpdated: '2026-07-05' },
  };
  assert(deriveScopeStatus(completedAgain, false) === 'completed', 'a re-completed scope must derive completed');
  assert(validateSprintFile(completedAgain, 'demo/sprint.json').length === 0, 'completion may coexist with history');

  // Malformed, empty, and out-of-order history is rejected without any write.
  const emptyHistory = validateSprintFile({ ...base, completionHistory: [] }, 'demo/sprint.json');
  assert(emptyHistory.some((issue) => issue.field === 'completionHistory'), 'empty history must be rejected');
  const noReason = validateSprintFile({ ...base, completionHistory: [{ ...record, reason: '' }] }, 'demo/sprint.json');
  assert(noReason.some((issue) => issue.field === 'completionHistory[0].reason'), 'a history record without a reason must be rejected');
  const badCompletion = validateSprintFile({ ...base, completionHistory: [{ ...record, completion: { completedAt: 'nope', by: '' } }] }, 'demo/sprint.json');
  assert(badCompletion.some((issue) => issue.field === 'completionHistory[0].completion.completedAt'), 'a malformed superseded completion must be rejected');
  const unpaired = validateSprintFile({ ...base, completionHistory: [{ ...record, requestDigest: 'a'.repeat(64) }] }, 'demo/sprint.json');
  assert(unpaired.some((issue) => issue.field === 'completionHistory[0]'), 'unpaired reopen digests must be rejected');
  const outOfOrder = validateSprintFile(
    { ...base, completionHistory: [record, { ...record, reopenedAt: '2026-07-01T00:00:00.000Z' }] },
    'demo/sprint.json',
  );
  assert(outOfOrder.some((issue) => issue.field === 'completionHistory[1].reopenedAt'), 'append-only ordering must be enforced');

  // The registry carries the same append-only history for a reopened scope.
  const stateIssues = validateProjectStateShape({
    schemaVersion: 4,
    artifactRoot: '.agents/kyro/scopes',
    scopes: [{ id: 'demo', title: 'Demo', status: 'planning', completionHistory: [record] }],
    activeScope: null,
    runtimePath: '~/.agents/kyro/current',
    installedAdapters: [],
  }, '.agents/kyro/kyro.json');
  assert(stateIssues.length === 0, `a reopened scope entry must validate, got ${JSON.stringify(stateIssues)}`);
}

function main() {
  assertStatusCoreIsPure();
  assertAnalyzeReportsActiveSprintStatusDrift();
  assertRepairNormalizesPhaseStatus();
  assertContextPackSurfacesReviewDebt();
  assertMcpReviewTaskAcceptsWaivers();
  assertStatusRouterDocumentsReviewDebt();
  assertCliStatusCommand();
  assertDescribeWriteFailureClassifiesErrno();
  assertDeriveScopeStatusMutationGuard();
  assertStatusTaskSummaryDistinguishesDispositions();
  assertScopeCompletionModel();
  assertScopeReopenModel();
  console.log('check:status — status coherence invariants passed');
}

try {
  main();
} catch (error) {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
