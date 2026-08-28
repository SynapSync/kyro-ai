import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { printPlan, resolveManagedPath } from '../fs';
import { readProjectState } from '../state';
import { resolveScope as resolveKyroScope } from '../core/scope-resolution';
import { collectFindings } from '../core/analysis';
import { KyroCoreError } from '../core/errors';
import {
  collectSprintTasks,
  deriveSprintCloseOutcomeClass,
  disposedCloseTasks,
  isTaskVerifiedComplete,
  undisposedCloseTasks,
} from '../core/status';
import { isInteractiveTerminal } from '../core/tty';
import { evaluateGuard } from '../core/policy';
import { emitBlockedReason, emitGateApproved, emitToolCommandRun, emitTraceEvent, normalizeTraceCloseOutcome, traceSnapshotId } from '../core/trace';
import { readJsonSafely } from '../artifacts/json';
import { archiveDir, scopeRoot, sprintJsonPath } from '../artifacts/paths';
import { projectScopeWritePath } from '../checkpoints/sprint-close';
import { surveyScopeCheckpoints } from '../checkpoints/discovery';
import { asSprintFile, validateSprintFile } from '../artifacts/schema';
import {
  applySprintCloseTransaction,
  buildSprintCloseCheckpoint,
  canonicalJson,
  deriveSprintCloseTransition,
  readSprintCloseCheckpoint,
  type SprintCloseTransaction,
} from '../checkpoints/sprint-close';
import type { ActiveSprint, OperationPlan, SprintCloseCheckpointV1, SprintCloseInputs, SprintFile, Task } from '../types';
import { SPRINT_CLOSE_OUTCOME } from '../types';
import { assertSafeManagedPath, assertSafePathSegment, withStateWriterLock } from '../pipeline/state-writer-lock';

/**
 * Deterministic, lossless scope close. The TOOL — not the agent — owns the destructive step.
 *
 * Guarantee: an immutable full-scope checkpoint is published before any mutable state changes.
 * The legacy ActiveSprint snapshot remains available for compatible readers. A matching checkpoint
 * makes retries idempotent; conflicting content or divergent live state is never overwritten.
 *
 * The agent still owns additive judgment work (conventions and debt extraction). The CLI owns the
 * checkpoint, narrative, compatible snapshot, and compare-and-swap live-state transition.
 */
export interface CloseSprintArgs {
  scope: string | null;
  outcome: string;
  outcomeExplicit: boolean;
  note: string | null;
  summary: string | null;
  recommendations: string[];
  learnings: string[];
  dryRun: boolean;
  yes: boolean;
  help: boolean;
}

export async function runCloseSprintCommand(rawArgs: string[]): Promise<void> {
  const args = parseCloseSprintArgs(rawArgs);
  if (args.help) {
    printCloseSprintHelp();
    return;
  }
  if (args.dryRun && args.yes) throw new KyroCoreError('INVALID_INPUT', '--dry-run and --yes are mutually exclusive.', 'Use --dry-run to preview, or --yes to confirm the write — not both.');

  const scope = resolveKyroScope(args.scope);
  const prepared = buildClosePlan(scope, args);
  const { plan, snapshotPath, checkpointPath, transaction } = prepared;
  const identity = transaction.checkpoint.identity;
  printPlan(`Close sprint ${identity.sprintN} (${identity.sprintSlug}) — lossless scope checkpoint`, plan);
  console.log(`\nCheckpoint (written first, immutable complete scope state): ${checkpointPath}`);
  console.log(`Legacy ActiveSprint snapshot (never overwritten): ${snapshotPath}`);
  printCloseTruthSummary(transaction);

  if (args.dryRun) {
    console.log('Dry run complete. No files changed.');
    return;
  }
  if (!args.yes) {
    // Prompting where stdin cannot answer (agent harness, CI, piped shell) blocks until the caller
    // times out instead of closing. Fail fast with the flag that completes the gate non-interactively.
    if (!isInteractiveTerminal()) {
      throw new KyroCoreError(
        'CONFIRMATION_REQUIRED',
        `Cannot close sprint ${identity.sprintN} in scope "${scope}": confirmation is required but this is not an interactive terminal.`,
        'Re-run with --yes to confirm the close non-interactively, or --dry-run to preview it.',
      );
    }
    const confirmed = await confirm(`Checkpoint and close sprint ${identity.sprintN} in scope "${scope}"? [y/N] `);
    if (!confirmed) {
      console.log('No changes made.');
      return;
    }
  }

  // Rebuild under the writer lock. The displayed plan is advisory; no stale pre-prompt state is
  // ever applied after another mutator has had a chance to run.
  withStateWriterLock(() => executeConfirmedClose(scope, args));
}

