import { readFileSync } from 'node:fs';
import { applyPlan, printPlan } from '../fs';
import { readJsonSafely } from '../artifacts/json';
import { sprintJsonPath } from '../artifacts/paths';
import { asSprintFile, validateLocalProjectStateShape, validateSharedProjectStateShape, validateSprintFile } from '../artifacts/schema';
import { LOCAL_STATE_PATH, PROJECT_STATE_PATH } from '../constants';
import { resolveScopeAuthorFromGit } from '../core/actor';
import { KyroCoreError } from '../core/errors';
import { countClarificationMarkers } from '../core/analysis';
import { deriveActiveSprintStatus, derivePhaseStatus, deriveScopeStatus } from '../core/status';
import { emitToolCommandRun } from '../core/trace';
import { readProjectState, updateProjectStateLayers } from '../state';
import type { ActiveSprint, KyroProjectState, NextAction, OperationPlan, Phase, Roadmap, ScopeAuthor, Spec, SpecRequirement, SpecScenario, SprintFile, Task } from '../types';
import type { ValidationIssue } from '../artifacts/schema';

const KEBAB_CASE_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SPEC_REQUIREMENT_PRIORITIES = ['must', 'should', 'could'] as const;

export interface PlanArgs {
  from: string;
  scope: string | null;
  dryRun: boolean;
  help: boolean;
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
 * (handoff.nextAction === 'plan_sprint') is sprint mode. Both modes need a resolved scope first
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
  if (currentSprint.handoff.nextAction !== 'plan_sprint') {
    throw new KyroCoreError(
      'NOT_READY_TO_PLAN',
      `Scope "${scope}" is not ready to plan a sprint (nextAction=${currentSprint.handoff.nextAction}).`,
      'Resolve the current handoff first (e.g. clarify, or done means the scope is complete).',
    );
  }
  runPlanSprintMode(raw, scope, currentSprint, args, state);
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

  registerScopeInProjectState(input.scope, sprint.title, state);

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

  // Planning a sprint makes the scope active; reconcile the kyro.json status cache so the freshly
  // written artifact is coherent (otherwise every sprint-mode run leaves a stale-status analyze
  // finding). This mirrors what `kyro repair` does — the derived status is the source of truth.
  reconcileScopeStatusInProjectState(scope, sprint, state);

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
  const nextAction: NextAction = markers > 0 ? 'clarify' : 'plan_sprint';
  const note = markers > 0
    ? `Scope initialized with ${markers} unresolved [NEEDS CLARIFICATION] marker(s); resolve them before planning.`
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
  if (roadmapEntry) roadmapEntry.state = 'active';
  // Deliberate scope cut for this increment: sprint mode does not auto-transition debt[] items (e.g.
  // marking due debt "in_progress" the way the plan-sprint workflow does by hand). Debt is left as-is;
  // the agent/checker can transition it explicitly. Never dropped or reset either way.

  const markers = countClarificationMarkers(next);
  const nextAction: NextAction = markers > 0 ? 'clarify' : 'execute_task';
  const nextTaskId = markers > 0 ? null : phases[0].tasks[0].id;
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
function registerScopeInProjectState(scope: string, title: string, state: KyroProjectState): void {
  if (!state.scopes.some((entry) => entry.id === scope)) {
    const scopes = [...state.scopes, { id: scope, title, status: 'planning' as const }];
    // Registry cache on shared; auto-activeScope only when unset (local layer).
    if (state.activeScope == null) {
      updateProjectStateLayers({ scopes, activeScope: scope });
    } else {
      updateProjectStateLayers({ scopes });
    }
  }
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

/** Reconcile the shared scopes[] status cache with the derived scope status (mirrors kyro repair). */
function reconcileScopeStatusInProjectState(scope: string, sprint: SprintFile, state: KyroProjectState): void {
  const entry = state.scopes.find((s) => s.id === scope);
  if (!entry) return;
  const derived = deriveScopeStatus(sprint, Boolean(sprint.activeSprint));
  if (entry.status === derived) return;
  const scopes = state.scopes.map((s) => (s.id === scope ? { ...s, status: derived } : s));
  updateProjectStateLayers({ scopes });
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

  const expectedN = current.ledger.length === 0 ? 1 : Math.max(...current.ledger.map((entry) => entry.n)) + 1;
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
  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    if (arg === '--help' || arg === '-h') help = true;
    else if (arg === '--dry-run') dryRun = true;
    else if (arg === '--from') { from = requireValue(rawArgs, i, arg); i += 1; }
    else if (arg.startsWith('--from=')) from = arg.slice('--from='.length);
    else if (arg === '--kyro-scope') { scope = requireValue(rawArgs, i, arg); i += 1; }
    else if (arg.startsWith('--kyro-scope=')) scope = arg.slice('--kyro-scope='.length);
    else throw new KyroCoreError('INVALID_INPUT', `Unknown plan option: ${arg}`);
  }
  return { from, scope, dryRun, help };
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) throw new KyroCoreError('INVALID_INPUT', `${flag} requires a value`);
  return value;
}

function printPlanHelp(): void {
  console.log(`Usage: kyro plan --from <file> [--kyro-scope <scope>] [--dry-run]

Two modes, auto-detected from the resolved scope's state (not from the --from file shape):
  - init mode: no sprint.json yet for the scope. Materializes the scope's initial sprint.json
    (spec + roadmap, activeSprint: null). Also registers the scope in the layered project state:
    project.json (scopes[]) and local.json (activeScope if unset). When git user.name and/or a valid user.email is set, writes optional
    sprint.json.author { name?, email?, source: "git", capturedAt } with usable fields only
    (malformed email dropped). Omits author when nothing usable remains. Never blocks init —
    author is best-effort only. Not accepted from the lean file (machine identity at write time).
  - sprint mode: sprint.json exists, activeSprint is null, and handoff.nextAction is "plan_sprint".
    Materializes the next activeSprint (phases/tasks all pending) from a lean sprint-plan file.
    Refuses with SPRINT_ALREADY_ACTIVE if a sprint is already active, or NOT_READY_TO_PLAN if the
    handoff isn't at plan_sprint yet. Writes only sprint.json (preserves existing author).
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
