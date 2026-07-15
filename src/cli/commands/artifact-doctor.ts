import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { KYRO_STATE_PATH } from '../constants';
import { resolveManagedPath } from '../fs';
import { readJsonSafely } from '../artifacts/json';
import { archiveDir, scopeRoot, sprintJsonPath } from '../artifacts/paths';
import { listScopeFolders } from '../artifacts/scopes';
import {
  asProjectState,
  validateProjectStateShape,
  validateSprintFile,
  type ValidationIssue,
} from '../artifacts/schema';
import type { CheckResult, KyroScopeEntry } from '../types';
import { SPRINT_CLOSE_TRANSACTION_STATUS, type SprintCloseCheckpointV1, type SprintCloseTransactionStatus } from '../types';
import { checkpointCommitment, sha256, validateSprintCloseCheckpoint } from '../checkpoints/sprint-close';
import { assertSafeManagedPath } from '../pipeline/state-writer-lock';

export interface ArtifactAuditOptions {
  kyroScope: string | null;
}

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
    checks.push(fail('kyro.json', formatIssues(projectIssues), 'Fix kyro.json so scopes[] are objects { id, title, status } and schemaVersion is 4, or run kyro install to repopulate.'));
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

  // Checkpoints are independent recovery artifacts. Inspect them even when live sprint.json is
  // missing or corrupt; returning early here would hide the best available recovery evidence.
  // 1. sprint.json must exist and be a valid file.
  const sprintRead = readJsonSafely(sprintJsonPath(scope));
  if (!sprintRead.exists) {
    checks.push(fail(`${scope}/sprint.json`, 'missing', `Run /kyro:forge (INIT) to create it.`));
    checks.push(...inspectSprintCloseCheckpoints(scope));
    return checks;
  }
  if (sprintRead.error) {
    checks.push(fail(`${scope}/sprint.json`, sprintRead.error, 'Fix invalid JSON or run kyro repair --kyro-scope <scope>.'));
    checks.push(...inspectSprintCloseCheckpoints(scope));
    return checks;
  }
  const issues = validateSprintFile(sprintRead.value, `${scope}/sprint.json`);
  if (issues.length > 0) {
    checks.push(fail(`${scope}/sprint.json`, formatIssues(issues), 'Fix the shape drift (see field paths). Conventions/scopes/debt/ADRs must be structured objects, not loose strings.'));
    checks.push(...inspectSprintCloseCheckpoints(scope));
    return checks;
  }
  checks.push(pass(`${scope}/sprint.json`, 'Schema shapes are valid.'));

  // 2b. Unresolved ambiguity: a [NEEDS CLARIFICATION] marker anywhere in sprint.json means the agent
  //     guessed instead of asking. This is the deterministic enforcement of the clarify discipline —
  //     it fails in ANY harness (including OpenCode), where prose-only guidance gets ignored.
  const markerCount = (JSON.stringify(sprintRead.value).match(/\[NEEDS CLARIFICATION/g) ?? []).length;
  if (markerCount > 0) {
    checks.push(fail(`${scope}/clarity`, `${markerCount} unresolved [NEEDS CLARIFICATION] marker(s) in sprint.json`, 'Run the clarify mode (or kyro analyze) to resolve them before planning/executing — do not guess.'));
  }

  // 3. Legacy snapshot audit: every closed sprint in the ledger must retain its ActiveSprint JSON.
  //    A missing snapshot means the sprint was closed by hand (skipping kyro close-sprint) and its
  //    full structured record is unrecoverable. Deterministic — catches the failure in any harness.
  const ledger = (sprintRead.value as { ledger?: Array<{ n?: number; slug?: string; snapshot?: string; checkpoint?: string; checkpointSha256?: string }> }).ledger ?? [];
  const missing = ledger.filter((entry) => {
    if (!entry.snapshot) return true;
    return !existsSync(resolveManagedPath(`${root}/${entry.snapshot}`));
  });
  if (missing.length > 0) {
    const detail = missing.map((e) => `sprint ${e.n ?? '?'} (${e.slug ?? '?'})`).join(', ');
    checks.push(fail(`${scope}/snapshots`, `closed sprint(s) without a verbatim active-sprint snapshot: ${detail}`, 'These were closed by hand, not via kyro close-sprint. Close future sprints with kyro close-sprint.'));
  } else if (ledger.length > 0) {
    checks.push(pass(`${scope}/snapshots`, `${ledger.length} closed sprint(s), all with a snapshot.`));
  }
  const legacyOnly = ledger.filter((entry) => entry.snapshot && !entry.checkpoint);
  if (legacyOnly.length > 0) {
    checks.push(warn(`${scope}/legacy-archives`, `${legacyOnly.length} closed sprint(s) have legacy active-sprint snapshots only`, 'Legacy snapshots remain valid for sprint-level audit, but they cannot reconstruct historical spec, debt, roadmap, handoff, ledger, or scope state. Do not manufacture backfilled checkpoints.'));
  }
  checks.push(...validateLedgerCheckpointReferences(scope, ledger));

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
  checks.push(...inspectSprintCloseCheckpoints(scope));
  return checks;
}