function executeConfirmedClose(scope: string, args: CloseSprintArgs): void {
  const fresh = buildClosePlan(scope, args);
  const identity = fresh.transaction.checkpoint.identity;
  emitToolCommandRun(scope, 'cli', 'close-sprint', { outcome: fresh.transaction.checkpoint.close.outcome });
  const guard = evaluateGuard('close_sprint', { surface: 'cli', scope, confirmed: true });
  if (guard.kind === 'blocked') {
    emitBlockedReason(scope, guard.message, guard.code);
    throw new KyroCoreError(guard.code ?? 'POLICY_BLOCKED', guard.message, guard.remedy);
  }
  emitGateApproved(scope, 'close_sprint');
  applySprintCloseTransaction(fresh.transaction);

  const verify = readJsonSafely(sprintJsonPath(scope));
  if (verify.error || !verify.exists) {
    throw new KyroCoreError('INVALID_JSON', `Close wrote sprint.json but re-parse failed (${verify.error ?? 'missing'}).`, `The snapshot at ${fresh.snapshotPath} preserves the sprint.`);
  }
  const issues = validateSprintFile(verify.value, `${scope}/sprint.json`);
  if (issues.length > 0) {
    const detail = issues.map((i) => `${i.field} ${i.message}`).join('; ');
    throw new KyroCoreError('INVALID_SPRINT_SHAPE', `Close wrote sprint.json but it failed validation — ${detail}.`, `The snapshot at ${fresh.snapshotPath} preserves the sprint.`);
  }
  emitTraceEvent({
    v: 1,
    ts: new Date().toISOString(),
    scope,
    type: 'close_snapshot',
    sprintN: identity.sprintN,
    snapshotId: traceSnapshotId(fresh.snapshotPath),
    outcome: normalizeTraceCloseOutcome(fresh.transaction.checkpoint.close.outcome),
  });
  console.log(`\nSprint ${identity.sprintN} closed. activeSprint cleared; ledger entry, snapshot, and checkpoint recorded.`);
  const handoff = (verify.value as SprintFile).handoff;
  console.log(`Next action: ${handoff.nextAction}.`);
  if (handoff.nextAction === 'plan_sprint') {
    console.log('');
    console.log('▶ Start the next sprint in a FRESH session.');
    console.log('  Carrying this session forward is the dominant token cost across a multi-sprint run;');
    console.log('  a new session reloads only the lean handoff below.');
    console.log('  New session → generate the handoff prompt (Claude: /kyro:task-context · other agents:');
    console.log('  the kyro-task-context skill), then start the next cycle (/kyro:forge).');
    console.log('');
    console.log('  Handoff facts (paste into the new session if you skip task-context):');
    console.log(`    scope:       ${scope}`);
    console.log(`    sprint.json: ${sprintJsonPath(scope)}`);
    console.log(`    nextAction:  ${handoff.nextAction}`);
    if (handoff.note) console.log(`    note:        ${handoff.note}`);
  } else if (handoff.nextAction === 'done') {
    console.log('');
    console.log('▶ Scope is terminal (historical completion or retirement). No further forge modes.');
  }
}

