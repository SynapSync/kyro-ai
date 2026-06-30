import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { AGENT_SKILLS_ROOT, PACKAGE_ROOT } from '../constants';
import { resolveManagedPath } from '../fs';
import type { CheckResult } from '../types';

const TOKEN_BUDGET = {
  agentsBlockWords: 150,
  projectedSkillWords: 200,
  commandRouterWords: 500,
  modeFileWords: 900,
  initModeWords: 500,
  analysisHelperWords: 450,
  roadmapTemplateWords: 450,
  reentryTemplateWords: 350,
  startupTokens: 1500,
  statusBriefTokens: 2000,
  initHappyPathTokens: 2000,
  orchestratorWords: 800,
  sprintForgeSkillWords: 800,
  runtimeStatusBriefTokens: 1500,
  runtimeForgeExecuteTokens: 2500,
  runtimeForgePlanTokens: 3000,
  runtimeForgeCloseTokens: 3200,
  runtimeForgeInitTokens: 3500,
} as const;

const RISK_LEVEL = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
} as const;

type RiskLevel = (typeof RISK_LEVEL)[keyof typeof RISK_LEVEL];

interface WeightedFile {
  path: string;
  words: number;
  estimatedTokens: number;
}

interface RuntimePathDefinition {
  name: string;
  budget: number;
  files: string[];
  projectedSkill?: 'forge' | 'status' | 'wrap-up';
  forbiddenFiles?: string[];
}

interface SizingDecisionFixture {
  recommendedSprintCount: number;
  riskLevel: RiskLevel;
  rationale: string;
  splitTriggers: string[];
  whyNotFewer: string;
  whyNotMore: string;
  sprintProofs: string[];
}

export function runTokenAuditChecks(): CheckResult[] {
  const checks: CheckResult[] = [];
  checks.push(...checkCommandRouters());
  checks.push(checkRuntimeAssetBudget('agents/orchestrator.md', TOKEN_BUDGET.orchestratorWords, 'orchestrator agent'));
  checks.push(checkRuntimeAssetBudget('skills/sprint-forge/SKILL.md', TOKEN_BUDGET.sprintForgeSkillWords, 'sprint-forge skill'));
  checks.push(...checkModeFiles());
  checks.push(checkInitModeBudget());
  checks.push(...checkAnalysisHelperBudgets());
  // v4 has no ROADMAP.md / REENTRY-PROMPTS.md templates; sprint.json is the single source of truth.
  checks.push(checkProjectedSkills());
  checks.push(checkAgentsBlockBudget());
  checks.push(checkStartupBudget());
  checks.push(checkStatusBriefBudget());
  checks.push(checkInitHappyPathBudget());
  checks.push(...checkRuntimePathBudgets());
  checks.push(...checkForbiddenRuntimeLoading());
  checks.push(checkSizingDecisionFixture());
  checks.push(reportHeaviestFiles());
  return checks;
}

function checkCommandRouters(): CheckResult[] {
  return ['commands/forge.md', 'commands/status.md', 'commands/wrap-up.md'].map((file) => {
    const weighted = weightPackageFile(file);
    if (weighted.words > TOKEN_BUDGET.commandRouterWords) {
      return warn('token budget: command router', `${file} has ${weighted.words} words`, 'Keep command files as routers; move details into mode/helper files.');
    }
    return pass('token budget: command router', `${file} ${weighted.words}/${TOKEN_BUDGET.commandRouterWords} words`);
  });
}

function checkModeFiles(): CheckResult[] {
  return listPackageFiles('skills/sprint-forge/assets/modes', '.md').map((file) => {
    const weighted = weightPackageFile(file);
    if (weighted.words > TOKEN_BUDGET.modeFileWords) {
      return warn('token budget: mode file', `${file} has ${weighted.words} words`, 'Split this mode or move detail into a lazy-loaded helper.');
    }
    return pass('token budget: mode file', `${file} ${weighted.words}/${TOKEN_BUDGET.modeFileWords} words`);
  });
}

function checkInitModeBudget(): CheckResult {
  const file = 'skills/sprint-forge/assets/modes/INIT.md';
  const weighted = weightPackageFile(file);
  if (weighted.words > TOKEN_BUDGET.initModeWords) {
    return warn('token budget: INIT mode', `${file} has ${weighted.words} words`, 'Keep INIT as a router; move work-type guidance into analysis helpers.');
  }
  return pass('token budget: INIT mode', `${weighted.words}/${TOKEN_BUDGET.initModeWords} words`);
}

