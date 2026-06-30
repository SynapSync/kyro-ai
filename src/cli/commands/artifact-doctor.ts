import { existsSync } from 'node:fs';
import { KYRO_STATE_PATH } from '../constants';
import { resolveManagedPath } from '../fs';
import { readJsonSafely } from '../artifacts/json';
import { scopeRoot, sprintJsonPath } from '../artifacts/paths';
import { listScopeFolders } from '../artifacts/scopes';
import {
  asProjectState,
  validateProjectStateShape,
  validateSprintFile,
  type ValidationIssue,
} from '../artifacts/schema';
import type { CheckResult, KyroScopeEntry } from '../types';

export interface ArtifactAuditOptions {
  kyroScope: string | null;
}

/** v3 artifacts that must not exist in a v4 scope. Their presence means the scope needs migration. */
const V3_ARTIFACTS = [
  'state.json',
  'index.json',
  'events.ndjson',
  'ROADMAP.md',
  'ROADMAP.summary.json',
  'DEBT.summary.json',
  'rules.index.json',
  'RE-ENTRY-PROMPTS.md',
  'REENTRY-PROMPTS.md',
  'phases',
];

export function runArtifactAuditChecks(options: ArtifactAuditOptions): CheckResult[] {
  const checks: CheckResult[] = [];
  const projectStateRead = readJsonSafely(KYRO_STATE_PATH);
  if (!projectStateRead.exists) {
    return [warn('project state', `${KYRO_STATE_PATH} not found`, 'Run kyro install --scope workspace, then create/open a Kyro scope.')];
  }
  if (projectStateRead.error) {
    return [fail('project state', `${KYRO_STATE_PATH}: ${projectStateRead.error}`, 'Repair or recreate kyro.json.')];
  }
  const projectIssues = validateProjectStateShape(projectStateRead.value, KYRO_STATE_PATH);
  if (projectIssues.length > 0) {
    checks.push(fail('kyro.json', formatIssues(projectIssues), 'Fix kyro.json so scopes[] are objects { id, title, status } and schemaVersion is 4. Run kyro migrate for a v3 file.'));
    return checks;
  }
  checks.push(pass('kyro.json', 'Valid v4 schema.'));

  const projectState = asProjectState(projectStateRead.value);
  if (!projectState) return checks;

  const scopeNames = resolveScopeNames(projectState.scopes, projectState.activeScope, options.kyroScope);
  if (scopeNames.length === 0) {
    checks.push(warn('artifact scopes', 'no scopes found', 'Run /kyro:forge (INIT) to create the first scope.'));
    return checks;
  }

  for (const scope of scopeNames) checks.push(...checkScope(scope));
  return checks;
}

export function inspectScope(scope: string): CheckResult[] {
  return checkScope(scope);
}

function checkScope(scope: string): CheckResult[] {
  const checks: CheckResult[] = [];
  const root = scopeRoot(scope);
  if (!existsSync(resolveManagedPath(root))) {
    return [fail(`${scope}`, `${root} not found`, 'Create the scope with /kyro:forge (INIT) or choose an existing scope.')];
  }

  // 1. v3 drift: any legacy artifact present means this scope was never migrated.
  const v3Found = V3_ARTIFACTS.filter((name) => existsSync(resolveManagedPath(`${root}/${name}`)));
  if (v3Found.length > 0) {
    checks.push(fail(`${scope}/v3-artifacts`, `legacy v3 artifacts present: ${v3Found.join(', ')}`, `Run kyro migrate --kyro-scope ${scope} to consolidate into sprint.json.`));
  }

  // 2. sprint.json must exist and be a valid v4 file.
  const sprintRead = readJsonSafely(sprintJsonPath(scope));
  if (!sprintRead.exists) {
    checks.push(fail(`${scope}/sprint.json`, 'missing', `Run kyro migrate --kyro-scope ${scope} (v3 scope) or /kyro:forge INIT.`));
    return checks;
  }
  if (sprintRead.error) {
    checks.push(fail(`${scope}/sprint.json`, sprintRead.error, 'Fix invalid JSON or run kyro repair --kyro-scope <scope>.'));
    return checks;
  }
  const issues = validateSprintFile(sprintRead.value, `${scope}/sprint.json`);
  if (issues.length > 0) {
    checks.push(fail(`${scope}/sprint.json`, formatIssues(issues), 'Fix the shape drift (see field paths). Conventions/scopes/debt must be objects, not strings.'));
  } else {
    checks.push(pass(`${scope}/sprint.json`, 'Schema shapes are valid.'));
  }
  return checks;
}

function resolveScopeNames(scopes: KyroScopeEntry[], activeScope: string | null, requestedScope: string | null): string[] {
  if (requestedScope) return [requestedScope];
  if (activeScope) return [activeScope];
  const names = new Set<string>(scopes.map((s) => s.id));
  for (const scope of listScopeFolders()) names.add(scope);
  return [...names].sort();
}

function formatIssues(issues: ValidationIssue[]): string {
  return issues.map((issue) => `${issue.path}:${issue.field} ${issue.message}`).join('; ');
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
