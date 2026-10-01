import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { sha256 } from '../checkpoints/sprint-close';
import { KyroCoreError } from '../core/errors';
import { WORK_ROOT, amendWorkBrief, assertBriefIntegrity, assertPromotionReciprocal, assertWorkId, createWork, promoteWork, readPromotionJournal, readWork, reopenWork, updateWork } from '../work/store';
import { readBriefSourceBytes } from '../work/brief-source';
import { planPromotionPreview } from '../work/promotion';

/** Re-exported so existing Work fixtures keep importing the reader from this command module. */
export { BRIEF_SOURCE_LIMIT, readBoundedBriefDescriptor } from '../work/brief-source';
import { computeEvidenceDigest, computeMaterialDigest, demoteTaskForInvalidation, deriveWorkHandoff, hasDependencyCycle, isMaterialTaskDefinitionChange, transitiveDependentIds } from '../work/schema';
import type { WorkTaskAmendmentProposal } from '../work/schema';
import type { WorkEvidence, WorkFile, WorkFinding, WorkTask, WorkValidation, WorkVerdict } from '../types';

export function runWorkCommand(args: string[]): void {
  const [subcommand = '', ...rest] = args;
  if (subcommand === '--help' || subcommand === '-h' || subcommand === 'help') {
    console.log([
      'Usage:',
      '  kyro work create --id <slug> --from <brief-or-idea> [--by <actor>] [--dry-run] [--json]',
      '  kyro work plan --work <slug> --from <proposal.json> --expect-revision <n> [--by <actor>] [--dry-run] [--json]',
      '  kyro work start --work <slug> --task Wn --expect-revision <n> [--by <actor>] [--dry-run] [--json]',
      '  kyro work block --work <slug> --task Wn --reason <text> --expect-revision <n> [--by <actor>] [--dry-run] [--json]',
      '  kyro work unblock --work <slug> --task Wn --expect-revision <n> [--by <actor>] [--dry-run] [--json]',
      '  kyro work record-evidence --work <slug> --task Wn --from <evidence.json> --expect-revision <n> --by <maker> [--dry-run] [--json]',
      '  kyro work review --work <slug> --task Wn --from <review.json> --verdict pass|fail --expect-revision <n> --by <checker> [--dry-run] [--json]',
      '  kyro work amend-task --work <slug> --task Wn --from <proposal.json> --reason <text> --expect-revision <n> --by <actor> [--dry-run] [--json]',
      '  kyro work amend-brief --work <slug> --from <brief.md> --reason <text> --expect-revision <n> --by <actor> [--dry-run] [--json]',
      '  kyro work dispose --work <slug> --task Wn --kind cancelled|superseded --reason <text> --expect-revision <n> --by <actor> [--replacement-task Wn] [--dry-run] [--json]',
  '  kyro work close --work <slug> --outcome completed|stopped --reason <text> --expect-revision <n> --by <actor> [--dry-run | --yes] [--json]',
  '  kyro work reopen --work <slug> --reason <text> --expect-revision <n> --by <actor> [--dry-run | --yes] [--json]',
  '  kyro work promote --work <slug> --to-scope <new-forge-scope> --expect-revision <n> --by <actor> [--dry-run | --yes] [--json]',
      '  kyro work status --work <slug> [--task Wn] [--json]',
      '  kyro work context-pack --work <slug> [--task Wn] [--json]',
    ].join('\n'));
    console.log('Evidence and review require --by with a specific actor. Validation results are maker-reported; a pass requires a different checker and does not certify automatic test execution or Forge QA.');
    console.log('Brief amendments require lossless UTF-8. An interrupted amendment blocks other Work mutations; retry with the original source, actor, reason, and expected revision. External brief edits never authorize recovery.');
    console.log('Promotion transfers only unfinished tasks as pending Forge tasks with no carried approval; a Work pass never becomes Forge QA. An interrupted promotion blocks other Work mutations; status shows the exact retry command. Status and doctor verify the reciprocal link before reporting a promoted Work as healthy. Until the installed runtime gains work, run these commands from the workspace build (node dist/cli.js).');
    return;
  }
  if (subcommand === 'create') return create(rest);
  if (subcommand === 'plan') return plan(rest);
  if (subcommand === 'start') return transition(rest, 'start');
  if (subcommand === 'block') return transition(rest, 'block');
  if (subcommand === 'unblock') return transition(rest, 'unblock');
  if (subcommand === 'record-evidence') return recordEvidence(rest);
  if (subcommand === 'review') return review(rest);
  if (subcommand === 'amend-task') return amendTask(rest);
  if (subcommand === 'amend-brief') return amendBrief(rest);
  if (subcommand === 'dispose') return dispose(rest);
  if (subcommand === 'close') return closeWork(rest);
  if (subcommand === 'reopen') return reopen(rest);
  if (subcommand === 'promote') return promote(rest);
  if (subcommand === 'status') return status(rest, false);
  if (subcommand === 'context-pack') return status(rest, true);
  throw new KyroCoreError('INVALID_INPUT', `Unknown work command: ${subcommand}.`, 'Use kyro work --help for supported commands.');
}
function closeWork(args: string[]): void {
  const options = parse(args, ['work', 'outcome', 'reason', 'expect-revision', 'by', 'yes']);
  const id = required(options, 'work');
  const outcome = required(options, 'outcome');
  if (outcome !== 'completed' && outcome !== 'stopped') throw new KyroCoreError('INVALID_INPUT', '--outcome must be completed or stopped.', 'Choose the truthful Work outcome.');
  const { reason, by, expectedRevision, dryRun } = closeOptions(options);
  const result = updateWork(id, expectedRevision, (current) => {
    const draftEmpty = current.state === 'draft' && current.tasks.length === 0;
    if (current.state !== 'active' && !draftEmpty) throw new KyroCoreError('INVALID_INPUT', `Work ${id} is not active and cannot be closed.`, 'Only active Work can close, except an empty draft may be stopped.');
    if (draftEmpty && outcome !== 'stopped') throw new KyroCoreError('INVALID_INPUT', 'An empty draft Work can only be stopped.', 'Use --outcome stopped with an explicit reason.');
    const unresolved = current.tasks.filter((task) => !['verified', 'cancelled', 'superseded'].includes(task.status));
    if (outcome === 'completed' && unresolved.length) throw new KyroCoreError('INVALID_INPUT', `Completed closure has ${unresolved.length} unresolved task(s): ${unresolved.map((task) => task.id).join(', ')}.`, 'Use stopped or resolve every task explicitly.');
    const now = new Date().toISOString();
    const next: WorkFile = { ...current, state: 'closed', revision: current.revision + 1, updatedAt: now,
      closure: { outcome, reason, by, closedAt: now, briefDigest: current.brief.digest, finalRevision: current.revision + 1 },
      activity: [...current.activity, { seq: current.activity.length + 1, at: now, event: 'work_closed', taskId: null, by, reason, revision: current.revision + 1 }], handoff: { ...current.handoff } };
    next.handoff = deriveWorkHandoff(next);
    if (!dryRun && process.env.KYRO_WORK_INJECT_FAILURE === 'close-before-write') throw new KyroCoreError('INTERNAL', 'Injected Work close failure before publication.', 'Retry the same close command.');
    return next;
  }, dryRun);
  output({ work: id, revision: result.revision, state: result.state, outcome,
    summary: workClosureSummary(result), closure: result.closure, handoff: result.handoff, dryRun }, Boolean(options.json));
}