export function inspectSprintCloseCheckpoints(scope: string): CheckResult[] {
  let directory: string;
  try { directory = assertSafeManagedPath(archiveDir(scope)); }
  catch (error) { return [fail(`${scope}/checkpoints`, error instanceof Error ? error.message : String(error), 'Replace symlinked or escaping artifact paths with real directories inside the workspace.')]; }
  if (!existsSync(directory)) return [];
  const files = readdirSync(directory).filter((file) => file.endsWith('.checkpoint.json'));
  const valid = files.flatMap((file) => {
    const path = `${archiveDir(scope)}/${file}`;
    const read = readJsonSafely(path);
    if (!read.exists || read.error || validateSprintCloseCheckpoint(read.value, path).length > 0) return [];
    const checkpoint = read.value as SprintCloseCheckpointV1;
    if (checkpoint.identity.scope !== scope) return [];
    return [{ path, checkpoint }];
  }).sort((left, right) => compareCheckpointRecency(right.checkpoint, left.checkpoint));
  const latestPath = valid[0]?.path ?? null;
  const sprintRead = readJsonSafely(sprintJsonPath(scope));
  const activeRecord = asRecord(asRecord(sprintRead.value)?.activeSprint);
  const activeN = typeof activeRecord?.n === 'number' ? activeRecord.n : null;
  return files.map((file) => {
    const path = `${archiveDir(scope)}/${file}`;
    const checkpoint = valid.find((candidate) => candidate.path === path)?.checkpoint;
    const supersededByActiveSprint = activeN !== null && checkpoint !== undefined && activeN > checkpoint.identity.sprintN;
    return inspectCheckpoint(scope, path, path === latestPath && !supersededByActiveSprint);
  });
}

function compareCheckpointRecency(left: SprintCloseCheckpointV1, right: SprintCloseCheckpointV1): number {
  return left.identity.sprintN - right.identity.sprintN
    || left.createdAt.localeCompare(right.createdAt)
    || left.checkpointId.localeCompare(right.checkpointId);
}

