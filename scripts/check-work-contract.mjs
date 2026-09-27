import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { computeMaterialDigest, validateWorkFile } from '../dist/cli/work/schema.js';

const at = '2026-09-26T00:00:00.000Z';
const digest = (value) => createHash('sha256').update(value).digest('hex');
const stable = (value) => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])) : value;
const definitionFor = (task = {
  id: 'W1', title: 'Document contract', description: 'Write contract validation fixtures.', context: '',
  filesToTouch: ['src/cli/work/schema.ts'], acceptanceCriteria: ['Contract is exact.'], dependsOn: [], definitionRevision: 1,
}) => ({
  id: task.id, title: task.title, description: task.description, context: task.context,
  filesToTouch: task.filesToTouch, acceptanceCriteria: task.acceptanceCriteria, dependsOn: task.dependsOn,
  definitionRevision: task.definitionRevision,
});
const expectedMaterialDigest = digest(JSON.stringify(stable({
  briefDigest: digest('brief'),
  definition: {
    id: 'W1', title: 'Document contract', description: 'Write contract validation fixtures.', context: '',
    filesToTouch: ['src/cli/work/schema.ts'], acceptanceCriteria: ['Contract is exact.'], dependsOn: [], definitionRevision: 1,
  },
})));
assert.equal(computeMaterialDigest(digest('brief'), definitionFor()), expectedMaterialDigest, 'material digest must hash stable JSON of the brief digest and normalized task definition');
const evidenceFor = (materialDigest = computeMaterialDigest(digest('brief'), definitionFor()), definitionRevision = 1) => ({
  summary: 'Validation completed.',
  validations: [{ command: 'npm run check:work-contract', result: 'passed', note: null }],
  filesChanged: ['src/cli/work/schema.ts'], notes: null, by: 'maker', recordedAt: at, definitionRevision, materialDigest,
});
const taskFor = (overrides = {}) => ({
  id: 'W1', title: 'Document contract', description: 'Write contract validation fixtures.', context: '',
  filesToTouch: ['src/cli/work/schema.ts'], acceptanceCriteria: ['Contract is exact.'], dependsOn: [],
  status: 'pending', blocker: null, evidence: null, verdict: null, disposition: null, definitionRevision: 1,
  ...overrides,
});
const base = {
  schemaVersion: 1, kind: 'organic-work', id: 'valid-work', title: 'Valid Work', objective: 'Validate the Work contract with adversarial fixtures.',
  brief: { path: 'brief.md', digest: digest('brief'), sourceIdea: null }, state: 'draft', revision: 1, createdAt: at, updatedAt: at,
  handoff: { nextAction: 'plan_tasks', nextTaskId: null, blockedReason: null }, tasks: [],
  activity: [{ seq: 1, at, event: 'created', taskId: null, by: 'cli', reason: 'Created by test.', revision: 1 }], closure: null, promotion: null,
};
const validPassTask = (() => {
  const task = taskFor();
  const evidence = evidenceFor(computeMaterialDigest(digest('brief'), definitionFor(task)));
  return { ...task, status: 'verified', evidence, verdict: {
    result: 'pass', checkedCriteria: ['Contract is exact.'], findings: [], by: 'checker', reviewedAt: at,
    definitionRevision: 1, evidenceDigest: digest(JSON.stringify(stable(evidence))), reviewedMaterialDigest: evidence.materialDigest,
  } };
})();
const active = (tasks, overrides = {}) => {
  const activity = [base.activity[0]];
  if (tasks.length) activity.push({ seq: activity.length + 1, at, event: 'tasks_planned', taskId: null, by: 'cli', reason: 'Tasks planned.', revision: 1 });
  for (const task of tasks) {
    const events = [];
    if (task.evidence) events.push('evidence_recorded');
    if (task.verdict) events.push('review_recorded');
    if (task.disposition) events.push('task_disposed');
    if (task.status === 'blocked') events.push('task_blocked');
    for (const event of events) activity.push({ seq: activity.length + 1, at, event, taskId: task.id, by: 'cli', reason: 'Task event.', revision: 1 });
  }
  return { ...base, state: 'active', tasks, activity, handoff: { nextAction: 'execute_task', nextTaskId: tasks[0]?.id ?? null, blockedReason: null }, ...overrides };
};