function promote(args: string[]): void {
  const options = parse(args, ['work', 'to-scope', 'expect-revision', 'by', 'yes']);
  const id = required(options, 'work');
  const toScope = required(options, 'to-scope');
  const expectedRevision = Number(required(options, 'expect-revision'));
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new KyroCoreError('INVALID_INPUT', '--expect-revision must be a positive integer.', 'Read Work status and retry from the current revision.');
  const by = requiredActor(options);
  const dryRun = options.dryRun === true;
  if (dryRun && options.yes === true) throw new KyroCoreError('INVALID_INPUT', '--dry-run and --yes cannot be combined.', 'Preview first, then confirm in a separate command.');
  if (!dryRun && options.yes !== true) throw new KyroCoreError('INVALID_INPUT', 'Promotion requires --yes to confirm.', 'Preview with --dry-run, then repeat with --yes.');
  if (dryRun) {
    const work = readWork(id);
    assertBriefIntegrity(work);
    const preview = planPromotionPreview(work, { toScope, actor: by, expectedRevision });
    output({ ...preview, dryRun: true }, Boolean(options.json));
    return;
  }
  const result = promoteWork(id, expectedRevision, { toScope, actor: by }, false);
  output({
    work: id,
    revision: result.work.revision,
    state: result.work.state,
    targetScope: toScope,
    targetPath: result.work.promotion?.targetPath,
    promotedTaskIds: result.work.promotion?.promotedTaskIds,
    requestDigest: result.requestDigest,
    targetDigest: result.targetDigest,
    recovered: result.recovered,
    handoff: result.work.handoff,
    dryRun: false,
  }, Boolean(options.json));
}

function reopen(args: string[]): void {
  const options = parse(args, ['work', 'reason', 'expect-revision', 'by', 'yes']);
  const id = required(options, 'work');
  const { reason, by, expectedRevision, dryRun } = closeOptions(options);
  const result = reopenWork(id, expectedRevision, reason, by, dryRun);
  output({ work: id, revision: result.work.revision, state: result.work.state, summary: workClosureSummary(result.work),
    closureHistoryPath: result.historyPath, handoff: result.work.handoff, dryRun }, Boolean(options.json));
}

function closeOptions(options: Record<string, string | boolean>): { reason: string; by: string; expectedRevision: number; dryRun: boolean } {
  const reason = required(options, 'reason').trim();
  if (!reason || reason.length > 2000) throw new KyroCoreError('INVALID_INPUT', '--reason must be 1-2000 non-whitespace characters.', 'Provide a concise explicit reason.');
  const by = requiredActor(options);
  const expectedRevision = Number(required(options, 'expect-revision'));
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new KyroCoreError('INVALID_INPUT', '--expect-revision must be a positive integer.', 'Read Work status and retry.');
  const dryRun = options.dryRun === true;
  if (dryRun && options.yes === true) throw new KyroCoreError('INVALID_INPUT', '--dry-run and --yes cannot be combined.', 'Preview first, then confirm in a separate command.');
  if (!dryRun && options.yes !== true) throw new KyroCoreError('INVALID_INPUT', 'Closure transitions require --yes to confirm.', 'Preview with --dry-run, then repeat with --yes.');
  return { reason, by, expectedRevision, dryRun };
}

function workClosureSummary(work: WorkFile): { verified: string[]; disposed: string[]; pending: string[]; inProgress: string[]; blocked: string[]; awaitingReview: string[]; unresolved: string[] } {
  const ids = (status: WorkTask['status']) => work.tasks.filter((task) => task.status === status).map((task) => task.id);
  const pending = ids('pending'); const inProgress = ids('in_progress'); const blocked = ids('blocked'); const awaitingReview = ids('awaiting_review');
  return { verified: ids('verified'), disposed: [...ids('cancelled'), ...ids('superseded')], pending, inProgress, blocked, awaitingReview,
    unresolved: work.tasks.filter((task) => !['verified', 'cancelled', 'superseded'].includes(task.status)).map((task) => task.id) };
}
function dispose(args: string[]): void {
  const options = parse(args, ['work', 'task', 'kind', 'reason', 'replacement-task', 'expect-revision', 'by']);
  const id = required(options, 'work');
  const taskId = required(options, 'task');
  if (!/^W[1-9]\d*$/.test(taskId)) throw new KyroCoreError('INVALID_INPUT', `Unsafe Work task reference: ${taskId}.`, 'Use a task ID such as W1.');
  const kind = required(options, 'kind');
  if (kind !== 'cancelled' && kind !== 'superseded') throw new KyroCoreError('INVALID_INPUT', '--kind must be cancelled or superseded.', 'Choose an explicit disposition kind.');
  const reason = required(options, 'reason').trim();
  if (!reason || reason.length > 2000) throw new KyroCoreError('INVALID_INPUT', '--reason must be 1-2000 non-whitespace characters.', 'Explain why the task is disposed.');
  const by = requiredActor(options);
  const expectedRevision = Number(required(options, 'expect-revision'));
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new KyroCoreError('INVALID_INPUT', '--expect-revision must be a positive integer.', 'Read the current Work revision and retry.');
  const replacementTaskId = typeof options['replacement-task'] === 'string' ? options['replacement-task'] : null;
  if (kind === 'superseded' && (!replacementTaskId || !/^W[1-9]\d*$/.test(replacementTaskId))) throw new KyroCoreError('INVALID_INPUT', 'Superseded disposal requires --replacement-task Wn.', 'Name an existing replacement task.');
  if (kind === 'cancelled' && replacementTaskId !== null) throw new KyroCoreError('INVALID_INPUT', 'Cancelled disposal cannot have a replacement task.', 'Omit --replacement-task.');
  const result = updateWork(id, expectedRevision, (current) => {
    if (current.state !== 'active') throw new KyroCoreError('INVALID_INPUT', `Work ${id} is not active.`, 'Dispose tasks only in an active Work.');
    const task = current.tasks.find((item) => item.id === taskId);
    if (!task) throw new KyroCoreError('INVALID_INPUT', `Work task ${taskId} does not exist.`, 'Refresh Work status and use an existing task ID.');
    if (!['pending', 'in_progress', 'blocked'].includes(task.status)) throw new KyroCoreError('INVALID_INPUT', `Task ${taskId} cannot be disposed from ${task.status}.`, 'Review awaiting evidence first; verified and disposed tasks are terminal.');
    if (replacementTaskId) {
      const replacement = current.tasks.find((item) => item.id === replacementTaskId);
      if (!replacement || replacementTaskId === taskId || ['cancelled', 'superseded'].includes(replacement.status)) throw new KyroCoreError('INVALID_INPUT', 'Replacement must be a different existing non-disposed task.', 'Choose a valid replacement task.');
      const visited = new Set<string>();
      const pending = [...replacement.dependsOn];
      while (pending.length) {
        const dependencyId = pending.pop()!;
        if (dependencyId === taskId) throw new KyroCoreError('INVALID_INPUT', `Replacement ${replacementTaskId} depends on disposed task ${taskId}.`, 'Amend the replacement dependency graph explicitly before disposal.');
        if (visited.has(dependencyId)) continue;
        visited.add(dependencyId);
        pending.push(...(current.tasks.find((item) => item.id === dependencyId)?.dependsOn ?? []));
      }
    }
    const now = new Date().toISOString();
    const tasks = current.tasks.map((item): WorkTask => item.id === taskId ? { ...item, status: kind, blocker: null, disposition: { kind, reason, by, recordedAt: now, replacementTaskId } } : item);
    const next: WorkFile = { ...current, revision: current.revision + 1, updatedAt: now, tasks, activity: [...current.activity, { seq: current.activity.length + 1, at: now, event: 'task_disposed', taskId, by, reason, revision: current.revision + 1 }], handoff: { ...current.handoff } };
    next.handoff = deriveWorkHandoff(next);
    return next;
  }, options.dryRun === true);
  output({ work: id, task: taskId, revision: result.revision, status: kind, replacementTaskId, handoff: result.handoff, dryRun: options.dryRun === true }, Boolean(options.json));
}
function create(args: string[]): void {
  const options = parse(args, ['id','from','by']); const id = required(options,'id'); const from = required(options,'from'); assertWorkId(id);
  const source = resolve(process.cwd(), from);
  // Bounded, no-follow, lossless ingestion: malformed, oversized, swapped, or
  // growing sources fail here, before any Work directory is published.
  const briefSource = readBriefSourceBytes(source, from);
  const briefText = briefSource.text;
  if (!briefText.trim()) throw new KyroCoreError('INVALID_INPUT', 'Brief source is empty.', 'Provide a non-empty brief.');
  const objective = firstOutcome(briefText);
  if (!objective) throw new KyroCoreError('INVALID_INPUT', 'Brief source has no verifiable body outcome after its front matter and title.', 'Add a substantive outcome paragraph below the document heading.');
  const now = new Date().toISOString(); const by = typeof options.by === 'string' ? options.by : 'cli'; const sourceIdea = from.startsWith('.agents/kyro/plan/') ? { path: from, digest: sha256(briefText), title: firstTitle(briefText) } : null;
  // brief.digest binds the original source bytes (equal to sha256(briefText) by
  // the lossless round-trip proven above); the writer publishes those bytes verbatim.
  const work: WorkFile = { schemaVersion: 1, kind: 'organic-work', id, title: firstTitle(briefText), objective, brief: { path: 'brief.md', digest: briefSource.digest, sourceIdea }, state: 'draft', revision: 1, createdAt: now, updatedAt: now, handoff: { nextAction: 'plan_tasks', nextTaskId: null, blockedReason: null }, tasks: [], activity: [{ seq: 1, at: now, event: 'created', taskId: null, by, reason: 'Created through the Work CLI.', revision: 1 }], closure: null, promotion: null };
  createWork(work, briefSource.bytes, options.dryRun === true); output({ work: id, path: `${WORK_ROOT}/${id}`, revision: 1, state: 'draft', nextAction: 'plan_tasks', dryRun: options.dryRun === true }, Boolean(options.json));
}
function transition(args: string[], action: 'start' | 'block' | 'unblock'): void {
  const allowed = action === 'block' ? ['work', 'task', 'expect-revision', 'reason', 'by'] : ['work', 'task', 'expect-revision', 'by'];
  const options = parse(args, allowed);
  const id = required(options, 'work'); const taskId = required(options, 'task');
  if (!/^W[1-9]\d*$/.test(taskId)) throw new KyroCoreError('INVALID_INPUT', `Unsafe Work task reference: ${taskId}.`, 'Use a task ID such as W1.');
  const expectedRevision = Number(required(options, 'expect-revision'));
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new KyroCoreError('INVALID_INPUT', '--expect-revision must be a positive integer.', 'Read the current Work revision and retry.');
  const reason = action === 'block' ? required(options, 'reason').trim() : '';
  if (action === 'block' && !reason) throw new KyroCoreError('INVALID_INPUT', '--reason must not be empty.', 'Provide a concrete blocker reason.');
  const by = typeof options.by === 'string' ? options.by : 'cli';
  const result = updateWork(id, expectedRevision, (current) => {
    if (current.state !== 'active') throw new KyroCoreError('INVALID_INPUT', `Work ${id} is not active.`, 'Task transitions require an active Work.');
    const index = current.tasks.findIndex((task) => task.id === taskId);
    if (index < 0) throw new KyroCoreError('INVALID_INPUT', `Work task ${taskId} does not exist.`, 'Refresh Work status and use an existing task ID.');
    const task = current.tasks[index];
    const now = new Date().toISOString();
    let nextTask: WorkTask;
    let event: 'task_started' | 'task_blocked' | 'task_unblocked';
    let activityReason: string;
    if (action === 'start') {
      if (task.status !== 'pending') throw new KyroCoreError('INVALID_INPUT', `Task ${taskId} cannot start from ${task.status}.`, 'Only an eligible pending task can start.');
      const dependencies = task.dependsOn.map((dependencyId) => current.tasks.find((candidate) => candidate.id === dependencyId)!);
      const unavailable = dependencies.find((dependency) => dependency.status !== 'verified');
      if (unavailable) throw new KyroCoreError('INVALID_INPUT', `Task ${taskId} is ineligible because dependency ${unavailable.id} is ${unavailable.status}.`, 'Verify every prerequisite before starting this task.');
      nextTask = { ...task, status: 'in_progress' }; event = 'task_started'; activityReason = 'Task started through the Work CLI.';
    } else if (action === 'block') {
      if (!['pending', 'in_progress'].includes(task.status)) throw new KyroCoreError('INVALID_INPUT', `Task ${taskId} cannot be blocked from ${task.status}.`, 'Only pending or in-progress tasks can be blocked.');
      nextTask = { ...task, status: 'blocked', blocker: { reason, by, recordedAt: now } }; event = 'task_blocked'; activityReason = reason;
    } else {
      if (task.status !== 'blocked' || task.blocker === null) throw new KyroCoreError('INVALID_INPUT', `Task ${taskId} is not blocked.`, 'Only a blocked task can be unblocked.');
      const resumeFailedReview = task.verdict?.result === 'fail';
      nextTask = { ...task, status: resumeFailedReview ? 'in_progress' : 'pending', blocker: null };
      event = 'task_unblocked';
      activityReason = resumeFailedReview ? 'Task unblocked and returned to failed-review remediation.' : 'Task unblocked and returned to pending eligibility.';
    }
    const tasks = current.tasks.map((item, itemIndex) => itemIndex === index ? nextTask : item);
    const next: WorkFile = { ...current, revision: current.revision + 1, updatedAt: now, tasks, activity: [...current.activity, { seq: current.activity.length + 1, at: now, event, taskId, by, reason: activityReason, revision: current.revision + 1 }], handoff: { ...current.handoff } };
    next.handoff = deriveWorkHandoff(next);
    return next;
  }, options.dryRun === true);
  output({ work: id, task: taskId, revision: result.revision, status: result.tasks.find((task) => task.id === taskId)?.status, handoff: result.handoff, dryRun: options.dryRun === true }, Boolean(options.json));
}

