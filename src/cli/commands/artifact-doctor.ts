import { existsSync, readFileSync } from 'node:fs';
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
    return checks;
  }
  checks.push(pass(`${scope}/sprint.json`, 'Schema shapes are valid.'));

  // 3. Zero-loss audit: every closed sprint in the ledger must have its verbatim snapshot on disk.
  //    A missing snapshot means the sprint was closed by hand (skipping kyro close-sprint) and its
  //    full structured record is unrecoverable. Deterministic — catches the failure in any harness.
  const ledger = (sprintRead.value as { ledger?: Array<{ n?: number; slug?: string; snapshot?: string }> }).ledger ?? [];
  const missing = ledger.filter((entry) => {
    if (!entry.snapshot) return true;
    return !existsSync(resolveManagedPath(`${root}/${entry.snapshot}`));
  });
  if (missing.length > 0) {
    const detail = missing.map((e) => `sprint ${e.n ?? '?'} (${e.slug ?? '?'})`).join(', ');
    checks.push(fail(`${scope}/snapshots`, `closed sprint(s) without a zero-loss snapshot: ${detail}`, 'These were closed by hand, not via kyro close-sprint — their structured record is lost. Close future sprints with kyro close-sprint.'));
  } else if (ledger.length > 0) {
    checks.push(pass(`${scope}/snapshots`, `${ledger.length} closed sprint(s), all with a snapshot.`));
  }

  // 4. Narrative integrity: each ledger[].archive .md must render a real title and an objective.
  //    A broken title ("Sprint N: undefined") means the narrative was rendered by hand without the
  //    sprint title — exactly the failure that close-sprint now owns deterministically. This catches
  //    it in any harness, including narratives written by other agents (e.g. OpenCode).
  const brokenNarratives = ledger
    .map((entry) => validateNarrative(root, entry))
    .filter((issue): issue is string => issue !== null);
  if (brokenNarratives.length > 0) {
    checks.push(fail(`${scope}/narratives`, `broken archive narrative(s): ${brokenNarratives.join('; ')}`, 'Regenerate the narrative via kyro close-sprint (it derives the title from roadmap.sprints[]); do not hand-write the .md.'));
  } else if (ledger.length > 0) {
    checks.push(pass(`${scope}/narratives`, `${ledger.length} narrative(s), all well-formed.`));
  }

  // 5. activeSprint.title (warn-only): a planned sprint must carry its title so the snapshot is
  //    self-contained and the narrative never renders undefined. Warn (not fail) so an in-flight
  //    sprint planned by an older generator can still be closed.
  const active = (sprintRead.value as { activeSprint?: ActiveSprintShape | null }).activeSprint;
  if (active && typeof active.title !== 'string') {
    checks.push(warn(`${scope}/activeSprint`, `sprint ${active.n ?? '?'} has no title field`, 'Re-plan or add activeSprint.title (copied from roadmap.sprints[]) so the archive narrative renders correctly.'));
  }

  // 6. evidence shape (warn-only): a done task should record evidence as an object
  //    { summary, validation, files_changed, notes } (see execute-task.md). A plain string means an
  //    agent wrote loose evidence; the close render tolerates it, but flag the drift. Warn, not fail.
  if (active) {
    const looseEvidence = collectDoneTasks(active)
      .filter((t) => t.evidence !== null && t.evidence !== undefined && typeof t.evidence !== 'object')
      .map((t) => t.id ?? '?');
    if (looseEvidence.length > 0) {
      checks.push(warn(`${scope}/evidence`, `done task(s) with non-object evidence: ${looseEvidence.join(', ')}`, 'Record task.evidence as { summary, validation, files_changed, notes } (see execute-task.md).'));
    }
  }
  return checks;
}

interface ActiveSprintShape {
  n?: number;
  title?: unknown;
  phases?: Array<{ tasks?: Array<{ id?: string; status?: string; evidence?: unknown }> }>;
}

/** Flatten done tasks across an activeSprint's phases (defensive against missing arrays). */
function collectDoneTasks(active: ActiveSprintShape): Array<{ id?: string; evidence?: unknown }> {
  const out: Array<{ id?: string; evidence?: unknown }> = [];
  for (const phase of active.phases ?? []) {
    for (const task of phase.tasks ?? []) {
      if (task.status === 'done') out.push(task);
    }
  }
  return out;
}

/** Validate one archive narrative .md. Returns a short issue string, or null if well-formed. */
function validateNarrative(root: string, entry: { n?: number; archive?: string }): string | null {
  if (!entry.archive) return null; // snapshot check already covers a missing archive path
  const abs = resolveManagedPath(`${root}/${entry.archive}`);
  if (!existsSync(abs)) return `sprint ${entry.n ?? '?'}: narrative file missing (${entry.archive})`;
  let content: string;
  try {
    content = readFileSync(abs, 'utf8');
  } catch {
    return `sprint ${entry.n ?? '?'}: narrative unreadable (${entry.archive})`;
  }
  const heading = content.match(/^# Sprint \d+:\s*(.+?)\s*$/m);
  if (!heading) return `sprint ${entry.n ?? '?'}: missing "# Sprint N: <title>" heading`;
  if (heading[1] === 'undefined' || heading[1].length === 0) {
    return `sprint ${entry.n ?? '?'}: title is "${heading[1] || '(empty)'}"`;
  }
  if (/^title:\s*['"]?.*undefined/m.test(content)) {
    return `sprint ${entry.n ?? '?'}: frontmatter title contains "undefined"`;
  }
  const objective = content.match(/##\s*Objective\s*\n+\s*(\S.*)/);
  if (!objective) return `sprint ${entry.n ?? '?'}: missing or empty "## Objective" section`;
  return null;
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
