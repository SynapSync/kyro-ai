import { readFileSync } from 'node:fs';
import { applyPlan, printPlan } from '../fs';
import { readJsonSafely } from '../artifacts/json';
import { sprintJsonPath } from '../artifacts/paths';
import { asSprintFile, validateSprintFile } from '../artifacts/schema';
import { countClarificationMarkers } from '../core/analysis';
import { KyroCoreError } from '../core/errors';
import { resolveScope } from '../core/scope-resolution';
import { emitToolCommandRun } from '../core/trace';
import { SPEC_REQUIREMENT_PRIORITY, type OperationPlan, type SpecRequirement, type SpecRequirementPriority, type SprintFile } from '../types';

const CLARIFICATION_TARGET_KIND = {
  OPEN_QUESTION: 'open_question',
  MARKER: 'marker',
} as const;
type ClarificationTargetKind = (typeof CLARIFICATION_TARGET_KIND)[keyof typeof CLARIFICATION_TARGET_KIND];

interface ClarificationTargetInput {
  kind: ClarificationTargetKind;
  text: string;
}

interface ClarificationResolutionInput {
  target: ClarificationTargetInput;
  answer: string;
  requirements: SpecRequirement[];
}

interface ClarificationFileInput {
  resolutions: ClarificationResolutionInput[];
}

interface ClarifyArgs {
  from: string;
  scope: string | null;
  dryRun: boolean;
  help: boolean;
}

/**
 * Tool-owned clarification writes. A resolution file may carry one accepted answer (the normal
 * conversational path) or several answers the user explicitly chose to accumulate.
 */
export function runClarifyCommand(rawArgs: string[]): void {
  const args = parseClarifyArgs(rawArgs);
  if (args.help) {
    printClarifyHelp();
    return;
  }
  if (!args.from) {
    throw new KyroCoreError('INVALID_INPUT', 'Usage: kyro clarify --from <resolutions.json> [--kyro-scope <scope>] [--dry-run].', 'Pass a lean clarification-resolution JSON file. Run kyro clarify --help.');
  }

  const scope = resolveScope(args.scope);
  const input = parseClarificationFile(args.from);
  const { sprint, plan } = buildClarifyPlan(scope, input);
  printPlan(`Apply ${input.resolutions.length} clarification resolution(s) to scope ${scope}`, plan);
  if (args.dryRun) {
    console.log('Dry run complete. No files changed.');
    return;
  }

  emitToolCommandRun(scope, 'cli', 'clarify', { resolutions: input.resolutions.length });
  applyPlan(plan);
  revalidateWritten(scope);
  console.log(`Applied ${input.resolutions.length} clarification resolution(s). Next action: ${sprint.handoff.nextAction}.`);
}

