import { readFileSync } from 'node:fs';
import { applyPlan, printPlan } from '../fs';
import { readJsonSafely } from '../artifacts/json';
import { sprintJsonPath } from '../artifacts/paths';
import { asSprintFile, validateLocalProjectStateShape, validateSharedProjectStateShape, validateSprintFile } from '../artifacts/schema';
import { LOCAL_STATE_PATH, PROJECT_STATE_PATH } from '../constants';
import { resolveScopeAuthorFromGit } from '../core/actor';
import { KyroCoreError } from '../core/errors';
import { scopeEntryFromDisk } from '../core/scope-entries';
import { countClarificationMarkers } from '../core/analysis';
import { deriveActiveSprintStatus, derivePhaseStatus, nextExecutableTaskId } from '../core/status';
import { emitToolCommandRun } from '../core/trace';
import { readProjectState, updateProjectStateLayers } from '../state';
import type { ActiveSprint, KyroProjectState, NextAction, OperationPlan, Phase, Roadmap, ScopeAuthor, Spec, SpecRequirement, SpecScenario, SprintFile, Task } from '../types';
import type { ValidationIssue } from '../artifacts/schema';
import { applyActivePlan, parseActivePlanInput, prepareActivePlan } from '../core/active-plan';
import { canonicalJson, sha256 } from '../core/digest';
import { atomicReplace } from '../checkpoints/sprint-close';
import { assertSafePathSegment, withStateWriterLock } from '../pipeline/state-writer-lock';
import { setCliMachineResult } from '../core/cli-envelope';

const KEBAB_CASE_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SPEC_REQUIREMENT_PRIORITIES = ['must', 'should', 'could'] as const;

export interface PlanArgs {
  from: string;
  scope: string | null;
  dryRun: boolean;
  help: boolean;
  updateActive: boolean;
  roadmap: boolean;
  yes: boolean;
  digest: string | null;
}

export interface LeanPlanInput {
  scope: string;
  title: string;
  objective: string;
  successCriteria: string[];
  spec: {
    requirements: SpecRequirement[];
    nonGoals: string[];
    openQuestions: string[];
  };
  roadmap: {
    plannedSprintCount: number;
    sizingRationale: string;
    sprints: Array<{ n: number; slug: string; title: string }>;
  };
}

interface LeanSprintTaskInput {
  id: string;
  title: string;
  description: string;
  files_to_touch: string[];
  context: string;
  acceptance_criteria: string[];
  depends_on: string[];
  scenario_refs: string[];
}

interface LeanSprintPhaseInput {
  id: string;
  title: string;
  objective: string;
  tasks: LeanSprintTaskInput[];
}

export interface LeanSprintInput {
  sprint: { n: number; slug: string; title: string; objective: string };
  phases: LeanSprintPhaseInput[];
  definitionOfDone: string[];
  scenarios: SpecScenario[];
}

/**
 * Mode is detected from scope state, not from the `--from` file shape: a scope with no sprint.json
 * yet is init mode; a scope with a valid sprint.json that has no active sprint and is ready
 * (handoff.nextAction is plan_sprint or await_scope_completion) is sprint mode. Both modes need a resolved scope first
 * (from --kyro-scope, or the lean file's own "scope" field for init mode), so that resolution
 * happens once, up front, before we know which mode we are in.
 */
export function runPlanCommand(rawArgs: string[]): void {
  const args = parsePlanArgs(rawArgs);
  if (args.help) {
    printPlanHelp();
    return;
  }
  if (!args.from) {
    throw new KyroCoreError('INVALID_INPUT', 'Usage: kyro plan --from <file> [--kyro-scope <scope>] [--dry-run]', 'Pass --from pointing at a lean plan JSON file (see docs/cli.md).');
  }

  const raw = readLeanPlanFile(args.from);
  const record = requireRecord(
    raw,
    '<root>',
    'Lean plan file must contain a JSON object (init mode: { scope?, title, objective, successCriteria, spec?, roadmap }; sprint mode: { sprint, phases, definitionOfDone, scenarios? }).',
  );
  const scope = resolvePlanScope(record, args.scope);
  if (args.updateActive && args.roadmap) throw new KyroCoreError('INVALID_INPUT', '--roadmap and --update-active cannot be combined.', 'Use the dedicated planned-roadmap writer separately from active-plan updates.');
  if (args.updateActive) {
    runActiveUpdate(raw, scope, args);
    return;
  }
  if (args.roadmap) {
    runRoadmapUpdate(raw, scope, args);
    return;
  }
  if (args.yes || args.digest) throw new KyroCoreError('INVALID_INPUT', '--yes and --digest are only valid with --update-active or --roadmap.');

  const state = readProjectState();
  if (!state) {
    throw new KyroCoreError(
      'INVALID_INPUT',
      'Kyro workspace not initialized (no project state).',
      'Run: kyro install --init-workspace',
    );
  }

  const existing = readJsonSafely(sprintJsonPath(scope));
  if (!existing.exists) {
    runPlanInitMode(raw, scope, args, state);
    return;
  }
  if (existing.error) {
    throw new KyroCoreError('INVALID_JSON', `sprint.json for "${scope}" is invalid JSON (${existing.error}).`, 'Fix invalid JSON or restore from an archive snapshot.');
  }
  const shapeIssues = validateSprintFile(existing.value, `${scope}/sprint.json`);
  if (shapeIssues.length > 0) {
    const detail = shapeIssues.map((issue) => `${issue.field} ${issue.message}`).join('; ');
    throw new KyroCoreError('INVALID_SPRINT_SHAPE', `Cannot plan for "${scope}": sprint.json has shape drift — ${detail}.`, 'Fix sprint.json shape first (kyro repair may help).');
  }
  const currentSprint = asSprintFile(existing.value)!;
  if (currentSprint.activeSprint !== null) {
    throw new KyroCoreError(
      'SPRINT_ALREADY_ACTIVE',
      `Scope "${scope}" already has an active sprint (N ${currentSprint.activeSprint.n}).`,
      'Close it with kyro close-sprint before planning the next sprint.',
    );
  }
  if (currentSprint.handoff.nextAction !== 'plan_sprint' && currentSprint.handoff.nextAction !== 'await_scope_completion') {
    throw new KyroCoreError(
      'NOT_READY_TO_PLAN',
      `Scope "${scope}" is not ready to plan a sprint (nextAction=${currentSprint.handoff.nextAction}).`,
      planRemedy(currentSprint, scope),
    );
  }
  runPlanSprintMode(raw, scope, currentSprint, args, state);
}

