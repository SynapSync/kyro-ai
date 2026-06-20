import { existsSync, readFileSync } from 'node:fs';
import { readJsonSafely } from '../artifacts/json';
import {
  eventsPath,
  roadmapSummaryPath,
  rulesIndexPath,
  scopeIndexPath,
  scopeRoot,
  scopeStatePath,
  sprintMarkdownPath,
  sprintSummaryPath,
} from '../artifacts/paths';
import { parseSprintTask } from '../artifacts/task-parser';
import {
  asScopeIndex,
  asScopeState,
  validateRoadmapSummary,
  validateRuleIndex,
  type KyroScopeIndex,
  type KyroScopeState,
  type RelevantArtifactPaths,
} from '../artifacts/schema';
import { resolveBudgetRouting } from '../budget-manifest';
import { resolveManagedPath } from '../fs';
import { readProjectState } from '../state';
import { listScopeNames } from '../artifacts/scopes';
import type { CliOptions, ContextPackMode, ContextPackOutput, ContextPackRuleSummary } from '../types';

const TASK_RULE_MODES = ['execute-task', 'review-task'] as const;

interface IndexedRule {
  id: string;
  category: string;
  summary: string;
  affectedModes: string[];
}

export function contextPack(options: Pick<CliOptions, 'kyroScope' | 'task' | 'json'>): void {
  const scope = resolveScope(options.kyroScope);
  if (!scope) {
    throw new Error('No Kyro scope selected. Use --kyro-scope <scope> or set activeScope in kyro.json.');
  }
  if (!scopeExists(scope)) {
    throw new Error(`Scope not found: ${scope}. Run kyro scope list to see available scopes.`);
  }

  const pack = buildContextPack(scope, options.task);
  if (options.json) {
    console.log(JSON.stringify(pack, null, 2));
    return;
  }
  printContextPackText(pack);
}

export function buildContextPack(scope: string, taskOption: string | null = null): ContextPackOutput {
  const warnings: string[] = [];
  const stateResult = readJsonSafely(scopeStatePath(scope));
  const indexResult = readJsonSafely(scopeIndexPath(scope));
  const roadmapSummaryResult = readJsonSafely(roadmapSummaryPath(scope));
  const rulesResult = readJsonSafely(rulesIndexPath());

  const state = readScopeState(stateResult, warnings);
  const index = readScopeIndex(indexResult, warnings);
  const roadmapSummary = readRoadmapSummary(roadmapSummaryResult, warnings);
  const packMode = resolvePackMode(taskOption, state, index, warnings);
  const rules = readRuleSummaries(rulesResult, warnings, packMode === 'task' ? [...TASK_RULE_MODES] : null);
  const taskContext = packMode === 'task'
    ? resolveTaskContext(scope, state, index, taskOption, warnings)
    : emptyTaskContext();

  const budgetRouting = resolveBudgetRouting(packMode, state?.nextAction ?? null);
  const packWithoutTokens: Omit<ContextPackOutput, 'estimatedTokens'> = {
    schemaVersion: 1,
    packMode,
    scope,
    status: state?.status ?? null,
    currentPhase: state?.currentPhase ?? null,
    nextAction: state?.nextAction ?? null,
    activeSprint: state?.activeSprint ?? null,
    roadmapSummary: index?.roadmapSummary ?? roadmapSummary?.summary ?? null,
    activeSprintSummary: index?.activeSprintSummary ?? null,
    nextTask: index?.nextTask ?? null,
    openDebtCount: index?.openDebtCount ?? null,
    relevantArtifactPaths: index?.relevantArtifactPaths ?? null,
    taskId: taskContext.taskId,
    taskDescription: taskContext.taskDescription,
    taskFiles: taskContext.taskFiles,
    taskVerification: taskContext.taskVerification,
    sourceMarkdown: taskContext.sourceMarkdown,
    sprintSummaryPath: taskContext.sprintSummaryPath,
    evidencePaths: taskContext.evidencePaths,
    rules,
    warnings,
    budgetClass: budgetRouting.budgetClass,
    reasoningTier: budgetRouting.reasoningTier as ContextPackOutput['reasoningTier'],
    maxContextTokens: budgetRouting.maxContextTokens,
    budgetGuidance: budgetRouting.budgetGuidance,
  };

  return {
    ...packWithoutTokens,
    estimatedTokens: estimatePackTokens(packWithoutTokens),
  };
}

