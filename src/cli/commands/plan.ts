import { readFileSync, writeFileSync } from 'node:fs';
import { applyPlan, printPlan, resolveManagedPath } from '../fs';
import { readJsonSafely } from '../artifacts/json';
import { sprintJsonPath } from '../artifacts/paths';
import { validateSprintFile } from '../artifacts/schema';
import { KYRO_STATE_PATH } from '../constants';
import { KyroCoreError } from '../core/errors';
import { countClarificationMarkers } from '../core/analysis';
import { emitToolCommandRun } from '../core/trace';
import { assertStateWriterLeaseHealthy } from '../pipeline/state-writer-lock';
import { readProjectState } from '../state';
import type { KyroProjectState, NextAction, OperationPlan, Roadmap, Spec, SpecRequirement, SprintFile } from '../types';

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
  const input = parseLeanPlanInput(raw, args.scope);

  const state = readProjectState();
  if (!state) throw new KyroCoreError('INVALID_INPUT', 'Kyro workspace not initialized (no kyro.json).', 'Run: kyro install --init-workspace');

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

  // Compute markers on a draft with an empty handoff.note so the note text itself can never be
  // mistaken for a marker payload.
  const draftSprint: SprintFile = {
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

function registerScopeInProjectState(scope: string, title: string, state: KyroProjectState): void {
  if (state.scopes.some((entry) => entry.id === scope)) return;
  const nextState: KyroProjectState = {
    ...state,
    scopes: [...state.scopes, { id: scope, title, status: 'planning' }],
    activeScope: state.activeScope ?? scope,
  };
  assertStateWriterLeaseHealthy();
  writeFileSync(resolveManagedPath(KYRO_STATE_PATH), `${JSON.stringify(nextState, null, 2)}\n`, 'utf-8');
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

function parseLeanPlanInput(raw: unknown, cliScope: string | null): LeanPlanInput {
  const record = requireRecord(raw, '<root>', 'Lean plan file must contain a JSON object { scope?, title, objective, successCriteria, spec?, roadmap }.');

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

Init mode only: materializes a scope's initial sprint.json (spec + roadmap, activeSprint: null)
from a compact lean plan JSON file — tool-owned and validated, so the agent never hand-writes the
full v4 document. Refuses with SCOPE_ALREADY_INITIALIZED if the scope already has a sprint.json.
Also registers the scope in kyro.json (scopes[], activeScope if unset).

Lean plan file shape:
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
  }`);
}