function recordEvidence(args: string[]): void {
  const options = parse(args, ['work', 'task', 'from', 'expect-revision', 'by']);
  const id = required(options, 'work'); const taskId = required(options, 'task'); const sourcePath = required(options, 'from');
  if (!/^W[1-9]\d*$/.test(taskId)) throw new KyroCoreError('INVALID_INPUT', `Unsafe Work task reference: ${taskId}.`, 'Use a task ID such as W1.');
  const expectedRevision = Number(required(options, 'expect-revision'));
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new KyroCoreError('INVALID_INPUT', '--expect-revision must be a positive integer.', 'Read the current Work revision and retry.');
  const source = resolve(process.cwd(), sourcePath);
  if (!existsSync(source) || !statSync(source).isFile()) throw new KyroCoreError('INVALID_INPUT', `Evidence proposal is not a readable file: ${sourcePath}.`, 'Provide an existing UTF-8 JSON evidence proposal.');
  if (statSync(source).size > 65_536) throw new KyroCoreError('INVALID_INPUT', 'Evidence proposal exceeds the 65536-byte input limit.', 'Keep the structured proposal concise; do not include tool transcripts.');
  let proposal: unknown;
  try { proposal = JSON.parse(readFileSync(source, 'utf8')); }
  catch (error) { throw new KyroCoreError('INVALID_INPUT', `Evidence proposal is not valid JSON: ${String(error)}.`, 'Provide a JSON object containing the current evidence fields.'); }
  const evidenceInput = parseEvidenceProposal(proposal);
  const by = requiredActor(options);
  const result = updateWork(id, expectedRevision, (current) => {
    if (current.state !== 'active') throw new KyroCoreError('INVALID_INPUT', `Work ${id} is not active.`, 'Evidence requires active Work.');
    const index = current.tasks.findIndex((task) => task.id === taskId);
    if (index < 0) throw new KyroCoreError('INVALID_INPUT', `Work task ${taskId} does not exist.`, 'Refresh Work status and use an existing task ID.');
    const task = current.tasks[index];
    if (task.status !== 'in_progress') throw new KyroCoreError('INVALID_INPUT', `Task ${taskId} cannot receive evidence from ${task.status}.`, 'Start an eligible task before recording evidence.');
    if (task.verdict?.result === 'pass') throw new KyroCoreError('INVALID_INPUT', `Task ${taskId} already has a passing verdict.`, 'Evidence replacement after a pass requires a later invalidation feature.');
    const unavailable = task.dependsOn.map((dependencyId) => current.tasks.find((candidate) => candidate.id === dependencyId)!).find((dependency) => dependency.status !== 'verified');
    if (unavailable) throw new KyroCoreError('INVALID_INPUT', `Task ${taskId} cannot receive evidence because dependency ${unavailable.id} is ${unavailable.status}.`, 'Verify every prerequisite before recording task evidence.');
    const now = new Date().toISOString();
    const evidence: WorkEvidence = { ...evidenceInput, by, recordedAt: now, definitionRevision: task.definitionRevision, materialDigest: computeMaterialDigest(current.brief.digest, task) };
    const nextTask: WorkTask = { ...task, status: 'awaiting_review', blocker: null, evidence, verdict: null };
    const tasks = current.tasks.map((item, itemIndex) => itemIndex === index ? nextTask : item);
    const next: WorkFile = { ...current, revision: current.revision + 1, updatedAt: now, tasks, activity: [...current.activity, { seq: current.activity.length + 1, at: now, event: 'evidence_recorded', taskId, by, reason: `Evidence recorded with ${evidence.validations.length} validation result${evidence.validations.length === 1 ? '' : 's'}.`, revision: current.revision + 1 }], handoff: { ...current.handoff } };
    next.handoff = deriveWorkHandoff(next);
    return next;
  }, options.dryRun === true);
  const task = result.tasks.find((candidate) => candidate.id === taskId)!;
  output({ work: id, task: taskId, revision: result.revision, status: task.status, materialDigest: task.evidence?.materialDigest, validations: task.evidence?.validations, handoff: result.handoff, dryRun: options.dryRun === true }, Boolean(options.json));
}