interface TaskContext {
  taskId: string | null;
  taskDescription: string | null;
  taskFiles: string[];
  taskVerification: string | null;
  sourceMarkdown: string | null;
  sprintSummaryPath: string | null;
  evidencePaths: string[];
}

function emptyTaskContext(): TaskContext {
  return {
    taskId: null,
    taskDescription: null,
    taskFiles: [],
    taskVerification: null,
    sourceMarkdown: null,
    sprintSummaryPath: null,
    evidencePaths: [],
  };
}

function resolvePackMode(
  taskOption: string | null,
  state: KyroScopeState | null,
  index: KyroScopeIndex | null,
  warnings: string[],
): ContextPackMode {
  if (taskOption === null) return 'scope';
  if (taskOption === '') {
    if (!state?.activeSprint) {
      throw new Error('No active sprint found. Pass --task <id> explicitly or activate a sprint first.');
    }
    if (!index?.nextTask) {
      throw new Error('No next task found in index.json. Pass --task <id> explicitly.');
    }
    warnings.push(`task id defaulted to index.nextTask: ${index.nextTask}`);
    return 'task';
  }
  return 'task';
}

function resolveTaskContext(
  scope: string,
  state: KyroScopeState | null,
  index: KyroScopeIndex | null,
  taskOption: string | null,
  warnings: string[],
): TaskContext {
  const taskId = taskOption === '' ? index?.nextTask ?? null : taskOption;
  if (!taskId) {
    throw new Error('Task id is required for task packs. Use --task <id>.');
  }
  if (!state?.activeSprint) {
    warnings.push('active sprint missing; task details may be incomplete');
    return { ...emptyTaskContext(), taskId };
  }

  const sourceMarkdown = sprintMarkdownPath(scope, state.activeSprint);
  const summaryPath = sprintSummaryPath(scope, state.activeSprint);
  const evidencePaths = [eventsPath(scope), summaryPath].filter((path) => existsSync(resolveManagedPath(path)));
  const absoluteMarkdown = resolveManagedPath(sourceMarkdown);
  let taskDescription: string | null = null;
  let taskFiles: string[] = [];
  let taskVerification: string | null = null;

  if (!existsSync(absoluteMarkdown)) {
    warnings.push(`${sourceMarkdown} missing`);
  } else {
    const parsed = parseSprintTask(readFileSync(absoluteMarkdown, 'utf-8'), taskId);
    if (!parsed) {
      warnings.push(`task ${taskId} not found in ${sourceMarkdown}`);
    } else {
      taskDescription = parsed.description;
      taskFiles = parsed.files;
      taskVerification = parsed.verification;
    }
  }

  return {
    taskId,
    taskDescription,
    taskFiles,
    taskVerification,
    sourceMarkdown,
    sprintSummaryPath: existsSync(resolveManagedPath(summaryPath)) ? summaryPath : null,
    evidencePaths,
  };
}

function resolveScope(kyroScope: string | null): string | null {
  if (kyroScope) return kyroScope;
  return readProjectState()?.activeScope ?? null;
}

function scopeExists(scope: string): boolean {
  if (listScopeNames().includes(scope)) return true;
  return existsSync(resolveManagedPath(scopeRoot(scope)));
}