export function buildClarifyPlan(
  scope: string,
  input: ClarificationFileInput,
): { sprint: SprintFile; plan: OperationPlan[] } {
  const sprint = loadValidSprint(scope);
  if (sprint.handoff.nextAction !== 'clarify') {
    throw new KyroCoreError('NOT_READY_TO_CLARIFY', `Scope "${scope}" is not awaiting clarification (nextAction=${sprint.handoff.nextAction}).`, 'Use kyro context-pack --json to inspect the current handoff before mutating the scope.');
  }

  const sourceKeys = new Set<string>();
  for (const resolution of input.resolutions) {
    const key = `${resolution.target.kind}:${resolution.target.text}`;
    if (sourceKeys.has(key)) {
      throw new KyroCoreError('INVALID_INPUT', `Clarification input resolves the same target more than once: ${key}.`, 'Keep exactly one resolution for each open question or marker.');
    }
    sourceKeys.add(key);
  }

  const requirementIds = new Set((sprint.spec?.requirements ?? []).map((requirement) => requirement.id));
  for (const resolution of input.resolutions) {
    for (const requirement of resolution.requirements) {
      if (requirementIds.has(requirement.id)) {
        throw new KyroCoreError('INVALID_INPUT', `Requirement id "${requirement.id}" already exists.`, 'Use a new requirement id, or leave the existing requirement unchanged.');
      }
      requirementIds.add(requirement.id);
    }
  }

  let next = JSON.parse(JSON.stringify(sprint)) as SprintFile;
  for (const resolution of input.resolutions) {
    next = applyResolution(next, resolution);
  }

  const unresolvedQuestions = next.spec?.openQuestions.length ?? 0;
  const unresolvedMarkers = countClarificationMarkers(next);
  const isClear = unresolvedQuestions === 0 && unresolvedMarkers === 0;
  next.handoff = {
    nextAction: isClear ? (next.activeSprint ? 'execute_task' : 'plan_sprint') : 'clarify',
    nextTaskId: isClear && next.activeSprint ? (sprint.handoff.nextTaskId ?? firstTaskId(next)) : null,
    blockers: [],
    note: isClear
      ? `All clarifications are resolved. ${next.activeSprint ? 'Resume the active sprint.' : 'Plan the next sprint from the clarified specification.'}`
      : `${unresolvedQuestions} open question(s) and ${unresolvedMarkers} clarification marker(s) remain. Continue clarify before planning or executing.`,
    lastUpdated: new Date().toISOString().slice(0, 10),
  };

  const issues = validateSprintFile(next, `${scope}/sprint.json`);
  if (issues.length > 0) {
    const detail = issues.map((issue) => `${issue.field} ${issue.message}`).join('; ');
    throw new KyroCoreError('INVALID_SPRINT_SHAPE', `Clarification input would produce invalid sprint.json — ${detail}.`, 'Fix the resolution input; Kyro wrote nothing.');
  }

  return {
    sprint: next,
    plan: [{ action: 'write', path: sprintJsonPath(scope), content: `${JSON.stringify(next, null, 2)}\n` }],
  };
}

function applyResolution(sprint: SprintFile, resolution: ClarificationResolutionInput): SprintFile {
  const { target, answer, requirements } = resolution;
  const spec = sprint.spec ?? { requirements: [], scenarios: [], nonGoals: [], openQuestions: [] };
  if (target.kind === CLARIFICATION_TARGET_KIND.OPEN_QUESTION) {
    if (!spec.openQuestions.includes(target.text)) {
      throw new KyroCoreError('CLARIFICATION_NOT_FOUND', `Open question was not found: "${target.text}".`, 'Read kyro context-pack --json and copy one current specOpenQuestions value exactly.');
    }
    return withResolution(sprint, {
      ...spec,
      requirements: [...spec.requirements, ...requirements],
      openQuestions: spec.openQuestions.filter((question) => question !== target.text),
    }, target.text, answer);
  }

  if (!hasMarker(sprint, target.text)) {
    throw new KyroCoreError('CLARIFICATION_NOT_FOUND', `Clarification marker was not found: "${target.text}".`, 'Copy the marker payload exactly from kyro analyze or sprint.json.');
  }
  const replaced = replaceMarker(sprint, target.text, answer);
  const replacedSpec = replaced.spec ?? { requirements: [], scenarios: [], nonGoals: [], openQuestions: [] };
  return withResolution(replaced, {
    ...replacedSpec,
    requirements: [...replacedSpec.requirements, ...requirements],
  }, target.text, answer);
}

function withResolution(sprint: SprintFile, spec: SprintFile['spec'], question: string, answer: string): SprintFile {
  return {
    ...sprint,
    spec,
    clarifications: [
      ...sprint.clarifications,
      { q: question, a: answer, sprint: sprint.activeSprint?.n ?? 1, date: new Date().toISOString().slice(0, 10) },
    ],
  };
}

function hasMarker(sprint: SprintFile, marker: string): boolean {
  return JSON.stringify(sprint).includes(`[NEEDS CLARIFICATION: ${marker}]`);
}