export function buildClosePlan(
  scope: string,
  args: CloseSprintArgs,
): { sprint: SprintFile; plan: OperationPlan[]; snapshotPath: string; checkpointPath: string; transaction: SprintCloseTransaction } {
  const root = scopeRoot(scope);
  assertSafePathSegment(scope, 'Scope');
  assertSafeManagedPath(root);
  assertSafeManagedPath(sprintJsonPath(scope));
  if (!existsSync(resolveManagedPath(root))) {
    throw new KyroCoreError('SCOPE_NOT_FOUND', `Scope not found: ${scope}`, 'Run kyro scope list to see available scopes.');
  }

  const read = readJsonSafely(sprintJsonPath(scope));
  if (!read.exists) {
    const recovered = findLatestCheckpoint(scope);
    if (!recovered) throw new KyroCoreError('SCOPE_NOT_FOUND', `Cannot close ${scope}: sprint.json not found and no checkpoint can resume it. Run recovery or /kyro:forge (INIT).`);
    assertMatchingCloseInputs(recovered.checkpoint.close, retryCloseInputs(recovered.checkpoint, args), recovered.path);
    return closePlanResult(recovered.checkpoint.intendedAfterClose, transactionFromExisting(recovered.path, recovered.checkpoint));
  }
  if (read.error) {
    throw new KyroCoreError('INVALID_JSON', `Cannot close ${scope}: sprint.json is invalid JSON (${read.error}). Restore from an archive snapshot.`);
  }
  const issues = validateSprintFile(read.value, `${scope}/sprint.json`);
  if (issues.length > 0) {
    const detail = issues.map((i) => `${i.field} ${i.message}`).join('; ');
    throw new KyroCoreError('INVALID_SPRINT_SHAPE', `Cannot close ${scope}: sprint.json has shape drift — ${detail}. Fix it before closing.`);
  }

  const sprint = asSprintFile(read.value);
  if (!sprint) {
    throw new KyroCoreError('INVALID_SPRINT_SHAPE', `Cannot close ${scope}: sprint.json is not a valid v4 SprintFile.`);
  }
  const active = sprint.activeSprint;
  if (!active) {
    const latest = sprint.ledger[sprint.ledger.length - 1];
    if (latest?.checkpoint) {
      const checkpointPath = `${root}/${latest.checkpoint}`;
      const checkpoint = readSprintCloseCheckpoint(checkpointPath);
      if (!checkpoint) throw new KyroCoreError('CHECKPOINT_CORRUPT', `Ledger references missing checkpoint ${checkpointPath}.`, 'Restore the checkpoint before retrying the close.');
      assertMatchingCloseInputs(checkpoint.close, retryCloseInputs(checkpoint, args), checkpointPath);
      const priorActive = checkpoint.beforeClose.activeSprint;
      if (!priorActive) throw new KyroCoreError('CHECKPOINT_CORRUPT', `Checkpoint ${checkpointPath} has no beforeClose.activeSprint.`);
      const transaction = transactionFromExisting(checkpointPath, checkpoint);
      return closePlanResult(sprint, transaction);
    }
    if (latest?.snapshot) {
      throw new KyroCoreError('SNAPSHOT_EXISTS', `Cannot close ${scope}: activeSprint is null and the latest ledger entry has only legacy snapshot ${latest.snapshot}.`, 'This sprint is already closed. Legacy archives cannot be upgraded into a full checkpoint without inventing historical state.');
    }
    throw new KyroCoreError('INVALID_INPUT', `Cannot close ${scope}: activeSprint is null (no sprint in progress). Nothing to snapshot.`);
  }
  assertSafePathSegment(active.slug, 'Sprint slug');
  const principles = readProjectState()?.principles ?? [];
  const blockingFindings = collectFindings(sprint, principles).filter((finding) => finding.severity === 'CRITICAL' || finding.severity === 'HIGH');
  if (blockingFindings.length > 0) {
    throw new KyroCoreError(
      'BLOCKING_FINDINGS',
      `Cannot close ${scope}: ${blockingFindings.length} blocking analyze finding(s) remain — ${blockingFindings.map((finding) => finding.detail).join('; ')}`,
      'Run kyro analyze, resolve CRITICAL/HIGH findings, then close the sprint.',
    );
  }

  const nnn = String(active.n).padStart(3, '0');
  const snapshotPath = `${archiveDir(scope)}/sprint-${nnn}-${active.slug}.json`;
  const narrativePath = `${archiveDir(scope)}/sprint-${nnn}-${active.slug}.md`;
  const checkpointPath = `${archiveDir(scope)}/sprint-${nnn}-${active.slug}.checkpoint.json`;
  for (const path of [snapshotPath, narrativePath, checkpointPath, sprintJsonPath(scope), projectScopeWritePath()]) assertSafeManagedPath(path);

  // Audit-trail protection: never overwrite an existing snapshot. A collision means this sprint
  // number was already closed — exactly the double-close that destroyed Sprint 1 data before.
  const existingCheckpoint = readSprintCloseCheckpoint(checkpointPath);
  if (existsSync(resolveManagedPath(snapshotPath)) && !existingCheckpoint) {
    throw new KyroCoreError(
      'SNAPSHOT_EXISTS',
      `Refusing to close: snapshot already exists at ${snapshotPath}. Sprint ${active.n} appears already closed; overwriting would destroy the audit trail.`,
      'Do not overwrite archives. Inspect the ledger/snapshot and choose the next valid action.',
    );
  }

  if (!existingCheckpoint) {
    const undisposed = undisposedCloseTasks(active);
    if (undisposed.length > 0) {
      const detail = undisposed.map((task) => `${task.id} (${task.status})`).join(', ');
      throw new KyroCoreError(
        'UNDISPOSED_TASKS',
        `Cannot close ${scope}: unfinished task(s) lack a disposition: ${detail}.`,
        'Record a disposition with kyro record-evidence <task> --disposition deferred|blocked|superseded|cancelled --reason "..." [--target debt:<id>|task:<id>|sprint:<n>], or complete and review the task.',
      );
    }
  }

  if (existingCheckpoint) {
    assertMatchingCloseInputs(existingCheckpoint.close, retryCloseInputs(existingCheckpoint, args), checkpointPath);
    if (existingCheckpoint.identity.scope !== scope || existingCheckpoint.identity.sprintN !== active.n || existingCheckpoint.identity.sprintSlug !== active.slug) {
      throw new KyroCoreError('CHECKPOINT_CONFLICT', `Checkpoint identity at ${checkpointPath} does not match the active sprint.`, 'Do not overwrite the checkpoint; reconcile the conflicting sprint identity.');
    }
    return closePlanResult(sprint, transactionFromExisting(checkpointPath, existingCheckpoint));
  }

  const closeInputs = buildCloseInputs(active, args);

  const state = readProjectState();
  const projectScopeBefore = state?.scopes.find((entry) => entry.id === scope);
  if (!state || !projectScopeBefore) {
    throw new KyroCoreError(
      'STATE_DIVERGED',
      `Cannot checkpoint ${scope}: its KyroScopeEntry is missing from project state.`,
      'Repair project.json (or legacy kyro.json) scopes[] before closing so the checkpoint can preserve scope state.',
    );
  }
  const createdAt = new Date().toISOString();
  const closedAt = createdAt.slice(0, 10);
  const transition = deriveSprintCloseTransition(sprint, projectScopeBefore, closeInputs, createdAt, snapshotPath, narrativePath, checkpointPath);
  const closed = transition.intendedAfterClose;
  const projectScopeAfter = transition.projectScopeAfter;
  const legacySnapshotContent = `${JSON.stringify(active, null, 2)}\n`;
  const narrativeContent = renderNarrative(sprint, active, closeInputs, closedAt);
  const transaction = buildSprintCloseCheckpoint(checkpointPath, {
    scope,
    active,
    createdAt,
    close: closeInputs,
    legacySnapshotPath: snapshotPath,
    narrativePath,
    beforeClose: sprint,
    intendedAfterClose: closed,
    projectScopeBefore,
    projectScopeAfter,
    legacySnapshotContent,
    narrativeContent,
  });
  return closePlanResult(sprint, transaction);
}

