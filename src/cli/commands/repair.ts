import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { ARTIFACT_ROOT } from '../constants';
import { applyPlan, printPlan, resolveManagedPath } from '../fs';
import { readProjectState } from '../state';
import { debtSummaryPath, phasesPath, roadmapPath, roadmapSummaryPath, scopeIndexPath, scopeRoot, scopeStatePath } from '../artifacts/paths';
import type { CliOptions, OperationPlan } from '../types';
import type { DebtSummary, KyroScopeIndex, KyroScopeState, RoadmapSummary, SprintSummary } from '../artifacts/schema';

interface RepairContext {
  scope: string;
  now: string;
}

interface SprintRepairSummary {
  markdownPath: string;
  summaryPath: string;
  summary: SprintSummary;
}

export async function repair(options: CliOptions): Promise<void> {
  const scope = resolveRepairScope(options.kyroScope);
  const plan = buildRepairPlan(scope);
  printPlan('Repair plan', plan);

  if (options.dryRun) {
    console.log('Dry run complete. No files changed.');
    return;
  }

  if (!options.yes) {
    const confirmed = await confirmRepair();
    if (!confirmed) {
      console.log('No changes made.');
      return;
    }
  }

  applyPlan(plan);
  console.log(`Kyro artifacts repaired for scope: ${scope}`);
}

export function buildRepairPlan(scope: string): OperationPlan[] {
  const root = scopeRoot(scope);
  if (!existsSync(resolveManagedPath(root))) {
    throw new Error(`Scope not found: ${scope}`);
  }
  if (!existsSync(resolveManagedPath(roadmapPath(scope)))) {
    throw new Error(`Cannot repair ${scope}: ROADMAP.md not found`);
  }

  const context: RepairContext = { scope, now: new Date().toISOString() };
  const sprintSummaries = buildSprintSummaries(context);
  const debtSummary = buildDebtSummary(context, sprintSummaries);
  const roadmapSummary = buildRoadmapSummary(context, sprintSummaries);
  const state = buildScopeState(context, sprintSummaries);
  const index = buildScopeIndex(context, roadmapSummary, sprintSummaries, debtSummary);

  const plan: OperationPlan[] = [
    { action: 'write', path: scopeStatePath(scope), content: stringifyJson(state) },
    { action: 'write', path: scopeIndexPath(scope), content: stringifyJson(index) },
    { action: 'write', path: roadmapSummaryPath(scope), content: stringifyJson(roadmapSummary) },
  ];

  for (const sprint of sprintSummaries) {
    plan.push({ action: 'write', path: sprint.summaryPath, content: stringifyJson(sprint.summary) });
  }

  if (debtSummary.open + debtSummary.inProgress + debtSummary.resolved + debtSummary.deferred + debtSummary.critical > 0) {
    plan.push({ action: 'write', path: debtSummaryPath(scope), content: stringifyJson(debtSummary) });
  }

  return plan;
}

function resolveRepairScope(requestedScope: string | null): string {
  if (requestedScope) return requestedScope;
  const state = readProjectState();
  if (state?.activeScope) return state.activeScope;
  const scopes = new Set<string>(state?.scopes ?? []);
  for (const folder of listScopeFolders()) scopes.add(folder);
  if (scopes.size === 1) return [...scopes][0];
  if (scopes.size === 0) throw new Error('No Kyro scopes found. Pass --kyro-scope <scope>.');
  throw new Error(`Multiple scopes found (${[...scopes].sort().join(', ')}). Pass --kyro-scope <scope>.`);
}

function buildScopeState(context: RepairContext, sprintSummaries: SprintRepairSummary[]): KyroScopeState {
  const active = latestSprint(sprintSummaries);
  return {
    schemaVersion: 1,
    scope: context.scope,
    status: active ? active.summary.status : 'planning',
    activeSprint: active ? basename(active.markdownPath, '.md') : null,
    currentPhase: active ? 'sprint' : 'planning',
    nextAction: active?.summary.nextRecommendedAction ?? 'plan_sprint',
    roadmapPath: roadmapPath(context.scope),
    sprintsPath: phasesPath(context.scope),
    lastUpdated: context.now,
  };
}