function inspectCheckpoint(scope: string, path: string, compareLiveState: boolean): CheckResult {
  const read = readJsonSafely(path);
  if (read.error) return checkpointResult(scope, path, SPRINT_CLOSE_TRANSACTION_STATUS.CORRUPT, read.error);
  const raw = asRecord(read.value);
  if (raw?.schemaVersion !== 1) {
    return checkpointResult(scope, path, SPRINT_CLOSE_TRANSACTION_STATUS.UNSUPPORTED_VERSION, `schemaVersion=${String(raw?.schemaVersion ?? '(missing)')}`);
  }
  const issues = validateSprintCloseCheckpoint(read.value, path);
  if (issues.length > 0) return checkpointResult(scope, path, SPRINT_CLOSE_TRANSACTION_STATUS.CORRUPT, issues.join('; '));
  const checkpoint = read.value as SprintCloseCheckpointV1;
  if (checkpoint.identity.scope !== scope) return checkpointResult(scope, path, SPRINT_CLOSE_TRANSACTION_STATUS.CORRUPT, `identity scope ${checkpoint.identity.scope} does not match directory ${scope}`);

  const snapshotState = inspectArtifact(checkpoint.paths.legacySnapshot, checkpoint.digests.legacySnapshot);
  const narrativeState = inspectArtifact(checkpoint.paths.narrative, checkpoint.digests.narrative);
  if (!compareLiveState) {
    const status = snapshotState === 'ok' && narrativeState === 'ok'
      ? SPRINT_CLOSE_TRANSACTION_STATUS.APPLIED
      : snapshotState === 'conflict' || narrativeState === 'conflict'
        ? SPRINT_CLOSE_TRANSACTION_STATUS.DIVERGED
        : SPRINT_CLOSE_TRANSACTION_STATUS.PARTIAL;
    return checkpointResult(scope, path, status, `historical integrity: snapshot=${snapshotState}, narrative=${narrativeState}`);
  }
  const sprintRead = readJsonSafely(sprintJsonPath(scope));
  const sprintDigest = sprintRead.exists && !sprintRead.error ? sha256(sprintRead.value) : null;
  const projectRead = readJsonSafely(KYRO_STATE_PATH);
  const project = asProjectState(projectRead.value);
  const projectEntry = project?.scopes.find((entry) => entry.id === scope);
  const projectDigest = projectEntry ? sha256(projectEntry) : null;

  const sprintPosition = digestPosition(sprintDigest, checkpoint.digests.beforeClose, checkpoint.digests.intendedAfterClose);
  const scopePosition = digestPosition(projectDigest, checkpoint.digests.projectScopeBefore, checkpoint.digests.projectScopeAfter);
  let status: SprintCloseTransactionStatus;
  if (snapshotState === 'conflict' || narrativeState === 'conflict' || sprintPosition === 'other' || scopePosition === 'other') {
    status = SPRINT_CLOSE_TRANSACTION_STATUS.DIVERGED;
  } else if (isAfterPosition(sprintPosition) && isAfterPosition(scopePosition) && snapshotState === 'ok' && narrativeState === 'ok') {
    status = SPRINT_CLOSE_TRANSACTION_STATUS.APPLIED;
  } else if (isBeforePosition(sprintPosition) && isBeforePosition(scopePosition) && snapshotState === 'missing' && narrativeState === 'missing') {
    status = SPRINT_CLOSE_TRANSACTION_STATUS.PREPARED;
  } else {
    status = SPRINT_CLOSE_TRANSACTION_STATUS.PARTIAL;
  }
  return checkpointResult(scope, path, status, `sprint=${sprintPosition}, scope=${scopePosition}, snapshot=${snapshotState}, narrative=${narrativeState}`);
}