function checkAnalysisHelperBudgets(): CheckResult[] {
  return listPackageFiles('skills/sprint-forge/assets/helpers/analysis', '.md').map((file) => {
    const weighted = weightPackageFile(file);
    if (weighted.words > TOKEN_BUDGET.analysisHelperWords) {
      return warn('token budget: analysis helper', `${file} has ${weighted.words} words`, 'Keep each work-type helper focused on routing, findings, and sizing signals.');
    }
    return pass('token budget: analysis helper', `${file} ${weighted.words}/${TOKEN_BUDGET.analysisHelperWords} words`);
  });
}

function checkTemplateBudget(file: string, budget: number, label: string): CheckResult {
  const weighted = weightPackageFile(file);
  if (weighted.words > budget) {
    return warn(`token budget: ${label}`, `${file} has ${weighted.words} words`, 'Keep templates lean; avoid copying lifecycle rules already defined in modes/helpers.');
  }
  return pass(`token budget: ${label}`, `${weighted.words}/${budget} words`);
}

function checkRuntimeAssetBudget(file: string, budget: number, label: string): CheckResult {
  const weighted = weightPackageFile(file);
  if (weighted.words > budget) {
    return fail(`token budget: ${label}`, `${file} has ${weighted.words}/${budget} words`, 'Keep eager runtime assets slim; move detail into lazy-loaded protocols or docs.');
  }
  return pass(`token budget: ${label}`, `${weighted.words}/${budget} words`);
}

function checkProjectedSkills(): CheckResult {
  const skillFiles = ['kyro-forge/SKILL.md', 'kyro-status/SKILL.md', 'kyro-wrap-up/SKILL.md'].map((file) => `${AGENT_SKILLS_ROOT}/${file}`);
  const existing = skillFiles.filter((file) => existsSync(resolveManagedPath(file)));
  if (existing.length === 0) {
    return warn('token budget: projected skills', 'global Kyro skills are not installed', 'Run kyro install, then kyro doctor --tokens again.');
  }
  const oversized = existing.map(weightManagedFile).filter((file) => file.words > TOKEN_BUDGET.projectedSkillWords);
  if (oversized.length > 0) {
    return warn('token budget: projected skills', formatWeightedList(oversized), 'Projected skills must stay as tiny stubs.');
  }
  return pass('token budget: projected skills', `${existing.length} skills within ${TOKEN_BUDGET.projectedSkillWords} words`);
}

function checkAgentsBlockBudget(): CheckResult {
  const agentsPath = resolveManagedPath('AGENTS.md');
  if (!existsSync(agentsPath)) {
    return warn('token budget: AGENTS block', 'AGENTS.md not found in this workspace', 'Install the codex adapter if this workspace should expose AGENTS.md instructions.');
  }
  const text = readFileSync(agentsPath, 'utf-8');
  const match = text.match(/<!-- kyro-ai:agents-md:start -->([\s\S]*?)<!-- kyro-ai:agents-md:end -->/m);
  if (!match) {
    return warn('token budget: AGENTS block', 'Kyro managed block not found', 'Run kyro install --agent codex or kyro sync --agent codex.');
  }
  const words = countWords(match[1]);
  if (words > TOKEN_BUDGET.agentsBlockWords) {
    return warn('token budget: AGENTS block', `${words}/${TOKEN_BUDGET.agentsBlockWords} words`, 'Keep AGENTS.md as bootstrap only.');
  }
  return pass('token budget: AGENTS block', `${words}/${TOKEN_BUDGET.agentsBlockWords} words`);
}

function checkStartupBudget(): CheckResult {
  const files = ['commands/forge.md', 'skills/sprint-forge/assets/modes/SPRINT.md'];
  const total = sumEstimatedTokens(files.map(weightPackageFile));
  if (total > TOKEN_BUDGET.startupTokens) {
    return warn('token budget: startup path', `${total}/${TOKEN_BUDGET.startupTokens} estimated tokens`, 'Reduce forge router or sprint router startup instructions.');
  }
  return pass('token budget: startup path', `${total}/${TOKEN_BUDGET.startupTokens} estimated tokens`);
}

function checkStatusBriefBudget(): CheckResult {
  const files = ['commands/status.md'];
  const total = sumEstimatedTokens(files.map(weightPackageFile));
  if (total > TOKEN_BUDGET.statusBriefTokens) {
    return warn('token budget: status brief path', `${total}/${TOKEN_BUDGET.statusBriefTokens} estimated tokens`, 'Keep status brief summary-first.');
  }
  return pass('token budget: status brief path', `${total}/${TOKEN_BUDGET.statusBriefTokens} estimated tokens`);
}