function runActiveUpdate(raw: unknown, scope: string, args: PlanArgs): void {
  if (args.dryRun && (args.yes || args.digest)) throw new KyroCoreError('INVALID_INPUT', 'Preview with --dry-run, or apply with --digest and --yes; not both.');
  if (!args.dryRun && (!args.yes || !args.digest)) {
    throw new KyroCoreError('CONFIRMATION_REQUIRED', 'Active plan updates require a reviewed digest and --yes.', 'First run plan --update-active --from <file> --kyro-scope <scope> --dry-run --json.');
  }
  const input = parseActivePlanInput(raw);
  const preview = args.dryRun ? prepareActivePlan(scope, input) : applyActivePlan(scope, input, args.digest!);
  const phase = args.dryRun ? 'preview' : preview.changes.length ? 'applied' : 'noop';
  const { projected, ...details } = preview;
  setCliMachineResult(phase, { ...details, outcome: phase, mode: 'update-active',
    requiresConfirmation: args.dryRun && preview.changes.length > 0,
    affectedFiles: phase === 'applied' ? [sprintJsonPath(scope)] : [], nextAction: projected.handoff.nextAction });
  console.log(`Active Sprint ${preview.sprint.n} update (${phase}): ${preview.changes.length} change(s).`);
  for (const change of preview.changes) console.log(`${change.target}.${change.field}: ${JSON.stringify(change.before)} → ${JSON.stringify(change.after)}`);
  console.log(`Revalidate tasks: ${preview.affectedTaskIds.join(', ') || 'none'}. Digest: ${preview.digest}`);
  if (args.dryRun) console.log('Dry run complete. No files changed.');
}

/**
 * A completed scope is not a dead end: reopening it is the lawful, auditable route back to planning,
 * so the remedy names that route instead of leaving the user to a manual edit or a recovery flow.
 */
interface RoadmapPlanInput {
  scope?: string;
  reason: string;
  updates: Array<{ n: number; title: string }>;
  add: Array<{ slug: string; title: string }>;
  cancel: number[];
  order?: number[];
}

interface RoadmapPlanPreview { digest: string; changes: Array<{ target: string; field: string; before: unknown; after: unknown }>; projected: SprintFile }

function runRoadmapUpdate(raw: unknown, scope: string, args: PlanArgs): void {
  if (args.dryRun && (args.yes || args.digest)) throw new KyroCoreError('INVALID_INPUT', 'Preview with --dry-run, or apply with --digest and --yes; not both.');
  if (!args.dryRun && (!args.yes || !args.digest)) {
    throw new KyroCoreError('CONFIRMATION_REQUIRED', 'Roadmap updates require a reviewed digest and --yes.', 'First run plan --roadmap --from <file> --kyro-scope <scope> --dry-run --json.');
  }
  const input = parseRoadmapPlanInput(raw);
  const preview = args.dryRun ? prepareRoadmapPlan(scope, input) : applyRoadmapPlan(scope, input, args.digest!);
  const phase = args.dryRun ? 'preview' : preview.changes.length ? 'applied' : 'noop';
  setCliMachineResult(phase, { digest: preview.digest, changes: preview.changes, outcome: phase, mode: 'roadmap',
    requiresConfirmation: args.dryRun && preview.changes.length > 0, affectedFiles: phase === 'applied' ? [sprintJsonPath(scope)] : [] });
  console.log(`Roadmap update (${phase}): ${preview.changes.length} change(s). Digest: ${preview.digest}`);
  if (args.dryRun) console.log('Dry run complete. No files changed.');
}

function parseRoadmapPlanInput(raw: unknown): RoadmapPlanInput {
  const root = requireRecord(raw, '<root>', 'Roadmap input must be an object { scope?, reason, updates?, add?, cancel?, order? }.');
  for (const key of Object.keys(root)) if (!['scope', 'reason', 'updates', 'add', 'cancel', 'order'].includes(key)) throw new KyroCoreError('INVALID_INPUT', `Roadmap input field "${key}" is not editable.`);
  const scope = root.scope === undefined ? undefined : requireNonEmptyString(root.scope, 'scope');
  const reason = requireNonEmptyString(root.reason, 'reason');
  const positiveN = (value: unknown, field: string): number => {
    if (!Number.isSafeInteger(value) || (value as number) < 1) throw new KyroCoreError('INVALID_INPUT', `${field} must be a positive integer.`);
    return value as number;
  };
  const updates = root.updates === undefined ? [] : (() => {
    if (!Array.isArray(root.updates)) throw new KyroCoreError('INVALID_INPUT', 'updates must be an array.');
    return root.updates.map((value, index) => { const row = requireRecord(value, `updates[${index}]`, 'Each update must be { n, title }.');
      if (Object.keys(row).some((key) => !['n', 'title'].includes(key))) throw new KyroCoreError('INVALID_INPUT', `updates[${index}] may only contain n and title.`);
      return { n: positiveN(row.n, `updates[${index}].n`), title: requireNonEmptyString(row.title, `updates[${index}].title`) }; });
  })();
  const add = root.add === undefined ? [] : (() => {
    if (!Array.isArray(root.add)) throw new KyroCoreError('INVALID_INPUT', 'add must be an array.');
    return root.add.map((value, index) => { const row = requireRecord(value, `add[${index}]`, 'Each add must be { slug, title }.');
      if (Object.keys(row).some((key) => !['slug', 'title'].includes(key))) throw new KyroCoreError('INVALID_INPUT', `add[${index}] may only contain slug and title.`);
      const slug = requireNonEmptyString(row.slug, `add[${index}].slug`); assertSafePathSegment(slug, 'Roadmap slug');
      return { slug, title: requireNonEmptyString(row.title, `add[${index}].title`) }; });
  })();
  const list = (value: unknown, field: string): number[] => { if (!Array.isArray(value)) throw new KyroCoreError('INVALID_INPUT', `${field} must be an array of positive sprint numbers.`); return value.map((n, index) => positiveN(n, `${field}[${index}]`)); };
  const cancel = root.cancel === undefined ? [] : list(root.cancel, 'cancel');
  const order = root.order === undefined ? undefined : list(root.order, 'order');
  for (const [label, values] of [['updates', updates.map((entry) => entry.n)], ['cancel', cancel], ['order', order ?? []]] as const) {
    if (new Set(values).size !== values.length) throw new KyroCoreError('INVALID_INPUT', `${label} contains duplicate sprint numbers.`);
  }
  if (!updates.length && !add.length && !cancel.length && !order?.length) throw new KyroCoreError('INVALID_INPUT', 'Roadmap update must include updates, add, cancel, or order.');
  return { ...(scope === undefined ? {} : { scope }), reason, updates, add, cancel, ...(order === undefined ? {} : { order }) };
}