function parseEvidenceProposal(value: unknown): Omit<WorkEvidence, 'by' | 'recordedAt' | 'definitionRevision' | 'materialDigest'> {
  const keys = ['summary', 'validations', 'filesChanged', 'notes'];
  if (!isRecord(value) || Object.keys(value).some((key) => !keys.includes(key))) throw new KyroCoreError('INVALID_INPUT', 'Evidence proposal must contain only summary, validations, filesChanged, and notes.', 'Remove unknown fields and provide the exact evidence shape.');
  for (const key of keys) if (!(key in value)) throw new KyroCoreError('INVALID_INPUT', `Evidence proposal field ${key} is required.`, 'Provide all normative evidence proposal fields.');
  if (typeof value.summary !== 'string' || !value.summary.trim() || value.summary.length > 4000) throw new KyroCoreError('INVALID_INPUT', 'Evidence summary must be a non-empty string of at most 4000 characters.', 'Keep the summary concise and factual.');
  if (!Array.isArray(value.validations) || value.validations.length < 1 || value.validations.length > 50) throw new KyroCoreError('INVALID_INPUT', 'Evidence validations must contain between 1 and 50 entries.', 'Record each actual check with a truthful result.');
  const validations = value.validations.map((raw, index): WorkValidation => {
    if (!isRecord(raw) || Object.keys(raw).some((key) => !['command', 'result', 'note'].includes(key)) || Object.keys(raw).length !== 3) throw new KyroCoreError('INVALID_INPUT', `validations[${index}] must contain exactly command, result, and note.`, 'Use the normative validation record shape.');
    if (typeof raw.command !== 'string' || !raw.command.trim() || raw.command.length > 500) throw new KyroCoreError('INVALID_INPUT', `validations[${index}].command must be a non-empty string of at most 500 characters.`, 'Provide the check name or command.');
    if (!['passed', 'failed', 'not_run'].includes(String(raw.result))) throw new KyroCoreError('INVALID_INPUT', `validations[${index}].result must be passed, failed, or not_run.`, 'Preserve the actual check result.');
    if (raw.note !== null && (typeof raw.note !== 'string' || raw.note.length > 2000)) throw new KyroCoreError('INVALID_INPUT', `validations[${index}].note must be null or a string of at most 2000 characters.`, 'Keep validation notes concise.');
    return { command: raw.command, result: raw.result as WorkValidation['result'], note: raw.note as string | null };
  });
  if (!Array.isArray(value.filesChanged) || value.filesChanged.length > 100 || !value.filesChanged.every(isSafeRelativePath)) throw new KyroCoreError('INVALID_INPUT', 'Evidence filesChanged must contain at most 100 safe relative paths.', 'Remove traversal, absolute paths, and invalid path segments.');
  if (value.notes !== null && (typeof value.notes !== 'string' || value.notes.length > 4000)) throw new KyroCoreError('INVALID_INPUT', 'Evidence notes must be null or a string of at most 4000 characters.', 'Keep notes concise and omit transcripts or secrets.');
  return { summary: value.summary.trim(), validations, filesChanged: value.filesChanged, notes: value.notes as string | null };
}

function review(args: string[]): void {
  const options = parse(args, ['work', 'task', 'from', 'verdict', 'expect-revision', 'by']);
  const id = required(options, 'work'); const taskId = required(options, 'task'); const sourcePath = required(options, 'from');
  if (!/^W[1-9]\d*$/.test(taskId)) throw new KyroCoreError('INVALID_INPUT', `Unsafe Work task reference: ${taskId}.`, 'Use a task ID such as W1.');
  const verdictResult = required(options, 'verdict');
  if (verdictResult !== 'pass' && verdictResult !== 'fail') throw new KyroCoreError('INVALID_INPUT', '--verdict must be pass or fail.', 'Choose pass only when every current criterion and check is satisfied.');
  const expectedRevision = Number(required(options, 'expect-revision'));
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new KyroCoreError('INVALID_INPUT', '--expect-revision must be a positive integer.', 'Read the current Work revision and retry.');
  const source = resolve(process.cwd(), sourcePath);
  if (!existsSync(source) || !statSync(source).isFile()) throw new KyroCoreError('INVALID_INPUT', `Review proposal is not a readable file: ${sourcePath}.`, 'Provide an existing UTF-8 JSON review proposal.');
  if (statSync(source).size > 65_536) throw new KyroCoreError('INVALID_INPUT', 'Review proposal exceeds the 65536-byte input limit.', 'Keep the structured proposal concise.');
  let proposal: unknown;
  try { proposal = JSON.parse(readFileSync(source, 'utf8')); }
  catch (error) { throw new KyroCoreError('INVALID_INPUT', `Review proposal is not valid JSON: ${String(error)}.`, 'Provide a JSON object with checkedCriteria and findings arrays.'); }
  const reviewInput = parseReviewProposal(proposal);
  const by = requiredActor(options);
  const result = updateWork(id, expectedRevision, (current) => {
    if (current.state !== 'active') throw new KyroCoreError('INVALID_INPUT', `Work ${id} is not active.`, 'Task review requires active Work.');
    const index = current.tasks.findIndex((task) => task.id === taskId);
    if (index < 0) throw new KyroCoreError('INVALID_INPUT', `Work task ${taskId} does not exist.`, 'Refresh Work status and use an existing task ID.');
    const task = current.tasks[index]; const evidence = task.evidence;
    if (task.status !== 'awaiting_review' || !evidence || task.verdict !== null) throw new KyroCoreError('INVALID_INPUT', `Task ${taskId} is not awaiting review with fresh evidence.`, 'Record current evidence after starting the task before reviewing.');
    if (evidence.definitionRevision !== task.definitionRevision) throw new KyroCoreError('STATE_DIVERGED', `Task ${taskId} evidence is stale for definition revision ${task.definitionRevision}.`, 'Record fresh evidence against the current task definition.');
    const materialDigest = computeMaterialDigest(current.brief.digest, task);
    if (evidence.materialDigest !== materialDigest) throw new KyroCoreError('STATE_DIVERGED', `Task ${taskId} evidence material digest is stale.`, 'Record fresh evidence against the current brief and task definition.');
    if (verdictResult === 'pass' && evidence.by === by) throw new KyroCoreError('INVALID_INPUT', `Task ${taskId} cannot be approved by its evidence maker.`, 'Use an independent checker identity for a pass review.');
    const missing = task.acceptanceCriteria.filter((criterion) => !reviewInput.checkedCriteria.includes(criterion));
    const extra = reviewInput.checkedCriteria.filter((criterion) => !task.acceptanceCriteria.includes(criterion));
    if (verdictResult === 'pass') {
      if (missing.length || extra.length || reviewInput.checkedCriteria.length !== task.acceptanceCriteria.length) throw new KyroCoreError('INVALID_INPUT', `Pass requires exact coverage of every current criterion; missing=${JSON.stringify(missing)}, extra=${JSON.stringify(extra)}.`, 'Check each current criterion exactly once and remove unrelated criteria.');
      if (evidence.validations.some((validation) => validation.result !== 'passed')) throw new KyroCoreError('INVALID_INPUT', 'Pass is forbidden while any recorded validation is failed or not_run.', 'Run the validation or use a fail verdict; preserve the actual result.');
      if (reviewInput.findings.some((finding) => finding.severity === 'critical')) throw new KyroCoreError('INVALID_INPUT', 'Pass is forbidden while a critical finding remains.', 'Resolve critical findings before requesting pass.');
    } else if (reviewInput.findings.length === 0) {
      throw new KyroCoreError('INVALID_INPUT', 'Fail review requires at least one finding.', 'Record a concrete finding explaining why the task is not accepted.');
    }
    const now = new Date().toISOString();
    const verdict: WorkVerdict = { result: verdictResult, checkedCriteria: reviewInput.checkedCriteria, findings: reviewInput.findings, by, reviewedAt: now, definitionRevision: task.definitionRevision, evidenceDigest: computeEvidenceDigest(evidence), reviewedMaterialDigest: materialDigest };
    const nextTask: WorkTask = { ...task, status: verdictResult === 'pass' ? 'verified' : 'in_progress', verdict };
    const tasks = current.tasks.map((item, itemIndex) => itemIndex === index ? nextTask : item);
    const next: WorkFile = { ...current, revision: current.revision + 1, updatedAt: now, tasks, activity: [...current.activity, { seq: current.activity.length + 1, at: now, event: 'review_recorded', taskId, by, reason: `Task review recorded with ${verdictResult}.`, revision: current.revision + 1 }], handoff: { ...current.handoff } };
    next.handoff = deriveWorkHandoff(next);
    return next;
  }, options.dryRun === true);
  const task = result.tasks.find((candidate) => candidate.id === taskId)!;
  output({ work: id, task: taskId, revision: result.revision, result: task.verdict?.result, status: task.status, checkedCriteria: task.verdict?.checkedCriteria, findings: task.verdict?.findings, evidenceDigest: task.verdict?.evidenceDigest, reviewedMaterialDigest: task.verdict?.reviewedMaterialDigest, handoff: result.handoff, dryRun: options.dryRun === true }, Boolean(options.json));
}

