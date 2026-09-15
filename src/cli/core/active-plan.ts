import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { archiveDir, scopeRoot, sprintJsonPath } from '../artifacts/paths';
import { asSprintFile, validateSprintFile } from '../artifacts/schema';
import { readJsonSafely } from '../artifacts/json';
import { surveyScopeCheckpoints } from '../checkpoints/discovery';
import { effectiveCommitment, resolveEffectiveCheckpoint } from '../checkpoints/effective';
import { atomicReplace } from '../checkpoints/sprint-close';
import { assertSafeManagedPath, assertSafePathSegment, withStateWriterLock } from '../pipeline/state-writer-lock';
import { readProjectState } from '../state';
import { allTasks, collectFindings } from './analysis';
import { activeGraphIssues } from './task-graph';
import { canonicalJson, sha256 } from './digest';
import { KyroCoreError } from './errors';
import { policyIssues, loadPolicy } from './policy';
import { deriveActiveSprintStatus, derivePhaseStatus, nextExecutableTaskId } from './status';
import { emitToolCommandRun } from './trace';
import type { ActiveSprint, SpecRequirement, SpecScenario, SprintFile, Task } from '../types';

const TASK_FIELDS = ['title', 'description', 'context', 'acceptance_criteria', 'files_to_touch', 'depends_on', 'scenario_refs'] as const;
type TaskField = typeof TASK_FIELDS[number];
type TaskUpdate = Pick<Task, 'id'> & Partial<Pick<Task, TaskField>>;
export interface ActivePlanInput {
  scope?: string;
  sprint: { n: number; slug: string };
  reason: string;
  tasks: TaskUpdate[];
  requirements: SpecRequirement[];
  scenarios: SpecScenario[];
}
export interface ActivePlanChange { target: string; field: string; before: unknown; after: unknown }
export interface ActivePlanPreview {
  scope: string;
  sprint: { n: number; slug: string };
  digest: string;
  reason: string;
  changes: ActivePlanChange[];
  affectedTaskIds: string[];
  invalidatedTaskIds: string[];
  projected: SprintFile;
}

/** Closed input surface: task field updates and full requirement/scenario definitions, never JSON paths. */
export function parseActivePlanInput(raw: unknown): ActivePlanInput {
  const root = record(raw, ['scope', 'sprint', 'reason', 'tasks', 'requirements', 'scenarios'], 'update');
  const identity = record(root.sprint, ['n', 'slug'], 'sprint');
  if (!Number.isSafeInteger(identity.n) || (identity.n as number) < 1) invalid('sprint.n must be a positive integer');
  const slug = text(identity.slug, 'sprint.slug');
  assertSafePathSegment(slug, 'Sprint slug');
  const rows = <T>(value: unknown, label: string, parse: (row: unknown) => T): T[] => {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > 2000) invalid(`${label} must be an array of at most 2000 entries`);
    return (value as unknown[]).map(parse);
  };
  const tasks = rows(root.tasks, 'tasks', (value): TaskUpdate => {
    const row = record(value, ['id', ...TASK_FIELDS], 'task');
    const task: TaskUpdate = { id: text(row.id, 'task.id') };
    for (const key of TASK_FIELDS) {
      if (!(key in row)) continue;
      if (key === 'title' || key === 'description' || key === 'context') task[key] = text(row[key], `task.${key}`);
      else task[key] = strings(row[key], `task.${key}`, key === 'acceptance_criteria');
    }
    if (Object.keys(task).length === 1) invalid(`task ${task.id} has no definition changes`);
    return task;
  });
  const requirements = rows(root.requirements, 'requirements', (value): SpecRequirement => {
    const row = record(value, ['id', 'statement', 'priority', 'rationale'], 'requirement');
    const result: SpecRequirement = { id: text(row.id, 'requirement.id'), statement: text(row.statement, 'requirement.statement') };
    if ('priority' in row) {
      if (!['must', 'should', 'could'].includes(String(row.priority))) invalid('requirement.priority must be must, should or could');
      result.priority = row.priority as SpecRequirement['priority'];
    }
    if ('rationale' in row) result.rationale = text(row.rationale, 'requirement.rationale');
    return result;
  });
  const scenarios = rows(root.scenarios, 'scenarios', (value): SpecScenario => {
    const row = record(value, ['id', 'requirement', 'given', 'when', 'then'], 'scenario');
    return { id: text(row.id, 'scenario.id'), requirement: text(row.requirement, 'scenario.requirement'),
      given: text(row.given, 'scenario.given'), when: text(row.when, 'scenario.when'), then: text(row.then, 'scenario.then') };
  });
  for (const [label, values] of [['task', tasks], ['requirement', requirements], ['scenario', scenarios]] as const) {
    if (new Set(values.map((v) => v.id)).size !== values.length) invalid(`duplicate ${label} update`);
  }
  if (!tasks.length && !requirements.length && !scenarios.length) invalid('update must contain tasks, requirements or scenarios');
  return { ...(root.scope === undefined ? {} : { scope: text(root.scope, 'scope') }),
    sprint: { n: identity.n as number, slug }, reason: text(root.reason, 'reason'), tasks, requirements, scenarios };
}

