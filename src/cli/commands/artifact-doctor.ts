import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename } from "node:path";
import { ARTIFACT_ROOT, KYRO_STATE_PATH } from "../constants";
import { resolveManagedPath } from "../fs";
import { readJsonSafely } from "../artifacts/json";
import {
  debtSummaryPath,
  eventsPath,
  phasesPath,
  roadmapPath,
  roadmapSummaryPath,
  rulesIndexPath,
  rulesPath,
  scopeIndexPath,
  scopeRoot,
  scopeStatePath,
} from "../artifacts/paths";
import { listScopeFolders, listScopeNames } from "../artifacts/scopes";
import {
  asProjectState,
  asScopeIndex,
  asScopeState,
  validateDebtSummary,
  validateProjectStateShape,
  validateExecutionEvent,
  validateRoadmapSummary,
  validateRuleIndex,
  validateScopeIndex,
  validateScopeState,
  validateSprintSummary,
  type KyroScopeIndex,
  type KyroScopeState,
  type ValidationIssue,
} from "../artifacts/schema";
import type { CheckResult } from "../types";

export interface ArtifactAuditOptions {
  kyroScope: string | null;
}

interface ScopeContext {
  scope: string;
  state: KyroScopeState | null;
  index: KyroScopeIndex | null;
}

export function runArtifactAuditChecks(
  options: ArtifactAuditOptions,
): CheckResult[] {
  const checks: CheckResult[] = [];
  const projectStateRead = readJsonSafely(KYRO_STATE_PATH);
  if (!projectStateRead.exists) {
    return [
      warn(
        "artifact state",
        `${KYRO_STATE_PATH} not found`,
        "Run kyro install --scope workspace, then create/open a Kyro scope.",
      ),
    ];
  }
  if (projectStateRead.error) {
    return [
      fail(
        "artifact state",
        `${KYRO_STATE_PATH}: ${projectStateRead.error}`,
        "Repair or recreate the project state JSON.",
      ),
    ];
  }
  const projectIssues = validateProjectStateShape(
    projectStateRead.value,
    KYRO_STATE_PATH,
  );
  if (projectIssues.length > 0) {
    checks.push(
      fail(
        "artifact state",
        formatIssues(projectIssues),
        "Fix kyro.json so it matches schemaVersion 1.",
      ),
    );
    return checks;
  }

  const projectState = asProjectState(projectStateRead.value);
  if (!projectState) return checks;

  checks.push(...checkRulesIndex());

  const scopeNames = resolveScopeNames(
    projectState.scopes,
    projectState.activeScope,
    options.kyroScope,
  );
  if (scopeNames.length === 0) {
    checks.push(
      warn(
        "artifact scopes",
        "no scopes found",
        "Run kyro-forge/INIT to create the first scope.",
      ),
    );
    return checks;
  }

  for (const scope of scopeNames) {
    checks.push(...checkScope(scope));
  }

  return checks;
}

export function inspectScope(scope: string): CheckResult[] {
  return checkScope(scope);
}

function checkRulesIndex(): CheckResult[] {
  const checks: CheckResult[] = [];
  const rules = rulesPath();
  const index = rulesIndexPath();
  const rulesAbsolute = resolveManagedPath(rules);
  const indexAbsolute = resolveManagedPath(index);
  if (!existsSync(rulesAbsolute)) return checks;

  const words = countWords(readFileSync(rulesAbsolute, "utf-8"));
  if (!existsSync(indexAbsolute)) {
    if (words > 200) {
      checks.push(
        warn(
          "artifact rules index",
          `${index} missing for ${words} rule words`,
          "Create rules.index.json so startup can avoid loading the full rules ledger.",
        ),
      );
    } else {
      checks.push(
        pass(
          "artifact rules index",
          `${index} optional for ${words} rule words`,
        ),
      );
    }
    return checks;
  }

  const value = readAndValidate(
    index,
    validateRuleIndex,
    "rules.index.json",
    checks,
    "Run kyro repair or regenerate the rules index from rules.md.",
  );
  if (value && isStale(rules, index)) {
    checks.push(
      warn(
        "artifact rules index",
        `${index} is older than rules.md`,
        "Refresh rules.index.json from rules.md.",
      ),
    );
  }
  return checks;
}

