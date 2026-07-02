import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { PACKAGE_ROOT } from '../constants';
import type { Agent, CliOptions } from '../types';
import { asEvalCase, validateEvalCase } from './case-schema';
import type { EvalCase } from './types';

export interface DiscoveredEvalCase {
  case: EvalCase;
  dir: string;
}

export function discoverEvalCases(options: Pick<CliOptions, 'evalCases' | 'evalTags' | 'agents'>): DiscoveredEvalCase[] {
  const root = join(PACKAGE_ROOT, 'fixtures/evals');
  if (!existsSync(root)) throw harnessError('fixtures/evals not found');

  const discovered: DiscoveredEvalCase[] = [];
  const ids = new Set<string>();
  for (const entry of readdirSync(root, { withFileTypes: true }).filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const dir = join(root, entry.name);
    const manifestPath = join(dir, 'case.json');
    if (!existsSync(manifestPath)) throw harnessError(`${dir} is missing case.json`);
    const raw = JSON.parse(readFileSync(manifestPath, 'utf-8')) as unknown;
    const issues = validateEvalCase(raw, manifestPath, basename(dir));
    if (issues.length > 0) throw harnessError(`Malformed eval case ${entry.name}:\n${issues.map((i) => `  - ${i.field}: ${i.message}`).join('\n')}`);
    const evalCase = asEvalCase(raw);
    const expectedDir = join(dir, 'expected');
    const expectedExists = existsSync(expectedDir) && statSync(expectedDir).isDirectory();
    if (evalCase.expectFinalState && !expectedExists) throw harnessError(`${evalCase.id}: expectFinalState is true but expected/ is missing`);
    if (!evalCase.expectFinalState && expectedExists) throw harnessError(`${evalCase.id}: expected/ exists but expectFinalState is false`);
    if (ids.has(evalCase.id)) throw harnessError(`Duplicate eval case id: ${evalCase.id}`);
    ids.add(evalCase.id);
    discovered.push({ case: evalCase, dir });
  }

  const selected = discovered.filter((item) => matchesFilters(item.case, options));
  if (selected.length === 0) throw harnessError('No eval cases selected');
  return selected;
}

function matchesFilters(evalCase: EvalCase, options: Pick<CliOptions, 'evalCases' | 'evalTags' | 'agents'>): boolean {
  if (options.evalCases.length > 0 && !options.evalCases.includes(evalCase.id)) return false;
  if (options.evalTags.length > 0 && !options.evalTags.some((tag) => evalCase.tags.includes(tag))) return false;
  if (options.agents.length > 0 && !options.agents.some((agent) => evalCase.agents.includes(agent as Agent) || evalCase.agents.includes('any'))) return false;
  return true;
}

export function harnessError(message: string): Error {
  const error = new Error(message);
  error.name = 'KyroEvalHarnessError';
  return error;
}