/** Read-only preparation; includes state, input, policy and inspected history in the decision digest. */
export function prepareActivePlan(scope: string, input: ActivePlanInput): ActivePlanPreview {
  assertSafePathSegment(scope, 'Scope');
  if (input.scope !== undefined && input.scope !== scope) invalid('update scope does not match --kyro-scope');
  const path = sprintJsonPath(scope);
  assertSafeManagedPath(path);
  const read = readJsonSafely(path);
  const shape = read.exists && !read.error ? validateSprintFile(read.value, path) : [];
  const current = !read.error && read.exists && shape.length === 0 ? asSprintFile(read.value) : null;
  if (!current) throw new KyroCoreError('INVALID_SPRINT_SHAPE', `Cannot update ${scope}: ${read.error ?? (shape.map((i) => `${i.field} ${i.message}`).join('; ') || 'missing sprint.json')}.`, 'Inspect the scope with doctor; do not edit state by hand.');
  const project = readProjectState();
  const entries = project?.scopes.filter((item) => item.id === scope) ?? [];
  const entry = entries[0];
  if (!entry || entries.length !== 1 || current.scope !== scope) throw new KyroCoreError('INVALID_PROJECT_STATE', 'Scope identity is not registered consistently.');
  if (current.completion || current.retirement || entry.completion || entry.retirement
    || ['completed', 'retired', 'closed', 'shipped', 'archived', 'done'].includes(current.status) || ['completed', 'retired'].includes(entry.status)
    || current.handoff.nextAction === 'done') {
    throw new KyroCoreError('NOT_READY_TO_PLAN', `Scope ${scope} is closed or retired; its historical tasks are immutable.`, 'Only an open scope with its current active sprint can be updated.');
  }
  const active = current.activeSprint;
  if (!active) throw new KyroCoreError('NO_ACTIVE_SPRINT', `Scope ${scope} has no active sprint; closed tasks are immutable.`);
  if (['closed', 'completed', 'shipped', 'archived', 'retired'].includes(active.status)) {
    throw new KyroCoreError('CHECKPOINT_CONFLICT', 'The active sprint carries a terminal status; resolve its lifecycle before editing.');
  }
  if (active.n !== input.sprint.n || active.slug !== input.sprint.slug) throw new KyroCoreError('STATE_DIVERGED', 'Update targets a different sprint than the current active sprint.');
  if (current.ledger.some((item) => item.n >= active.n)) throw new KyroCoreError('CHECKPOINT_CONFLICT', 'The active sprint identity overlaps closed history.');
  const history = inspectHistory(scope, current);
  const existingIssues = activeGraphIssues(current).filter((issue) => issue.startsWith('duplicate'));
  if (existingIssues.length) invalid(existingIssues.join('; '));
  const next = JSON.parse(JSON.stringify(current)) as SprintFile;
  const tasks = allTasks(next.activeSprint!);
  const changes: ActivePlanChange[] = [];
  const affected = new Set<string>();
  const changedScenarios = new Set<string>();
  const changedRequirements = new Set<string>();
  const change = (target: string, field: string, before: unknown, after: unknown): boolean => {
    if (canonicalJson(before) === canonicalJson(after)) return false;
    changes.push({ target, field, before: before ?? null, after: after ?? null });
    return true;
  };
  for (const update of input.tasks) {
    const task = tasks.find((item) => item.id === update.id);
    if (!task) throw new KyroCoreError('TASK_NOT_FOUND', `Task ${update.id} is not in the active sprint. Historical tasks cannot be updated.`);
    for (const field of TASK_FIELDS) {
      if (field in update && change(task.id, field, task[field], update[field])) {
        Object.assign(task, { [field]: update[field] });
        affected.add(task.id);
      }
    }
  }
  if (input.requirements.length || input.scenarios.length) {
    next.spec ??= { requirements: [], scenarios: [], nonGoals: [], openQuestions: [] };
    for (const requirement of input.requirements) {
      const index = next.spec.requirements.findIndex((item) => item.id === requirement.id);
      const previous = next.spec.requirements[index];
      const merged = { ...previous, ...requirement };
      if (!change(requirement.id, 'requirement', previous, merged)) continue;
      if (history.requirements.has(requirement.id) || (previous && history.unknown)) historical(requirement.id);
      if (index < 0) next.spec.requirements.push(merged); else next.spec.requirements[index] = merged;
      changedRequirements.add(requirement.id);
    }
    for (const scenario of input.scenarios) {
      const index = next.spec.scenarios.findIndex((item) => item.id === scenario.id);
      const previous = next.spec.scenarios[index];
      if (previous && previous.requirement !== scenario.requirement) invalid(`scenario ${scenario.id} cannot change its requirement identity`);
      const merged = { ...previous, ...scenario };
      if (!change(scenario.id, 'scenario', previous, merged)) continue;
      if (history.scenarios.has(scenario.id) || (previous && history.unknown)) historical(scenario.id);
      if (index < 0) next.spec.scenarios.push(merged); else next.spec.scenarios[index] = merged;
      changedScenarios.add(scenario.id);
    }
  }
  for (const scenario of [...(current.spec?.scenarios ?? []), ...(next.spec?.scenarios ?? [])]) {
    if (changedRequirements.has(scenario.requirement)) changedScenarios.add(scenario.id);
  }
  // Consumers in both graphs: removing a reference cannot hide the previous impact.
  const bothTasks = [...allTasks(active), ...tasks];
  for (const task of bothTasks) if ((task.scenario_refs ?? []).some((ref) => changedScenarios.has(ref))) affected.add(task.id);
  const consumers = new Map<string, Set<string>>();
  for (const task of bothTasks) for (const dep of task.depends_on ?? []) {
    if (!consumers.has(dep)) consumers.set(dep, new Set());
    consumers.get(dep)!.add(task.id);
  }
  const queue = [...affected];
  for (let i = 0; i < queue.length; i += 1) for (const id of consumers.get(queue[i]) ?? []) {
    if (!affected.has(id)) { affected.add(id); queue.push(id); }
  }
  const invalidatedTaskIds: string[] = [];
  for (const task of tasks.filter((item) => affected.has(item.id))) {
    if (task.disposition) continue; // Definition editing is not execution reactivation.
    if (task.verdict !== null && task.verdict !== undefined) {
      change(task.id, 'verdict', task.verdict, null);
      task.verdict = null;
      invalidatedTaskIds.push(task.id);
    }
    if (task.status === 'done') { change(task.id, 'status', 'done', 'pending'); task.status = 'pending'; }
  }
  if (changes.length) {
    for (const phase of next.activeSprint!.phases) {
      const status = derivePhaseStatus(phase);
      change(`phase:${phase.id}`, 'status', phase.status, status);
      phase.status = status;
    }
    const sprintStatus = deriveActiveSprintStatus(next.activeSprint!);
    change('activeSprint', 'status', next.activeSprint!.status, sprintStatus);
    next.activeSprint!.status = sprintStatus;
    // Keep the normal route; an affected task may still depend on an earlier pending task.
    const nextTask = nextExecutableTaskId(next.activeSprint!);
    next.handoff = { ...next.handoff,
      ...(nextTask ? { nextAction: 'execute_task', nextTaskId: nextTask } : {}),
      note: `Active plan updated: ${input.reason}. Revalidate affected tasks: ${[...affected].sort().join(', ') || 'none'}. Previous evidence is retained for reference, not renewed approval.`,
    };
    for (const field of ['nextAction', 'nextTaskId', 'note'] as const) change('handoff', field, current.handoff[field], next.handoff[field]);
  }
  const graphIssues = activeGraphIssues(next);
  const shapeIssues = validateSprintFile(next, path);
  const policyErrors = policyIssues();
  const blockers = collectFindings(next, project?.principles ?? []).filter((f) => f.severity === 'CRITICAL' || f.severity === 'HIGH');
  if (graphIssues.length || shapeIssues.length || policyErrors.length || blockers.length) {
    throw new KyroCoreError('BLOCKING_FINDINGS', [...graphIssues, ...shapeIssues.map((i) => `${i.field}: ${i.message}`),
      ...policyErrors.map((i) => `${i.field}: ${i.message}`), ...blockers.map((f) => f.detail)].join('; '), 'Correct the input or resolve unrelated blockers; no plan update was written.');
  }
  return { scope, sprint: input.sprint, reason: input.reason,
    digest: sha256({ kind: 'active-plan-update', state: current, input, entry, principles: project?.principles ?? [], policy: loadPolicy().policy, history: history.digests }),
    changes, affectedTaskIds: [...affected].sort(), invalidatedTaskIds: invalidatedTaskIds.sort(), projected: next };
}