function checkInitHappyPathBudget(): CheckResult {
  // v4: INIT loads only the INIT mode + one routed analysis helper. No v3 templates.
  const baseFiles = [
    'commands/forge.md',
    'skills/sprint-forge/assets/modes/INIT.md',
  ].map(weightPackageFile);
  const heaviestHelper = listPackageFiles('skills/sprint-forge/assets/helpers/analysis', '.md').map(weightPackageFile).sort((a, b) => b.estimatedTokens - a.estimatedTokens)[0];
  const files = heaviestHelper ? [...baseFiles, heaviestHelper] : baseFiles;
  const total = sumEstimatedTokens(files);
  if (total > TOKEN_BUDGET.initHappyPathTokens) {
    return warn('token budget: INIT happy path', `${total}/${TOKEN_BUDGET.initHappyPathTokens} estimated tokens`, 'Reduce INIT, routed analysis helper, or scoped templates.');
  }
  return pass('token budget: INIT happy path', `${total}/${TOKEN_BUDGET.initHappyPathTokens} estimated tokens`);
}


function checkRuntimePathBudgets(): CheckResult[] {
  return runtimePathDefinitions().map((definition) => {
    const weightedFiles = definition.files.map(weightPackageFile);
    if (definition.projectedSkill) weightedFiles.unshift(weightProjectedCommandSkill(definition.projectedSkill));
    const total = sumEstimatedTokens(weightedFiles);
    const detail = `${total}/${definition.budget} estimated tokens (${formatWeightedList(weightedFiles)})`;
    if (total > definition.budget) {
      return fail(`token budget: ${definition.name}`, detail, 'Reduce eager runtime files or route helpers later.');
    }
    return pass(`token budget: ${definition.name}`, detail);
  });
}

function checkForbiddenRuntimeLoading(): CheckResult[] {
  const checks: CheckResult[] = [];
  for (const definition of runtimePathDefinitions()) {
    const loaded = new Set(definition.files);
    const forbiddenLoaded = (definition.forbiddenFiles ?? []).filter((file) => loaded.has(file));
    if (forbiddenLoaded.length > 0) {
      checks.push(fail(`runtime loading: ${definition.name}`, `loads forbidden helpers: ${forbiddenLoaded.join(', ')}`, 'Route to exactly one mode and only its named helpers.'));
    } else {
      checks.push(pass(`runtime loading: ${definition.name}`, 'no forbidden helpers loaded'));
    }
  }

  const orchestrator = readFileSync(resolve(PACKAGE_ROOT, 'agents/orchestrator.md'), 'utf-8');
  const eagerSprintHelperPattern = /SPRINT phase[^\n]*(sprint-generator|debt-tracker|learner)/i;
  if (eagerSprintHelperPattern.test(orchestrator)) {
    checks.push(fail('runtime loading: orchestrator sprint route', 'SPRINT phase eagerly references heavy helpers', 'Keep SPRINT routing to SPRINT.md plus exactly one routed mode.'));
  } else {
    checks.push(pass('runtime loading: orchestrator sprint route', 'SPRINT route is mode-only'));
  }

  const kyroRuntimeFiles = listPackageFiles('skills/sprint-forge', '.md');
  if (kyroRuntimeFiles.some((file) => /ad3c-cycle\.md$/i.test(file))) {
    checks.push(fail('runtime loading: AD3C workflow', 'sprint-forge still packages ad3c-cycle.md', 'Remove AD3C from Kyro runtime while preserving standalone skills.'));
  } else {
    checks.push(pass('runtime loading: AD3C workflow', 'AD3C absent from Kyro runtime paths'));
  }
  return checks;
}

