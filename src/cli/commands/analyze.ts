import { runAnalysis } from "../core/analysis";
import { buildVerificationMatrix } from "../core/verification-matrix";
import type { MatrixLevel, VerificationMatrix } from "../core/verification-matrix";
import type { AnalysisFinding, AnalysisSeverity, CliOptions } from "../types";

const SEVERITY_ORDER: AnalysisSeverity[] = [
  "CRITICAL",
  "HIGH",
  "MEDIUM",
  "LOW",
];

export function analyze(options: Pick<CliOptions, "kyroScope" | "json" | "matrix">): void {
  if (options.matrix) {
    matrix(options);
    return;
  }
  const result = runAnalysis(options.kyroScope);
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printReport(result.scope, result.findings);
  }
  if (result.blocking) process.exitCode = 1;
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

const LEVEL_LABEL: Record<MatrixLevel, string> = {
  none: "none",
  linked: "linked",
  evidence: "evidence",
  verdict: "verdict recorded",
  unknown: "unknown",
};

/** Read-only display path: no gate, no exit 1 for coverage, no trace write. */
function matrix(options: Pick<CliOptions, "kyroScope" | "json">): void {
  const result = buildVerificationMatrix(options.kyroScope);
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  printMatrix(result);
}

function printMatrix(result: VerificationMatrix): void {
  if (result.message) {
    console.log(`[OK] ${result.message}`);
    return;
  }
  console.log(`Scenario verification matrix — ${result.scope} (${result.scenarios.length} scenario(s))\n`);
  for (const s of result.scenarios) {
    const tasks = s.tasks.map((t) => {
      const notes = [...(t.level !== s.level ? [LEVEL_LABEL[t.level]] : []), ...t.notes];
      return `${t.id} [sprint ${t.sprint}]${notes.length ? ` (${notes.join("; ")})` : ""}${t.sameDeclaredActor ? " ⚠ same declared actor" : ""}`;
    });
    const tail = [tasks.join(", "), ...s.notes].filter(Boolean).join(" — ");
    console.log(`${s.id} (${s.requirement}) — ${LEVEL_LABEL[s.level]}${tail ? ` — ${tail}` : ""}`);
  }
  for (const h of result.history.filter((item) => item.status === "unknown")) {
    console.log(`[unknown] sprint ${h.n} (${h.slug}, ${h.source}): ${h.reason ?? "unreadable"}`);
  }
  const counts = (Object.keys(LEVEL_LABEL) as MatrixLevel[]).map((level) => `${level}=${result.summary[level]}`).join("  ");
  console.log(`\nSummary: ${counts}`);
  console.log(result.note);
}