/**
 * Render the human narrative .md deterministically. The TITLE is taken from `roadmap.sprints[]`
 * (the authoritative source, always present) with safe fallbacks — so it can never render
 * `Sprint N: undefined`, the failure that hand-rendered narratives produced. The agent supplies
 * only judgment text (learnings, recommendations) via args; structure comes from the snapshot.
 */
function renderNarrative(sprint: SprintFile, active: ActiveSprint, args: SprintCloseInputs, closedAt: string): string {
  const roadmapTitle = sprint.roadmap.sprints.find((s) => s.n === active.n)?.title;
  const title = roadmapTitle ?? active.title ?? active.objective;
  const nextN = active.n + 1;

  const lines: string[] = [];
  lines.push('---');
  lines.push(`title: '${sprint.scope} — Sprint ${active.n}: ${title.replace(/'/g, "''")}'`);
  lines.push(`date: '${closedAt}'`);
  lines.push(`scope: '${sprint.scope}'`);
  lines.push(`sprint: ${active.n}`);
  lines.push(`slug: '${active.slug}'`);
  lines.push(`outcome: '${args.outcome}'`);
  lines.push("type: 'sprint-archive'");
  lines.push('---');
  lines.push('');
  lines.push(`# Sprint ${active.n}: ${title}`);
  lines.push('');
  lines.push(`> Closed: ${closedAt}`);
  lines.push(`> Outcome: ${args.outcome}`);
  lines.push('');
  lines.push('## Objective');
  lines.push('');
  lines.push(active.objective);
  lines.push('');

  lines.push('## Definition of Done');
  lines.push('');
  if (active.definitionOfDone.length > 0) {
    for (const item of active.definitionOfDone) lines.push(`- ${item}`);
  } else {
    lines.push('_None recorded._');
  }
  lines.push('');

  lines.push('## Phases');
  lines.push('');
  for (const phase of active.phases) {
    lines.push(`### ${phase.id} — ${phase.title}`);
    lines.push('');
    if (phase.objective) {
      lines.push(`> ${phase.objective}`);
      lines.push('');
    }
    for (const task of phase.tasks) {
      lines.push(`#### ${task.id}: ${task.title}`);
      lines.push('');
      lines.push(`**Status**: ${task.status}`);
      lines.push('');
      const dispositionLine = renderDisposition(task);
      if (dispositionLine) {
        lines.push(`**Disposition**: ${dispositionLine}`);
        lines.push('');
      }
      if (task.description) {
        lines.push(`**Description**: ${task.description}`);
        lines.push('');
      }
      lines.push(...renderEvidence(task.evidence));
      lines.push(`**Verdict**: ${renderVerdict(task.verdict)}`);
      lines.push('');
      lines.push('---');
    }
  }
  lines.push('');

  const unfinished = collectSprintTasks(active).filter((task) => !isTaskVerifiedComplete(task));
  lines.push('## Unfinished work');
  lines.push('');
  if (unfinished.length === 0) {
    lines.push('_None — every task is done with a passing verdict._');
  } else {
    for (const task of unfinished) {
      const dispositionLine = renderDisposition(task) ?? `${task.status}, no disposition`;
      lines.push(`- **${task.id}** (${task.title}): ${dispositionLine}`);
    }
  }
  lines.push('');

  lines.push('## Learnings');
  lines.push('');
  if (args.learnings.length > 0) {
    for (const item of args.learnings) lines.push(`- ${item}`);
  } else {
    lines.push('_No learnings recorded._');
  }
  lines.push('');

  lines.push('## Resolved Debt');
  lines.push('');
  const resolved = sprint.debt.filter((d) => d.status === 'resolved');
  if (resolved.length > 0) {
    for (const d of resolved) lines.push(`- **${d.id}**: ${d.title}`);
  } else {
    lines.push('_No debt resolved in this sprint._');
  }
  lines.push('');

  lines.push(`## Recommendations for Sprint ${nextN}`);
  lines.push('');
  if (args.recommendations.length > 0) {
    for (const item of args.recommendations) lines.push(`- ${item}`);
  } else {
    lines.push('_None recorded._');
  }
  lines.push('');

  return `${lines.join('\n')}`;
}