function validateLedgerCheckpointReferences(
  scope: string,
  ledger: Array<{ n?: number; slug?: string; snapshot?: string; checkpoint?: string; checkpointSha256?: string }>,
): CheckResult[] {
  const results: CheckResult[] = [];
  for (const entry of ledger) {
    if (!entry.checkpoint) continue;
    const expected = `archive/sprint-${String(entry.n ?? 0).padStart(3, '0')}-${entry.slug ?? ''}.checkpoint.json`;
    if (entry.checkpoint !== expected) {
      results.push(fail(`${scope}/ledger-checkpoint/${entry.n ?? '?'}`, `checkpoint reference ${entry.checkpoint} does not match ledger identity`, `Expected ${expected}. Do not redirect immutable checkpoint references.`));
      continue;
    }
    const path = `${scopeRoot(scope)}/${entry.checkpoint}`;
    const read = readJsonSafely(path);
    if (!read.exists) {
      results.push(fail(`${scope}/ledger-checkpoint/${entry.n ?? '?'}`, `referenced checkpoint is missing: ${entry.checkpoint}`, 'Restore the immutable checkpoint from versioned storage.'));
      continue;
    }
    if (read.error) {
      results.push(fail(`${scope}/ledger-checkpoint/${entry.n ?? '?'}`, `referenced checkpoint is unreadable: ${read.error}`, 'Restore the immutable checkpoint; do not rewrite the ledger to hide the failure.'));
      continue;
    }
    const issues = validateSprintCloseCheckpoint(read.value, path);
    const checkpoint = read.value as Partial<SprintCloseCheckpointV1>;
    if (issues.length > 0 || checkpoint.identity?.sprintN !== entry.n || checkpoint.identity?.sprintSlug !== entry.slug) {
      results.push(fail(`${scope}/ledger-checkpoint/${entry.n ?? '?'}`, `referenced checkpoint is invalid or mismatched: ${issues.join('; ') || 'identity mismatch'}`, 'Restore the checkpoint that matches this ledger entry.'));
    } else if (!entry.checkpointSha256) {
      results.push(warn(`${scope}/ledger-checkpoint/${entry.n ?? '?'}`, `${entry.checkpoint} has no external ledger commitment`, 'This pre-anchor checkpoint remains readable, but archive-only tampering cannot be detected. Future closes record checkpointSha256.'));
    } else if (entry.checkpointSha256 !== checkpointCommitment(checkpoint as SprintCloseCheckpointV1)) {
      results.push(fail(`${scope}/ledger-checkpoint/${entry.n ?? '?'}`, `checkpoint commitment does not match live ledger anchor for ${entry.checkpoint}`, 'Treat the archive as tampered or corrupted. Restore the checkpoint bytes/content from trusted versioned storage.'));
    } else {
      results.push(pass(`${scope}/ledger-checkpoint/${entry.n ?? '?'}`, `${entry.checkpoint} matches ledger identity and external commitment.`));
    }
  }
  return results;
}

function checkpointResult(scope: string, path: string, status: SprintCloseTransactionStatus, detail: string): CheckResult {
  const name = `${scope}/checkpoint/${path.split('/').pop() ?? path}`;
  const message = `${status}: ${detail}`;
  if (status === SPRINT_CLOSE_TRANSACTION_STATUS.APPLIED) return pass(name, message);
  if (status === SPRINT_CLOSE_TRANSACTION_STATUS.PREPARED || status === SPRINT_CLOSE_TRANSACTION_STATUS.PARTIAL) {
    return warn(name, message, 'Retry kyro close-sprint with the checkpoint\'s frozen close inputs to resume safely.');
  }
  if (status === SPRINT_CLOSE_TRANSACTION_STATUS.UNSUPPORTED_VERSION) return fail(name, message, 'Upgrade Kyro before inspecting or resuming this checkpoint.');
  return fail(name, message, status === SPRINT_CLOSE_TRANSACTION_STATUS.DIVERGED ? 'Do not overwrite live state. Reconcile it explicitly against the checkpoint before/after images.' : 'Restore the immutable checkpoint from versioned storage; do not overwrite it.');
}

function inspectArtifact(path: string, expectedDigest: string): 'missing' | 'ok' | 'conflict' {
  const absolute = resolveManagedPath(path);
  if (!existsSync(absolute)) return 'missing';
  try { return sha256(readFileSync(absolute, 'utf8')) === expectedDigest ? 'ok' : 'conflict'; }
  catch { return 'conflict'; }
}

type DigestPosition = 'before' | 'after' | 'both' | 'missing' | 'other';

function digestPosition(current: string | null, before: string, after: string): DigestPosition {
  if (current === null) return 'missing';
  if (current === before && current === after) return 'both';
  if (current === before) return 'before';
  if (current === after) return 'after';
  return 'other';
}

function isBeforePosition(position: DigestPosition): boolean { return position === 'before' || position === 'both'; }
function isAfterPosition(position: DigestPosition): boolean { return position === 'after' || position === 'both'; }

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
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
