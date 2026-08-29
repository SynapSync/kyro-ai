import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { PACKAGE_ROOT } from '../constants';
import { readPackageVersion } from '../help';
import { createEvalSandbox } from './sandbox';
import { deepEqualNormalized, normalizeSprintJson } from './normalize';
import type { DiscoveredEvalCase } from './discovery';
import type { EvalCaseResult, EvalFailure } from './types';

export function runEvalCase(item: DiscoveredEvalCase, keepSandbox: boolean): EvalCaseResult {
  const started = Date.now();
  const sandbox = createEvalSandbox(item, keepSandbox);
  const failures: EvalFailure[] = [];
  try {
    if (item.case.route) failures.push(...assertRoute(item, sandbox.root, sandbox.home));
    item.case.steps.forEach((step, index) => {
      failures.push(...runStep(step.run, step.env ?? {}, step.expect, sandbox.root, sandbox.home, index));
    });
    if (item.case.expectFinalState) failures.push(...assertFinalState(item, sandbox.root));
  } finally {
    sandbox.cleanup();
  }
  return {
    id: item.case.id,
    status: failures.length === 0 ? 'pass' : 'fail',
    durationMs: Date.now() - started,
    failures,
    ...(keepSandbox ? { sandboxPath: sandbox.root } : {}),
  };
}

export function runtimeVersion(): string {
  return readPackageVersion();
}

function assertRoute(item: DiscoveredEvalCase, cwd: string, home: string): EvalFailure[] {
  const route = item.case.route;
  if (!route) return [];
  const result = spawnCli(['context-pack', '--kyro-scope', item.case.scope, '--json'], cwd, home);
  if (result.status !== 0) return [{ at: 'route.context-pack.exitCode', expected: 0, actual: result.status }];
  const raw = JSON.parse(result.stdout) as { data?: unknown };
  const parsed = (isCliEnvelope(raw) ? raw.data : raw) as { nextAction?: string; routing?: { modes?: string[] }; budgetClass?: string; reasoningTier?: string };
  const failures: EvalFailure[] = [];
  compare(failures, 'route.nextAction', route.nextAction, parsed.nextAction);
  compare(failures, 'route.routing.modes', route.expectedModes, parsed.routing?.modes ?? []);
  compare(failures, 'route.budgetClass', route.expectedBudgetClass, parsed.budgetClass);
  compare(failures, 'route.reasoningTier', route.expectedReasoningTier, parsed.reasoningTier);
  return failures;
}

function runStep(run: string[], env: Record<string, string>, expect: { exitCode: number; stdoutIncludes?: string[]; stdoutExcludes?: string[]; stderrIncludes?: string[]; stderrExcludes?: string[] }, cwd: string, home: string, index: number): EvalFailure[] {
  const result = spawnCli(run, cwd, home, env);
  const failures: EvalFailure[] = [];
  compare(failures, `step[${index}].exitCode`, expect.exitCode, result.status);
  const comparableStdout = `${result.stdout}\n${normalizedJsonOutput(result.stdout)}`;
  for (const needle of expect.stdoutIncludes ?? []) if (!comparableStdout.includes(needle)) failures.push({ at: `step[${index}].stdoutIncludes`, expected: needle, actual: result.stdout });
  for (const needle of expect.stdoutExcludes ?? []) if (comparableStdout.includes(needle)) failures.push({ at: `step[${index}].stdoutExcludes`, expected: `not ${needle}`, actual: result.stdout });
  for (const needle of expect.stderrIncludes ?? []) if (!result.stderr.includes(needle)) failures.push({ at: `step[${index}].stderrIncludes`, expected: needle, actual: result.stderr });
  for (const needle of expect.stderrExcludes ?? []) if (result.stderr.includes(needle)) failures.push({ at: `step[${index}].stderrExcludes`, expected: `not ${needle}`, actual: result.stderr });
  return failures;
}

function assertFinalState(item: DiscoveredEvalCase, sandboxRoot: string): EvalFailure[] {
  const expectedPath = join(item.dir, 'expected/sprint.json');
  if (!existsSync(expectedPath)) return [{ at: 'finalState.expected/sprint.json', expected: 'exists', actual: 'missing' }];
  const actualPath = join(sandboxRoot, '.agents/kyro/scopes', item.case.scope, 'sprint.json');
  if (!existsSync(actualPath)) return [{ at: 'finalState.sprint.json', expected: 'exists', actual: 'missing' }];
  const expected = normalizeSprintJson(JSON.parse(readFileSync(expectedPath, 'utf-8')), sandboxRoot);
  const actual = normalizeSprintJson(JSON.parse(readFileSync(actualPath, 'utf-8')), sandboxRoot);
  if (!deepEqualNormalized(expected, actual)) return [{ at: 'finalState.sprint.json', expected, actual }];
  return [];
}

function spawnCli(args: string[], cwd: string, home: string, extraEnv: Record<string, string> = {}): { status: number; stdout: string; stderr: string } {
  const cli = join(PACKAGE_ROOT, 'dist/cli.js');
  if (!existsSync(cli)) throw new Error('dist/cli.js missing. Run npm run build first.');
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd,
    env: { ...process.env, HOME: home, ...extraEnv },
    encoding: 'utf-8',
  });
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function compare(failures: EvalFailure[], at: string, expected: unknown, actual: unknown): void {
  if (JSON.stringify(expected) !== JSON.stringify(actual)) failures.push({ at, expected, actual });
}

function isCliEnvelope(value: unknown): value is { schemaVersion: 1; ok: true; data: unknown } {
  return typeof value === 'object' && value !== null
    && (value as { schemaVersion?: unknown }).schemaVersion === 1
    && (value as { ok?: unknown }).ok === true
    && 'data' in value;
}

function normalizedJsonOutput(output: string): string {
  try { return JSON.stringify(JSON.parse(output), null, 2); }
  catch { return output; }
}