function checkExecutionEvents(scope: string): CheckResult[] {
  const checks: CheckResult[] = [];
  const path = eventsPath(scope);
  const absolute = resolveManagedPath(path);
  if (!existsSync(absolute)) return checks;
  const lines = readFileSync(absolute, "utf-8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  for (const [index, line] of lines.entries()) {
    try {
      const parsed: unknown = JSON.parse(line);
      const issues = validateExecutionEvent(parsed, `${path}:${index + 1}`);
      if (issues.length > 0) {
        checks.push(
          fail(
            `artifact events:${scope}`,
            formatIssues(issues),
            "Fix the invalid execution event line or rebuild from sprint Markdown.",
          ),
        );
        return checks;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      checks.push(
        fail(
          `artifact events:${scope}`,
          `${path}:${index + 1}: ${message}`,
          "Keep events.ndjson as one valid JSON object per line.",
        ),
      );
      return checks;
    }
  }
  checks.push(
    pass(
      `artifact events:${scope}`,
      `${path} has ${lines.length} valid events`,
    ),
  );
  return checks;
}

function countWords(text: string): number {
  return text.trim().length === 0 ? 0 : text.trim().split(/\s+/).length;
}

function checkScope(scope: string): CheckResult[] {
  const checks: CheckResult[] = [];
  const root = scopeRoot(scope);
  if (!existsSync(resolveManagedPath(root))) {
    return [
      fail(
        `artifact scope:${scope}`,
        `${root} not found`,
        "Create the scope with kyro-forge/INIT or choose an existing scope.",
      ),
    ];
  }

  const context = readScopeContext(scope, checks);
  checks.push(...checkRequiredMarkdown(scope));
  checks.push(...checkSummaries(scope, context));
  checks.push(...checkStateReferences(scope, context));
  checks.push(...checkIndexReferences(scope, context));
  checks.push(...checkExecutionEvents(scope));
  return checks;
}

function readScopeContext(scope: string, checks: CheckResult[]): ScopeContext {
  const state = readAndValidate(
    scopeStatePath(scope),
    validateScopeState,
    "state.json",
    checks,
    "Run kyro repair --kyro-scope <scope>.",
  );
  const index = readAndValidate(
    scopeIndexPath(scope),
    validateScopeIndex,
    "index.json",
    checks,
    "Run kyro repair --kyro-scope <scope>.",
  );
  return {
    scope,
    state: state ? asScopeState(state) : null,
    index: index ? asScopeIndex(index) : null,
  };
}

function readAndValidate(
  path: string,
  validate: (value: unknown, path: string) => ValidationIssue[],
  label: string,
  checks: CheckResult[],
  remedy: string,
): unknown | null {
  const result = readJsonSafely(path);
  if (!result.exists) {
    checks.push(warn(`artifact ${label}`, `${path} missing`, remedy));
    return null;
  }
  if (result.error) {
    checks.push(
      fail(
        `artifact ${label}`,
        `${path}: ${result.error}`,
        "Fix invalid JSON.",
      ),
    );
    return null;
  }
  const issues = validate(result.value, path);
  if (issues.length > 0) {
    checks.push(fail(`artifact ${label}`, formatIssues(issues), remedy));
    return null;
  }
  checks.push(pass(`artifact ${label}`, `${path} is valid`));
  return result.value;
}

function checkRequiredMarkdown(scope: string): CheckResult[] {
  const checks: CheckResult[] = [];
  if (!existsSync(resolveManagedPath(roadmapPath(scope)))) {
    checks.push(
      fail(
        `artifact scope:${scope}`,
        `${roadmapPath(scope)} missing`,
        "Run INIT or repair the scope from a valid roadmap source.",
      ),
    );
  } else {
    checks.push(
      pass(`artifact roadmap:${scope}`, `${roadmapPath(scope)} exists`),
    );
  }
  if (!existsSync(resolveManagedPath(phasesPath(scope)))) {
    checks.push(
      warn(
        `artifact phases:${scope}`,
        `${phasesPath(scope)} missing`,
        "Run kyro repair or create the phases directory before sprint planning.",
      ),
    );
  }
  return checks;
}

function checkSummaries(scope: string, context: ScopeContext): CheckResult[] {
  const checks: CheckResult[] = [];
  const roadmapSummary = readAndValidate(
    roadmapSummaryPath(scope),
    validateRoadmapSummary,
    "ROADMAP.summary.json",
    checks,
    "Run kyro repair --kyro-scope <scope>.",
  );
  if (
    roadmapSummary &&
    isStale(roadmapPath(scope), roadmapSummaryPath(scope))
  ) {
    checks.push(
      warn(
        `artifact roadmap summary:${scope}`,
        `${roadmapSummaryPath(scope)} is older than ROADMAP.md`,
        "Run kyro repair --kyro-scope <scope>.",
      ),
    );
  }

  const sprintMarkdownFiles = listSprintMarkdown(scope);
  const sprintSummaryFiles = listSprintSummaries(scope);
  if (sprintMarkdownFiles.length > 0 && sprintSummaryFiles.length === 0) {
    checks.push(
      warn(
        `artifact sprint summaries:${scope}`,
        "sprint markdown exists but no sprint summaries were found",
        "Run kyro repair --kyro-scope <scope>.",
      ),
    );
  }

  for (const summaryPath of sprintSummaryFiles) {
    const value = readAndValidate(
      summaryPath,
      validateSprintSummary,
      basename(summaryPath),
      checks,
      "Run kyro repair --kyro-scope <scope>.",
    );
    if (value && isRecord(value)) {
      const source =
        typeof value.sourceMarkdown === "string" ? value.sourceMarkdown : null;
      if (source && !existsSync(resolveManagedPath(source))) {
        checks.push(
          fail(
            `artifact sprint summary:${scope}`,
            `${summaryPath} sourceMarkdown does not exist: ${source}`,
            "Run kyro repair --kyro-scope <scope>.",
          ),
        );
      } else if (source && isStale(source, summaryPath)) {
        checks.push(
          warn(
            `artifact sprint summary:${scope}`,
            `${summaryPath} is older than ${source}`,
            "Run kyro repair --kyro-scope <scope>.",
          ),
        );
      }
    }
  }

  const hasDebt = sprintMarkdownFiles.some((file) =>
    hasDebtEvidence(readText(file)),
  );
  if (hasDebt || existsSync(resolveManagedPath(debtSummaryPath(scope)))) {
    readAndValidate(
      debtSummaryPath(scope),
      validateDebtSummary,
      "DEBT.summary.json",
      checks,
      "Run kyro repair --kyro-scope <scope>.",
    );
  }

  if (context.scope !== scope) {
    checks.push(
      fail(
        `artifact scope:${scope}`,
        `internal scope mismatch: ${context.scope}`,
        "Run kyro repair.",
      ),
    );
  }
  return checks;
}

function checkStateReferences(
  scope: string,
  context: ScopeContext,
): CheckResult[] {
  const checks: CheckResult[] = [];
  if (!context.state) return checks;
  if (context.state.scope !== scope) {
    checks.push(
      fail(
        `artifact state:${scope}`,
        `state.scope=${context.state.scope} but expected ${scope}`,
        "Run kyro repair --kyro-scope <scope>.",
      ),
    );
  }
  if (!existsSync(resolveManagedPath(context.state.roadmapPath))) {
    checks.push(
      fail(
        `artifact state:${scope}`,
        `roadmapPath missing: ${context.state.roadmapPath}`,
        "Run kyro repair --kyro-scope <scope>.",
      ),
    );
  }
  if (!existsSync(resolveManagedPath(context.state.sprintsPath))) {
    checks.push(
      fail(
        `artifact state:${scope}`,
        `sprintsPath missing: ${context.state.sprintsPath}`,
        "Run kyro repair --kyro-scope <scope>.",
      ),
    );
  }
  if (
    context.state.activeSprint &&
    !findSprintMarkdown(scope, context.state.activeSprint)
  ) {
    checks.push(
      fail(
        `artifact state:${scope}`,
        `activeSprint not found: ${context.state.activeSprint}`,
        "Run kyro repair --kyro-scope <scope> or set the correct active sprint.",
      ),
    );
  }
  return checks;
}

function checkIndexReferences(
  scope: string,
  context: ScopeContext,
): CheckResult[] {
  const checks: CheckResult[] = [];
  if (!context.index) return checks;
  const paths = context.index.relevantArtifactPaths;
  for (const [field, path] of Object.entries(paths)) {
    if (!existsSync(resolveManagedPath(path))) {
      const severity = field === "roadmapSummary" ? warn : fail;
      checks.push(
        severity(
          `artifact index:${scope}`,
          `relevantArtifactPaths.${field} missing: ${path}`,
          "Run kyro repair --kyro-scope <scope>.",
        ),
      );
    }
  }
  if (context.index.nextTask) {
    const activeSprint = context.state?.activeSprint
      ? findSprintMarkdown(scope, context.state.activeSprint)
      : latestSprintMarkdown(scope);
    if (
      activeSprint &&
      !readText(activeSprint).includes(context.index.nextTask)
    ) {
      checks.push(
        fail(
          `artifact index:${scope}`,
          `nextTask not found in active sprint: ${context.index.nextTask}`,
          "Run kyro repair --kyro-scope <scope> or correct the next task.",
        ),
      );
    }
  }
  return checks;
}

function resolveScopeNames(
  stateScopes: string[],
  activeScope: string | null,
  requestedScope: string | null,
): string[] {
  if (requestedScope) return [requestedScope];
  if (activeScope) return [activeScope];
  const names = new Set<string>(stateScopes);
  for (const scope of listScopeFolders()) names.add(scope);
  return [...names].sort();
}

function listSprintMarkdown(scope: string): string[] {
  return listPhaseFiles(scope).filter(
    (file) => /SPRINT-.*\.md$/.test(file) && !file.endsWith(".summary.md"),
  );
}

function listSprintSummaries(scope: string): string[] {
  return listPhaseFiles(scope).filter((file) =>
    /SPRINT-.*\.summary\.json$/.test(file),
  );
}

function listPhaseFiles(scope: string): string[] {
  const absolute = resolveManagedPath(phasesPath(scope));
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => `${phasesPath(scope)}/${entry.name}`)
    .sort();
}