function prepareRoadmapPlan(scope: string, input: RoadmapPlanInput): RoadmapPlanPreview {
  assertSafePathSegment(scope, 'Scope');
  if (input.scope !== undefined && input.scope !== scope) throw new KyroCoreError('INVALID_INPUT', 'Roadmap input scope does not match --kyro-scope.');
  const path = sprintJsonPath(scope); const read = readJsonSafely(path);
  const issues = read.exists && !read.error ? validateSprintFile(read.value, path) : [];
  const current = read.exists && !read.error && issues.length === 0 ? asSprintFile(read.value) : null;
  if (!current) throw new KyroCoreError('INVALID_SPRINT_SHAPE', `Cannot update roadmap: ${read.error ?? (issues.map((issue) => `${issue.field} ${issue.message}`).join('; ') || 'missing sprint.json')}.`, 'Run doctor; do not edit managed state by hand.');
  if (current.retirement || current.completion || current.handoff.nextAction === 'done') throw new KyroCoreError('NOT_READY_TO_PLAN', `Scope ${scope} is closed or retired; its roadmap is immutable.`);
  const next = JSON.parse(JSON.stringify(current)) as SprintFile;
  const changes: RoadmapPlanPreview['changes'] = [];
  const change = (target: string, field: string, before: unknown, after: unknown): boolean => { if (canonicalJson(before) === canonicalJson(after)) return false; changes.push({ target, field, before, after }); return true; };
  const byN = new Map(next.roadmap.sprints.map((entry) => [entry.n, entry]));
  const planned = (n: number, action: string) => { const entry = byN.get(n); if (!entry) throw new KyroCoreError('INVALID_INPUT', `Roadmap sprint ${n} does not exist.`); if (entry.state !== 'planned') throw new KyroCoreError('INVALID_INPUT', `Roadmap sprint ${n} is ${entry.state}, so ${action} is allowed only for planned entries.`, 'Closed and active sprint identities are immutable.'); return entry; };
  for (const update of input.updates) { const entry = planned(update.n, 'retitle'); if (change(`roadmap.sprints[n=${entry.n}]`, 'title', entry.title, update.title)) entry.title = update.title; }
  for (const n of input.cancel) { const entry = planned(n, 'cancel'); if (change(`roadmap.sprints[n=${entry.n}]`, 'state', entry.state, 'cancelled')) entry.state = 'cancelled'; }
  let nextN = Math.max(0, ...next.roadmap.sprints.map((entry) => entry.n)) + 1;
  for (const item of input.add) { if (next.roadmap.sprints.some((entry) => entry.slug === item.slug)) throw new KyroCoreError('INVALID_INPUT', `Roadmap slug "${item.slug}" already exists.`); const entry = { n: nextN++, slug: item.slug, title: item.title, state: 'planned' }; next.roadmap.sprints.push(entry); byN.set(entry.n, entry); changes.push({ target: 'roadmap.sprints', field: 'add', before: null, after: entry }); }
  const remainingPlanned = next.roadmap.sprints.filter((entry) => entry.state === 'planned');
  if (input.order) { if (input.order.length !== remainingPlanned.length || input.order.some((n) => !remainingPlanned.some((entry) => entry.n === n))) throw new KyroCoreError('INVALID_INPUT', 'order must contain each remaining planned sprint exactly once.'); const ordered = input.order.map((n) => byN.get(n)!); const stable = next.roadmap.sprints.filter((entry) => entry.state !== 'planned'); const reordered = [...stable, ...ordered]; if (change('roadmap.sprints', 'presentationOrder', next.roadmap.sprints, reordered)) next.roadmap.sprints = reordered; }
  const count = next.roadmap.sprints.filter((entry) => entry.state !== 'cancelled').length;
  if (change('roadmap', 'plannedSprintCount', next.roadmap.plannedSprintCount, count)) next.roadmap.plannedSprintCount = count;
  const shapeIssues = validateSprintFile(next, path); if (shapeIssues.length) throw new KyroCoreError('BLOCKING_FINDINGS', shapeIssues.map((issue) => `${issue.field}: ${issue.message}`).join('; '), 'Correct the roadmap input; no state was written.');
  const project = readProjectState();
  return { digest: sha256({ kind: 'roadmap-plan-update', state: current, input, project: project?.scopes.find((entry) => entry.id === scope) ?? null }), changes, projected: next };
}

function applyRoadmapPlan(scope: string, input: RoadmapPlanInput, digest: string): RoadmapPlanPreview {
  return withStateWriterLock(() => { const preview = prepareRoadmapPlan(scope, input); if (preview.digest !== digest) throw new KyroCoreError('STATE_DIVERGED', 'Roadmap preview is stale or belongs to another input.', 'Re-run plan --roadmap --dry-run and approve the new digest.'); if (!preview.changes.length) return preview; preview.projected.handoff.lastUpdated = new Date().toISOString(); atomicReplace(sprintJsonPath(scope), `${JSON.stringify(preview.projected, null, 2)}\n`); const written = readJsonSafely(sprintJsonPath(scope)); if (!written.exists || written.error || sha256(written.value) !== sha256(preview.projected)) throw new KyroCoreError('STATE_DIVERGED', 'Roadmap update failed post-write verification.', 'Inspect the current state before retrying.'); emitToolCommandRun(scope, 'cli', 'plan', { mode: 'roadmap', digest, reason: input.reason }); return preview; });
}

function planRemedy(sprint: SprintFile, scope: string): string {
  if (sprint.retirement) return 'This scope is retired and terminal. Plan the follow-on work in a new scope.';
  if (sprint.completion) return `This scope is explicitly completed. Run kyro scope reopen --kyro-scope ${scope} --reason "<why>" --yes to return it to planning.`;
  return 'Resolve the current handoff first (e.g. clarify; done means the scope is complete).';
}

function runPlanInitMode(raw: unknown, scope: string, args: PlanArgs, state: KyroProjectState): void {
  const input = parseLeanPlanInput(raw, scope);
  const { sprint, plan } = buildPlanInitPlan(input.scope, input);
  printPlan(`Initialize scope "${input.scope}" (init mode)`, plan);

  if (args.dryRun) {
    console.log('Dry run complete. No files changed.');
    return;
  }

  emitToolCommandRun(input.scope, 'cli', 'plan', { mode: 'init' });
  applyPlan(plan);

  const verify = readJsonSafely(sprintJsonPath(input.scope));
  if (verify.error || !verify.exists) throw new KyroCoreError('INVALID_JSON', `plan wrote sprint.json but re-parse failed (${verify.error ?? 'missing'}).`, 'Restore from an archive snapshot.');
  const issues = validateSprintFile(verify.value, `${input.scope}/sprint.json`);
  if (issues.length > 0) {
    const detail = issues.map((issue) => `${issue.field} ${issue.message}`).join('; ');
    throw new KyroCoreError('INVALID_SPRINT_SHAPE', `plan wrote sprint.json but it failed validation — ${detail}.`, 'Restore from an archive snapshot.');
  }

  registerScopeInProjectState(input.scope);

  const requirementCount = sprint.spec?.requirements.length ?? 0;
  console.log(`Scope "${input.scope}" initialized: ${requirementCount} requirement(s), ${sprint.roadmap.sprints.length} sprint(s) planned. Next action: ${sprint.handoff.nextAction}.`);
}