function readScopeState(result: ReturnType<typeof readJsonSafely>, warnings: string[]): KyroScopeState | null {
  if (!result.exists) {
    warnings.push('state.json missing');
    return null;
  }
  if (result.error) {
    warnings.push(`state.json invalid: ${result.error}`);
    return null;
  }
  const state = asScopeState(result.value);
  if (!state) {
    warnings.push('state.json does not match schemaVersion 1 shape');
    return null;
  }
  return state;
}

function readScopeIndex(result: ReturnType<typeof readJsonSafely>, warnings: string[]): KyroScopeIndex | null {
  if (!result.exists) {
    warnings.push('index.json missing');
    return null;
  }
  if (result.error) {
    warnings.push(`index.json invalid: ${result.error}`);
    return null;
  }
  const index = asScopeIndex(result.value);
  if (!index) {
    warnings.push('index.json does not match schemaVersion 1 shape');
    return null;
  }
  return index;
}

function readRoadmapSummary(result: ReturnType<typeof readJsonSafely>, warnings: string[]): { summary: string } | null {
  if (!result.exists) {
    warnings.push('ROADMAP.summary.json missing');
    return null;
  }
  if (result.error) {
    warnings.push(`ROADMAP.summary.json invalid: ${result.error}`);
    return null;
  }
  const issues = validateRoadmapSummary(result.value, roadmapSummaryPath(''));
  if (issues.length > 0) {
    warnings.push('ROADMAP.summary.json does not match schemaVersion 1 shape');
    return null;
  }
  const record = result.value as { summary?: string };
  return typeof record.summary === 'string' ? { summary: record.summary } : null;
}

function readRuleSummaries(
  result: ReturnType<typeof readJsonSafely>,
  warnings: string[],
  affectedModes: string[] | null,
): ContextPackRuleSummary[] {
  if (!result.exists) {
    warnings.push('rules.index.json missing');
    return [];
  }
  if (result.error) {
    warnings.push(`rules.index.json invalid: ${result.error}`);
    return [];
  }
  const issues = validateRuleIndex(result.value, rulesIndexPath());
  if (issues.length > 0) {
    warnings.push('rules.index.json does not match schemaVersion 1 shape');
    return [];
  }

  const record = result.value as { rules?: Array<{ id?: string; category?: string; summary?: string; affectedModes?: string[] }> };
  if (!Array.isArray(record.rules)) return [];

  const indexed = record.rules
    .filter((rule): rule is IndexedRule => (
      typeof rule.id === 'string'
      && typeof rule.category === 'string'
      && typeof rule.summary === 'string'
      && Array.isArray(rule.affectedModes)
      && rule.affectedModes.every((mode) => typeof mode === 'string')
    ));

  const selected = affectedModes
    ? indexed.filter((rule) => rule.affectedModes.some((mode) => affectedModes.includes(mode)))
    : indexed;

  return selected.map((rule) => ({ id: rule.id, category: rule.category, summary: rule.summary }));
}

function estimatePackTokens(pack: Omit<ContextPackOutput, 'estimatedTokens'>): number {
  const text = [
    pack.packMode,
    pack.scope,
    pack.status,
    pack.currentPhase,
    pack.nextAction,
    pack.activeSprint,
    pack.roadmapSummary,
    pack.activeSprintSummary,
    pack.nextTask,
    pack.taskId,
    pack.taskDescription,
    pack.taskFiles.join('\n'),
    pack.taskVerification,
    pack.sourceMarkdown,
    pack.sprintSummaryPath,
    pack.evidencePaths.join('\n'),
    pack.openDebtCount?.toString() ?? '',
    formatArtifactPaths(pack.relevantArtifactPaths),
    pack.rules.map((rule) => `${rule.id} ${rule.category} ${rule.summary}`).join('\n'),
    pack.warnings.join('\n'),
    pack.budgetClass,
    pack.reasoningTier,
    pack.budgetGuidance,
    pack.maxContextTokens.toString(),
  ].join('\n');
  return estimateTokens(countWords(text));
}