function parseReviewProposal(value: unknown): { checkedCriteria: string[]; findings: WorkFinding[] } {
  if (!isRecord(value) || Object.keys(value).some((key) => !['checkedCriteria', 'findings'].includes(key)) || Object.keys(value).length !== 2) throw new KyroCoreError('INVALID_INPUT', 'Review proposal must contain exactly checkedCriteria and findings.', 'Remove unknown fields and provide the exact review shape.');
  if (!Array.isArray(value.checkedCriteria) || !value.checkedCriteria.every((item) => typeof item === 'string' && item.trim())) throw new KyroCoreError('INVALID_INPUT', 'checkedCriteria must be an array of non-empty strings.', 'Provide exact current criteria checked by the reviewer.');
  if (new Set(value.checkedCriteria).size !== value.checkedCriteria.length) throw new KyroCoreError('INVALID_INPUT', 'checkedCriteria contains duplicate criteria.', 'List each checked criterion exactly once.');
  if (!Array.isArray(value.findings)) throw new KyroCoreError('INVALID_INPUT', 'findings must be an array.', 'Use an empty array when no findings remain.');
  const findings = value.findings.map((raw, index): WorkFinding => {
    if (!isRecord(raw) || Object.keys(raw).some((key) => !['severity', 'detail'].includes(key)) || Object.keys(raw).length !== 2) throw new KyroCoreError('INVALID_INPUT', `findings[${index}] must contain exactly severity and detail.`, 'Use the normative finding record shape.');
    if (!['critical', 'warning', 'suggestion'].includes(String(raw.severity))) throw new KyroCoreError('INVALID_INPUT', `findings[${index}].severity must be critical, warning, or suggestion.`, 'Choose a supported finding severity.');
    if (typeof raw.detail !== 'string' || !raw.detail.trim() || raw.detail.length > 2000) throw new KyroCoreError('INVALID_INPUT', `findings[${index}].detail must be a non-empty string of at most 2000 characters.`, 'Describe the finding concisely.');
    return { severity: raw.severity as WorkFinding['severity'], detail: raw.detail.trim() };
  });
  return { checkedCriteria: value.checkedCriteria as string[], findings };
}

function amendTask(args: string[]): void {
  const options = parse(args, ['work', 'task', 'from', 'reason', 'expect-revision', 'by']);
  const id = required(options, 'work');
  const taskId = required(options, 'task');
  const sourcePath = required(options, 'from');
  if (!/^W[1-9]\d*$/.test(taskId)) throw new KyroCoreError('INVALID_INPUT', `Unsafe Work task reference: ${taskId}.`, 'Use a task ID such as W1.');
  const reason = required(options, 'reason').trim();
  if (!reason) throw new KyroCoreError('INVALID_INPUT', '--reason must not be empty.', 'Explain why the task definition is changing.');
  if (reason.length > 2000) throw new KyroCoreError('INVALID_INPUT', '--reason must be at most 2000 characters.', 'Keep the amendment reason concise; do not embed transcripts or secrets.');
  const expectedRevision = Number(required(options, 'expect-revision'));
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new KyroCoreError('INVALID_INPUT', '--expect-revision must be a positive integer.', 'Read the current Work revision and retry.');
  const source = resolve(process.cwd(), sourcePath);
  if (!existsSync(source) || !statSync(source).isFile()) throw new KyroCoreError('INVALID_INPUT', `Amend-task proposal is not a readable file: ${sourcePath}.`, 'Provide an existing UTF-8 JSON amendment proposal.');
  if (statSync(source).size > 65_536) throw new KyroCoreError('INVALID_INPUT', 'Amend-task proposal exceeds the 65536-byte input limit.', 'Keep the structured proposal concise.');
  let proposal: unknown;
  try { proposal = JSON.parse(readFileSync(source, 'utf8')); }
  catch (error) { throw new KyroCoreError('INVALID_INPUT', `Amend-task proposal is not valid JSON: ${String(error)}.`, 'Provide a JSON object with the new task definition fields.'); }
  const amendment = parseAmendTaskProposal(proposal);
  const by = requiredActor(options);
  const invalidatedTaskIds: string[] = [];
  const result = updateWork(id, expectedRevision, (current) => {
    if (current.state !== 'active') throw new KyroCoreError('INVALID_INPUT', `Work ${id} is not active.`, 'Task amendments require an active Work.');
    const index = current.tasks.findIndex((task) => task.id === taskId);
    if (index < 0) throw new KyroCoreError('INVALID_INPUT', `Work task ${taskId} does not exist.`, 'Refresh Work status and use an existing task ID.');
    const task = current.tasks[index];
    if (task.status === 'cancelled' || task.status === 'superseded') throw new KyroCoreError('INVALID_INPUT', `Work task ${taskId} is ${task.status} and cannot be amended.`, 'Disposed tasks are terminal; plan a replacement task instead of amending them.');
    if (!isMaterialTaskDefinitionChange(task, amendment)) throw new KyroCoreError('INVALID_INPUT', `Amend-task proposal matches the current definition of ${taskId}; no amendment is required.`, 'Change at least one definition field or keep the current contract.');
    const ids = new Set(current.tasks.map((item) => item.id));
    for (const dependency of amendment.dependsOn) {
      if (dependency === taskId) throw new KyroCoreError('INVALID_INPUT', `Task graph self-dependency: ${taskId} depends on itself.`, 'Remove the self-dependency.');
      if (!/^W[1-9]\d*$/.test(dependency)) throw new KyroCoreError('INVALID_INPUT', `Unsafe Work task reference: ${dependency}.`, 'Reference existing task IDs such as W1.');
      if (!ids.has(dependency)) throw new KyroCoreError('INVALID_INPUT', `Task graph dependency ${dependency} referenced by ${taskId} does not exist.`, 'Reference an existing task ID.');
    }
    if (new Set(amendment.dependsOn).size !== amendment.dependsOn.length) throw new KyroCoreError('INVALID_INPUT', `Task ${taskId} dependsOn contains duplicate task IDs.`, 'List each dependency once.');
    const candidateGraph = current.tasks.map((item) => ({ id: item.id, dependsOn: item.id === taskId ? amendment.dependsOn : item.dependsOn }));
    if (hasDependencyCycle(candidateGraph)) throw new KyroCoreError('INVALID_INPUT', 'Task graph contains a dependency cycle.', 'Remove at least one edge from the cycle.');
    const now = new Date().toISOString();
    let amended = demoteTaskForInvalidation({
      ...task,
      title: amendment.title.trim(),
      description: amendment.description.trim(),
      context: amendment.context,
      filesToTouch: amendment.filesToTouch,
      acceptanceCriteria: amendment.acceptanceCriteria,
      dependsOn: amendment.dependsOn,
      definitionRevision: task.definitionRevision + 1,
    });
    if (amended.status === 'in_progress') {
      const verifiedIds = new Set(current.tasks.filter((item) => item.id !== taskId && item.status === 'verified').map((item) => item.id));
      if (amended.dependsOn.some((dependency) => !verifiedIds.has(dependency))) amended = { ...amended, status: 'pending' };
    }
    invalidatedTaskIds.push(taskId);
    const downstreamIds = new Set(transitiveDependentIds(current.tasks, taskId));
    const tasks = current.tasks.map((item): WorkTask => {
      if (item.id === taskId) return amended;
      if (!downstreamIds.has(item.id)) return item;
      if (item.status !== 'in_progress' && item.status !== 'awaiting_review' && item.status !== 'verified') return item;
      invalidatedTaskIds.push(item.id);
      return { ...item, status: 'pending', blocker: null, evidence: null, verdict: null };
    });
    const next: WorkFile = { ...current, revision: current.revision + 1, updatedAt: now, tasks, activity: [...current.activity, { seq: current.activity.length + 1, at: now, event: 'task_amended', taskId, by, reason, revision: current.revision + 1 }], handoff: { ...current.handoff } };
    next.handoff = deriveWorkHandoff(next);
    return next;
  }, options.dryRun === true);
  const task = result.tasks.find((candidate) => candidate.id === taskId)!;
  output({ work: id, task: taskId, revision: result.revision, definitionRevision: task.definitionRevision, status: task.status, materialChange: true, invalidatedTaskIds, handoff: result.handoff, dryRun: options.dryRun === true }, Boolean(options.json));
}