assert.deepEqual(validateWorkFile(base), [], 'minimum empty Work must validate');
const full = {
  ...base, state: 'promoted', handoff: { nextAction: 'done', nextTaskId: null, blockedReason: null }, tasks: [validPassTask],
  activity: [
    base.activity[0],
    { seq: 2, at, event: 'tasks_planned', taskId: null, by: 'cli', reason: 'Tasks planned.', revision: 1 },
    { seq: 3, at, event: 'evidence_recorded', taskId: 'W1', by: 'maker', reason: 'Evidence recorded.', revision: 1 },
    { seq: 4, at, event: 'review_recorded', taskId: 'W1', by: 'checker', reason: 'Review recorded.', revision: 1 },
    { seq: 5, at, event: 'work_closed', taskId: null, by: 'cli', reason: 'Work closed.', revision: 1 },
    { seq: 6, at, event: 'promotion_prepared', taskId: null, by: 'cli', reason: 'Promotion prepared.', revision: 1 },
    { seq: 7, at, event: 'work_promoted', taskId: null, by: 'cli', reason: 'Work promoted.', revision: 1 },
  ],
  closure: { outcome: 'completed', reason: 'All tasks were verified.', by: 'cli', closedAt: at, briefDigest: base.brief.digest, finalRevision: 1 },
  promotion: { targetScope: 'forge-target', targetPath: '.agents/kyro/scopes/forge-target/sprint.json', sourceRevision: 1, sourceDigest: digest('source'), promotedTaskIds: [], promotedAt: at, by: 'cli' },
};
assert.deepEqual(validateWorkFile(full), [], 'valid fully populated Work must validate');

function rejects(name, value, field) {
  const issues = validateWorkFile(value);
  assert(issues.some((entry) => entry.field.includes(field)), `${name} must report ${field}; got ${JSON.stringify(issues)}`);
}

rejects('unknown root key', { ...base, scope: 'forge' }, 'scope');
rejects('Forge sprint field is forbidden', { ...base, activeSprint: 1 }, 'activeSprint');
rejects('Forge debt field is forbidden', { ...base, debt: [] }, 'debt');
rejects('invalid digest', { ...base, brief: { ...base.brief, digest: 'bad' } }, 'brief.digest');
rejects('unsafe brief path', { ...base, brief: { ...base.brief, path: '../brief.md' } }, 'brief.path');
rejects('invalid source Idea path', { ...base, brief: { ...base.brief, sourceIdea: { path: 'ideas/idea.md', digest: digest('idea'), title: 'Idea' } } }, 'brief.sourceIdea.path');
rejects('invalid timestamp', { ...base, createdAt: '2026-09-26' }, 'createdAt');
rejects('activity timestamp outside Work lifetime', { ...base, activity: [{ ...base.activity[0], at: '2026-09-27T00:00:00.000Z' }] }, 'activity[0].at');
rejects('invalid source Idea digest', { ...base, brief: { ...base.brief, sourceIdea: { path: '.agents/kyro/plan/idea.md', digest: 'invalid', title: 'Idea' } } }, 'brief.sourceIdea.digest');
rejects('duplicate IDs', active([taskFor(), taskFor()]), 'tasks[1].id');
rejects('non-increasing IDs', active([taskFor({ id: 'W2' }), taskFor({ id: 'W1' })]), 'tasks[1].id');
rejects('broken dependency', active([taskFor({ dependsOn: ['W9'] })]), 'dependsOn[0]');
rejects('duplicate dependency', active([taskFor(), taskFor({ id: 'W2', dependsOn: ['W1', 'W1'] })]), 'dependsOn[1]');
rejects('cycle', active([taskFor({ dependsOn: ['W2'] }), taskFor({ id: 'W2', dependsOn: ['W1'] })]), 'tasks');
rejects('impossible verified state', active([taskFor({ status: 'verified' })]), 'tasks.W1.status');
rejects('empty draft cannot report done', { ...base, handoff: { nextAction: 'done', nextTaskId: null, blockedReason: null } }, 'handoff.nextAction');
rejects('empty draft cannot execute', { ...base, handoff: { nextAction: 'execute_task', nextTaskId: null, blockedReason: null } }, 'handoff.nextAction');
rejects('pending task cannot report done', active([taskFor()], { handoff: { nextAction: 'done', nextTaskId: null, blockedReason: null } }), 'handoff.nextAction');
rejects('invalid handoff target/action pair', active([taskFor()], { handoff: { nextAction: 'review_task', nextTaskId: 'W1', blockedReason: null } }), 'handoff.nextAction');
rejects('missing handoff target', active([taskFor()], { handoff: { nextAction: 'execute_task', nextTaskId: 'W8', blockedReason: null } }), 'handoff.nextTaskId');
rejects('pending task cannot carry blocker', active([taskFor({ blocker: { reason: 'Blocked.', by: 'maker', recordedAt: at } })]), 'tasks.W1.blocker');
rejects('blocked state requires blocker', active([taskFor({ status: 'blocked' })], { handoff: { nextAction: 'resolve_blocker', nextTaskId: 'W1', blockedReason: 'Blocked.' } }), 'tasks.W1.blocker');