function countWords(text: string): number {
  return text.trim().length === 0 ? 0 : text.trim().split(/\s+/).length;
}

function estimateTokens(words: number): number {
  return Math.ceil(words * 1.33);
}

function formatArtifactPaths(paths: RelevantArtifactPaths | null): string {
  if (!paths) return '';
  return [paths.roadmap, paths.roadmapSummary, paths.sprints, paths.reentry].join('\n');
}

function printContextPackText(pack: ContextPackOutput): void {
  console.log(`Kyro Context Pack — ${pack.scope} (${pack.packMode})`);
  console.log('');

  if (pack.packMode === 'task') {
    console.log('Task');
    console.log(`  id: ${pack.taskId ?? 'unknown'}`);
    console.log(`  description: ${pack.taskDescription ?? 'none'}`);
    if (pack.taskFiles.length > 0) {
      console.log(`  files: ${pack.taskFiles.join(', ')}`);
    }
    console.log(`  verification: ${pack.taskVerification ?? 'none'}`);
    if (pack.sourceMarkdown) console.log(`  source: ${pack.sourceMarkdown}`);
    if (pack.sprintSummaryPath) console.log(`  sprint summary: ${pack.sprintSummaryPath}`);
    if (pack.evidencePaths.length > 0) {
      console.log('  evidence paths:');
      for (const path of pack.evidencePaths) console.log(`    - ${path}`);
    }
    console.log('');
    console.log('Scope Routing');
    console.log(`  status: ${pack.status ?? 'unknown'}`);
    console.log(`  phase: ${pack.currentPhase ?? 'unknown'}`);
    console.log(`  next action: ${pack.nextAction ?? 'unknown'}`);
    console.log(`  active sprint: ${pack.activeSprint ?? 'none'}`);
    console.log('');
  } else {
    console.log('Scope Status');
    console.log(`  status: ${pack.status ?? 'unknown'}`);
    console.log(`  phase: ${pack.currentPhase ?? 'unknown'}`);
    console.log(`  next action: ${pack.nextAction ?? 'unknown'}`);
    console.log(`  active sprint: ${pack.activeSprint ?? 'none'}`);
    console.log('');
    console.log('Routing Summary');
    console.log(`  roadmap: ${pack.roadmapSummary ?? 'none'}`);
    console.log(`  sprint: ${pack.activeSprintSummary ?? 'none'}`);
    console.log(`  next task: ${pack.nextTask ?? 'none'}`);
    console.log(`  open debt: ${pack.openDebtCount ?? 'unknown'}`);
    console.log('');
    if (pack.relevantArtifactPaths) {
      console.log('Artifact Paths');
      console.log(`  roadmap: ${pack.relevantArtifactPaths.roadmap}`);
      console.log(`  roadmap summary: ${pack.relevantArtifactPaths.roadmapSummary}`);
      console.log(`  sprints: ${pack.relevantArtifactPaths.sprints}`);
      console.log(`  re-entry: ${pack.relevantArtifactPaths.reentry}`);
      console.log('');
    }
  }

  if (pack.rules.length > 0) {
    console.log(`Rules (${pack.rules.length})`);
    for (const rule of pack.rules) {
      console.log(`  [${rule.id}] ${rule.summary}`);
    }
    console.log('');
  }
  if (pack.warnings.length > 0) {
    console.log('Warnings');
    for (const warning of pack.warnings) {
      console.log(`  - ${warning}`);
    }
    console.log('');
  }
  console.log('Budget Class');
  console.log(`  class: ${pack.budgetClass}`);
  console.log(`  reasoning tier: ${pack.reasoningTier}`);
  console.log(`  max context tokens: ${pack.maxContextTokens}`);
  console.log(`  guidance: ${pack.budgetGuidance}`);
  console.log('');
  console.log(`Estimated tokens: ~${pack.estimatedTokens}`);
}