function parseAmendTaskProposal(value: unknown): WorkTaskAmendmentProposal {
  const keys = ['title', 'description', 'context', 'filesToTouch', 'acceptanceCriteria', 'dependsOn'];
  if (!isRecord(value) || Object.keys(value).some((key) => !keys.includes(key))) throw new KyroCoreError('INVALID_INPUT', 'Amend-task proposal must contain only title, description, context, filesToTouch, acceptanceCriteria, and dependsOn.', 'Remove unknown fields and provide the exact amendment shape.');
  for (const key of keys) if (!(key in value)) throw new KyroCoreError('INVALID_INPUT', `Amend-task proposal field ${key} is required.`, 'Provide every task definition field with its new value.');
  if (typeof value.title !== 'string' || !value.title.trim()) throw new KyroCoreError('INVALID_INPUT', 'Amend-task proposal title must be a non-empty string.', 'Provide the new task title.');
  if (typeof value.description !== 'string' || !value.description.trim()) throw new KyroCoreError('INVALID_INPUT', 'Amend-task proposal description must be a non-empty string.', 'Provide the new deliverable description.');
  if (typeof value.context !== 'string') throw new KyroCoreError('INVALID_INPUT', 'Amend-task proposal context must be a string.', 'Use an empty string when no additional context is needed.');
  if (!Array.isArray(value.filesToTouch) || !value.filesToTouch.every((path) => isSafeRelativePath(path))) throw new KyroCoreError('INVALID_INPUT', 'Amend-task proposal filesToTouch must contain safe relative paths.', 'Remove absolute paths, traversal, empty segments, and backslashes.');
  if (!Array.isArray(value.acceptanceCriteria) || value.acceptanceCriteria.length === 0 || !value.acceptanceCriteria.every((criterion) => typeof criterion === 'string' && criterion.trim())) throw new KyroCoreError('INVALID_INPUT', 'Amend-task proposal acceptanceCriteria must be a non-empty array of strings.', 'Provide observable, non-empty criteria.');
  const normalized = value.acceptanceCriteria.map((criterion) => (criterion as string).replace(/\s+/g, ' ').trim().toLocaleLowerCase('en-US'));
  if (new Set(normalized).size !== normalized.length) throw new KyroCoreError('INVALID_INPUT', 'Amend-task proposal acceptanceCriteria contains duplicate criteria after normalization.', 'Keep each acceptance criterion unique.');
  if (!Array.isArray(value.dependsOn) || !value.dependsOn.every((dependency) => typeof dependency === 'string')) throw new KyroCoreError('INVALID_INPUT', 'Amend-task proposal dependsOn must be an array of task IDs.', 'Use an empty array when there are no dependencies.');
  return { title: value.title as string, description: value.description as string, context: value.context as string, filesToTouch: value.filesToTouch as string[], acceptanceCriteria: value.acceptanceCriteria as string[], dependsOn: value.dependsOn as string[] };
}

function amendBrief(args: string[]): void {
  const options = parse(args, ['work', 'from', 'reason', 'expect-revision', 'by']);
  const id = required(options, 'work');
  const sourcePath = required(options, 'from');
  const reason = required(options, 'reason').trim();
  if (!reason) throw new KyroCoreError('INVALID_INPUT', '--reason must not be empty.', 'Explain why the brief contract is changing.');
  if (reason.length > 2000) throw new KyroCoreError('INVALID_INPUT', '--reason must be at most 2000 characters.', 'Keep the amendment reason concise; do not embed the brief or secrets.');
  const expectedRevision = Number(required(options, 'expect-revision'));
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new KyroCoreError('INVALID_INPUT', '--expect-revision must be a positive integer.', 'Read the current Work revision and retry.');
  const source = resolve(process.cwd(), sourcePath);
  const briefSource = readBriefSourceBytes(source, sourcePath);
  const briefBytes = briefSource.bytes;
  const briefText = briefSource.text;
  if (!briefText.trim()) throw new KyroCoreError('INVALID_INPUT', 'Brief amendment source is empty.', 'Provide a non-empty brief.');
  const objective = firstOutcome(briefText);
  if (!objective) throw new KyroCoreError('INVALID_INPUT', 'Brief amendment source has no verifiable body outcome after its front matter and title.', 'Add a substantive outcome paragraph below the document heading.');
  const by = requiredActor(options);
  const result = amendWorkBrief(id, expectedRevision, { briefBytes, title: firstTitle(briefText), objective, reason, by }, options.dryRun === true);
  output({ work: id, revision: result.work.revision, previousDigest: result.previousDigest, briefDigest: result.briefDigest, invalidatedTaskIds: result.invalidatedTaskIds, handoff: result.work.handoff, dryRun: options.dryRun === true }, Boolean(options.json));
}