/** Tolerate evidence as a plain string OR an object { summary, validation, files_changed, notes }. */
function renderEvidence(evidence: unknown): string[] {
  if (evidence === null || evidence === undefined) {
    return ['**Evidence**: _No evidence recorded._', ''];
  }
  if (typeof evidence === 'string') {
    return [`**Evidence**: ${evidence}`, ''];
  }
  if (typeof evidence === 'object') {
    const e = evidence as Record<string, unknown>;
    const out: string[] = ['**Evidence**:'];
    if (typeof e.summary === 'string') out.push(`- Summary: ${e.summary}`);
    if (typeof e.validation === 'string') out.push(`- Validation: ${e.validation}`);
    else if (Array.isArray(e.validation)) for (const line of e.validation) out.push(`- Validation: ${String(line)}`);
    if (Array.isArray(e.files_changed)) out.push(`- Files changed: ${e.files_changed.map((f) => `\`${String(f)}\``).join(', ')}`);
    if (typeof e.notes === 'string') out.push(`- Notes: ${e.notes}`);
    if (out.length === 1) out.push('- _Recorded (unstructured)._');
    out.push('');
    return out;
  }
  return [`**Evidence**: ${String(evidence)}`, ''];
}

/** Tolerate verdict as an object { result, findings } or null. */
function renderVerdict(verdict: unknown): string {
  if (verdict === null || verdict === undefined) return '_Not reviewed._';
  if (typeof verdict === 'string') return verdict;
  if (typeof verdict === 'object') {
    const v = verdict as Record<string, unknown>;
    const result = typeof v.result === 'string' ? v.result : 'recorded';
    const findings = Array.isArray(v.findings) && v.findings.length > 0
      ? ` — ${v.findings.map((f) => String(f)).join('; ')}`
      : '';
    const waived = Array.isArray(v.waived_criteria) && v.waived_criteria.length > 0
      ? ` (waived: ${v.waived_criteria.map((w) => { const r = w as Record<string, unknown>; return `${String(r.criterion)} — ${String(r.reason)}`; }).join('; ')})`
      : '';
    return `${result}${findings}${waived}`;
  }
  return String(verdict);
}

function closePlanResult(sprint: SprintFile, transaction: SprintCloseTransaction): { sprint: SprintFile; plan: OperationPlan[]; snapshotPath: string; checkpointPath: string; transaction: SprintCloseTransaction } {
  const checkpoint = transaction.checkpoint;
  const plan: OperationPlan[] = [
    { action: 'write', path: transaction.checkpointPath, content: transaction.checkpointContent },
    { action: 'write', path: checkpoint.paths.legacySnapshot, content: transaction.legacySnapshotContent },
    { action: 'write', path: checkpoint.paths.narrative, content: transaction.narrativeContent },
    { action: 'write', path: sprintJsonPath(checkpoint.identity.scope), content: `${JSON.stringify(checkpoint.intendedAfterClose, null, 2)}\n` },
  ];
  if (canonicalJson(checkpoint.projectScopeBefore) !== canonicalJson(checkpoint.projectScopeAfter)) {
    plan.push({ action: 'write', path: projectScopeWritePath() });
  }
  return { sprint, plan, snapshotPath: checkpoint.paths.legacySnapshot, checkpointPath: transaction.checkpointPath, transaction };
}

function transactionFromExisting(checkpointPath: string, checkpoint: SprintCloseTransaction['checkpoint']): SprintCloseTransaction {
  const active = checkpoint.beforeClose.activeSprint;
  if (!active) throw new KyroCoreError('CHECKPOINT_CORRUPT', `Checkpoint ${checkpointPath} has no beforeClose.activeSprint.`);
  const legacySnapshotContent = `${JSON.stringify(active, null, 2)}\n`;
  const narrativeContent = renderNarrative(checkpoint.beforeClose, active, checkpoint.close, checkpoint.createdAt.slice(0, 10));
  return { checkpointPath, checkpoint, checkpointContent: `${JSON.stringify(checkpoint, null, 2)}\n`, legacySnapshotContent, narrativeContent };
}

function retryCloseInputs(checkpoint: SprintCloseCheckpointV1, args: CloseSprintArgs): SprintCloseInputs {
  const active = checkpoint.beforeClose.activeSprint;
  if (!active) {
    throw new KyroCoreError('CHECKPOINT_CORRUPT', `Checkpoint ${checkpoint.identity.sprintN} has no beforeClose.activeSprint.`, 'Restore the checkpoint before retrying the close.');
  }
  return {
    outcome: args.outcomeExplicit
      ? args.outcome
      : deriveSprintCloseOutcomeClass(active) === 'completed'
        ? SPRINT_CLOSE_OUTCOME.SHIPPED
        : SPRINT_CLOSE_OUTCOME.PARTIAL,
    note: args.note,
    summary: args.summary,
    recommendations: [...args.recommendations],
    learnings: [...args.learnings],
  };
}

function buildCloseInputs(active: ActiveSprint, args: CloseSprintArgs): SprintCloseInputs {
  return {
    outcome: resolveCloseOutcome(active, args),
    note: args.note,
    summary: args.summary,
    recommendations: [...args.recommendations],
    learnings: [...args.learnings],
  };
}

const COMPLETED_CLOSE_OUTCOMES = new Set<string>([SPRINT_CLOSE_OUTCOME.SHIPPED, SPRINT_CLOSE_OUTCOME.COMPLETED]);
const PARTIAL_CLOSE_OUTCOMES = new Set<string>([SPRINT_CLOSE_OUTCOME.PARTIAL]);
const ABANDONED_CLOSE_OUTCOMES = new Set<string>([SPRINT_CLOSE_OUTCOME.ABANDONED, SPRINT_CLOSE_OUTCOME.ABORTED]);

function resolveCloseOutcome(active: ActiveSprint, args: CloseSprintArgs): string {
  const derived = deriveSprintCloseOutcomeClass(active);
  const requested = args.outcome;
  if (derived === 'completed') {
    if (!args.outcomeExplicit) return SPRINT_CLOSE_OUTCOME.SHIPPED;
    if (PARTIAL_CLOSE_OUTCOMES.has(requested)) {
      throw new KyroCoreError(
        'INVALID_INPUT',
        `Cannot close as ${requested}: every task is done with a passing verdict.`,
        'Omit --outcome or pass --outcome shipped/completed.',
      );
    }
    return requested;
  }
  if (!args.outcomeExplicit) return SPRINT_CLOSE_OUTCOME.PARTIAL;
  if (COMPLETED_CLOSE_OUTCOMES.has(requested)) {
    throw new KyroCoreError(
      'INVALID_INPUT',
      `Cannot close as ${requested}: disposed or unfinished work cannot be recorded as shipped/completed.`,
      'Omit --outcome to persist partial, or pass --outcome partial or --outcome abandoned.',
    );
  }
  if (PARTIAL_CLOSE_OUTCOMES.has(requested) || ABANDONED_CLOSE_OUTCOMES.has(requested)) return requested;
  throw new KyroCoreError(
    'INVALID_INPUT',
    `Unknown close outcome "${requested}" for a partial sprint.`,
    'Use --outcome partial or --outcome abandoned.',
  );
}

function renderDisposition(task: Task): string | null {
  const disposition = task.disposition;
  if (!disposition) return null;
  const target = disposition.target ? ` → ${disposition.target.kind}:${disposition.target.id}` : '';
  return `${disposition.kind}${target} — ${disposition.reason}`;
}

function printCloseTruthSummary(transaction: SprintCloseTransaction): void {
  const active = transaction.checkpoint.beforeClose.activeSprint;
  const outcome = transaction.checkpoint.close.outcome;
  if (!active) return;
  const disposed = disposedCloseTasks(active);
  const verified = collectSprintTasks(active).filter((task) => isTaskVerifiedComplete(task)).length;
  console.log(`\nClose outcome: ${outcome} (${verified} verified complete, ${disposed.length} disposed).`);
  if (disposed.length === 0) return;
  console.log('Disposed tasks:');
  for (const task of disposed) {
    console.log(`  ${task.id}: ${renderDisposition(task)}`);
  }
}

function assertMatchingCloseInputs(expected: SprintCloseInputs, actual: SprintCloseInputs, checkpointPath: string): void {
  if (canonicalJson(expected) !== canonicalJson(actual)) {
    throw new KyroCoreError('CHECKPOINT_CONFLICT', `Close inputs conflict with frozen metadata in ${checkpointPath}.`, 'Retry with exactly the outcome, note, summary, recommendations, and learnings stored in the checkpoint.');
  }
}

function findLatestCheckpoint(scope: string): { path: string; checkpoint: SprintCloseCheckpointV1 } | null {
  const directory = archiveDir(scope);
  const candidates = surveyScopeCheckpoints(scope).safeFiles;
  const parsed: Array<{ path: string; checkpoint: SprintCloseCheckpointV1 }> = [];
  for (const name of candidates) {
    const path = `${directory}/${name}`;
    const checkpoint = readSprintCloseCheckpoint(path);
    if (checkpoint) parsed.push({ path, checkpoint });
  }
  parsed.sort((left, right) => compareCheckpointRecency(right.checkpoint, left.checkpoint));
  return parsed[0] ?? null;
}

export function compareCheckpointRecency(left: SprintCloseCheckpointV1, right: SprintCloseCheckpointV1): number {
  return left.identity.sprintN - right.identity.sprintN
    || left.createdAt.localeCompare(right.createdAt)
    || left.checkpointId.localeCompare(right.checkpointId);
}


function parseCloseSprintArgs(args: string[]): CloseSprintArgs {
  let scope: string | null = null;
  let outcome = 'shipped';
  let outcomeExplicit = false;
  let note: string | null = null;
  let summary: string | null = null;
  const recommendations: string[] = [];
  const learnings: string[] = [];
  let dryRun = false;
  let yes = false;
  let help = false;

  const takeValue = (arg: string, i: number): [string, number] => {
    const inline = arg.indexOf('=');
    if (inline !== -1) return [arg.slice(inline + 1), i];
    const value = args[i + 1];
    if (value === undefined || value.startsWith('--')) throw new KyroCoreError('INVALID_INPUT', `${arg} requires a value`);
    return [value, i + 1];
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '--yes' || arg === '-y' || arg === '--confirm') yes = true;
    else if (arg === '--help' || arg === '-h') help = true;
    else if (arg === '--kyro-scope' || arg.startsWith('--kyro-scope=')) [scope, i] = takeValue(arg, i);
    else if (arg === '--outcome' || arg.startsWith('--outcome=')) {
      [outcome, i] = takeValue(arg, i);
      outcomeExplicit = true;
    }
    else if (arg === '--note' || arg.startsWith('--note=')) [note, i] = takeValue(arg, i);
    else if (arg === '--summary' || arg.startsWith('--summary=')) [summary, i] = takeValue(arg, i);
    else if (arg === '--recommendation' || arg.startsWith('--recommendation=')) {
      const [value, next] = takeValue(arg, i);
      recommendations.push(value);
      i = next;
    } else if (arg === '--learning' || arg.startsWith('--learning=')) {
      const [value, next] = takeValue(arg, i);
      learnings.push(value);
      i = next;
    } else throw new KyroCoreError('INVALID_INPUT', `Unknown option: ${arg}`);
  }

  return { scope, outcome, outcomeExplicit, note, summary, recommendations, learnings, dryRun, yes, help };
}

function printCloseSprintHelp(): void {
  console.log(`kyro close-sprint — deterministic, lossless scope close

The tool publishes a versioned full-scope checkpoint BEFORE changing live state,
preserves the legacy ActiveSprint snapshot, and safely resumes matching retries.

Usage:
  kyro close-sprint [--kyro-scope <scope>] [options]

Options:
  --kyro-scope <scope>     Scope to close (defaults to the active/only scope)
  --outcome <text>         Sprint outcome. Default shipped when every task is done+pass;
                           derived partial when any task is disposed. shipped/completed
                           are refused for disposed work.
  --note <text>            handoff.note for the next session
  --summary <text>         previousSprint summary (defaults to the sprint objective)
  --recommendation <text>  Recommendation for the next sprint (repeatable)
  --learning <text>        Learning to record in the narrative (repeatable)
  --dry-run                Show the plan without writing
  -y, --yes, --confirm     Skip confirmation
  -h, --help               Show this help

Run the narrative/conventions/debt work in the close-sprint mode first; this
command owns the durable checkpoint transaction and activeSprint clear.`);
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input, output });
  try {
    const answer = (await rl.question(question)).trim().toLowerCase();
    return answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}