function runPlanSprintMode(raw: unknown, scope: string, currentSprint: SprintFile, args: PlanArgs, state: KyroProjectState): void {
  const input = parseLeanSprintInput(raw, currentSprint);
  const { sprint, plan } = buildPlanSprintPlan(scope, currentSprint, input);
  printPlan(`Plan Sprint ${input.sprint.n} for scope "${scope}" (sprint mode)`, plan);

  if (args.dryRun) {
    console.log('Dry run complete. No files changed.');
    return;
  }

  emitToolCommandRun(scope, 'cli', 'plan', { mode: 'sprint' });
  applyPlan(plan);

  const verify = readJsonSafely(sprintJsonPath(scope));
  if (verify.error || !verify.exists) throw new KyroCoreError('INVALID_JSON', `plan wrote sprint.json but re-parse failed (${verify.error ?? 'missing'}).`, 'Restore from an archive snapshot.');
  const issues = validateSprintFile(verify.value, `${scope}/sprint.json`);
  if (issues.length > 0) {
    const detail = issues.map((issue) => `${issue.field} ${issue.message}`).join('; ');
    throw new KyroCoreError('INVALID_SPRINT_SHAPE', `plan wrote sprint.json but it failed validation — ${detail}.`, 'Restore from an archive snapshot.');
  }

  const active = sprint.activeSprint!;
  const phaseCount = active.phases.length;
  const taskCount = active.phases.reduce((sum, phase) => sum + phase.tasks.length, 0);
  console.log(`Sprint ${active.n} planned for "${scope}": ${phaseCount} phase(s), ${taskCount} task(s). Next action: ${sprint.handoff.nextAction}.`);
}