function status(args: string[], context: boolean): void {
  const options = parse(args, ['work', 'task']); const id = required(options, 'work'); const work = readWork(id);
  const taskById = new Map(work.tasks.map((item) => [item.id, item]));
  const canStart = (item: WorkTask): boolean => item.status === 'pending' && item.dependsOn.every((dependencyId) => taskById.get(dependencyId)?.status === 'verified');
  let anomaly: string | null = null; try { assertBriefIntegrity(work); } catch (error) { anomaly = error instanceof Error ? error.message : String(error); }
  if (!anomaly) {
    try {
      const pendingPromotion = readPromotionJournal(id);
      if (pendingPromotion) anomaly = `Work ${id} has a pending promotion to Forge scope "${pendingPromotion.toScope}". Retry: kyro work promote --work ${id} --to-scope ${pendingPromotion.toScope} --expect-revision ${pendingPromotion.expectedRevision} --by ${pendingPromotion.actor} --yes.`;
    } catch (error) { anomaly = error instanceof Error ? error.message : String(error); }
  }
  // A promoted Work is never reported healthy on work.json activity alone:
  // the reciprocal target link and destination must agree in both directions.
  if (!anomaly) {
    try { assertPromotionReciprocal(work); } catch (error) { anomaly = error instanceof Error ? error.message : String(error); }
  }
  const requestedTask = typeof options.task === 'string' ? options.task : work.handoff.nextTaskId;
  if (requestedTask && !/^W[1-9]\d*$/.test(requestedTask)) throw new KyroCoreError('INVALID_INPUT', `Unsafe Work task reference: ${requestedTask}.`, 'Use a task ID such as W1.');
  const task = requestedTask ? taskById.get(requestedTask) ?? null : null;
  if (requestedTask && !task) throw new KyroCoreError('INVALID_INPUT', `Work task ${requestedTask} does not exist.`, 'Refresh Work status and use an existing task ID.');
  const taskReadModel = task ? {
    id: task.id, title: task.title, description: task.description, context: task.context,
    filesToTouch: task.filesToTouch, status: task.status, dependsOn: task.dependsOn,
    prerequisites: task.dependsOn.map((dependencyId) => { const dependency = taskById.get(dependencyId)!; return { id: dependency.id, status: dependency.status, verified: dependency.status === 'verified' }; }),
    eligible: canStart(task),
    acceptanceCriteria: task.acceptanceCriteria, blocker: task.blocker, disposition: task.disposition,
    evidence: task.evidence ? { summary: task.evidence.summary, validations: task.evidence.validations, filesChanged: task.evidence.filesChanged, notes: task.evidence.notes, by: task.evidence.by, validationProvenance: 'maker_reported', definitionRevision: task.evidence.definitionRevision, materialDigest: task.evidence.materialDigest } : null,
    verdict: task.verdict ? { result: task.verdict.result, checkedCriteria: task.verdict.checkedCriteria, findings: task.verdict.findings, by: task.verdict.by, definitionRevision: task.verdict.definitionRevision, reviewedMaterialDigest: task.verdict.reviewedMaterialDigest } : null,
  } : null;
  const workTasks = work.tasks.map((item) => ({ id: item.id, status: item.status, dependsOn: item.dependsOn, eligible: canStart(item), blocker: item.blocker, disposition: item.disposition }));
  const recipes = [`kyro work status --work ${id} --json`];
  if (!anomaly && work.state === 'draft') recipes.push(`kyro work plan --work ${id} --from <proposal.json> --expect-revision ${work.revision}`);
  if (!anomaly && work.state === 'closed') recipes.push(`kyro work reopen --work ${id} --reason "<reason>" --by <actor> --expect-revision ${work.revision} --dry-run`);
  if (!anomaly && work.state === 'active') recipes.push(`kyro work close --work ${id} --outcome <completed-or-stopped> --reason "<reason>" --by <actor> --expect-revision ${work.revision} --dry-run`);
  if (!anomaly && work.state === 'active' && taskReadModel) {
    const prefix = `kyro work`;
    const target = `--work ${id} --task ${taskReadModel.id}`;
    const revision = `--expect-revision ${work.revision}`;
    if (taskReadModel.eligible) recipes.push(`${prefix} start ${target} ${revision}`);
    if (taskReadModel.status === 'pending' || taskReadModel.status === 'in_progress') recipes.push(`${prefix} block ${target} --reason "<reason>" ${revision}`);
    if (taskReadModel.status === 'blocked') recipes.push(`${prefix} unblock ${target} ${revision}`);
    if (taskReadModel.status === 'in_progress') recipes.push(`${prefix} record-evidence ${target} --from <evidence.json> --by <maker> ${revision}`);
    if (taskReadModel.status === 'awaiting_review') recipes.push(`${prefix} review ${target} --from <review.json> --verdict <pass-or-fail> --by <checker> ${revision}`);
  }
  const data = {
    schemaVersion: 1, work: { id: work.id, revision: work.revision, state: work.state, briefDigest: work.brief.digest },
    nextAction: anomaly ? 'resolve_blocker' : work.handoff.nextAction, nextTaskId: anomaly ? null : work.handoff.nextTaskId,
    blockedReason: anomaly ?? work.handoff.blockedReason, anomalies: anomaly ? [anomaly] : [], tasks: workTasks, task: taskReadModel,
    summary: workClosureSummary(work), closure: work.closure,
    ...(context ? { recipes } : {}),
  };
  output(data, Boolean(options.json));
}
function plan(args: string[]): void {
  const options = parse(args, ['work', 'from', 'expect-revision', 'by']);
  const id = required(options, 'work');
  const sourcePath = required(options, 'from');
  const expectedRevision = Number(required(options, 'expect-revision'));
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new KyroCoreError('INVALID_INPUT', '--expect-revision must be a positive integer.', 'Read the current Work revision and retry.');
  const source = resolve(process.cwd(), sourcePath);
  if (!existsSync(source) || !statSync(source).isFile()) throw new KyroCoreError('INVALID_INPUT', `Plan proposal is not a readable file: ${sourcePath}.`, 'Provide an existing UTF-8 JSON proposal.');
  if (statSync(source).size > 16_777_216) throw new KyroCoreError('INVALID_INPUT', 'Plan proposal exceeds the 16 MiB input limit.', 'Split the Work plan into a smaller input or use a later amendment; this is an operational byte limit, not a task-count policy.');
  let proposal: unknown;
  try { proposal = JSON.parse(readFileSync(source, 'utf8')); }
  catch (error) { throw new KyroCoreError('INVALID_INPUT', `Plan proposal is not valid JSON: ${String(error)}.`, 'Provide a JSON object with a tasks array.'); }
  const definitions = parsePlanProposal(proposal);
  const by = typeof options.by === 'string' ? options.by : 'cli';
  const result = updateWork(id, expectedRevision, (current) => {
    if (current.state !== 'draft' || current.tasks.length !== 0) throw new KyroCoreError('INVALID_INPUT', `Work ${id} already has a task plan.`, 'Use kyro work amend-task to change a planned task definition.');
    const now = new Date().toISOString();
    const tasks: WorkTask[] = definitions.map((definition) => ({ ...definition, status: 'pending', blocker: null, evidence: null, verdict: null, disposition: null }));
    const next: WorkFile = { ...current, state: 'active', revision: current.revision + 1, updatedAt: now, tasks, handoff: { nextAction: 'execute_task', nextTaskId: null, blockedReason: null }, activity: [...current.activity, { seq: current.activity.length + 1, at: now, event: 'tasks_planned', taskId: null, by, reason: `Planned ${tasks.length} Work task${tasks.length === 1 ? '' : 's'}.`, revision: current.revision + 1 }] };
    next.handoff = deriveWorkHandoff(next);
    return next;
  }, options.dryRun === true);
  output({ work: id, revision: result.revision, state: result.state, tasks: result.tasks.map((task) => ({ id: task.id, dependsOn: task.dependsOn, status: task.status })), handoff: result.handoff, dryRun: options.dryRun === true }, Boolean(options.json));
}

