import { readJsonSafely } from '../artifacts/json';
import { sprintJsonPath } from '../artifacts/paths';
import { asSharedProjectState, asSprintFile, validateSharedProjectStateShape, validateSprintFile } from '../artifacts/schema';
import { PROJECT_STATE_PATH } from '../constants';
import { KyroCoreError } from '../core/errors';
import { resolveScope } from '../core/scope-resolution';
import { emitToolCommandRun } from '../core/trace';
import { applyPlan, printPlan } from '../fs';
import { readSharedProjectState, sanitizeSharedForWrite } from '../state';
import type { Convention, KyroSharedProjectState, OperationPlan, SprintFile } from '../types';

/**
 * Tool-owned convention append. Scope-local is the default; --global also persists the rule on
 * shared project.json so every scope context pack inherits it.
 *
 *   kyro rule add --rule "Run docs-check after OpenAPI changes" --tag process [--global]
 */
export function runRuleCommand(rawArgs: string[]): void {
  const sub = rawArgs[0];
  if (sub === undefined || sub === '--help' || sub === '-h' || sub === 'help') {
    printRuleHelp();
    return;
  }
  if (sub === 'add') {
    runRuleAdd(rawArgs.slice(1));
    return;
  }
  throw new KyroCoreError('INVALID_INPUT', `Unknown rule subcommand "${sub}".`, 'Use: kyro rule add. Run kyro rule --help.');
}

function runRuleAdd(rawArgs: string[]): void {
  const args = parseRuleAddArgs(rawArgs);
  if (args.help) {
    printRuleHelp();
    return;
  }
  const scope = resolveScope(args.scope);
  const { plan, convention, globalAdded, alreadyGlobal } = buildRuleAddPlan(scope, args);
  const destination = args.global ? 'scope and shared project' : 'scope';
  printPlan(`Add rule ${convention.id} to ${destination}`, plan);
  if (args.dryRun) {
    console.log('Dry run complete. No files changed.');
    return;
  }
  emitToolCommandRun(scope, 'cli', 'rule add', { id: convention.id, global: args.global });
  applyPlan(plan);
  revalidateWritten(scope, args.global);
  const globalMessage = globalAdded ? ' Also persisted globally in project.json.' : alreadyGlobal ? ' Matching global rule already existed in project.json.' : '';
  console.log(`Rule ${convention.id} added to scope ${scope}.${globalMessage}`);
}

export interface RuleAddArgs {
  id: string | null;
  rule: string;
  tags: string[];
  scope: string | null;
  global: boolean;
  dryRun: boolean;
  help: boolean;
}

export interface RuleAddPlan {
  sprint: SprintFile;
  sharedProject: KyroSharedProjectState | null;
  plan: OperationPlan[];
  convention: Convention;
  globalAdded: boolean;
  alreadyGlobal: boolean;
}