function replaceMarker(value: SprintFile, marker: string, answer: string): SprintFile {
  const needle = `[NEEDS CLARIFICATION: ${marker}]`;
  const visit = (current: unknown): unknown => {
    if (typeof current === 'string') return current.split(needle).join(answer);
    if (Array.isArray(current)) return current.map(visit);
    if (current && typeof current === 'object') {
      return Object.fromEntries(Object.entries(current).map(([key, child]) => [key, visit(child)]));
    }
    return current;
  };
  return visit(value) as SprintFile;
}

function firstTaskId(sprint: SprintFile): string | null {
  for (const phase of sprint.activeSprint?.phases ?? []) {
    if (phase.tasks[0]) return phase.tasks[0].id;
  }
  return sprint.activeSprint?.emergentTasks?.[0]?.id ?? null;
}

function loadValidSprint(scope: string): SprintFile {
  const read = readJsonSafely(sprintJsonPath(scope));
  if (!read.exists) throw new KyroCoreError('SCOPE_NOT_FOUND', `Scope "${scope}" has no sprint.json.`, 'Create the scope with kyro plan --from <file>.');
  if (read.error) throw new KyroCoreError('INVALID_JSON', `sprint.json for "${scope}" is invalid JSON (${read.error}).`, 'Restore from an archive snapshot.');
  const issues = validateSprintFile(read.value, `${scope}/sprint.json`);
  if (issues.length > 0) {
    const detail = issues.map((issue) => `${issue.field} ${issue.message}`).join('; ');
    throw new KyroCoreError('INVALID_SPRINT_SHAPE', `Cannot clarify ${scope}: ${detail}`, 'Fix sprint.json shape before applying clarifications.');
  }
  const sprint = asSprintFile(read.value);
  if (!sprint) throw new KyroCoreError('INVALID_SPRINT_SHAPE', `sprint.json for "${scope}" is not a valid v4 file.`, 'Run kyro doctor --artifacts.');
  return sprint;
}

function parseClarificationFile(path: string): ClarificationFileInput {
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(path, 'utf-8')) as unknown; }
  catch (error) { throw new KyroCoreError('INVALID_INPUT', `Cannot read clarification file "${path}": ${error instanceof Error ? error.message : String(error)}.`, 'Pass a valid JSON file with a resolutions array.'); }
  if (!isRecord(raw) || !Array.isArray(raw.resolutions) || raw.resolutions.length === 0) {
    throw new KyroCoreError('INVALID_INPUT', 'Clarification file must contain a non-empty resolutions array.', 'Use { "resolutions": [{ "target": { "kind": "open_question", "text": "..." }, "answer": "..." }] }.');
  }
  return { resolutions: raw.resolutions.map((value, index) => parseResolution(value, index)) };
}

function parseResolution(value: unknown, index: number): ClarificationResolutionInput {
  const path = `resolutions[${index}]`;
  if (!isRecord(value) || !isRecord(value.target)) throw new KyroCoreError('INVALID_INPUT', `${path} must contain target { kind, text } and answer.`, 'Fix the clarification JSON shape.');
  const kind = value.target.kind;
  const text = value.target.text;
  const answer = value.answer;
  if (!isClarificationTargetKind(kind) || typeof text !== 'string' || !text.trim() || typeof answer !== 'string' || !answer.trim()) {
    throw new KyroCoreError('INVALID_INPUT', `${path} target.kind/text and answer must be non-empty valid values.`, 'Use kind "open_question" or "marker" and provide non-empty text and answer.');
  }
  const requirementsRaw = value.requirements ?? [];
  if (!Array.isArray(requirementsRaw)) throw new KyroCoreError('INVALID_INPUT', `${path}.requirements must be an array when provided.`, 'Use an array of { id, statement, priority?, rationale? }.');
  return {
    target: { kind, text: text.trim() },
    answer: answer.trim(),
    requirements: requirementsRaw.map((requirement, requirementIndex) => parseRequirement(requirement, `${path}.requirements[${requirementIndex}]`)),
  };
}