function parsePlanProposal(value: unknown): Array<Omit<WorkTask, 'status' | 'blocker' | 'evidence' | 'verdict' | 'disposition'>> {
  if (!isRecord(value) || Object.keys(value).some((key) => key !== 'tasks') || !Array.isArray(value.tasks)) throw new KyroCoreError('INVALID_INPUT', 'Plan proposal must be an object with exactly one tasks array.', 'Remove unknown fields and provide tasks.');
  if (value.tasks.length === 0) throw new KyroCoreError('INVALID_INPUT', 'Plan proposal tasks must not be empty.', 'Add at least one task.');
  const expectedKeys = ['id', 'title', 'description', 'context', 'filesToTouch', 'acceptanceCriteria', 'dependsOn'];
  const definitions = value.tasks.map((raw, index) => {
    const field = `tasks[${index}]`;
    if (!isRecord(raw)) throw new KyroCoreError('INVALID_INPUT', `${field} must be an object.`, 'Provide an exact task definition.');
    const unexpected = Object.keys(raw).find((key) => !expectedKeys.includes(key));
    const missing = expectedKeys.find((key) => !(key in raw));
    if (unexpected) throw new KyroCoreError('INVALID_INPUT', `${field}.${unexpected} is not allowed.`, 'Remove unknown task fields.');
    if (missing) throw new KyroCoreError('INVALID_INPUT', `${field}.${missing} is required.`, 'Provide every task definition field.');
    const id = `W${index + 1}`;
    if (raw.id !== id) throw new KyroCoreError('INVALID_INPUT', `${field}.id must be ${id} in stable proposal order.`, 'Use contiguous W1..Wn task IDs.');
    for (const key of ['title', 'description'] as const) if (typeof raw[key] !== 'string' || !raw[key].trim()) throw new KyroCoreError('INVALID_INPUT', `${field}.${key} must be a non-empty string.`, 'Provide a task title and deliverable description.');
    if (typeof raw.context !== 'string') throw new KyroCoreError('INVALID_INPUT', `${field}.context must be a string.`, 'Use an empty string when no additional context is needed.');
    if (!Array.isArray(raw.filesToTouch) || !raw.filesToTouch.every((path) => isSafeRelativePath(path))) throw new KyroCoreError('INVALID_INPUT', `${field}.filesToTouch must contain safe relative paths.`, 'Remove absolute paths, traversal, empty segments, and backslashes.');
    if (!Array.isArray(raw.acceptanceCriteria) || raw.acceptanceCriteria.length === 0 || !raw.acceptanceCriteria.every((criterion) => typeof criterion === 'string' && criterion.trim())) throw new KyroCoreError('INVALID_INPUT', `${field}.acceptanceCriteria must be a non-empty array of strings.`, 'Provide observable, non-empty criteria.');
    const normalized = raw.acceptanceCriteria.map((criterion) => (criterion as string).replace(/\s+/g, ' ').trim().toLocaleLowerCase('en-US'));
    if (new Set(normalized).size !== normalized.length) throw new KyroCoreError('INVALID_INPUT', `${field}.acceptanceCriteria contains duplicate criteria after normalization.`, 'Keep each acceptance criterion unique.');
    if (!Array.isArray(raw.dependsOn) || !raw.dependsOn.every((dependency) => typeof dependency === 'string')) throw new KyroCoreError('INVALID_INPUT', `${field}.dependsOn must be an array of task IDs.`, 'Use an empty array when there are no dependencies.');
    if (new Set(raw.dependsOn).size !== raw.dependsOn.length) throw new KyroCoreError('INVALID_INPUT', `${field}.dependsOn contains duplicate task IDs.`, 'List each dependency once.');
    return { id, title: (raw.title as string).trim(), description: (raw.description as string).trim(), context: raw.context, filesToTouch: raw.filesToTouch as string[], acceptanceCriteria: raw.acceptanceCriteria as string[], dependsOn: raw.dependsOn as string[], definitionRevision: 1 };
  });
  const ids = new Set(definitions.map((task) => task.id));
  for (const task of definitions) for (const dependency of task.dependsOn) {
    if (dependency === task.id) throw new KyroCoreError('INVALID_INPUT', `Task graph self-dependency: ${task.id} depends on itself.`, 'Remove the self-dependency.');
    if (!ids.has(dependency)) throw new KyroCoreError('INVALID_INPUT', `Task graph dependency ${dependency} referenced by ${task.id} does not exist.`, 'Reference an existing task ID.');
  }
  if (hasDependencyCycle(definitions)) throw new KyroCoreError('INVALID_INPUT', 'Task graph contains a dependency cycle.', 'Remove at least one edge from the cycle.');
  return definitions;
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function isSafeRelativePath(value: unknown): value is string { return typeof value === 'string' && value !== '' && !value.startsWith('/') && !value.includes('\\') && !value.split('/').some((segment) => segment === '' || segment === '.' || segment === '..'); }

function parse(args:string[], allowed:string[]):Record<string,string|boolean>{const out:Record<string,string|boolean>={};for(let i=0;i<args.length;i++){const arg=args[i];if(arg==='--json'||arg==='--dry-run'||(arg==='--yes'&&allowed.includes('yes'))){const key=arg==='--json'?'json':arg==='--dry-run'?'dryRun':'yes';if(out[key]===true)throw new KyroCoreError('INVALID_INPUT',`${arg} may only be specified once.`,'Remove the duplicate option.');out[key]=true;continue;}if(!arg.startsWith('--'))throw new KyroCoreError('INVALID_INPUT',`Unknown work argument: ${arg}.`,'Use kyro work --help.');const key=arg.slice(2);if(!allowed.includes(key))throw new KyroCoreError('INVALID_INPUT',`Unknown work option: ${arg}.`,'Use kyro work --help.');if(key in out)throw new KyroCoreError('INVALID_INPUT',`${arg} may only be specified once.`,'Remove the duplicate option.');const value=args[++i];if(!value||value.startsWith('--'))throw new KyroCoreError('INVALID_INPUT',`${arg} requires a value.`,'Provide the required value.');out[key]=value;}return out;}
function required(o:Record<string,string|boolean>,key:string):string{const v=o[key];if(typeof v!=='string')throw new KyroCoreError('INVALID_INPUT',`--${key} is required.`,'Provide the required value.');return v;}
function requiredActor(options: Record<string, string | boolean>): string {
  const actor = required(options, 'by').trim();
  if (!actor || actor.length > 128 || ['cli', 'unknown', 'anonymous'].includes(actor.toLowerCase())) {
    throw new KyroCoreError('INVALID_INPUT', '--by must identify a specific maker or checker in at most 128 characters.', 'Use distinct, non-placeholder actor identities for evidence and pass review.');
  }
  return actor;
}
function stripFrontMatter(source:string):string {
  const normalized = source.replace(/^\uFEFF/, '');
  const opening = normalized.match(/^---\s*\r?\n/);
  if (!opening) return normalized;
  const closing = /^---\s*$/m.exec(normalized.slice(opening[0].length));
  return closing ? normalized.slice(opening[0].length + closing.index + closing[0].length) : normalized;
}
function firstTitle(source:string):string {
  const body = stripFrontMatter(source);
  const heading = body.split(/\r?\n/).find((line) => /^#\s+\S/.test(line.trim()));
  if (heading) return heading.trim().replace(/^#\s+/, '').trim();
  const frontMatterTitle = /^title:\s*["']?(.+?)["']?\s*$/m.exec(source)?.[1]?.trim();
  return frontMatterTitle || 'Untitled Work';
}
function firstOutcome(source:string):string {
  const body = stripFrontMatter(source);
  const allLines = body.split(/\r?\n/);
  const titleIndex = allLines.findIndex((line) => /^#\s+\S/.test(line.trim()));
  const lines = allLines.slice(titleIndex >= 0 ? titleIndex + 1 : 0);
  let paragraph: string[] = [];
  const candidates: string[] = [];
  for (const line of lines) {
    if (/^\s*#{1,6}\s+/.test(line)) {
      if (paragraph.length) candidates.push(paragraph.join(' ').trim());
      paragraph = [];
      continue;
    }
    if (!line.trim()) {
      if (paragraph.length) candidates.push(paragraph.join(' ').trim());
      paragraph = [];
      continue;
    }
    if (/^\s*(?:[-*+]\s|\d+[.)]\s|```|~~~)/.test(line)) continue;
    paragraph.push(line.trim());
  }
  if (paragraph.length) candidates.push(paragraph.join(' ').trim());
  return candidates.find((candidate) => candidate.length >= 20 && candidate.split(/\s+/).filter(Boolean).length >= 4)?.slice(0, 1000) ?? '';
}
function output(data:unknown,json:boolean):void{console.log(json?JSON.stringify(data):JSON.stringify(data,null,2));}