export function buildRuleAddPlan(scope: string, args: RuleAddArgs): RuleAddPlan {
  const sprint = loadValidSprint(scope);
  const rule = normalizeRule(args.rule);
  if (!rule) throw new KyroCoreError('INVALID_INPUT', '--rule is required.', 'Pass --rule "Specific actionable rule".');

  const tags = normalizeTags(args.tags);
  const normalizedRule = comparableRule(rule);
  if (sprint.conventions.some((convention) => comparableRule(convention.rule) === normalizedRule)) {
    throw new KyroCoreError('INVALID_INPUT', 'The active scope already contains this rule.', 'Run kyro context-pack to inspect existing conventions before adding another.');
  }

  const sharedProject = loadSharedProject(args.global);
  const globalConventions = sharedProject?.conventions ?? [];
  const matchingGlobal = globalConventions.find((convention) => comparableRule(convention.rule) === normalizedRule) ?? null;
  const idPool = [...sprint.conventions, ...globalConventions];
  const requestedId = args.id?.trim() || null;
  if (requestedId && !/^[a-z0-9][a-z0-9-]*$/.test(requestedId)) {
    throw new KyroCoreError('INVALID_INPUT', `Rule id "${requestedId}" must use lowercase letters, numbers, and hyphens.`, 'Pass --id process-3 or omit --id for automatic allocation.');
  }

  const canReuseGlobalId = matchingGlobal && !sprint.conventions.some((convention) => convention.id === matchingGlobal.id);
  const id = requestedId ?? (canReuseGlobalId ? matchingGlobal.id : nextConventionId(idPool, tags[0]));
  if (sprint.conventions.some((convention) => convention.id === id)) {
    throw new KyroCoreError('INVALID_INPUT', `Rule id "${id}" already exists in scope ${scope}.`, 'Choose a new --id or omit it for automatic allocation.');
  }
  const globalIdOwner = globalConventions.find((convention) => convention.id === id) ?? null;
  if (globalIdOwner && globalIdOwner !== matchingGlobal) {
    throw new KyroCoreError('INVALID_INPUT', `Rule id "${id}" already exists in project.json.`, 'Choose a new --id or omit it for automatic allocation.');
  }

  const convention: Convention = {
    id,
    rule,
    tags,
    addedSprint: currentSprintNumber(sprint),
  };
  const nextSprint: SprintFile = { ...sprint, conventions: [...sprint.conventions, convention] };
  const plan: OperationPlan[] = [writeJsonPlan(sprintJsonPath(scope), nextSprint)];

  let nextSharedProject: KyroSharedProjectState | null = sharedProject;
  const globalAdded = args.global && matchingGlobal === null;
  if (sharedProject && globalAdded) {
    nextSharedProject = sanitizeSharedForWrite({
      ...sharedProject,
      conventions: [...globalConventions, convention],
    });
    plan.push(writeJsonPlan(PROJECT_STATE_PATH, nextSharedProject));
  }

  return {
    sprint: nextSprint,
    sharedProject: nextSharedProject,
    plan,
    convention,
    globalAdded,
    alreadyGlobal: args.global && matchingGlobal !== null,
  };
}

function loadValidSprint(scope: string): SprintFile {
  const read = readJsonSafely(sprintJsonPath(scope));
  if (!read.exists) {
    throw new KyroCoreError('SCOPE_NOT_FOUND', `Scope "${scope}" has no sprint.json.`, 'Create the scope with kyro plan --from (init).');
  }
  if (read.error) {
    throw new KyroCoreError('INVALID_JSON', `sprint.json for "${scope}" is invalid JSON (${read.error}).`, 'Restore from an archive snapshot.');
  }
  const issues = validateSprintFile(read.value, `${scope}/sprint.json`);
  if (issues.length > 0) {
    throw new KyroCoreError('INVALID_SPRINT_SHAPE', `Cannot add rule for ${scope}: ${formatIssues(issues)}`, 'Fix sprint.json shape first (kyro doctor --artifacts).');
  }
  const sprint = asSprintFile(read.value);
  if (!sprint) throw new KyroCoreError('INVALID_SPRINT_SHAPE', `sprint.json for "${scope}" is not a valid v4 file.`, 'Run kyro doctor --artifacts.');
  return sprint;
}

function loadSharedProject(required: boolean): KyroSharedProjectState | null {
  const shared = readSharedProjectState();
  if (!shared) {
    if (!required) return null;
    throw new KyroCoreError(
      'INVALID_INPUT',
      'Global rule persistence requires .agents/kyro/project.json.',
      'Run npx kyro-ai install --init-workspace --yes to create or migrate layered project state, then retry with --global.',
    );
  }
  const issues = validateSharedProjectStateShape(shared, PROJECT_STATE_PATH);
  if (issues.length > 0) {
    throw new KyroCoreError('INVALID_INPUT', `Cannot add a global rule: ${formatIssues(issues)}`, 'Fix project.json shape first (kyro doctor --artifacts).');
  }
  const valid = asSharedProjectState(shared);
  if (!valid) throw new KyroCoreError('INVALID_INPUT', 'project.json is not valid shared v4 state.', 'Run kyro doctor --artifacts.');
  return valid;
}

