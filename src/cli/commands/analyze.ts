import { runAnalysis } from "../core/analysis";
import type { AnalysisFinding, AnalysisSeverity, CliOptions } from "../types";

const SEVERITY_ORDER: AnalysisSeverity[] = [
  "CRITICAL",
  "HIGH",
  "MEDIUM",
  "LOW",
];

export function analyze(options: Pick<CliOptions, "kyroScope" | "json">): void {
  const result = runAnalysis(options.kyroScope);
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printReport(result.scope, result.findings);
  }
  if (result.blocking) process.exit(1);
}

function printReport(scope: string, findings: AnalysisFinding[]): void {
  if (findings.length === 0) {
    console.log(`[OK] ${scope}: no semantic issues found.`);
    return;
  }
  const counts = SEVERITY_ORDER.map(
    (s) => `${s}=${findings.filter((f) => f.severity === s).length}`,
  ).join("  ");
  console.log(
    `Analysis of ${scope} — ${findings.length} finding(s)  (${counts})\n`,
  );
  for (const f of findings) {
    console.log(`[${f.severity}] ${f.id} (${f.category}): ${f.detail}`);
    console.log(`        ${f.remedy}`);
  }
}