function parseRequirement(value: unknown, path: string): SpecRequirement {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim() || typeof value.statement !== 'string' || !value.statement.trim()) {
    throw new KyroCoreError('INVALID_INPUT', `${path} must contain non-empty id and statement strings.`, 'Use { "id": "R5", "statement": "...", "priority": "must" }.');
  }
  if (value.priority !== undefined && !isPriority(value.priority)) {
    throw new KyroCoreError('INVALID_INPUT', `${path}.priority is invalid.`, 'Use must, should, or could.');
  }
  if (value.rationale !== undefined && typeof value.rationale !== 'string') {
    throw new KyroCoreError('INVALID_INPUT', `${path}.rationale must be a string when provided.`, 'Use a short rationale string or omit it.');
  }
  return {
    id: value.id.trim(),
    statement: value.statement.trim(),
    ...(value.priority ? { priority: value.priority } : {}),
    ...(typeof value.rationale === 'string' ? { rationale: value.rationale.trim() } : {}),
  };
}

function parseClarifyArgs(rawArgs: string[]): ClarifyArgs {
  const args: ClarifyArgs = { from: '', scope: null, dryRun: false, help: false };
  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--from') args.from = requireValue(rawArgs, i++, '--from');
    else if (arg.startsWith('--from=')) args.from = arg.slice('--from='.length);
    else if (arg === '--kyro-scope') args.scope = requireValue(rawArgs, i++, '--kyro-scope');
    else if (arg.startsWith('--kyro-scope=')) args.scope = arg.slice('--kyro-scope='.length);
    else throw new KyroCoreError('INVALID_INPUT', `Unknown clarify option: ${arg}`, 'Run kyro clarify --help.');
  }
  return args;
}

function revalidateWritten(scope: string): void {
  const verify = readJsonSafely(sprintJsonPath(scope));
  if (verify.error || !verify.exists) throw new KyroCoreError('INVALID_JSON', `clarify wrote sprint.json but re-parse failed (${verify.error ?? 'missing'}).`, 'Restore from an archive snapshot.');
  const issues = validateSprintFile(verify.value, `${scope}/sprint.json`);
  if (issues.length > 0) {
    const detail = issues.map((issue) => `${issue.field} ${issue.message}`).join('; ');
    throw new KyroCoreError('INVALID_SPRINT_SHAPE', `clarify wrote sprint.json but it failed validation — ${detail}.`, 'Restore from an archive snapshot.');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isClarificationTargetKind(value: unknown): value is ClarificationTargetKind {
  return typeof value === 'string' && Object.values(CLARIFICATION_TARGET_KIND).includes(value as ClarificationTargetKind);
}

function isPriority(value: unknown): value is SpecRequirementPriority {
  return typeof value === 'string' && Object.values(SPEC_REQUIREMENT_PRIORITY).includes(value as SpecRequirementPriority);
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) throw new KyroCoreError('INVALID_INPUT', `${flag} requires a value.`, `Pass ${flag} <value>.`);
  return value;
}

function printClarifyHelp(): void {
  console.log(`Usage:
  kyro clarify --from <resolutions.json> [--kyro-scope <scope>] [--dry-run]

Apply one or more accepted clarification answers through the CLI. Never hand-edit sprint.json.
The normal conversation resolves one question at a time; a resolutions file may contain a batch only
when the user explicitly asks to defer registration.

Resolution file:
  {
    "resolutions": [
      {
        "target": { "kind": "open_question", "text": "Exact current question" },
        "answer": "Accepted decision.",
        "requirements": [{ "id": "R5", "statement": "Verifiable effect.", "priority": "must" }]
      }
    ]
  }

target.kind is "open_question" or "marker". A marker target replaces every exact
[NEEDS CLARIFICATION: text] occurrence with the accepted answer. The command remains in clarify
until no open questions or unresolved markers remain.
`);
}