const incompletePass = { ...validPassTask, verdict: { ...validPassTask.verdict, checkedCriteria: [] } };
rejects('pass must cover every criterion', active([incompletePass], { handoff: { nextAction: 'done', nextTaskId: null, blockedReason: null } }), 'checkedCriteria');
const criticalPass = { ...validPassTask, verdict: { ...validPassTask.verdict, findings: [{ severity: 'critical', detail: 'Critical issue remains.' }] } };
rejects('pass cannot contain a critical finding', active([criticalPass], { handoff: { nextAction: 'done', nextTaskId: null, blockedReason: null } }), 'findings');
rejects('evidence revision must match task', active([taskFor({ status: 'awaiting_review', evidence: evidenceFor(digest('material'), 2) })], { handoff: { nextAction: 'review_task', nextTaskId: 'W1', blockedReason: null } }), 'evidence.definitionRevision');
rejects('in-progress evidence without review must await review', active([taskFor({ status: 'in_progress', evidence: evidenceFor() })]), 'tasks.W1.status');
rejects('blocked evidence without review must await review', active([taskFor({ status: 'blocked', blocker: { reason: 'Waiting for access.', by: 'maker', recordedAt: at }, evidence: evidenceFor() })], { handoff: { nextAction: 'resolve_blocker', nextTaskId: 'W1', blockedReason: 'Waiting for access.' } }), 'tasks.W1.status');
const failedEvidence = evidenceFor();
const failedVerdictTask = taskFor({ status: 'in_progress', evidence: failedEvidence, verdict: {
  result: 'fail', checkedCriteria: [], findings: [{ severity: 'warning', detail: 'A required correction remains.' }], by: 'checker', reviewedAt: at,
  definitionRevision: 1, evidenceDigest: digest(JSON.stringify(stable(failedEvidence))), reviewedMaterialDigest: failedEvidence.materialDigest,
} });
assert.deepEqual(validateWorkFile(active([failedVerdictTask])), [], 'in_progress evidence with a fail verdict must remain valid');
rejects('random valid-shaped material digest must not bind unrelated task material', active([taskFor({ status: 'awaiting_review', evidence: evidenceFor(digest('unrelated content')) })], { handoff: { nextAction: 'review_task', nextTaskId: 'W1', blockedReason: null } }), 'tasks.W1.evidence.materialDigest');
rejects('pending verdict is incoherent', active([taskFor({ status: 'awaiting_review', evidence: evidenceFor(), verdict: validPassTask.verdict })], { handoff: { nextAction: 'review_task', nextTaskId: 'W1', blockedReason: null } }), 'tasks.W1.status');
rejects('verdict evidence digest must match', active([{ ...validPassTask, verdict: { ...validPassTask.verdict, evidenceDigest: digest('different evidence') } }], { handoff: { nextAction: 'done', nextTaskId: null, blockedReason: null } }), 'evidenceDigest');
rejects('verdict cannot predate evidence', active([{ ...validPassTask, verdict: { ...validPassTask.verdict, reviewedAt: '2026-09-25T23:59:59.000Z' } }], { handoff: { nextAction: 'done', nextTaskId: null, blockedReason: null } }), 'verdict.reviewedAt');
rejects('failed validation cannot pass', active([{ ...validPassTask, evidence: { ...validPassTask.evidence, validations: [{ command: 'test', result: 'not_run', note: null }] } }], { handoff: { nextAction: 'done', nextTaskId: null, blockedReason: null } }), 'evidence.validations');

