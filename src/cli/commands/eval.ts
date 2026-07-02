import { discoverEvalCases, harnessError } from '../eval/discovery';
import { runEvalCase, runtimeVersion } from '../eval/runner';
import type { CliOptions } from '../types';
import type { EvalReport } from '../eval/types';

export function runEval(options: Pick<CliOptions, 'evalCases' | 'evalTags' | 'agents' | 'json' | 'evalList' | 'keepSandbox'>): void {
  const started = Date.now();
  let cases;
  try {
    cases = discoverEvalCases(options);
  } catch (error: unknown) {
    printHarnessError(error, options.json);
    process.exit(2);
  }

  if (options.evalList) {
    if (options.json) {
      console.log(JSON.stringify({ cases: cases.map((item) => ({ id: item.case.id, title: item.case.title, tags: item.case.tags, agents: item.case.agents })) }, null, 2));
    } else {
      for (const item of cases) console.log(`${item.case.id} — ${item.case.title}`);
    }
    return;
  }

  const results = cases.map((item) => runEvalCase(item, options.keepSandbox));
  const failed = results.filter((result) => result.status === 'fail').length;
  const report: EvalReport = {
    evalReportSchemaVersion: 1,
    runtimeVersion: runtimeVersion(),
    selected: results.length,
    passed: results.length - failed,
    failed,
    durationMs: Date.now() - started,
    cases: results,
  };

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printHumanReport(report);
  }
  if (failed > 0) process.exit(1);
}

function printHarnessError(error: unknown, json: boolean): void {
  const message = error instanceof Error ? error.message : String(error);
  if (json) {
    console.log(JSON.stringify({ evalReportSchemaVersion: 1, error: 'harness', message }, null, 2));
  } else {
    console.error(`ERROR: ${message}`);
  }
  void harnessError;
}

function printHumanReport(report: EvalReport): void {
  for (const result of report.cases) {
    const icon = result.status === 'pass' ? 'PASS' : 'FAIL';
    console.log(`[${icon}] ${result.id}: ${result.durationMs}ms`);
    for (const failure of result.failures) {
      console.log(`       ${failure.at}`);
      console.log(`       expected: ${formatValue(failure.expected)}`);
      console.log(`       actual:   ${formatValue(failure.actual)}`);
    }
    if (result.sandboxPath) console.log(`       sandbox: ${result.sandboxPath}`);
  }
  console.log(`\nEval summary: ${report.passed}/${report.selected} passed in ${report.durationMs}ms`);
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return value.length > 300 ? `${value.slice(0, 300)}…` : value;
  const serialized = JSON.stringify(value);
  return serialized.length > 300 ? `${serialized.slice(0, 300)}…` : serialized;
}