function findSprintMarkdown(
  scope: string,
  activeSprint: string,
): string | null {
  if (
    activeSprint.endsWith(".md") &&
    existsSync(resolveManagedPath(activeSprint))
  )
    return activeSprint;
  return (
    listSprintMarkdown(scope).find((file) =>
      file.includes(activeSprint.replace(/\.md$/, "")),
    ) ?? null
  );
}

function latestSprintMarkdown(scope: string): string | null {
  const files = listSprintMarkdown(scope);
  return files.length > 0 ? files[files.length - 1] : null;
}

function isStale(sourcePath: string, summaryPath: string): boolean {
  const source = resolveManagedPath(sourcePath);
  const summary = resolveManagedPath(summaryPath);
  if (!existsSync(source) || !existsSync(summary)) return false;
  return statSync(source).mtimeMs > statSync(summary).mtimeMs + 1000;
}

function readText(path: string): string {
  const absolute = resolveManagedPath(path);
  return existsSync(absolute) ? readFileSync(absolute, "utf-8") : "";
}

function hasDebtEvidence(text: string): boolean {
  return (
    /\|[^|\n]*\b(open|in-progress|in progress|resolved|deferred)\b[^|\n]*\|/i.test(
      text,
    ) ||
    /^\s*[-*]\s+.*\b(debt|tech debt)\b.*\b(open|in-progress|in progress|resolved|deferred|critical)\b/im.test(
      text,
    )
  );
}

function formatIssues(issues: ValidationIssue[]): string {
  return issues
    .map((issue) => `${issue.path}:${issue.field} ${issue.message}`)
    .join("; ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function pass(name: string, detail: string): CheckResult {
  return { status: "pass", name, detail };
}

function warn(name: string, detail: string, remedy: string): CheckResult {
  return { status: "warn", name, detail, remedy };
}

function fail(name: string, detail: string, remedy: string): CheckResult {
  return { status: "fail", name, detail, remedy };
}