function buildScopeIndex(context: RepairContext, roadmapSummary: RoadmapSummary, sprintSummaries: SprintRepairSummary[], debtSummary: DebtSummary): KyroScopeIndex {
  const active = latestSprint(sprintSummaries);
  return {
    schemaVersion: 1,
    scope: context.scope,
    roadmapSummary: roadmapSummary.summary,
    activeSprintSummary: active?.summaryPath ?? null,
    openDebtCount: debtSummary.open + debtSummary.inProgress,
    nextTask: active?.summary.nextTask ?? null,
    sizingDecision: roadmapSummary.sizingDecision,
    relevantArtifactPaths: {
      roadmap: roadmapPath(context.scope),
      roadmapSummary: roadmapSummaryPath(context.scope),
      sprints: phasesPath(context.scope),
      reentry: `${scopeRoot(context.scope)}/RE-ENTRY-PROMPTS.md`,
    },
    lastUpdated: context.now,
  };
}

function buildRoadmapSummary(context: RepairContext, sprintSummaries: SprintRepairSummary[]): RoadmapSummary {
  const text = readText(roadmapPath(context.scope));
  const plannedSprintCount = countUniqueMatches(text, /Sprint\s+(\d+)/gi);
  const completedSprintCount = sprintSummaries.filter((sprint) => sprint.summary.status === 'completed').length;
  const summary = firstMeaningfulLine(text) || `${context.scope} roadmap`;
  return {
    schemaVersion: 1,
    scope: context.scope,
    status: completedSprintCount >= plannedSprintCount && plannedSprintCount > 0 ? 'completed' : 'planned',
    summary,
    plannedSprintCount,
    completedSprintCount,
    adaptationCount: countMatches(text, /adapt/i),
    sizingDecision: {
      recommendedSprintCount: plannedSprintCount,
      riskLevel: plannedSprintCount > 3 ? 'high' : plannedSprintCount > 1 ? 'medium' : 'low',
      rationale: 'Reconstructed from roadmap sprint references.',
      splitTriggers: [],
      whyNotFewer: 'Repaired summary preserves the roadmap sprint count instead of collapsing scope.',
      whyNotMore: 'Repaired summary does not invent additional sprints beyond roadmap evidence.',
      sprintProofs: Array.from({ length: plannedSprintCount }, (_, index) => `Sprint ${index + 1} exists in roadmap evidence.`),
    },
    nextRecommendedAction: sprintSummaries.length === 0 ? 'plan_sprint' : latestSprint(sprintSummaries)?.summary.nextRecommendedAction ?? 'status',
    openDecisions: extractListItemsUnderHeading(text, /open decisions/i),
    relevantArtifactPaths: [roadmapPath(context.scope)],
    lastUpdated: context.now,
  };
}

function buildSprintSummaries(context: RepairContext): SprintRepairSummary[] {
  return listSprintMarkdown(context.scope).map((markdownPath) => {
    const text = readText(markdownPath);
    const sprintName = basename(markdownPath, '.md');
    const summaryPath = markdownPath.replace(/\.md$/, '.summary.json');
    const blockedTasks = countMatches(text, /\[!\]/g);
    const carryOverTasks = countMatches(text, /\[>\]/g);
    const completedTasks = countMatches(text, /\[x\]/gi);
    const nextTask = findNextTask(text);
    const summary: SprintSummary = {
      schemaVersion: 1,
      scope: context.scope,
      sprint: sprintName,
      status: nextTask ? 'active' : blockedTasks > 0 ? 'blocked' : 'completed',
      completedTasks,
      blockedTasks,
      carryOverTasks,
      nextRecommendedAction: nextTask ? 'execute_task' : 'close_sprint',
      nextTask,
      openDecisions: extractListItemsUnderHeading(text, /open decisions/i),
      filesTouched: extractCodePaths(text),
      debtDeltas: [],
      sourceMarkdown: markdownPath,
      lastUpdated: context.now,
    };
    return { markdownPath, summaryPath, summary };
  });
}