rejects('activity sequence must be contiguous', { ...base, activity: [{ ...base.activity[0], seq: 2 }] }, 'activity[0].seq');
rejects('activity task ID must exist', { ...base, activity: [...base.activity, { seq: 2, at: at, event: 'task_started', taskId: 'W9', by: 'maker', reason: 'Start.', revision: 1 }] }, 'activity[1].taskId');
rejects('activity task event requires a task ID', { ...base, activity: [...base.activity, { seq: 2, at, event: 'task_started', taskId: null, by: 'maker', reason: 'Start.', revision: 1 }] }, 'activity[1].taskId');
rejects('activity cannot repeat created', { ...base, activity: [...base.activity, { ...base.activity[0], seq: 2 }] }, 'activity');
const draftTasksPlanned = { ...base, activity: [...base.activity, { seq: 2, at, event: 'tasks_planned', taskId: null, by: 'cli', reason: 'Tasks planned.', revision: 1 }] };
rejects('empty draft cannot claim tasks were planned', draftTasksPlanned, 'activity');
const draftWorkClosed = { ...base, activity: [...base.activity, { seq: 2, at, event: 'work_closed', taskId: null, by: 'cli', reason: 'Work closed.', revision: 1 }] };
rejects('empty draft cannot claim work was closed', draftWorkClosed, 'activity');
const missingEvidenceEvent = active([taskFor({ status: 'awaiting_review', evidence: evidenceFor() })]);
missingEvidenceEvent.activity = missingEvidenceEvent.activity.filter((item) => item.event !== 'evidence_recorded').map((item, index) => ({ ...item, seq: index + 1 }));
rejects('evidence requires matching activity event', missingEvidenceEvent, 'tasks.W1.evidence');
const missingReviewEvent = active([validPassTask]);
missingReviewEvent.activity = missingReviewEvent.activity.filter((item) => item.event !== 'review_recorded').map((item, index) => ({ ...item, seq: index + 1 }));
rejects('verdict requires matching review event', missingReviewEvent, 'tasks.W1.verdict');
const reopenedWithHistoricalClose = active([validPassTask], { handoff: { nextAction: 'ready_to_close', nextTaskId: null, blockedReason: null } });
reopenedWithHistoricalClose.activity.push({ seq: reopenedWithHistoricalClose.activity.length + 1, at, event: 'work_closed', taskId: null, by: 'cli', reason: 'Work was closed before reopening.', revision: 1 });
assert.deepEqual(validateWorkFile(reopenedWithHistoricalClose), [], 'reopened active Work with tasks may retain historical work_closed activity');
const partialClosure = { ...base, state: 'closed', handoff: { nextAction: 'done', nextTaskId: null, blockedReason: null }, tasks: [taskFor()], closure: { outcome: 'completed', reason: 'Complete.', by: 'cli', closedAt: at, briefDigest: base.brief.digest, finalRevision: 1 } };
rejects('completed closure requires terminal tasks', partialClosure, 'closure.outcome');
rejects('closure revision must match Work revision', { ...full, closure: { ...full.closure, finalRevision: 2 } }, 'closure.finalRevision');
const superseded = taskFor({ id: 'W1', status: 'superseded', disposition: { kind: 'superseded', reason: 'Replaced.', by: 'cli', recordedAt: at, replacementTaskId: 'W9' } });
rejects('supersession target must exist', active([superseded], { handoff: { nextAction: 'ready_to_close', nextTaskId: null, blockedReason: null } }), 'replacementTaskId');
rejects('supersession target cannot be self', active([taskFor({ status: 'superseded', disposition: { kind: 'superseded', reason: 'Replaced.', by: 'cli', recordedAt: at, replacementTaskId: 'W1' } })], { handoff: { nextAction: 'ready_to_close', nextTaskId: null, blockedReason: null } }), 'replacementTaskId');

console.log('Work v1 contract fixtures passed, including normative coherence and adversarial state coverage.');