function runtimePathDefinitions(): RuntimePathDefinition[] {
  const commonForge = ['commands/forge.md', 'agents/orchestrator.md', 'skills/sprint-forge/SKILL.md'];
  const commonSprintForbidden = [
    'skills/sprint-forge/assets/helpers/sprint-generator.md',
    'skills/sprint-forge/assets/helpers/debt-tracker.md',
    'skills/sprint-forge/assets/helpers/learner.md',
  ];
  return [
    {
      name: 'runtime path: kyro-forge:init',
      budget: TOKEN_BUDGET.runtimeForgeInitTokens,
      projectedSkill: 'forge',
      files: [...commonForge, 'skills/sprint-forge/assets/modes/INIT.md', heaviestAnalysisHelperPath()].filter(isString),
      forbiddenFiles: ['skills/sprint-forge/assets/helpers/sprint-generator.md', 'skills/sprint-forge/assets/helpers/debt-tracker.md'],
    },
    {
      name: 'runtime path: kyro-forge:plan',
      budget: TOKEN_BUDGET.runtimeForgePlanTokens,
      projectedSkill: 'forge',
      files: [...commonForge, 'skills/sprint-forge/assets/modes/SPRINT.md', 'skills/sprint-forge/assets/modes/plan-sprint.md', 'skills/sprint-forge/assets/helpers/sprint-generator.md'],
      forbiddenFiles: ['skills/sprint-forge/assets/helpers/learner.md', 'skills/sprint-forge/assets/helpers/reviewer.md'],
    },
    {
      name: 'runtime path: kyro-forge:execute',
      budget: TOKEN_BUDGET.runtimeForgeExecuteTokens,
      projectedSkill: 'forge',
      files: [...commonForge, 'skills/sprint-forge/assets/modes/SPRINT.md', 'skills/sprint-forge/assets/modes/execute-task.md'],
      forbiddenFiles: commonSprintForbidden,
    },
    {
      name: 'runtime path: kyro-forge:review',
      budget: TOKEN_BUDGET.runtimeForgeExecuteTokens,
      projectedSkill: 'forge',
      files: [...commonForge, 'skills/sprint-forge/assets/modes/SPRINT.md', 'skills/sprint-forge/assets/modes/review-task.md', 'skills/sprint-forge/assets/helpers/reviewer.md'],
      forbiddenFiles: ['skills/sprint-forge/assets/helpers/sprint-generator.md', 'skills/sprint-forge/assets/helpers/learner.md'],
    },
    {
      name: 'runtime path: kyro-forge:close',
      budget: TOKEN_BUDGET.runtimeForgeCloseTokens,
      projectedSkill: 'forge',
      files: [...commonForge, 'skills/sprint-forge/assets/modes/SPRINT.md', 'skills/sprint-forge/assets/modes/close-sprint.md', 'skills/sprint-forge/assets/helpers/debt-tracker.md', 'skills/sprint-forge/assets/helpers/learner.md'],
      forbiddenFiles: ['skills/sprint-forge/assets/helpers/sprint-generator.md'],
    },
    {
      name: 'runtime path: kyro-status:brief',
      budget: TOKEN_BUDGET.runtimeStatusBriefTokens,
      projectedSkill: 'status',
      files: ['commands/status.md', 'agents/orchestrator.md'],
      forbiddenFiles: ['skills/sprint-forge/assets/modes/SPRINT.md', 'skills/sprint-forge/assets/helpers/sprint-generator.md'],
    },
    {
      name: 'runtime path: kyro-wrap-up',
      budget: TOKEN_BUDGET.runtimeForgeCloseTokens,
      projectedSkill: 'wrap-up',
      files: ['commands/wrap-up.md', 'agents/orchestrator.md', 'skills/sprint-forge/SKILL.md', 'skills/sprint-forge/assets/helpers/handoff.md'],
      forbiddenFiles: ['skills/sprint-forge/assets/helpers/sprint-generator.md'],
    },
  ];
}

function heaviestAnalysisHelperPath(): string | null {
  const helper = listPackageFiles('skills/sprint-forge/assets/helpers/analysis', '.md').map(weightPackageFile).sort((a, b) => b.estimatedTokens - a.estimatedTokens)[0];
  return helper?.path ?? null;
}

function weightProjectedCommandSkill(command: 'forge' | 'status' | 'wrap-up'): WeightedFile {
  const managedPath = `${AGENT_SKILLS_ROOT}/kyro-${command}/SKILL.md`;
  if (existsSync(resolveManagedPath(managedPath))) return weightManagedFile(managedPath);
  const title = command === 'wrap-up' ? 'Kyro Wrap-Up' : `Kyro ${command}`;
  const text = `---\nname: kyro-${command}\ndescription: Kyro command stub\n---\n# ${title}\nRead the Kyro command router, then load only the files requested by that router. Do not ask the user to restate the workflow.`;
  return buildWeightedFile(`projected:${command}`, text);
}

function isString(value: string | null): value is string {
  return typeof value === 'string';
}