function revalidateWritten(scope: string, global: boolean): void {
  const sprintRead = readJsonSafely(sprintJsonPath(scope));
  if (sprintRead.error || !sprintRead.exists) {
    throw new KyroCoreError('INVALID_JSON', `rule add wrote sprint.json but re-parse failed (${sprintRead.error ?? 'missing'}).`, 'Restore from an archive snapshot.');
  }
  const sprintIssues = validateSprintFile(sprintRead.value, `${scope}/sprint.json`);
  if (sprintIssues.length > 0) {
    throw new KyroCoreError('INVALID_SPRINT_SHAPE', `rule add wrote sprint.json but validation failed: ${formatIssues(sprintIssues)}`, 'Restore from an archive snapshot.');
  }
  if (!global) return;
  const projectRead = readJsonSafely(PROJECT_STATE_PATH);
  if (projectRead.error || !projectRead.exists) {
    throw new KyroCoreError('INVALID_JSON', `rule add expected project.json but re-parse failed (${projectRead.error ?? 'missing'}).`, 'Re-run kyro doctor --artifacts.');
  }
  const projectIssues = validateSharedProjectStateShape(projectRead.value, PROJECT_STATE_PATH);
  if (projectIssues.length > 0) {
    throw new KyroCoreError('INVALID_INPUT', `rule add wrote project.json but validation failed: ${formatIssues(projectIssues)}`, 'Re-run kyro doctor --artifacts.');
  }
}

function normalizeRule(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function comparableRule(value: string): string {
  return normalizeRule(value).toLowerCase();
}

function normalizeTags(values: string[]): string[] {
  const tags = values.length > 0 ? values : ['process'];
  const normalized = [...new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))];
  for (const tag of normalized) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(tag)) {
      throw new KyroCoreError('INVALID_INPUT', `Tag "${tag}" must use lowercase letters, numbers, and hyphens.`, 'Pass --tag process, --tag testing, or another kebab-case tag.');
    }
  }
  return normalized.length > 0 ? normalized : ['process'];
}

function nextConventionId(existing: Convention[], prefix: string): string {
  let max = 0;
  const pattern = new RegExp(`^${escapeRegex(prefix)}-(\\d+)$`);
  for (const convention of existing) {
    const match = pattern.exec(convention.id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `${prefix}-${max + 1}`;
}

function currentSprintNumber(sprint: SprintFile): number {
  if (sprint.activeSprint) return sprint.activeSprint.n;
  return sprint.ledger.reduce((max, entry) => Math.max(max, entry.n), 0);
}

function writeJsonPlan(path: string, value: unknown): OperationPlan {
  return { action: 'write', path, content: `${JSON.stringify(value, null, 2)}\n` };
}

function formatIssues(issues: Array<{ field: string; message: string }>): string {
  return issues.map((issue) => `${issue.field} ${issue.message}`).join('; ');
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseRuleAddArgs(args: string[]): RuleAddArgs {
  const out: RuleAddArgs = {
    id: null,
    rule: '',
    tags: [],
    scope: null,
    global: false,
    dryRun: false,
    help: false,
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') out.help = true;
    else if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--global') out.global = true;
    else if (arg === '--id') out.id = requireValue(args, i++, '--id');
    else if (arg === '--rule') out.rule = requireValue(args, i++, '--rule');
    else if (arg === '--tag') out.tags.push(requireValue(args, i++, '--tag'));
    else if (arg === '--kyro-scope') out.scope = requireValue(args, i++, '--kyro-scope');
    else throw new KyroCoreError('INVALID_INPUT', `Unknown flag for rule add: ${arg}`, 'Run kyro rule --help.');
  }
  return out;
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new KyroCoreError('INVALID_INPUT', `${flag} requires a value.`, `Pass ${flag} <value>.`);
  }
  return value;
}

function printRuleHelp(): void {
  console.log(`Usage:
  kyro rule add --rule <text> [--tag <tag> ...] [--id <id>] [--global] [--kyro-scope <scope>] [--dry-run]

Registers an operational rule in the active scope's sprint.json conventions. Use --global only
after the user confirms the rule should also be inherited by every scope through project.json.
Tags default to process; --kyro-scope defaults to the active or only scope.

Example:
  kyro rule add --rule "Keep the readiness checklist synchronized with verified scope evidence." \\
    --tag process --global
`);
}