function buildDebtSummary(context: RepairContext, sprintSummaries: SprintRepairSummary[]): DebtSummary {
  const debtSources = sprintSummaries
    .map((sprint) => ({ path: sprint.markdownPath, text: readText(sprint.markdownPath) }))
    .filter((source) => hasDebtEvidence(source.text));
  const sourceMarkdown = debtSources[0]?.path ?? null;
  const text = debtSources.map((source) => source.text).join('\n');
  return {
    schemaVersion: 1,
    scope: context.scope,
    open: countDebtStatus(text, 'open'),
    inProgress: countDebtStatus(text, 'in-progress') + countDebtStatus(text, 'in progress'),
    resolved: countDebtStatus(text, 'resolved'),
    deferred: countDebtStatus(text, 'deferred'),
    critical: countMatches(text, /critical/gi),
    oldestOpenItem: findOldestOpenDebt(text),
    sourceMarkdown,
    lastUpdated: context.now,
  };
}

function listScopeFolders(): string[] {
  const root = resolveManagedPath(ARTIFACT_ROOT);
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

function listSprintMarkdown(scope: string): string[] {
  const directory = resolveManagedPath(phasesPath(scope));
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /SPRINT-.*\.md$/.test(entry.name))
    .map((entry) => `${phasesPath(scope)}/${entry.name}`)
    .sort();
}

function latestSprint(sprints: SprintRepairSummary[]): SprintRepairSummary | null {
  return sprints.length > 0 ? sprints[sprints.length - 1] : null;
}

function readText(path: string): string {
  return readFileSync(resolveManagedPath(path), 'utf-8');
}

function stringifyJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function countMatches(text: string, pattern: RegExp): number {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  return [...text.matchAll(new RegExp(pattern.source, flags))].length;
}

function countUniqueMatches(text: string, pattern: RegExp): number {
  return new Set([...text.matchAll(pattern)].map((match) => match[1])).size;
}

function countDebtStatus(text: string, status: string): number {
  const pattern = new RegExp(`\\|[^\\n]*\\b${escapeRegExp(status)}\\b[^\\n]*\\|`, 'gi');
  return countMatches(text, pattern);
}

function firstMeaningfulLine(text: string): string | null {
  for (const line of text.split('\n')) {
    const trimmed = line.trim().replace(/^#+\s*/, '');
    if (trimmed.length > 0 && !trimmed.startsWith('---') && !trimmed.includes(':')) return trimmed;
  }
  return null;
}

function findNextTask(text: string): string | null {
  const match = text.match(/\[ \]\s+((?:T|TE)\d+(?:\.\d+)?)/);
  return match ? match[1] : null;
}

function extractListItemsUnderHeading(text: string, heading: RegExp): string[] {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => heading.test(line));
  if (start < 0) return [];
  const items: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6}\s+/.test(line)) break;
    const match = line.match(/^\s*[-*]\s+(.+)/);
    if (match) items.push(match[1].trim());
  }
  return items;
}

function extractCodePaths(text: string): string[] {
  const paths = new Set<string>();
  for (const match of text.matchAll(/`([^`]+\.(?:ts|tsx|js|jsx|json|md|go|py|rs|java|cs|yaml|yml))`/g)) {
    paths.add(match[1]);
  }
  return [...paths].sort();
}

function findOldestOpenDebt(text: string): string | null {
  const line = text.split('\n').find((item) => /\|/g.test(item) && /open/i.test(item));
  return line?.trim() ?? null;
}

function hasDebtEvidence(text: string): boolean {
  return /\|[^|\n]*\b(open|in-progress|in progress|resolved|deferred)\b[^|\n]*\|/i.test(text)
    || /^\s*[-*]\s+.*\b(debt|tech debt)\b.*\b(open|in-progress|in progress|resolved|deferred|critical)\b/mi.test(text);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function confirmRepair(): Promise<boolean> {
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question('Repair Kyro JSON artifacts? [y/N] ');
    return answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes';
  } finally {
    rl.close();
  }
}
