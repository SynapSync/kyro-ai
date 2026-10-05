import { createHash } from 'node:crypto';
import type { WorkFile, WorkTask, WorkTaskDefinition } from '../types';
import type { ValidationIssue } from '../artifacts/schema';

const SHA256 = /^[0-9a-f]{64}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TASK_ID = /^W[1-9]\d*$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const ACTIONS = ['plan_tasks', 'execute_task', 'review_task', 'resolve_blocker', 'ready_to_close', 'done'];
const TASK_STATES = ['pending', 'in_progress', 'blocked', 'awaiting_review', 'verified', 'cancelled', 'superseded'];
const EVENTS = ['created', 'brief_amended', 'tasks_planned', 'task_started', 'task_blocked', 'task_unblocked', 'evidence_recorded', 'review_recorded', 'task_amended', 'task_disposed', 'work_closed', 'work_reopened', 'promotion_prepared', 'work_promoted'];
const ROOT = ['schemaVersion', 'kind', 'id', 'title', 'objective', 'brief', 'state', 'revision', 'createdAt', 'updatedAt', 'handoff', 'tasks', 'activity', 'closure', 'promotion'];

export function validateWorkFile(value: unknown, path = 'work.json'): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!record(value)) return [{ path, field: '<root>', message: 'must be an object' }];

  exact(value, ROOT, path, '', issues);
  literal(value, 'schemaVersion', 1, path, issues);
  literal(value, 'kind', 'organic-work', path, issues);
  slug(value.id, path, 'id', issues);
  nonempty(value.title, path, 'title', issues);
  nonempty(value.objective, path, 'objective', issues);
  positive(value.revision, path, 'revision', issues);
  timestamp(value.createdAt, path, 'createdAt', issues);
  timestamp(value.updatedAt, path, 'updatedAt', issues);
  if (isTimestamp(value.createdAt) && isTimestamp(value.updatedAt) && Date.parse(value.updatedAt) < Date.parse(value.createdAt)) {
    issue(path, 'updatedAt', 'must not precede createdAt', issues);
  }
  if (!['draft', 'active', 'closed', 'promoted'].includes(value.state as string)) issue(path, 'state', 'must be a Work state', issues);

  brief(value.brief, path, 'brief', issues);
  handoff(value.handoff, path, 'handoff', issues);
  if (!Array.isArray(value.tasks)) issue(path, 'tasks', 'must be an array', issues);
  else value.tasks.forEach((item, index) => task(item, path, `tasks[${index}]`, issues));
  if (!Array.isArray(value.activity)) issue(path, 'activity', 'must be an array', issues);
  else value.activity.forEach((item, index) => activity(item, path, `activity[${index}]`, issues));
  nullableObject(value.closure, path, 'closure', issues, closure);
  nullableObject(value.promotion, path, 'promotion', issues, promotion);

  if (!Array.isArray(value.tasks)) return issues;
  const tasks = value.tasks.filter(record);
  const taskById = new Map<string, Record<string, unknown>>();
  let previousTaskNumber = 0;
  for (const [index, item] of tasks.entries()) {
    if (typeof item.id !== 'string') continue;
    if (taskById.has(item.id)) issue(path, `tasks[${index}].id`, 'must be unique', issues);
    taskById.set(item.id, item);
    const number = Number(item.id.slice(1));
    if (Number.isInteger(number) && number <= previousTaskNumber) issue(path, `tasks[${index}].id`, 'task IDs must be in increasing, never-reused order', issues);
    if (Number.isInteger(number)) previousTaskNumber = number;
  }

  for (const item of tasks) {
    const id = String(item.id);
    if (!Array.isArray(item.dependsOn)) continue;
    const seen = new Set<string>();
    for (const [index, dependency] of item.dependsOn.entries()) {
      if (typeof dependency !== 'string') continue;
      if (seen.has(dependency)) issue(path, `tasks.${id}.dependsOn[${index}]`, 'must not contain duplicate dependencies', issues);
      seen.add(dependency);
      if (dependency === id) issue(path, `tasks.${id}.dependsOn[${index}]`, 'must not reference itself', issues);
      else if (!taskById.has(dependency)) issue(path, `tasks.${id}.dependsOn[${index}]`, 'references a missing task', issues);
    }
    const unavailableDependency = item.dependsOn.find((dependency) => {
      const parent = typeof dependency === 'string' ? taskById.get(dependency) : undefined;
      return parent && parent.status !== 'verified';
    });
    if (['in_progress', 'awaiting_review', 'verified'].includes(String(item.status)) && unavailableDependency) {
      issue(path, `tasks.${id}.dependsOn`, 'active or verified task requires every dependency to be verified', issues);
    }
  }
  if (hasCycle(tasks)) issue(path, 'tasks', 'contains a dependency cycle', issues);

  semantic(value, tasks, taskById, path, issues);
  validateActivity(value, tasks, path, issues);
  return issues;
}

export function asWorkFile(value: unknown): WorkFile | null {
  return validateWorkFile(value).length === 0 ? value as WorkFile : null;
}

export function computeMaterialDigest(briefDigest: string, definition: WorkTaskDefinition): string {
  const material = {
    briefDigest,
    definition: {
      id: definition.id,
      title: definition.title,
      description: definition.description,
      context: definition.context,
      filesToTouch: definition.filesToTouch,
      acceptanceCriteria: definition.acceptanceCriteria,
      dependsOn: definition.dependsOn,
      definitionRevision: definition.definitionRevision,
    },
  };
  return createHash('sha256').update(stableJson(material)).digest('hex');
}