export function buildPlanInitPlan(scope: string, input: LeanPlanInput): { sprint: SprintFile; plan: OperationPlan[] } {
  const existing = readJsonSafely(sprintJsonPath(scope));
  if (existing.exists) {
    throw new KyroCoreError(
      'SCOPE_ALREADY_INITIALIZED',
      `Scope "${scope}" already has a sprint.json.`,
      'Per-sprint planning via kyro plan is not yet available; use the plan-sprint workflow. To re-bootstrap, remove the scope first.',
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const spec: Spec = {
    requirements: input.spec.requirements,
    scenarios: [],
    nonGoals: input.spec.nonGoals,
    openQuestions: input.spec.openQuestions,
  };
  const roadmap: Roadmap = {
    plannedSprintCount: input.roadmap.plannedSprintCount,
    sizingRationale: input.roadmap.sizingRationale,
    sprints: input.roadmap.sprints.map((sprint) => ({ ...sprint, state: 'planned' })),
  };

  // Best-effort scope creator from git. Optional enrichment only — never blocks init.
  // resolveScopeAuthorFromGit never throws; still strip author if a draft would fail schema
  // solely because of it (belt-and-suspenders so this feature cannot break plan).
  const author = resolveScopeAuthorFromGit();

  // Compute markers on a draft with an empty handoff.note so the note text itself can never be
  // mistaken for a marker payload.
  const baseSprint: SprintFile = {
    schemaVersion: 4,
    scope,
    title: input.title,
    status: 'planning',
    objective: input.objective,
    successCriteria: input.successCriteria,
    spec,
    clarifications: [],
    conventions: [],
    adrs: [],
    roadmap,
    ledger: [],
    previousSprint: null,
    activeSprint: null,
    debt: [],
    handoff: { nextAction: 'plan_sprint', nextTaskId: null, blockers: [], note: '', lastUpdated: today },
  };
  const draftSprint = attachAuthorIfValid(baseSprint, author);

  const markers = countClarificationMarkers(draftSprint);
  const openQuestionCount = draftSprint.spec?.openQuestions?.length ?? 0;
  // Markers are hard clarity gaps; non-empty openQuestions are also init-time clarify work
  // (docs: clarify drains openQuestions before the spec is treated as stable for planning).
  const nextAction: NextAction = markers > 0 || openQuestionCount > 0 ? 'clarify' : 'plan_sprint';
  const note = markers > 0
    ? `Scope initialized with ${markers} unresolved [NEEDS CLARIFICATION] marker(s); resolve them before planning.`
    : openQuestionCount > 0
      ? `Scope initialized with ${openQuestionCount} open question(s); resolve them via clarify before planning Sprint 1.`
      : 'Scope initialized (spec + roadmap); ready to plan Sprint 1.';

  const sprint: SprintFile = {
    ...draftSprint,
    handoff: { nextAction, nextTaskId: null, blockers: [], note, lastUpdated: today },
  };

  const plan: OperationPlan[] = [{ action: 'write', path: sprintJsonPath(scope), content: `${JSON.stringify(sprint, null, 2)}\n` }];
  return { sprint, plan };
}

/**
 * Attach optional author only when the resulting document still validates.
 * If author is the sole cause of shape failure, drop it — this feature must never break plan init.
 */
function attachAuthorIfValid(base: SprintFile, author: ScopeAuthor | null): SprintFile {
  if (!author) return base;
  try {
    const candidate: SprintFile = { ...base, author };
    const issues = validateSprintFile(candidate, 'plan-init-draft');
    if (issues.length === 0) return candidate;
    const onlyAuthor = issues.every((issue) => issue.field === 'author' || issue.field.startsWith('author.'));
    if (onlyAuthor) return base;
    // Non-author issues on a draft we just built should be impossible for author attach;
    // still prefer writing without author rather than inventing a failure path here.
    return base;
  } catch {
    return base;
  }
}

/**
 * Sprint mode: materialize the next `activeSprint` from a lean sprint-plan file, mutating a deep
 * clone of the current sprint.json (mirrors record-evidence's clone approach). Writes only
 * sprint.json — kyro.json is untouched (the scope is already registered from init mode).
 */
export function buildPlanSprintPlan(scope: string, current: SprintFile, input: LeanSprintInput): { sprint: SprintFile; plan: OperationPlan[] } {
  const today = new Date().toISOString().slice(0, 10);
  const next = JSON.parse(JSON.stringify(current)) as SprintFile;

  const phases: Phase[] = input.phases.map((phaseInput) => {
    const tasks: Task[] = phaseInput.tasks.map((taskInput) => ({
      id: taskInput.id,
      title: taskInput.title,
      description: taskInput.description,
      files_to_touch: taskInput.files_to_touch,
      context: taskInput.context,
      acceptance_criteria: taskInput.acceptance_criteria,
      depends_on: taskInput.depends_on,
      scenario_refs: taskInput.scenario_refs,
      status: 'pending',
      evidence: null,
      verdict: null,
    }));
    const phase: Phase = { id: phaseInput.id, title: phaseInput.title, objective: phaseInput.objective, status: 'pending', tasks };
    phase.status = derivePhaseStatus(phase);
    return phase;
  });

  const activeSprint: ActiveSprint = {
    n: input.sprint.n,
    slug: input.sprint.slug,
    title: input.sprint.title,
    objective: input.sprint.objective,
    status: 'planned',
    phases,
    emergentTasks: [],
    definitionOfDone: input.definitionOfDone,
  };
  // Derived, never hardcoded: an all-pending sprint derives to "planned", not "executing" — hardcoding
  // "executing" here would make `kyro analyze`'s coherence check flag it immediately (known finding).
  activeSprint.status = deriveActiveSprintStatus(activeSprint);
  next.activeSprint = activeSprint;

  // Merge scenarios into spec.scenarios by id: add new, replace existing. requirements/nonGoals/
  // openQuestions are preserved untouched (only scenarios changes in sprint mode).
  const scenarioMap = new Map<string, SpecScenario>((next.spec?.scenarios ?? []).map((scenario) => [scenario.id, scenario]));
  for (const scenario of input.scenarios) scenarioMap.set(scenario.id, scenario);
  next.spec = {
    requirements: next.spec?.requirements ?? [],
    scenarios: [...scenarioMap.values()],
    nonGoals: next.spec?.nonGoals ?? [],
    openQuestions: next.spec?.openQuestions ?? [],
  };

  const roadmapEntry = next.roadmap.sprints.find((entry) => entry.n === input.sprint.n);
  if (roadmapEntry) {
    roadmapEntry.state = 'active';
  } else {
    next.roadmap.sprints.push({
      n: input.sprint.n,
      slug: input.sprint.slug,
      title: input.sprint.title,
      state: 'active',
    });
    next.roadmap.plannedSprintCount = next.roadmap.sprints.filter((entry) => entry.state !== 'cancelled').length;
  }
  // Deliberate scope cut for this increment: sprint mode does not auto-transition debt[] items (e.g.
  // marking due debt "in_progress" the way the plan-sprint workflow does by hand). Debt is left as-is;
  // the agent/checker can transition it explicitly. Never dropped or reset either way.

  const markers = countClarificationMarkers(next);
  const nextAction: NextAction = markers > 0 ? 'clarify' : 'execute_task';
  const nextTaskId = markers > 0 ? null : nextExecutableTaskId(next);
  const note = markers > 0
    ? `Sprint ${input.sprint.n} planned with ${markers} unresolved [NEEDS CLARIFICATION] marker(s); resolve them before executing.`
    : `Sprint ${input.sprint.n} planned; ready to execute.`;
  next.handoff = { nextAction, nextTaskId, blockers: [], note, lastUpdated: today };

  const plan: OperationPlan[] = [{ action: 'write', path: sprintJsonPath(scope), content: `${JSON.stringify(next, null, 2)}\n` }];
  return { sprint: next, plan };
}

/**
 * Register the scope in the layered project state, then prove the state on disk is valid.
 *
 * The early return below used to skip the write entirely when the scope was already registered —
 * and with it, the normalization that `updateProjectStateLayers` performs. A workspace whose
 * project.json had been hand-authored (no `schemaVersion`, `principle` instead of `rule`, ...) but
 * already listed the scope therefore survived `plan` untouched, and the command still printed
 * "Scope initialized". `kyro doctor` failed on that same state a second later. Agents read the
 * success line, concluded Kyro had not written the files, and hand-patched them — which is exactly
 * the failure this command exists to prevent.
 *
 * Now the shape is verified on every run, whether or not a scope was added, and a bad state fails
 * the command instead of riding along under a success message.
 */
function registerScopeInProjectState(scope: string): void {
  if (!scopeEntryFromDisk(scope)) {
    throw new KyroCoreError('INVALID_SPRINT_SHAPE', `The new scope "${scope}" has no valid matching sprint.json.`);
  }
  updateProjectStateLayers({ activeScope: scope });
  assertProjectStateIsValid();
}

/**
 * Fail closed when the project state on disk does not validate. Never report a successful plan on
 * top of state that `doctor` rejects — a green message over a red workspace is what sends agents
 * hand-editing.
 */
function assertProjectStateIsValid(): void {
  const layers: { path: string; issues: ValidationIssue[] }[] = [];
  const shared = readJsonSafely(PROJECT_STATE_PATH);
  if (shared.exists && !shared.error) {
    layers.push({ path: PROJECT_STATE_PATH, issues: validateSharedProjectStateShape(shared.value, PROJECT_STATE_PATH) });
  }
  const local = readJsonSafely(LOCAL_STATE_PATH);
  if (local.exists && !local.error) {
    layers.push({ path: LOCAL_STATE_PATH, issues: validateLocalProjectStateShape(local.value, LOCAL_STATE_PATH) });
  }

  const broken = layers.filter((layer) => layer.issues.length > 0);
  if (broken.length === 0) return;

  const detail = broken
    .map((layer) => `${layer.path}: ${layer.issues.map((issue) => `${issue.field} ${issue.message}`).join('; ')}`)
    .join(' | ');
  throw new KyroCoreError(
    'INVALID_PROJECT_STATE',
    `sprint.json was written, but project state failed validation — ${detail}.`,
    'Run: npx kyro-ai install --scope workspace --init-workspace --yes to rewrite the managed fields. Do NOT hand-edit project.json or local.json — Kyro owns their shape.',
  );
}

function readLeanPlanFile(path: string): unknown {
  let text: string;
  try {
    text = readFileSync(path, 'utf-8');
  } catch (error) {
    throw new KyroCoreError('INVALID_INPUT', `Cannot read lean plan file: ${path} (${error instanceof Error ? error.message : String(error)}).`, 'Pass a valid --from <file> path.');
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new KyroCoreError('INVALID_JSON', `Lean plan file is not valid JSON: ${path} (${error instanceof Error ? error.message : String(error)}).`, 'Fix the JSON syntax in the lean plan file.');
  }
}

/**
 * Shared by both modes: resolve the scope from --kyro-scope and/or the lean file's own "scope" field
 * (init mode only carries the latter — sprint-mode files have no "scope" field, so they rely on
 * --kyro-scope). Runs before mode detection, since we need a scope to look up sprint.json.
 */
function resolvePlanScope(record: Record<string, unknown>, cliScope: string | null): string {
  const fileScope = record.scope;
  if (fileScope !== undefined && typeof fileScope !== 'string') {
    throw new KyroCoreError('INVALID_INPUT', 'Lean plan "scope" must be a string when present.', 'Set scope to a kebab-case identifier or omit it and pass --kyro-scope.');
  }
  if (cliScope && fileScope && cliScope !== fileScope) {
    throw new KyroCoreError('INVALID_INPUT', `--kyro-scope "${cliScope}" does not match lean plan "scope" "${fileScope}".`, 'Make --kyro-scope and the lean plan file scope agree, or pass only one of them.');
  }
  const scope = cliScope ?? (fileScope as string | undefined);
  if (!scope) {
    throw new KyroCoreError('INVALID_INPUT', 'No scope given: pass --kyro-scope <scope> or set "scope" in the lean plan file.', 'Add "scope" to the lean plan file or pass --kyro-scope.');
  }
  if (!KEBAB_CASE_RE.test(scope)) {
    throw new KyroCoreError('INVALID_INPUT', `Scope "${scope}" is not kebab-case.`, 'Use lowercase letters, digits, and hyphens only, e.g. "oauth-implementation".');
  }
  return scope;
}

function parseLeanPlanInput(raw: unknown, cliScope: string | null): LeanPlanInput {
  const record = requireRecord(raw, '<root>', 'Lean plan file must contain a JSON object { scope?, title, objective, successCriteria, spec?, roadmap }.');
  const scope = resolvePlanScope(record, cliScope);

  const title = requireNonEmptyString(record.title, 'title');
  const objective = requireNonEmptyString(record.objective, 'objective');
  const successCriteria = requireNonEmptyStringArray(record.successCriteria, 'successCriteria');
  const spec = parseLeanSpec(record.spec);
  const roadmap = parseLeanRoadmap(record.roadmap);

  return { scope, title, objective, successCriteria, spec, roadmap };
}

function parseLeanSpec(value: unknown): LeanPlanInput['spec'] {
  if (value === undefined) return { requirements: [], nonGoals: [], openQuestions: [] };
  const record = requireRecord(value, 'spec', 'Lean plan "spec" must be an object when present: { requirements?, nonGoals?, openQuestions? }.');
  return {
    requirements: parseLeanRequirements(record.requirements),
    nonGoals: parseOptionalStringArray(record.nonGoals, 'spec.nonGoals'),
    openQuestions: parseOptionalStringArray(record.openQuestions, 'spec.openQuestions'),
  };
}

function parseLeanRequirements(value: unknown): SpecRequirement[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new KyroCoreError('INVALID_INPUT', 'Lean plan "spec.requirements" must be an array when present.', 'Use [{ id, statement, priority?, rationale? }, ...].');
  }
  const requirements = value.map((entry, index) => parseLeanRequirement(entry, index));
  const seen = new Set<string>();
  for (const requirement of requirements) {
    if (seen.has(requirement.id)) {
      throw new KyroCoreError('INVALID_INPUT', `Duplicate requirement id "${requirement.id}" in spec.requirements.`, 'Requirement ids must be unique.');
    }
    seen.add(requirement.id);
  }
  return requirements;
}

function parseLeanRequirement(value: unknown, index: number): SpecRequirement {
  const record = requireRecord(value, `spec.requirements[${index}]`, `spec.requirements[${index}] must be an object { id, statement, priority?, rationale? }.`);
  const id = requireNonEmptyString(record.id, `spec.requirements[${index}].id`);
  const statement = requireNonEmptyString(record.statement, `spec.requirements[${index}].statement`);
  const requirement: SpecRequirement = { id, statement };
  if (record.priority !== undefined) {
    if (!SPEC_REQUIREMENT_PRIORITIES.includes(record.priority as (typeof SPEC_REQUIREMENT_PRIORITIES)[number])) {
      throw new KyroCoreError('INVALID_INPUT', `spec.requirements[${index}].priority must be one of: ${SPEC_REQUIREMENT_PRIORITIES.join(', ')}.`, 'Fix or remove the priority field.');
    }
    requirement.priority = record.priority as SpecRequirement['priority'];
  }
  if (record.rationale !== undefined) {
    if (typeof record.rationale !== 'string') {
      throw new KyroCoreError('INVALID_INPUT', `spec.requirements[${index}].rationale must be a string when present.`);
    }
    requirement.rationale = record.rationale;
  }
  return requirement;
}

function parseLeanRoadmap(value: unknown): LeanPlanInput['roadmap'] {
  const record = requireRecord(value, 'roadmap', 'Lean plan "roadmap" must be an object { plannedSprintCount, sizingRationale?, sprints }.');
  if (!Array.isArray(record.sprints) || record.sprints.length === 0) {
    throw new KyroCoreError('INVALID_INPUT', 'Lean plan "roadmap.sprints" must be a non-empty array.', 'Provide at least one { n, slug, title } sprint entry.');
  }
  const sprints = record.sprints.map((entry, index) => parseLeanRoadmapSprint(entry, index));
  const seenN = new Set<number>();
  for (const sprint of sprints) {
    if (seenN.has(sprint.n)) {
      throw new KyroCoreError('INVALID_INPUT', `Duplicate roadmap.sprints[].n = ${sprint.n}.`, 'Sprint n values must be unique.');
    }
    seenN.add(sprint.n);
  }
  const plannedSprintCount = record.plannedSprintCount;
  if (typeof plannedSprintCount !== 'number' || !Number.isFinite(plannedSprintCount)) {
    throw new KyroCoreError('INVALID_INPUT', 'Lean plan "roadmap.plannedSprintCount" must be a number.', 'Set roadmap.plannedSprintCount.');
  }
  if (plannedSprintCount !== sprints.length) {
    throw new KyroCoreError('INVALID_INPUT', `roadmap.plannedSprintCount (${plannedSprintCount}) does not match roadmap.sprints.length (${sprints.length}).`, 'Make plannedSprintCount equal the number of sprints entries.');
  }
  if (record.sizingRationale !== undefined && typeof record.sizingRationale !== 'string') {
    throw new KyroCoreError('INVALID_INPUT', 'Lean plan "roadmap.sizingRationale" must be a string when present.');
  }
  const sizingRationale = typeof record.sizingRationale === 'string' ? record.sizingRationale : '';
  return { plannedSprintCount, sizingRationale, sprints };
}

function parseLeanRoadmapSprint(value: unknown, index: number): { n: number; slug: string; title: string } {
  const record = requireRecord(value, `roadmap.sprints[${index}]`, `roadmap.sprints[${index}] must be an object { n, slug, title }.`);
  if (typeof record.n !== 'number' || !Number.isFinite(record.n)) {
    throw new KyroCoreError('INVALID_INPUT', `roadmap.sprints[${index}].n must be a number.`);
  }
  const slug = requireNonEmptyString(record.slug, `roadmap.sprints[${index}].slug`);
  const title = requireNonEmptyString(record.title, `roadmap.sprints[${index}].title`);
  return { n: record.n, slug, title };
}

function parseLeanSprintInput(raw: unknown, current: SprintFile): LeanSprintInput {
  const record = requireRecord(raw, '<root>', 'Lean sprint file must contain a JSON object { sprint, phases, definitionOfDone, scenarios? }.');

  const sprint = parseLeanSprintHeader(record.sprint);

  const closedN = current.ledger.length === 0 ? 0 : Math.max(...current.ledger.map((entry) => entry.n));
  let expectedN = closedN + 1;
  // A cancelled planned identity is retained as roadmap history but must never be resurrected by
  // sprint materialization. Skip each cancelled slot while preserving every other sprint number.
  while (current.roadmap.sprints.some((entry) => entry.n === expectedN && entry.state === 'cancelled')) expectedN += 1;
  if (sprint.n !== expectedN) {
    throw new KyroCoreError(
      'INVALID_INPUT',
      `Lean sprint "sprint.n" (${sprint.n}) does not match the expected next sprint number (${expectedN}).`,
      `Set sprint.n to ${expectedN} (max sprint.ledger[].n + 1, or 1 if the ledger is empty).`,
    );
  }

  if (!Array.isArray(record.phases) || record.phases.length === 0) {
    throw new KyroCoreError('INVALID_INPUT', 'Lean sprint "phases" must be a non-empty array.', 'Provide at least one phase with at least one task.');
  }
  const phases = record.phases.map((entry, index) => parseLeanSprintPhase(entry, index));

  const seenPhaseIds = new Set<string>();
  for (const phase of phases) {
    if (seenPhaseIds.has(phase.id)) throw new KyroCoreError('INVALID_INPUT', `Duplicate phase id "${phase.id}" in phases.`, 'Phase ids must be unique.');
    seenPhaseIds.add(phase.id);
  }

  const allTasks = phases.flatMap((phase) => phase.tasks);
  const taskIds = new Set<string>();
  for (const task of allTasks) {
    if (taskIds.has(task.id)) throw new KyroCoreError('INVALID_INPUT', `Duplicate task id "${task.id}" across phases.`, 'Task ids must be unique across the whole sprint.');
    taskIds.add(task.id);
  }
  for (const task of allTasks) {
    for (const dep of task.depends_on) {
      if (!taskIds.has(dep)) throw new KyroCoreError('INVALID_INPUT', `Task "${task.id}" depends_on "${dep}" which does not exist in this sprint.`, 'Fix the depends_on reference or add the missing task.');
    }
  }

  const definitionOfDone = requireNonEmptyStringArray(record.definitionOfDone, 'definitionOfDone');
  const scenarios = parseLeanSprintScenarios(record.scenarios, current);

  const scenarioIds = new Set<string>([...(current.spec?.scenarios ?? []).map((scenario) => scenario.id), ...scenarios.map((scenario) => scenario.id)]);
  for (const task of allTasks) {
    for (const ref of task.scenario_refs) {
      if (!scenarioIds.has(ref)) {
        throw new KyroCoreError(
          'INVALID_INPUT',
          `Task "${task.id}" scenario_refs "${ref}" is not a known scenario id (checked existing spec.scenarios and this sprint's scenarios).`,
          'Fix the scenario_refs reference or add the missing scenario to "scenarios".',
        );
      }
    }
  }

  return { sprint, phases, definitionOfDone, scenarios };
}

function parseLeanSprintHeader(value: unknown): LeanSprintInput['sprint'] {
  const record = requireRecord(value, 'sprint', 'Lean sprint "sprint" must be an object { n, slug, title, objective }.');
  if (typeof record.n !== 'number' || !Number.isFinite(record.n)) {
    throw new KyroCoreError('INVALID_INPUT', 'Lean sprint "sprint.n" must be a number.', 'Set sprint.n to the expected next sprint number.');
  }
  const slug = requireNonEmptyString(record.slug, 'sprint.slug');
  const title = requireNonEmptyString(record.title, 'sprint.title');
  const objective = requireNonEmptyString(record.objective, 'sprint.objective');
  return { n: record.n, slug, title, objective };
}

function parseLeanSprintPhase(value: unknown, index: number): LeanSprintInput['phases'][number] {
  const record = requireRecord(value, `phases[${index}]`, `phases[${index}] must be an object { id, title, objective, tasks }.`);
  const id = requireNonEmptyString(record.id, `phases[${index}].id`);
  const title = requireNonEmptyString(record.title, `phases[${index}].title`);
  const objective = requireNonEmptyString(record.objective, `phases[${index}].objective`);
  if (!Array.isArray(record.tasks) || record.tasks.length === 0) {
    throw new KyroCoreError('INVALID_INPUT', `phases[${index}].tasks must be a non-empty array.`, 'Add at least one task to the phase.');
  }
  const tasks = record.tasks.map((entry, taskIndex) => parseLeanSprintTask(entry, index, taskIndex));
  return { id, title, objective, tasks };
}

function parseLeanSprintTask(value: unknown, phaseIndex: number, taskIndex: number): LeanSprintInput['phases'][number]['tasks'][number] {
  const prefix = `phases[${phaseIndex}].tasks[${taskIndex}]`;
  const record = requireRecord(
    value,
    prefix,
    `${prefix} must be an object { id, title, description, files_to_touch, context, acceptance_criteria, depends_on?, scenario_refs? }.`,
  );
  const id = requireNonEmptyString(record.id, `${prefix}.id`);
  const title = requireNonEmptyString(record.title, `${prefix}.title`);
  const description = requireNonEmptyString(record.description, `${prefix}.description`);
  const context = requireNonEmptyString(record.context, `${prefix}.context`);
  const files_to_touch = parseOptionalStringArray(record.files_to_touch, `${prefix}.files_to_touch`);
  const acceptance_criteria = requireNonEmptyStringArray(record.acceptance_criteria, `${prefix}.acceptance_criteria`);
  const depends_on = parseOptionalStringArray(record.depends_on, `${prefix}.depends_on`);
  const scenario_refs = parseOptionalStringArray(record.scenario_refs, `${prefix}.scenario_refs`);
  return { id, title, description, context, files_to_touch, acceptance_criteria, depends_on, scenario_refs };
}

function parseLeanSprintScenarios(value: unknown, current: SprintFile): SpecScenario[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new KyroCoreError('INVALID_INPUT', 'Lean sprint "scenarios" must be an array when present.', 'Use [{ id, requirement, given, when, then }, ...].');
  }
  const requirementIds = new Set((current.spec?.requirements ?? []).map((requirement) => requirement.id));
  const scenarios = value.map((entry, index) => parseLeanSprintScenario(entry, index, requirementIds));
  const seen = new Set<string>();
  for (const scenario of scenarios) {
    if (seen.has(scenario.id)) throw new KyroCoreError('INVALID_INPUT', `Duplicate scenario id "${scenario.id}" in scenarios.`, 'Scenario ids must be unique.');
    seen.add(scenario.id);
  }
  return scenarios;
}