function checkSizingDecisionFixture(): CheckResult {
  const file = 'skills/sprint-forge/assets/fixtures/subcommands-and-reports.sizingDecision.json';
  const absolutePath = resolve(PACKAGE_ROOT, file);
  if (!existsSync(absolutePath)) {
    return fail('sizingDecision fixture', `${file} missing`, 'Add the subcommands-and-reports regression fixture.');
  }

  try {
    const parsed: unknown = JSON.parse(readFileSync(absolutePath, 'utf-8'));
    if (!isSizingDecisionFixture(parsed)) {
      return fail('sizingDecision fixture', `${file} has invalid shape`, 'Keep recommendedSprintCount, splitTriggers, whyNotFewer, whyNotMore, and sprintProofs consistent.');
    }
    const consistencyError = validateSizingDecision(parsed);
    if (consistencyError) {
      return fail('sizingDecision fixture', consistencyError, 'Fix the fixture so sprint boundaries are explicit and justified.');
    }
    return pass('sizingDecision fixture', `subcommands-and-reports validates ${parsed.recommendedSprintCount} justified sprints`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown parse error';
    return fail('sizingDecision fixture', `${file}: ${message}`, 'Keep the fixture as valid JSON.');
  }
}

function validateSizingDecision(decision: SizingDecisionFixture): string | null {
  if (decision.recommendedSprintCount !== decision.sprintProofs.length) {
    return `recommendedSprintCount=${decision.recommendedSprintCount} but sprintProofs.length=${decision.sprintProofs.length}`;
  }
  if (decision.recommendedSprintCount > 1 && decision.splitTriggers.length === 0) {
    return 'multi-sprint sizing requires non-empty splitTriggers';
  }
  if (decision.whyNotFewer.trim().length === 0) {
    return 'whyNotFewer must be non-empty';
  }
  if (decision.whyNotMore.trim().length === 0) {
    return 'whyNotMore must be non-empty';
  }
  if (decision.sprintProofs.some((proof) => proof.trim().length === 0)) {
    return 'every planned sprint needs a non-empty proof';
  }
  return null;
}

function isSizingDecisionFixture(value: unknown): value is SizingDecisionFixture {
  if (!isRecord(value)) return false;
  return (
    typeof value.recommendedSprintCount === 'number' &&
    isRiskLevel(value.riskLevel) &&
    typeof value.rationale === 'string' &&
    isStringArray(value.splitTriggers) &&
    typeof value.whyNotFewer === 'string' &&
    typeof value.whyNotMore === 'string' &&
    isStringArray(value.sprintProofs)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isRiskLevel(value: unknown): value is RiskLevel {
  return value === RISK_LEVEL.LOW || value === RISK_LEVEL.MEDIUM || value === RISK_LEVEL.HIGH;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function reportHeaviestFiles(): CheckResult {
  const files = [
    ...listPackageFiles('commands', '.md'),
    ...listPackageFiles('agents', '.md'),
    ...listPackageFiles('skills/sprint-forge', '.md'),
  ].map(weightPackageFile).sort((a, b) => b.words - a.words).slice(0, 8);
  return pass('token audit: heaviest files', formatWeightedList(files));
}

function listPackageFiles(directory: string, extension: string): string[] {
  const root = resolve(PACKAGE_ROOT, directory);
  if (!existsSync(root)) return [];
  const files: string[] = [];
  walk(root, files, extension);
  return files.map((file) => relative(PACKAGE_ROOT, file)).sort();
}

function walk(current: string, files: string[], extension: string): void {
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const full = join(current, entry.name);
    if (entry.isDirectory()) walk(full, files, extension);
    if (entry.isFile() && entry.name.endsWith(extension)) files.push(full);
  }
}

function weightPackageFile(file: string): WeightedFile {
  const text = readFileSync(resolve(PACKAGE_ROOT, file), 'utf-8');
  return buildWeightedFile(file, text);
}

function weightManagedFile(file: string): WeightedFile {
  const text = readFileSync(resolveManagedPath(file), 'utf-8');
  return buildWeightedFile(file, text);
}

function buildWeightedFile(path: string, text: string): WeightedFile {
  const words = countWords(text);
  return { path, words, estimatedTokens: estimateTokens(words) };
}

function countWords(text: string): number {
  return text.trim().length === 0 ? 0 : text.trim().split(/\s+/).length;
}

function estimateTokens(words: number): number {
  return Math.ceil(words * 1.33);
}

function sumEstimatedTokens(files: WeightedFile[]): number {
  return files.reduce((sum, file) => sum + file.estimatedTokens, 0);
}

function formatWeightedList(files: WeightedFile[]): string {
  return files.map((file) => `${file.path}=${file.words}w/~${file.estimatedTokens}t`).join(', ');
}

function pass(name: string, detail: string): CheckResult {
  return { status: 'pass', name, detail };
}

function warn(name: string, detail: string, remedy: string): CheckResult {
  return { status: 'warn', name, detail, remedy };
}

function fail(name: string, detail: string, remedy: string): CheckResult {
  return { status: 'fail', name, detail, remedy };
}
