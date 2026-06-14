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
  startupTokens: 1500,
  statusBriefTokens: 2000,
} as const;

interface WeightedFile {
  path: string;
  words: number;
  estimatedTokens: number;
}

export function runTokenAuditChecks(): CheckResult[] {
  const checks: CheckResult[] = [];
  checks.push(...checkCommandRouters());
  checks.push(...checkModeFiles());
  checks.push(checkProjectedSkills());
  checks.push(checkAgentsBlockBudget());
  checks.push(checkStartupBudget());
  checks.push(checkStatusBriefBudget());
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
  const total = files.map(weightPackageFile).reduce((sum, file) => sum + file.estimatedTokens, 0);
  if (total > TOKEN_BUDGET.startupTokens) {
    return warn('token budget: startup path', `${total}/${TOKEN_BUDGET.startupTokens} estimated tokens`, 'Reduce forge router or sprint router startup instructions.');
  }
  return pass('token budget: startup path', `${total}/${TOKEN_BUDGET.startupTokens} estimated tokens`);
}

function checkStatusBriefBudget(): CheckResult {
  const files = ['commands/status.md'];
  const total = files.map(weightPackageFile).reduce((sum, file) => sum + file.estimatedTokens, 0);
  if (total > TOKEN_BUDGET.statusBriefTokens) {
    return warn('token budget: status brief path', `${total}/${TOKEN_BUDGET.statusBriefTokens} estimated tokens`, 'Keep status brief summary-first.');
  }
  return pass('token budget: status brief path', `${total}/${TOKEN_BUDGET.statusBriefTokens} estimated tokens`);
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

function formatWeightedList(files: WeightedFile[]): string {
  return files.map((file) => `${file.path}=${file.words}w/~${file.estimatedTokens}t`).join(', ');
}

function pass(name: string, detail: string): CheckResult {
  return { status: 'pass', name, detail };
}

function warn(name: string, detail: string, remedy: string): CheckResult {
  return { status: 'warn', name, detail, remedy };
}