function parseLeanSprintScenario(value: unknown, index: number, requirementIds: Set<string>): SpecScenario {
  const prefix = `scenarios[${index}]`;
  const record = requireRecord(value, prefix, `${prefix} must be an object { id, requirement, given, when, then }.`);
  const id = requireNonEmptyString(record.id, `${prefix}.id`);
  const requirement = requireNonEmptyString(record.requirement, `${prefix}.requirement`);
  const given = requireNonEmptyString(record.given, `${prefix}.given`);
  const when = requireNonEmptyString(record.when, `${prefix}.when`);
  const then = requireNonEmptyString(record.then, `${prefix}.then`);
  if (!requirementIds.has(requirement)) {
    throw new KyroCoreError(
      'INVALID_INPUT',
      `${prefix}.requirement "${requirement}" does not reference an existing spec.requirements[].id.`,
      'Fix the requirement reference, or add it to spec.requirements first (spec requirements are not authored by sprint mode).',
    );
  }
  return { id, requirement, given, when, then };
}

function requireRecord(value: unknown, field: string, message: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new KyroCoreError('INVALID_INPUT', message, `Fix "${field}" in the lean plan file.`);
  }
  return value as Record<string, unknown>;
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new KyroCoreError('INVALID_INPUT', `Lean plan "${field}" must be a non-empty string.`, `Add a non-empty "${field}" to the lean plan file.`);
  }
  return value;
}

function requireNonEmptyStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || !value.every((item) => typeof item === 'string' && item.trim() !== '')) {
    throw new KyroCoreError('INVALID_INPUT', `Lean plan "${field}" must be a non-empty array of non-empty strings.`, `Add at least one entry to "${field}".`);
  }
  return value as string[];
}

function parseOptionalStringArray(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new KyroCoreError('INVALID_INPUT', `Lean plan "${field}" must be an array of strings when present.`, `Fix "${field}" in the lean plan file.`);
  }
  return value as string[];
}

function parsePlanArgs(rawArgs: string[]): PlanArgs {
  let from = '';
  let scope: string | null = null;
  let dryRun = false;
  let help = false;
  let updateActive = false;
  let roadmap = false;
  let yes = false;
  let digest: string | null = null;
  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    if (arg === '--help' || arg === '-h') help = true;
    else if (arg === '--dry-run') dryRun = true;
    else if (arg === '--from') { from = requireValue(rawArgs, i, arg); i += 1; }
    else if (arg.startsWith('--from=')) from = arg.slice('--from='.length);
    else if (arg === '--kyro-scope') { scope = requireValue(rawArgs, i, arg); i += 1; }
    else if (arg.startsWith('--kyro-scope=')) scope = arg.slice('--kyro-scope='.length);
    else if (arg === '--update-active') updateActive = true;
    else if (arg === '--roadmap') roadmap = true;
    else if (arg === '--yes' || arg === '--confirm') yes = true;
    else if (arg === '--digest') { digest = requireValue(rawArgs, i, arg); i += 1; }
    else if (arg.startsWith('--digest=')) digest = arg.slice('--digest='.length);
    else throw new KyroCoreError('INVALID_INPUT', `Unknown plan option: ${arg}`);
  }
  if (digest !== null && !/^[a-f0-9]{64}$/.test(digest)) throw new KyroCoreError('INVALID_INPUT', '--digest must be a lowercase SHA-256 digest.');
  return { from, scope, dryRun, help, updateActive, roadmap, yes, digest };
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) throw new KyroCoreError('INVALID_INPUT', `${flag} requires a value`);
  return value;
}