export function computeEvidenceDigest(evidence: unknown): string { return digestJson(evidence); }

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (record(value)) return `{${Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

function semantic(work: Record<string, unknown>, tasks: Record<string, unknown>[], taskById: Map<string, Record<string, unknown>>, path: string, issues: ValidationIssue[]): void {
  const handoff = record(work.handoff) ? work.handoff : null;
  const briefValue = record(work.brief) ? work.brief : null;
  const closureValue = record(work.closure) ? work.closure : null;
  const promotionValue = record(work.promotion) ? work.promotion : null;
  const state = work.state;

  if (briefValue && briefValue.path !== 'brief.md') issue(path, 'brief.path', 'must be brief.md inside the Work directory', issues);
  if (briefValue && record(briefValue.sourceIdea)) {
    const sourcePath = briefValue.sourceIdea.path;
    if (typeof sourcePath === 'string' && !sourcePath.startsWith('.agents/kyro/plan/')) issue(path, 'brief.sourceIdea.path', 'must reference a document under .agents/kyro/plan/', issues);
  }

  if (state === 'draft') {
    if (tasks.length !== 0) issue(path, 'tasks', 'draft requires an empty task list', issues);
    if (closureValue || promotionValue) issue(path, 'state', 'draft cannot have closure or promotion', issues);
  }
  if (state === 'active') {
    if (tasks.length === 0) issue(path, 'state', 'active Work requires at least one task', issues);
    if (closureValue || promotionValue) issue(path, 'state', 'active Work cannot have closure or promotion', issues);
  }
  if (state === 'closed') {
    if (!closureValue) issue(path, 'closure', 'is required when state is closed', issues);
    if (promotionValue) issue(path, 'promotion', 'cannot exist before state is promoted', issues);
  }
  if (state === 'promoted' && !promotionValue) issue(path, 'promotion', 'is required when state is promoted', issues);
  if (state !== 'closed' && state !== 'promoted' && closureValue) issue(path, 'closure', 'requires closed or promoted state', issues);
  if (state !== 'promoted' && promotionValue) issue(path, 'promotion', 'requires promoted state', issues);

  for (const item of tasks) validateTaskState(item, taskById, briefValue?.digest, path, issues);

  if (closureValue) {
    if (briefValue && closureValue.briefDigest !== briefValue.digest) issue(path, 'closure.briefDigest', 'must match the current brief digest', issues);
    if (!promotionValue && closureValue.finalRevision !== work.revision) issue(path, 'closure.finalRevision', 'must match the current Work revision', issues);
    // A promoted Work keeps its historical closure metadata: promotion advanced
    // the revision after closure, so the preserved finalRevision must precede
    // (never exceed) the current revision instead of matching it.
    if (promotionValue && Number(closureValue.finalRevision) > Number(work.revision)) issue(path, 'closure.finalRevision', 'must not exceed the current Work revision once promoted', issues);
    if (isTimestamp(work.updatedAt) && isTimestamp(closureValue.closedAt)) {
      const closedAt = Date.parse(closureValue.closedAt);
      const updatedAt = Date.parse(work.updatedAt);
      if (!promotionValue && closedAt < updatedAt) issue(path, 'closure.closedAt', 'must not precede updatedAt', issues);
      // A promoted Work keeps its historical closure: promotion advanced
      // updatedAt after closure, so the preserved closedAt must precede (never
      // follow) the current revision timestamp instead of matching it.
      if (promotionValue && closedAt > updatedAt) issue(path, 'closure.closedAt', 'must not follow updatedAt once promoted', issues);
    }
    if (closureValue.outcome === 'completed' && tasks.length === 0) {
      issue(path, 'closure.outcome', 'completed requires at least one planned task; use stopped for an unstarted Work', issues);
    }
    if (closureValue.outcome === 'completed' && tasks.some((item) => !isTerminal(item))) {
      issue(path, 'closure.outcome', 'completed requires every task to be verified or explicitly disposed', issues);
    }
  }

  if (promotionValue) {
    if (promotionValue.sourceRevision !== work.revision) issue(path, 'promotion.sourceRevision', 'must match the current Work revision', issues);
    if (isTimestamp(work.updatedAt) && isTimestamp(promotionValue.promotedAt) && Date.parse(promotionValue.promotedAt) < Date.parse(work.updatedAt)) {
      issue(path, 'promotion.promotedAt', 'must not precede updatedAt', issues);
    }
    if (Array.isArray(promotionValue.promotedTaskIds)) {
      const promotedIds = new Set<string>();
      promotionValue.promotedTaskIds.forEach((id, index) => {
        if (typeof id !== 'string') return;
        if (promotedIds.has(id)) issue(path, `promotion.promotedTaskIds[${index}]`, 'must be unique', issues);
        promotedIds.add(id);
        const promotedTask = taskById.get(id);
        if (!promotedTask) issue(path, `promotion.promotedTaskIds[${index}]`, 'references a missing task', issues);
        else if (isTerminal(promotedTask)) issue(path, `promotion.promotedTaskIds[${index}]`, 'must reference a task that is neither verified nor disposed', issues);
      });
    }
    if (typeof promotionValue.targetPath === 'string' && !promotionValue.targetPath.endsWith('/sprint.json')) {
      issue(path, 'promotion.targetPath', 'must point to a sprint.json destination', issues);
    }
  }
  const activityEvents = new Set(Array.isArray(work.activity) ? work.activity.filter(record).map((item) => item.event) : []);
  if (closureValue && !activityEvents.has('work_closed')) issue(path, 'closure', 'requires a matching work_closed activity event', issues);
  if (promotionValue && !activityEvents.has('work_promoted')) issue(path, 'promotion', 'requires a matching work_promoted activity event', issues);
  if (state === 'closed' && !activityEvents.has('work_closed')) issue(path, 'state', 'closed state requires a work_closed activity event', issues);
  if (activityEvents.has('work_reopened') && !activityEvents.has('work_closed')) issue(path, 'activity', 'work_reopened requires a previous work_closed event', issues);
  if (state === 'promoted' && !activityEvents.has('work_promoted')) issue(path, 'state', 'promoted state requires a work_promoted activity event', issues);

  if (handoff) {
    const expected = deriveHandoff(state, tasks, taskById);
    if (handoff.nextAction !== expected.nextAction) issue(path, 'handoff.nextAction', `must be ${expected.nextAction} for the current Work state`, issues);
    if (handoff.nextTaskId !== expected.nextTaskId) issue(path, 'handoff.nextTaskId', `must be ${expected.nextTaskId ?? 'null'} for the current Work state`, issues);
    if (handoff.blockedReason !== expected.blockedReason) issue(path, 'handoff.blockedReason', `must be ${expected.blockedReason ?? 'null'} for the current Work state`, issues);
  }
}

export function deriveWorkHandoff(work: Pick<WorkFile, 'state' | 'tasks'>): WorkFile['handoff'] {
  const tasks = work.tasks as unknown as Record<string, unknown>[];
  const taskById = new Map(tasks.map((task) => [String(task.id), task]));
  return deriveHandoff(work.state, tasks, taskById) as WorkFile['handoff'];
}

function deriveHandoff(state: unknown, tasks: Record<string, unknown>[], taskById: Map<string, Record<string, unknown>>): { nextAction: string; nextTaskId: string | null; blockedReason: string | null } {
  if (state === 'closed' || state === 'promoted') return { nextAction: 'done', nextTaskId: null, blockedReason: null };
  if (state === 'draft' && tasks.length === 0) return { nextAction: 'plan_tasks', nextTaskId: null, blockedReason: null };
  const review = tasks.find((item) => item.status === 'awaiting_review');
  if (review) return { nextAction: 'review_task', nextTaskId: String(review.id), blockedReason: null };
  const runnable = tasks.find((item) => ['pending', 'in_progress'].includes(String(item.status))
    && Array.isArray(item.dependsOn)
    && item.dependsOn.every((id) => typeof id === 'string' && taskById.get(id)?.status === 'verified'));
  if (runnable) return { nextAction: 'execute_task', nextTaskId: String(runnable.id), blockedReason: null };
  const blocked = tasks.find((item) => item.status === 'blocked');
  if (blocked) return { nextAction: 'resolve_blocker', nextTaskId: String(blocked.id), blockedReason: record(blocked.blocker) && typeof blocked.blocker.reason === 'string' ? blocked.blocker.reason : null };
  const waiting = tasks.find((item) => item.status === 'pending' && Array.isArray(item.dependsOn)
    && item.dependsOn.some((id) => typeof id === 'string' && isDisposed(taskById.get(id))));
  if (waiting) return { nextAction: 'resolve_blocker', nextTaskId: String(waiting.id), blockedReason: 'A dependency was disposed and requires an explicit plan update.' };
  if (tasks.length > 0 && tasks.every(isTerminal)) return { nextAction: 'ready_to_close', nextTaskId: null, blockedReason: null };
  return { nextAction: 'execute_task', nextTaskId: null, blockedReason: null };
}

function validateTaskState(taskValue: Record<string, unknown>, taskById: Map<string, Record<string, unknown>>, briefDigest: unknown, path: string, issues: ValidationIssue[]): void {
  const id = String(taskValue.id);
  const prefix = `tasks.${id}`;
  const evidenceValue = record(taskValue.evidence) ? taskValue.evidence : null;
  const verdictValue = record(taskValue.verdict) ? taskValue.verdict : null;
  const blockerValue = record(taskValue.blocker) ? taskValue.blocker : null;
  const dispositionValue = record(taskValue.disposition) ? taskValue.disposition : null;
  const status = taskValue.status;

  if ((status === 'blocked') !== (taskValue.blocker !== null)) issue(path, `${prefix}.blocker`, 'must be present exactly for blocked tasks', issues);
  if ((status === 'cancelled' || status === 'superseded') !== (taskValue.disposition !== null)) issue(path, `${prefix}.disposition`, 'must be present exactly for disposed tasks', issues);
  if (dispositionValue && dispositionValue.kind !== status) issue(path, `${prefix}.disposition.kind`, 'must match the task status', issues);
  if (status === 'pending' && (evidenceValue || verdictValue || blockerValue || dispositionValue)) issue(path, `${prefix}.status`, 'pending tasks cannot have evidence, verdict, blocker, or disposition', issues);
  if (status === 'in_progress' && (blockerValue || dispositionValue || verdictValue?.result === 'pass')) issue(path, `${prefix}.status`, 'in_progress requires no blocker, disposition, or pass verdict', issues);
  if (status === 'blocked' && dispositionValue) issue(path, `${prefix}.status`, 'blocked tasks cannot have a disposition', issues);
  if (status === 'awaiting_review' && (!evidenceValue || verdictValue || blockerValue || dispositionValue)) issue(path, `${prefix}.status`, 'awaiting_review requires current evidence and no verdict, blocker, or disposition', issues);
  if (status === 'verified' && (!evidenceValue || !verdictValue || verdictValue.result !== 'pass' || blockerValue || dispositionValue)) issue(path, `${prefix}.status`, 'verified requires evidence and a pass verdict without blocker or disposition', issues);
  if ((status === 'cancelled' || status === 'superseded') && (blockerValue || verdictValue?.result === 'pass')) issue(path, `${prefix}.status`, 'disposed tasks cannot be blocked or retain a pass verdict', issues);
  if (evidenceValue && !verdictValue && status !== 'awaiting_review') issue(path, `${prefix}.status`, 'evidence without a verdict requires awaiting_review status', issues);

  if (evidenceValue && evidenceValue.definitionRevision !== taskValue.definitionRevision) issue(path, `${prefix}.evidence.definitionRevision`, 'must match the current task definitionRevision', issues);
  if (evidenceValue && typeof briefDigest === 'string' && evidenceValue.materialDigest !== computeMaterialDigest(briefDigest, taskValue as unknown as WorkTaskDefinition)) {
    issue(path, `${prefix}.evidence.materialDigest`, 'must bind the current brief digest and task definition', issues);
  }
  if (verdictValue) {
    if (verdictValue.definitionRevision !== taskValue.definitionRevision) issue(path, `${prefix}.verdict.definitionRevision`, 'must match the current task definitionRevision', issues);
    if (!evidenceValue) issue(path, `${prefix}.verdict`, 'requires evidence', issues);
    else {
      if (verdictValue.evidenceDigest !== digestJson(evidenceValue)) issue(path, `${prefix}.verdict.evidenceDigest`, 'must match the current evidence digest', issues);
      if (verdictValue.reviewedMaterialDigest !== evidenceValue.materialDigest) issue(path, `${prefix}.verdict.reviewedMaterialDigest`, 'must match evidence.materialDigest', issues);
      if (isTimestamp(evidenceValue.recordedAt) && isTimestamp(verdictValue.reviewedAt) && Date.parse(verdictValue.reviewedAt) < Date.parse(evidenceValue.recordedAt)) {
        issue(path, `${prefix}.verdict.reviewedAt`, 'must not precede evidence.recordedAt', issues);
      }
    }
    if (verdictValue.result === 'pass') {
      const criteria = Array.isArray(taskValue.acceptanceCriteria) ? taskValue.acceptanceCriteria : [];
      const checked = Array.isArray(verdictValue.checkedCriteria) ? verdictValue.checkedCriteria : [];
      if (!sameStrings(criteria, checked)) issue(path, `${prefix}.verdict.checkedCriteria`, 'pass must cover every current acceptance criterion exactly', issues);
      const findings = Array.isArray(verdictValue.findings) ? verdictValue.findings : [];
      if (findings.some((findingValue) => record(findingValue) && findingValue.severity === 'critical')) issue(path, `${prefix}.verdict.findings`, 'pass cannot contain a critical finding', issues);
      if (evidenceValue && Array.isArray(evidenceValue.validations) && evidenceValue.validations.some((validationValue) => record(validationValue) && validationValue.result !== 'passed')) {
        issue(path, `${prefix}.evidence.validations`, 'pass requires every recorded validation to have passed', issues);
      }
      if (status !== 'verified') issue(path, `${prefix}.status`, 'a pass verdict requires verified status', issues);
    }
    if (verdictValue.result === 'fail' && !['in_progress', 'blocked', 'cancelled', 'superseded'].includes(String(status))) issue(path, `${prefix}.status`, 'a fail verdict requires remediation, blocked, or disposed status', issues);
  }

  if (dispositionValue?.kind === 'superseded') {
    const replacementId = dispositionValue.replacementTaskId;
    if (typeof replacementId !== 'string') issue(path, `${prefix}.disposition.replacementTaskId`, 'is required for superseded tasks', issues);
    else if (replacementId === id || !taskById.has(replacementId)) issue(path, `${prefix}.disposition.replacementTaskId`, 'must reference a different existing task', issues);
  }
  if (dispositionValue?.kind === 'cancelled' && dispositionValue.replacementTaskId !== null) issue(path, `${prefix}.disposition.replacementTaskId`, 'must be null for cancelled tasks', issues);
}

function validateActivity(work: Record<string, unknown>, tasks: Record<string, unknown>[], path: string, issues: ValidationIssue[]): void {
  if (!Array.isArray(work.activity)) return;
  const taskIds = new Set(tasks.map((item) => item.id).filter((id): id is string => typeof id === 'string'));
  let previousAt: number | null = null;
  let previousRevision = 0;
  let createdEvents = 0;
  let closedEvents = 0;
  const eventTaskIds = new Map<string, Set<string>>();
  const createdAt = isTimestamp(work.createdAt) ? Date.parse(work.createdAt) : null;
  const updatedAt = isTimestamp(work.updatedAt) ? Date.parse(work.updatedAt) : null;
  for (const [index, item] of work.activity.entries()) {
    if (!record(item)) continue;
    const prefix = `activity[${index}]`;
    if (item.seq !== index + 1) issue(path, `${prefix}.seq`, 'must be consecutive starting at 1', issues);
    if (typeof item.taskId === 'string' && !taskIds.has(item.taskId)) issue(path, `${prefix}.taskId`, 'must reference an existing task or be null', issues);
    const requiresTask = ['task_started', 'task_blocked', 'task_unblocked', 'evidence_recorded', 'review_recorded', 'task_amended', 'task_disposed'].includes(String(item.event));
    if (requiresTask && item.taskId === null) issue(path, `${prefix}.taskId`, 'is required for task activity events', issues);
    if (item.event === 'created' && (index !== 0 || item.taskId !== null || item.revision !== 1)) issue(path, `${prefix}.event`, 'created must be the first activity at revision 1 without a task ID', issues);
    if (item.event === 'created') {
      createdEvents += 1;
      if (createdAt !== null && isTimestamp(item.at) && Date.parse(item.at) !== createdAt) issue(path, `${prefix}.at`, 'must match createdAt', issues);
    }
    if (item.event === 'work_closed') closedEvents += 1;
    if (item.event === 'work_reopened' && closedEvents === 0) issue(path, `${prefix}.event`, 'work_reopened requires an earlier work_closed event', issues);
    if (item.event === 'work_reopened' && item.taskId !== null) issue(path, `${prefix}.taskId`, 'work_reopened must not reference a task', issues);
    if (typeof item.event === 'string' && typeof item.taskId === 'string') {
      const taskEventIds = eventTaskIds.get(item.event) ?? new Set<string>();
      taskEventIds.add(item.taskId);
      eventTaskIds.set(item.event, taskEventIds);
    }
    if (typeof item.revision === 'number' && typeof work.revision === 'number') {
      if (item.revision < previousRevision) issue(path, `${prefix}.revision`, 'must not decrease', issues);
      if (index === 0 && item.revision !== 1) issue(path, `${prefix}.revision`, 'the first activity must be revision 1', issues);
      if (index > 0 && item.revision > previousRevision + 1) issue(path, `${prefix}.revision`, 'must not skip a Work revision', issues);
      if (item.revision > work.revision) issue(path, `${prefix}.revision`, 'must not exceed the current Work revision', issues);
      previousRevision = item.revision;
    }
    if (isTimestamp(item.at)) {
      const currentAt = Date.parse(item.at);
      if (previousAt !== null && currentAt < previousAt) issue(path, `${prefix}.at`, 'must not precede the previous activity timestamp', issues);
      if (createdAt !== null && currentAt < createdAt) issue(path, `${prefix}.at`, 'must not precede createdAt', issues);
      if (updatedAt !== null && currentAt > updatedAt) issue(path, `${prefix}.at`, 'must not follow updatedAt', issues);
      previousAt = currentAt;
    }
  }
  if (work.activity.length === 0) issue(path, 'activity', 'must include the created event', issues);
  else if (record(work.activity[0]) && work.activity[0].event !== 'created') issue(path, 'activity[0].event', 'must be created', issues);
  if (createdEvents !== 1) issue(path, 'activity', 'must contain exactly one created event', issues);
  if (previousRevision !== work.revision) issue(path, 'activity', 'latest activity revision must match the current Work revision', issues);
  const events = new Set(work.activity.filter(record).map((item) => item.event));
  if (events.has('tasks_planned') && (work.state === 'draft' || tasks.length === 0)) issue(path, 'activity', 'tasks_planned requires a non-draft Work with at least one task', issues);
  if (events.has('work_closed') && work.state === 'draft' && !events.has('work_reopened')) issue(path, 'activity', 'draft Work may only retain work_closed as reopened history', issues);

  for (const taskValue of tasks) {
    const id = typeof taskValue.id === 'string' ? taskValue.id : null;
    if (!id) continue;
    if (taskValue.evidence !== null && !eventTaskIds.get('evidence_recorded')?.has(id)) issue(path, `tasks.${id}.evidence`, 'requires a matching evidence_recorded activity event', issues);
    if (taskValue.verdict !== null && !eventTaskIds.get('review_recorded')?.has(id)) issue(path, `tasks.${id}.verdict`, 'requires a matching review_recorded activity event', issues);
    if (taskValue.disposition !== null && !eventTaskIds.get('task_disposed')?.has(id)) issue(path, `tasks.${id}.disposition`, 'requires a matching task_disposed activity event', issues);
  }
}

function brief(value: unknown, path: string, field: string, issues: ValidationIssue[]): void {
  if (!record(value)) { issue(path, field, 'must be an object', issues); return; }
  exact(value, ['path', 'digest', 'sourceIdea'], path, field, issues);
  safeRelative(value.path, path, `${field}.path`, issues);
  digest(value.digest, path, `${field}.digest`, issues);
  if (value.sourceIdea !== null) {
    if (!record(value.sourceIdea)) { issue(path, `${field}.sourceIdea`, 'must be an object or null', issues); return; }
    exact(value.sourceIdea, ['path', 'digest', 'title'], path, `${field}.sourceIdea`, issues);
    safeRelative(value.sourceIdea.path, path, `${field}.sourceIdea.path`, issues);
    digest(value.sourceIdea.digest, path, `${field}.sourceIdea.digest`, issues);
    nonempty(value.sourceIdea.title, path, `${field}.sourceIdea.title`, issues);
  }
}

function handoff(value: unknown, path: string, field: string, issues: ValidationIssue[]): void {
  if (!record(value)) { issue(path, field, 'must be an object', issues); return; }
  exact(value, ['nextAction', 'nextTaskId', 'blockedReason'], path, field, issues);
  if (typeof value.nextAction !== 'string' || !ACTIONS.includes(value.nextAction)) issue(path, `${field}.nextAction`, 'must be a valid Work action', issues);
  nullableString(value.nextTaskId, path, `${field}.nextTaskId`, issues);
  nullableNonempty(value.blockedReason, path, `${field}.blockedReason`, issues);
}

function task(value: unknown, path: string, field: string, issues: ValidationIssue[]): void {
  if (!record(value)) { issue(path, field, 'must be an object', issues); return; }
  exact(value, ['id', 'title', 'description', 'context', 'filesToTouch', 'acceptanceCriteria', 'dependsOn', 'status', 'blocker', 'evidence', 'verdict', 'disposition', 'definitionRevision'], path, field, issues);
  taskId(value.id, path, `${field}.id`, issues);
  nonempty(value.title, path, `${field}.title`, issues);
  nonempty(value.description, path, `${field}.description`, issues);
  str(value.context, path, `${field}.context`, issues);
  paths(value.filesToTouch, path, `${field}.filesToTouch`, issues);
  uniqueStrings(value.acceptanceCriteria, path, `${field}.acceptanceCriteria`, issues, true);
  if (!Array.isArray(value.dependsOn)) issue(path, `${field}.dependsOn`, 'must be an array', issues);
  else value.dependsOn.forEach((dependency, index) => taskId(dependency, path, `${field}.dependsOn[${index}]`, issues));
  if (typeof value.status !== 'string' || !TASK_STATES.includes(value.status)) issue(path, `${field}.status`, 'must be a Work task status', issues);
  nullableObject(value.blocker, path, `${field}.blocker`, issues, blocker);
  nullableObject(value.evidence, path, `${field}.evidence`, issues, evidence);
  nullableObject(value.verdict, path, `${field}.verdict`, issues, verdict);
  nullableObject(value.disposition, path, `${field}.disposition`, issues, disposition);
  positive(value.definitionRevision, path, `${field}.definitionRevision`, issues);
}

function blocker(value: unknown, path: string, field: string, issues: ValidationIssue[]): void {
  if (!record(value)) { issue(path, field, 'must be an object', issues); return; }
  exact(value, ['reason', 'by', 'recordedAt'], path, field, issues);
  nonempty(value.reason, path, `${field}.reason`, issues);
  nonempty(value.by, path, `${field}.by`, issues);
  timestamp(value.recordedAt, path, `${field}.recordedAt`, issues);
}

function evidence(value: unknown, path: string, field: string, issues: ValidationIssue[]): void {
  if (!record(value)) { issue(path, field, 'must be an object', issues); return; }
  exact(value, ['summary', 'validations', 'filesChanged', 'notes', 'by', 'recordedAt', 'definitionRevision', 'materialDigest'], path, field, issues);
  nonempty(value.summary, path, `${field}.summary`, issues);
  if (!Array.isArray(value.validations) || value.validations.length === 0) issue(path, `${field}.validations`, 'must be a non-empty array', issues);
  else value.validations.forEach((item, index) => validation(item, path, `${field}.validations[${index}]`, issues));
  paths(value.filesChanged, path, `${field}.filesChanged`, issues);
  nullableString(value.notes, path, `${field}.notes`, issues);
  nonempty(value.by, path, `${field}.by`, issues);
  timestamp(value.recordedAt, path, `${field}.recordedAt`, issues);
  positive(value.definitionRevision, path, `${field}.definitionRevision`, issues);
  digest(value.materialDigest, path, `${field}.materialDigest`, issues);
}

function validation(value: unknown, path: string, field: string, issues: ValidationIssue[]): void {
  if (!record(value)) { issue(path, field, 'must be an object', issues); return; }
  exact(value, ['command', 'result', 'note'], path, field, issues);
  nonempty(value.command, path, `${field}.command`, issues);
  if (!['passed', 'failed', 'not_run'].includes(value.result as string)) issue(path, `${field}.result`, 'must be a validation result', issues);
  nullableString(value.note, path, `${field}.note`, issues);
}

function verdict(value: unknown, path: string, field: string, issues: ValidationIssue[]): void {
  if (!record(value)) { issue(path, field, 'must be an object', issues); return; }
  exact(value, ['result', 'checkedCriteria', 'findings', 'by', 'reviewedAt', 'definitionRevision', 'evidenceDigest', 'reviewedMaterialDigest'], path, field, issues);
  if (!['pass', 'fail'].includes(value.result as string)) issue(path, `${field}.result`, 'must be pass or fail', issues);
  uniqueStrings(value.checkedCriteria, path, `${field}.checkedCriteria`, issues, false);
  if (!Array.isArray(value.findings)) issue(path, `${field}.findings`, 'must be an array', issues);
  else value.findings.forEach((item, index) => finding(item, path, `${field}.findings[${index}]`, issues));
  nonempty(value.by, path, `${field}.by`, issues);
  timestamp(value.reviewedAt, path, `${field}.reviewedAt`, issues);
  positive(value.definitionRevision, path, `${field}.definitionRevision`, issues);
  digest(value.evidenceDigest, path, `${field}.evidenceDigest`, issues);
  digest(value.reviewedMaterialDigest, path, `${field}.reviewedMaterialDigest`, issues);
}

function finding(value: unknown, path: string, field: string, issues: ValidationIssue[]): void {
  if (!record(value)) { issue(path, field, 'must be an object', issues); return; }
  exact(value, ['severity', 'detail'], path, field, issues);
  if (!['critical', 'warning', 'suggestion'].includes(value.severity as string)) issue(path, `${field}.severity`, 'must be a finding severity', issues);
  nonempty(value.detail, path, `${field}.detail`, issues);
}

function disposition(value: unknown, path: string, field: string, issues: ValidationIssue[]): void {
  if (!record(value)) { issue(path, field, 'must be an object', issues); return; }
  exact(value, ['kind', 'reason', 'by', 'recordedAt', 'replacementTaskId'], path, field, issues);
  if (!['cancelled', 'superseded'].includes(value.kind as string)) issue(path, `${field}.kind`, 'must be cancelled or superseded', issues);
  nonempty(value.reason, path, `${field}.reason`, issues);
  nonempty(value.by, path, `${field}.by`, issues);
  timestamp(value.recordedAt, path, `${field}.recordedAt`, issues);
  nullableString(value.replacementTaskId, path, `${field}.replacementTaskId`, issues);
}

function activity(value: unknown, path: string, field: string, issues: ValidationIssue[]): void {
  if (!record(value)) { issue(path, field, 'must be an object', issues); return; }
  exact(value, ['seq', 'at', 'event', 'taskId', 'by', 'reason', 'revision'], path, field, issues);
  positive(value.seq, path, `${field}.seq`, issues);
  timestamp(value.at, path, `${field}.at`, issues);
  if (typeof value.event !== 'string' || !EVENTS.includes(value.event)) issue(path, `${field}.event`, 'must be a Work activity event', issues);
  nullableString(value.taskId, path, `${field}.taskId`, issues);
  nonempty(value.by, path, `${field}.by`, issues);
  nonempty(value.reason, path, `${field}.reason`, issues);
  positive(value.revision, path, `${field}.revision`, issues);
}

function closure(value: unknown, path: string, field: string, issues: ValidationIssue[]): void {
  if (!record(value)) { issue(path, field, 'must be an object', issues); return; }
  exact(value, ['outcome', 'reason', 'by', 'closedAt', 'briefDigest', 'finalRevision'], path, field, issues);
  if (!['completed', 'stopped'].includes(value.outcome as string)) issue(path, `${field}.outcome`, 'must be completed or stopped', issues);
  nonempty(value.reason, path, `${field}.reason`, issues);
  nonempty(value.by, path, `${field}.by`, issues);
  timestamp(value.closedAt, path, `${field}.closedAt`, issues);
  digest(value.briefDigest, path, `${field}.briefDigest`, issues);
  positive(value.finalRevision, path, `${field}.finalRevision`, issues);
}

function promotion(value: unknown, path: string, field: string, issues: ValidationIssue[]): void {
  if (!record(value)) { issue(path, field, 'must be an object', issues); return; }
  exact(value, ['targetScope', 'targetPath', 'sourceRevision', 'sourceDigest', 'promotedTaskIds', 'promotedAt', 'by'], path, field, issues);
  slug(value.targetScope, path, `${field}.targetScope`, issues);
  safeRelative(value.targetPath, path, `${field}.targetPath`, issues);
  positive(value.sourceRevision, path, `${field}.sourceRevision`, issues);
  digest(value.sourceDigest, path, `${field}.sourceDigest`, issues);
  if (!Array.isArray(value.promotedTaskIds)) issue(path, `${field}.promotedTaskIds`, 'must be an array', issues);
  else value.promotedTaskIds.forEach((item, index) => taskId(item, path, `${field}.promotedTaskIds[${index}]`, issues));
  timestamp(value.promotedAt, path, `${field}.promotedAt`, issues);
  nonempty(value.by, path, `${field}.by`, issues);
}

/**
 * Reciprocal promotion sidecar published under the target Forge scope.
 * Versioned exact keys; every digest binds bytes external to this record
 * (pre-promotion work.json as sourceDigest, target sprint.json, brief.md),
 * never this record itself.
 */
export function validatePromotionSidecar(value: unknown, path = 'promotion-source.json'): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!record(value)) return [{ path, field: '<root>', message: 'must be an object' }];
  exact(value, ['schemaVersion', 'kind', 'sourceWorkId', 'sourcePath', 'sourceRevision', 'sourceDigest', 'sourceBriefDigest', 'targetScope', 'targetPath', 'targetDigest', 'promotedTaskIds', 'actor', 'preparedAt', 'promotedAt', 'requestDigest'], path, '', issues);
  literal(value, 'schemaVersion', 1, path, issues);
  if (value.kind !== 'work-promotion-source') issue(path, 'kind', 'must be work-promotion-source', issues);
  slug(value.sourceWorkId, path, 'sourceWorkId', issues);
  safeRelative(value.sourcePath, path, 'sourcePath', issues);
  if (typeof value.sourcePath === 'string' && !value.sourcePath.endsWith('/work.json')) issue(path, 'sourcePath', 'must point to a work.json source', issues);
  positive(value.sourceRevision, path, 'sourceRevision', issues);
  digest(value.sourceDigest, path, 'sourceDigest', issues);
  digest(value.sourceBriefDigest, path, 'sourceBriefDigest', issues);
  slug(value.targetScope, path, 'targetScope', issues);
  safeRelative(value.targetPath, path, 'targetPath', issues);
  if (typeof value.targetPath === 'string' && !value.targetPath.endsWith('/sprint.json')) issue(path, 'targetPath', 'must point to a sprint.json destination', issues);
  digest(value.targetDigest, path, 'targetDigest', issues);
  if (!Array.isArray(value.promotedTaskIds)) issue(path, 'promotedTaskIds', 'must be an array', issues);
  else value.promotedTaskIds.forEach((item, index) => taskId(item, path, `promotedTaskIds[${index}]`, issues));
  nonempty(value.actor, path, 'actor', issues);
  timestamp(value.preparedAt, path, 'preparedAt', issues);
  timestamp(value.promotedAt, path, 'promotedAt', issues);
  digest(value.requestDigest, path, 'requestDigest', issues);
  return issues;
}

/**
 * Durable pending promotion intent under the source Work directory.
 * Lifecycle evidence only: readers derive blocked state from it but never
 * treat its presence as a completed promotion.
 */
export function validatePromotionJournal(value: unknown, path = '.pending-promotion.json'): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!record(value)) return [{ path, field: '<root>', message: 'must be an object' }];
  exact(value, ['schemaVersion', 'kind', 'workId', 'toScope', 'expectedRevision', 'actor', 'requestDigest', 'sourceBriefDigest', 'oldWorkDigest', 'newWorkDigest', 'stagedTargetDigest', 'preparedAt'], path, '', issues);
  literal(value, 'schemaVersion', 1, path, issues);
  if (value.kind !== 'work-promotion-intent') issue(path, 'kind', 'must be work-promotion-intent', issues);
  slug(value.workId, path, 'workId', issues);
  slug(value.toScope, path, 'toScope', issues);
  positive(value.expectedRevision, path, 'expectedRevision', issues);
  nonempty(value.actor, path, 'actor', issues);
  digest(value.requestDigest, path, 'requestDigest', issues);
  digest(value.sourceBriefDigest, path, 'sourceBriefDigest', issues);
  digest(value.oldWorkDigest, path, 'oldWorkDigest', issues);
  digest(value.newWorkDigest, path, 'newWorkDigest', issues);
  digest(value.stagedTargetDigest, path, 'stagedTargetDigest', issues);
  timestamp(value.preparedAt, path, 'preparedAt', issues);
  return issues;
}

function hasCycle(tasks: Record<string, unknown>[]): boolean {
  return hasDependencyCycle(tasks.map((item) => ({
    id: String(item.id),
    dependsOn: Array.isArray(item.dependsOn) ? item.dependsOn.filter((id): id is string => typeof id === 'string') : [],
  })));
}

export interface WorkTaskAmendmentProposal {
  title: string;
  description: string;
  context: string;
  filesToTouch: string[];
  acceptanceCriteria: string[];
  dependsOn: string[];
}

/**
 * True when the proposed definition differs materially from the stored task.
 * Title and description compare trimmed (the writer stores them trimmed);
 * a whitespace-only change is not material. Context, files, and criteria
 * compare exactly as written; dependencies compare as an unordered edge set
 * because prerequisite order carries no graph semantics.
 */
export function isMaterialTaskDefinitionChange(
  current: Pick<WorkTaskDefinition, 'title' | 'description' | 'context' | 'filesToTouch' | 'acceptanceCriteria' | 'dependsOn'>,
  proposal: WorkTaskAmendmentProposal,
): boolean {
  if (proposal.title.trim() !== current.title) return true;
  if (proposal.description.trim() !== current.description) return true;
  if (proposal.context !== current.context) return true;
  if (!sameOrderedStrings(proposal.filesToTouch, current.filesToTouch)) return true;
  if (!sameOrderedStrings(proposal.acceptanceCriteria, current.acceptanceCriteria)) return true;
  if (!sameUnorderedStrings(proposal.dependsOn, current.dependsOn)) return true;
  return false;
}

/**
 * Clear the current approval bound to a task whose definition or brief changed.
 * Evidence and verdicts (pass or fail) reference the previous material via
 * definitionRevision and digests, so the schema requires them to be dropped.
 * Tasks awaiting review or verified return to pending; in-progress and blocked
 * tasks keep their status so local work can continue under the new contract.
 * Prior approvals remain auditable in activity history; this only clears the
 * live approval. Pending and disposed tasks are returned unchanged.
 */
export function demoteTaskForInvalidation(task: WorkTask): WorkTask {
  if (task.evidence === null && task.verdict === null
    && task.status !== 'awaiting_review' && task.status !== 'verified') return task;
  const cleared: WorkTask = { ...task, evidence: null, verdict: null };
  if (task.status === 'awaiting_review' || task.status === 'verified') {
    cleared.status = 'pending';
    cleared.blocker = null;
  }
  return cleared;
}

/** Transitive dependents of a task in BFS order (iterative, no recursion). */
export function transitiveDependentIds(
  tasks: ReadonlyArray<{ id: string; dependsOn: readonly string[] }>,
  rootId: string,
): string[] {
  const dependents = new Map<string, string[]>();
  for (const task of tasks) for (const dependency of task.dependsOn) {
    const children = dependents.get(dependency) ?? [];
    children.push(task.id);
    dependents.set(dependency, children);
  }
  const visited = new Set<string>([rootId]);
  const queue = [...(dependents.get(rootId) ?? [])];
  const result: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    result.push(id);
    for (const child of dependents.get(id) ?? []) if (!visited.has(child)) queue.push(child);
  }
  return result;
}

export function hasDependencyCycle(tasks: ReadonlyArray<{ id: string; dependsOn: readonly string[] }>): boolean {
  const pending = new Map(tasks.map((task) => [task.id, 0]));
  const dependents = new Map<string, string[]>();
  for (const task of tasks) for (const dependency of task.dependsOn) {
    if (!pending.has(dependency)) continue;
    pending.set(task.id, (pending.get(task.id) ?? 0) + 1);
    const children = dependents.get(dependency) ?? [];
    children.push(task.id);
    dependents.set(dependency, children);
  }
  const queue = [...pending].filter(([, count]) => count === 0).map(([id]) => id);
  for (let head = 0; head < queue.length; head++) {
    for (const child of dependents.get(queue[head]) ?? []) {
      const count = (pending.get(child) ?? 0) - 1;
      pending.set(child, count);
      if (count === 0) queue.push(child);
    }
  }
  return queue.length !== pending.size;
}

function exact(value: Record<string, unknown>, keys: string[], path: string, field: string, issues: ValidationIssue[]): void {
  for (const key of Object.keys(value)) if (!keys.includes(key)) issue(path, field ? `${field}.${key}` : key, 'is not allowed', issues);
  for (const key of keys) if (!(key in value)) issue(path, field ? `${field}.${key}` : key, 'is required', issues);
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function issue(path: string, field: string, message: string, issues: ValidationIssue[]): void { issues.push({ path, field, message }); }
function str(value: unknown, path: string, field: string, issues: ValidationIssue[]): void { if (typeof value !== 'string') issue(path, field, 'must be a string', issues); }
function nonempty(value: unknown, path: string, field: string, issues: ValidationIssue[]): void { if (typeof value !== 'string' || value.trim() === '') issue(path, field, 'must be a non-empty string', issues); }
function nullableString(value: unknown, path: string, field: string, issues: ValidationIssue[]): void { if (value !== null && typeof value !== 'string') issue(path, field, 'must be a string or null', issues); }
function nullableNonempty(value: unknown, path: string, field: string, issues: ValidationIssue[]): void { if (value !== null && (typeof value !== 'string' || value.trim() === '')) issue(path, field, 'must be a non-empty string or null', issues); }
function literal(value: Record<string, unknown>, key: string, expected: unknown, path: string, issues: ValidationIssue[]): void { if (value[key] !== expected) issue(path, key, `must be ${String(expected)}`, issues); }
function positive(value: unknown, path: string, field: string, issues: ValidationIssue[]): void { if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) issue(path, field, 'must be a positive integer', issues); }
function isTimestamp(value: unknown): value is string { return typeof value === 'string' && ISO_UTC.test(value) && !Number.isNaN(Date.parse(value)); }
function timestamp(value: unknown, path: string, field: string, issues: ValidationIssue[]): void { if (!isTimestamp(value)) issue(path, field, 'must be an ISO-8601 UTC timestamp', issues); }
function digest(value: unknown, path: string, field: string, issues: ValidationIssue[]): void { if (typeof value !== 'string' || !SHA256.test(value)) issue(path, field, 'must be a lowercase SHA-256 digest', issues); }
function slug(value: unknown, path: string, field: string, issues: ValidationIssue[]): void { if (typeof value !== 'string' || !SLUG.test(value)) issue(path, field, 'must be a safe slug', issues); }
function taskId(value: unknown, path: string, field: string, issues: ValidationIssue[]): void { if (typeof value !== 'string' || !TASK_ID.test(value)) issue(path, field, 'must match Wn', issues); }
function safeRelative(value: unknown, path: string, field: string, issues: ValidationIssue[]): void {
  if (typeof value !== 'string' || value === '' || value.startsWith('/') || value.includes('\\') || value.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
    issue(path, field, 'must be a safe relative path', issues);
  }
}
function paths(value: unknown, path: string, field: string, issues: ValidationIssue[]): void { if (!Array.isArray(value)) issue(path, field, 'must be an array', issues); else value.forEach((item, index) => safeRelative(item, path, `${field}[${index}]`, issues)); }
function uniqueStrings(value: unknown, path: string, field: string, issues: ValidationIssue[], requireNonempty: boolean): void {
  if (!Array.isArray(value) || (requireNonempty && value.length === 0) || !value.every((item) => typeof item === 'string' && (!requireNonempty || item.trim() !== ''))) issue(path, field, 'must be a valid string array', issues);
  else if (new Set(value.map((item) => item.replace(/\s+/g, ' ').trim().toLocaleLowerCase('en-US'))).size !== value.length) issue(path, field, 'must contain unique strings after normalization', issues);
}
function nullableObject(value: unknown, path: string, field: string, issues: ValidationIssue[], validator: (value: unknown, path: string, field: string, issues: ValidationIssue[]) => void): void { if (value !== null) validator(value, path, field, issues); }
function isDisposed(value: Record<string, unknown> | undefined): boolean { return value?.status === 'cancelled' || value?.status === 'superseded'; }
function isTerminal(value: Record<string, unknown>): boolean { return value.status === 'verified' || isDisposed(value); }
function sameStrings(left: unknown[], right: unknown[]): boolean { return left.length === right.length && left.every((value) => right.includes(value)) && right.every((value) => left.includes(value)); }
function sameOrderedStrings(left: readonly string[], right: readonly string[]): boolean { return left.length === right.length && left.every((value, index) => value === right[index]); }
function sameUnorderedStrings(left: readonly string[], right: readonly string[]): boolean { return left.length === right.length && [...left].sort().every((value, index) => value === [...right].sort()[index]); }
function digestJson(value: unknown): string {
  const stable = (item: unknown): unknown => Array.isArray(item) ? item.map(stable) : record(item) ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, stable(item[key])])) : item;
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}