/** Single-file transaction: contract changes and invalidation commit together, never via the ordinary multi-write plan. */
export function applyActivePlan(scope: string, input: ActivePlanInput, digest: string): ActivePlanPreview {
  return withStateWriterLock(() => {
    const preview = prepareActivePlan(scope, input);
    if (preview.digest !== digest) throw new KyroCoreError('STATE_DIVERGED', 'Active plan preview is stale or belongs to another input.', 'Re-run plan --update-active --dry-run and approve the new diff; do not reuse the old digest.');
    if (!preview.changes.length) return preview;
    preview.projected.handoff.lastUpdated = new Date().toISOString();
    atomicReplace(sprintJsonPath(scope), `${JSON.stringify(preview.projected, null, 2)}\n`);
    const written = readJsonSafely(sprintJsonPath(scope));
    if (!written.exists || written.error || sha256(written.value) !== sha256(preview.projected)) throw new KyroCoreError('STATE_DIVERGED', 'Active plan update failed post-write verification.', 'Inspect current state before retrying.');
    // Diagnostic only. The atomic sprint image is authoritative; no audit transaction is claimed.
    emitToolCommandRun(scope, 'cli', 'plan', { mode: 'update-active', digest, reason: input.reason });
    return preview;
  });
}

function inspectHistory(scope: string, sprint: SprintFile): { scenarios: Set<string>; requirements: Set<string>; unknown: boolean; digests: unknown[] } {
  const survey = surveyScopeCheckpoints(scope);
  if (survey.unusable.length) throw new KyroCoreError('CHECKPOINT_CONFLICT', survey.unusable.map((item) => `${item.path}: ${item.detail}`).join('; '), 'Resolve historical integrity before updating active work.');
  const active = sprint.activeSprint!;
  if (survey.usable.some((item) => item.checkpoint.identity.sprintN >= active.n)) throw new KyroCoreError('CHECKPOINT_CONFLICT', 'A close checkpoint already exists for the current or a later sprint.');
  const archive = assertSafeManagedPath(archiveDir(scope));
  if (existsSync(archive) && readdirSync(archive).some((name) => name.startsWith(`sprint-${String(active.n).padStart(3, '0')}-`))) {
    throw new KyroCoreError('CHECKPOINT_CONFLICT', 'Historical artifacts already exist for this sprint; do not edit during or after close.');
  }
  const scenarios = new Set<string>();
  const requirements = new Set<string>();
  const digests: unknown[] = [];
  let unknown = false;
  for (const entry of sprint.ledger) {
    let closed: ActiveSprint | null = null;
    let spec = sprint.spec;
    if (entry.checkpoint) {
      if (!entry.checkpoint.startsWith('archive/') || entry.checkpoint.includes('..') || entry.checkpoint.includes('\\')) invalid('unsafe historical checkpoint path');
      const resolved = resolveEffectiveCheckpoint(scope, entry);
      if (!resolved.checkpoint || !['valid', 'canonicalized'].includes(resolved.status)
        || (entry.checkpointSha256 && entry.checkpointSha256 !== effectiveCommitment(resolved))) {
        throw new KyroCoreError('CHECKPOINT_CONFLICT', `Cannot verify historical checkpoint for sprint ${entry.n}: ${resolved.detail}`);
      }
      closed = resolved.checkpoint.beforeClose.activeSprint;
      spec = resolved.checkpoint.beforeClose.spec;
      digests.push({ entry: entry.n, raw: resolved.originalSha256, commitment: effectiveCommitment(resolved) });
      for (const [artifact, expected] of [
        [resolved.checkpoint.paths.legacySnapshot, resolved.checkpoint.digests.legacySnapshot],
        [resolved.checkpoint.paths.narrative, resolved.checkpoint.digests.narrative],
      ]) {
        if (!artifact.startsWith(`${archiveDir(scope)}/`) || artifact.includes('..') || artifact.includes('\\')) invalid('unsafe historical artifact path');
        let actual: string;
        try { actual = sha256(readFileSync(assertSafeManagedPath(artifact), 'utf8')); }
        catch { throw new KyroCoreError('CHECKPOINT_CORRUPT', `Historical artifact ${artifact} is missing or unreadable.`); }
        if (actual !== expected) throw new KyroCoreError('CHECKPOINT_CONFLICT', `Historical artifact ${artifact} differs from its checkpoint.`);
        digests.push({ artifact, digest: actual });
      }
    } else if (entry.snapshot) {
      if (!entry.snapshot.startsWith('archive/') || entry.snapshot.includes('..') || entry.snapshot.includes('\\')) invalid('unsafe historical snapshot path');
      const path = assertSafeManagedPath(`${scopeRoot(scope)}/${entry.snapshot}`);
      let raw: unknown;
      try { raw = JSON.parse(readFileSync(path, 'utf8')); } catch { throw new KyroCoreError('CHECKPOINT_CORRUPT', `Historical snapshot ${entry.snapshot} is unreadable.`); }
      if (!raw || validateSprintFile({ ...sprint, activeSprint: raw }, path).length) throw new KyroCoreError('CHECKPOINT_CORRUPT', `Historical snapshot ${entry.snapshot} is malformed.`);
      closed = raw as ActiveSprint;
      digests.push({ entry: entry.n, snapshot: sha256(raw) });
      // A legacy snapshot does not retain the requirement mapping as it existed at close.
      unknown = true;
    } else { unknown = true; digests.push({ entry: entry.n, consumers: 'unknown' }); }
    if (!closed) { unknown = true; continue; }
    if (closed.n !== entry.n || closed.slug !== entry.slug) throw new KyroCoreError('CHECKPOINT_CONFLICT', 'Historical sprint identity does not match its ledger.');
    for (const task of allTasks(closed)) for (const ref of task.scenario_refs ?? []) {
      scenarios.add(ref);
      const scenario = spec?.scenarios.find((item) => item.id === ref);
      if (scenario) requirements.add(scenario.requirement); else unknown = true;
    }
  }
  return { scenarios, requirements, unknown, digests };
}

function record(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid(`${label} must be an object`);
  const row = value as Record<string, unknown>;
  for (const key of Object.keys(row)) if (!keys.includes(key)) invalid(`${label}.${key} is not editable`);
  return row;
}
function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 100_000) invalid(`${label} must be non-empty text (at most 100000 characters)`);
  return value as string;
}
function strings(value: unknown, label: string, nonempty: boolean): string[] {
  if (!Array.isArray(value) || value.length > 2000 || (nonempty && !value.length)) invalid(`${label} must be ${nonempty ? 'a non-empty' : 'an'} array (at most 2000 entries)`);
  return (value as unknown[]).map((v) => text(v, label));
}
function invalid(message: string): never { throw new KyroCoreError('INVALID_INPUT', message, 'Use only active task definition fields; state, evidence and history are tool-owned.'); }
function historical(id: string): never { throw new KyroCoreError('CHECKPOINT_CONFLICT', `Definition ${id} has historical or unverified consumers and is immutable for this update.`, 'Preserve the old definition and use a new identity for active work.'); }