function printPlanHelp(): void {
  console.log(`Usage: kyro plan --from <file> [--kyro-scope <scope>] [--dry-run]
  kyro plan --update-active --from <file> --kyro-scope <scope> --dry-run --json
  kyro plan --update-active --from <file> --kyro-scope <scope> --digest <sha256> --yes --json
  kyro plan --roadmap --from <file> --kyro-scope <scope> (--dry-run | --digest <sha256> --yes) --json

Explicit --update-active edits existing tasks in the current unclosed sprint of an open scope.
Preview first; apply requires the exact digest and --yes. Closed/archived tasks are immutable.
Input: { scope?, sprint: { n, slug }, reason, tasks?: [{ id, title?, description?, context?,
  acceptance_criteria?, files_to_touch?, depends_on?, scenario_refs? } | { id, action: "cancel", reason }],
  requirements?: [{ id, statement, priority?, rationale? } | { id, action: "remove" }],
  scenarios?: [{ id, requirement, given, when, then }] }
Removing a requirement automatically removes its live scenarios and requires the same request to cancel every live task consuming them. No task additions or lifecycle fields are accepted.
Changes invalidate affected task/dependent verdicts atomically; cancellations retain any prior evidence as history.
Revalidate, record new evidence and review; optional QA is not automatically introduced.
A retry after a successful update needs a new preview (no persistent update receipts).

--roadmap is a separate digest-protected writer for planned roadmap entries only. Input:
{ reason, updates?: [{ n, title }], add?: [{ slug, title }], cancel?: [n], order?: [n] }.
It never changes closed or active entries; additions receive the next unused n. The order field contains
exactly the remaining planned n values and controls only their presentation. Cancelled entries remain
as cancelled history and are excluded from plannedSprintCount and future materialization.

Two default modes, auto-detected from the resolved scope's state (not from the --from file shape):
  - init mode: no sprint.json yet for the scope. Materializes the scope's initial sprint.json
    (spec + roadmap, activeSprint: null). The sprint file defines the scope, and local.json sets
    activeScope to the initialized scope. When git user.name and/or a valid user.email is set, writes optional
    sprint.json.author { name?, email?, source: "git", capturedAt } with usable fields only
    (malformed email dropped). Omits author when nothing usable remains. Never blocks init —
    author is best-effort only. Not accepted from the lean file (machine identity at write time).
  - sprint mode: sprint.json exists, activeSprint is null, and handoff.nextAction is "plan_sprint"
    or "await_scope_completion" (invoking plan explicitly chooses scope expansion).
    Materializes the next activeSprint (phases/tasks all pending) from a lean sprint-plan file.
    Refuses with SPRINT_ALREADY_ACTIVE if a sprint is already active, or NOT_READY_TO_PLAN if the
    handoff isn't at plan_sprint or await_scope_completion. Writes only sprint.json (preserves existing author).
Both modes are tool-owned and validated, so the agent never hand-writes the full v4 document.

Init-mode lean plan file shape:
  {
    "scope": "kebab-case-scope",
    "title": "Human title",
    "objective": "One sentence.",
    "successCriteria": ["...", "..."],
    "spec": {
      "requirements": [{ "id": "R1", "statement": "...", "priority": "must", "rationale": "..." }],
      "nonGoals": ["..."],
      "openQuestions": ["..."]
    },
    "roadmap": {
      "plannedSprintCount": 2,
      "sizingRationale": "...",
      "sprints": [{ "n": 1, "slug": "...", "title": "..." }]
    }
  }

Sprint-mode lean plan file shape (--kyro-scope required; no "scope" field in the file):
  {
    "sprint": { "n": 1, "slug": "artifact-standard", "title": "Artifact standard", "objective": "One sentence." },
    "phases": [
      { "id": "P1", "title": "Phase title", "objective": "Phase objective",
        "tasks": [
          { "id": "T1.1", "title": "...", "description": "...", "files_to_touch": ["src/x.rs"],
            "context": "...", "acceptance_criteria": ["...", "..."], "depends_on": [], "scenario_refs": [] }
        ] }
    ],
    "definitionOfDone": ["...", "..."],
    "scenarios": [ { "id": "S1", "requirement": "R1", "given": "...", "when": "...", "then": "..." } ]
  }
sprint.n must equal (max sprint.ledger[].n) + 1, or 1 if the ledger is empty. scenarios[].requirement
must reference an existing spec.requirements[].id; task scenario_refs must reference an existing
scenario id (existing spec.scenarios or this file's scenarios).`);
}
