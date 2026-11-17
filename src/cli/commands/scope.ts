import { KYRO_PROJECT_ROOT } from '../constants';
import { readJsonSafely } from '../artifacts/json';
import { loadScopeSprint } from '../artifacts/load-sprint';
import { archiveDir, scopeRoot, sprintJsonPath } from '../artifacts/paths';
import { asSprintFile, asTaskVerdict } from '../artifacts/schema';
import { formatScopeAuthor } from '../core/actor';
import { hasLayeredProjectStateOnDisk, readProjectState, updateProjectStateLayers } from '../state';
import { applyPlan } from '../fs';
import { sha256 } from '../core/digest';
import { setCliMachineResult } from '../core/cli-envelope';
import { buildRecordEvidencePlan, type RecordEvidenceArgs } from './record-evidence';
import { buildClosePlan } from './close-sprint';
import { applySprintCloseTransaction, readSprintCloseCheckpoint } from '../checkpoints/sprint-close';
import { undisposedCloseTasks } from '../core/status';
import { KyroCoreError } from '../core/errors';
import { dryRunFlag, flag, helpFlag, option, parseFlags, takeNonEmptyUnlessDashed, type FlagSpec } from '../core/flags';
import { evaluateGuard } from '../core/policy';
import { emitBlockedReason, emitGateApproved } from '../core/trace';
import { emitToolCommandRun } from '../core/trace';
import { collectFindings } from '../core/analysis';
import { inspectScope, inspectSprintCloseCheckpoints } from './artifact-doctor';
import type { KyroProjectState, SprintFile, Task } from '../types';
import {
  applyScopeRetirement,
  buildScopeRetirementPreparation,
  readScopeRetirementCheckpoint,
  scopeRetirementCheckpointPath,
  type ScopeRetirementRequest,
} from '../checkpoints/scope-retirement';
import {
  applyScopeReopen,
  buildScopeReopenPreparation,
  type ScopeReopenPreparation,
  type ScopeReopenRequest,
} from '../checkpoints/scope-reopen';
import {
  applyScopeCompletion,
  buildScopeCompletionPreparation,
  type ScopeCompletionPreparation,
  type ScopeCompletionRequest,
} from '../checkpoints/scope-completion';

interface ScopeRetireArgs extends ScopeRetirementRequest {
  digest: string | null;
  yes: boolean;
  dryRun: boolean;
  help: boolean;
}

export function runScopeCommand(args: string[]): void {
  const [subcommand = '', maybeScope = ''] = args;
  if (subcommand === '--help' || subcommand === '-h' || subcommand === 'help' || subcommand === '') {
    printScopeHelp();
    return;
  }
  if (subcommand === 'list') {
    listScopes();
    return;
  }
  if (subcommand === 'inspect') {
    if (!maybeScope) throw new KyroCoreError('INVALID_INPUT', 'Usage: kyro scope inspect <scope>');
    inspectScopeCommand(maybeScope);
    return;
  }
  if (subcommand === 'set-active') {
    const parsed = parseSetActiveArgs(args.slice(1));
    if (!parsed.scope) throw new KyroCoreError('INVALID_INPUT', 'Usage: kyro scope set-active <scope> [--yes] [--dry-run]');
    setActiveScope(parsed.scope, parsed.yes, parsed.dryRun);
    return;
  }
  if (subcommand === 'discard') {
    const parsed = parseDiscardArgs(args.slice(1));
    if (parsed.help) {
      printScopeDiscardHelp();
      return;
    }
    runScopeDiscard(parsed);
    return;
  }
  if (subcommand === 'retire') {
    const parsed = parseRetireArgs(args.slice(1));
    if (parsed.help) {
      printScopeRetireHelp();
      return;
    }
    runScopeRetire(parsed);
    return;
  }
  if (subcommand === 'complete') {
    const parsed = parseCompleteArgs(args.slice(1));
    if (parsed.help) {
      printScopeCompleteHelp();
      return;
    }
    runScopeComplete(parsed);
    return;
  }
  if (subcommand === 'reopen') {
    const parsed = parseReopenArgs(args.slice(1));
    if (parsed.help) {
      printScopeReopenHelp();
      return;
    }
    runScopeReopen(parsed);
    return;
  }
  throw new KyroCoreError('UNKNOWN_SUBCOMMAND', `Unknown scope subcommand: ${subcommand}.`, 'Run kyro scope --help.');
}

function listScopes(): void {
  const state = readProjectState();
  const scopes = state?.scopes.map((entry) => entry.id) ?? [];
  if (scopes.length === 0) {
    console.log('No Kyro scopes found.');
    return;
  }
  const active = state?.activeScope ?? null;
  for (const scope of scopes) {
    const marker = scope === active ? '*' : ' ';
    const status = state?.scopes.find((entry) => entry.id === scope)?.status ?? 'unregistered';
    console.log(`${marker} ${scope} [${status}]`);
  }
}

function inspectScopeCommand(scope: string): void {
  printScopeSummary(scope);
  const checks = inspectScope(scope);
  let failed = false;
  for (const check of checks) {
    const icon = check.status === 'pass' ? 'PASS' : check.status === 'warn' ? 'WARN' : 'FAIL';
    console.log(`[${icon}] ${check.name}: ${check.detail}`);
    if (check.remedy) console.log(`       Remedy: ${check.remedy}`);
    if (check.status === 'fail') failed = true;
  }
  if (failed) process.exitCode = 1;
}

function printScopeSummary(scope: string): void {
  const sprint = asSprintFile(readJsonSafely(sprintJsonPath(scope)).value);
  console.log(`Scope: ${scope}`);
  if (sprint) {
    console.log(`Status: ${sprint.status}`);
    if (sprint.author) {
      console.log(`Author: ${formatScopeAuthor(sprint.author)}`);
    }
    console.log(`Active sprint: ${sprint.activeSprint ? `${sprint.activeSprint.n} — ${sprint.activeSprint.slug}` : 'none'}`);
    console.log(`Next action: ${sprint.handoff.nextAction}`);
    console.log(`Next task: ${sprint.handoff.nextTaskId ?? 'none'}`);
    console.log(`Open debt: ${sprint.debt.filter((d) => d.status === 'open' || d.status === 'in_progress').length}`);
    printLifecycleHistory(sprint);
  } else {
    console.log('sprint.json: missing or invalid (run /kyro:forge INIT to create it)');
  }
  console.log('');
}

function setActiveScope(scope: string, yes: boolean, dryRun: boolean): void {
  const state = readProjectState();
  if (!state) {
    throw new KyroCoreError(
      'INVALID_INPUT',
      `Kyro project state not found under ${KYRO_PROJECT_ROOT}/`,
      'Run kyro install --init-workspace to create project state.',
    );
  }
  if (!scopeExists(scope, state)) throw new KyroCoreError('SCOPE_NOT_FOUND', `Scope not found: ${scope}`, 'Run kyro scope list to see available scopes.');
  if (state.scopes.find((entry) => entry.id === scope)?.status === 'retired') {
    throw new KyroCoreError('SCOPE_RETIRED', `Cannot activate retired scope: ${scope}.`, 'Inspect its retirement record or select a non-retired scope.');
  }
  const guard = evaluateGuard('scope_set_active', { surface: 'cli', scope, confirmed: yes });
  if (guard.kind === 'blocked') {
    emitBlockedReason(scope, guard.message, guard.code);
    throw new KyroCoreError(guard.code ?? 'POLICY_BLOCKED', guard.message, guard.remedy);
  }
  if (guard.kind === 'confirmation_required') {
    emitBlockedReason(scope, guard.message, guard.code);
    throw new KyroCoreError(guard.code ?? 'CONFIRMATION_REQUIRED', guard.message, guard.remedy);
  }
  if (dryRun) {
    console.log(`Would set active Kyro scope to: ${scope}`);
    return;
  }
  emitGateApproved(scope, 'scope_set_active');
  updateProjectStateLayers({ activeScope: scope });
  console.log(`Active Kyro scope set to: ${scope}`);
}

const scopeValue = takeNonEmptyUnlessDashed((flagName) => new KyroCoreError('INVALID_INPUT', `${flagName} requires a value.`));
const scopeOption = <S>(name: string, apply: (args: S, value: string) => void): FlagSpec<S> => option([name], scopeValue, apply);
const yesFlag = <S extends { yes: boolean }>(names: readonly string[]): FlagSpec<S> => flag<S>(names, (a) => { a.yes = true; });

function parseSetActiveArgs(args: string[]): { scope: string; yes: boolean; dryRun: boolean } {
  const parsed = { scope: '', yes: false, dryRun: false };
  return parseFlags([yesFlag<typeof parsed>(['--yes', '-y', '--confirm']), dryRunFlag<typeof parsed>()], args, parsed, (arg, state) => {
    if (!arg.startsWith('--') && !state.scope) state.scope = arg;
    else throw new KyroCoreError('INVALID_INPUT', `Unknown scope set-active option: ${arg}`);
  });
}

interface ScopeDiscardArgs {
  scope: string;
  reason: string;
  digest: string | null;
  yes: boolean;
  dryRun: boolean;
  help: boolean;
}

/**
 * One externally approved lifecycle operation.  It deliberately composes the existing evidence,
 * close, and retirement builders rather than introducing a second journal/WAL.  The close
 * checkpoint is the durable after-image for a interrupted cancellation/close stage; the existing
 * retirement checkpoint owns the final stage.
 */
function runScopeDiscard(args: ScopeDiscardArgs): void {
  if (args.dryRun && (args.digest || args.yes)) {
    throw new KyroCoreError('INVALID_INPUT', '--dry-run cannot be combined with --digest or --yes.', 'Preview with --dry-run, then apply the reviewed digest with --yes.');
  }
  const prepared = prepareScopeDiscard(args.scope, args.reason);
  printScopeDiscardPlan(prepared);
  if (args.dryRun) {
    setCliMachineResult('preview', { outcome: 'preview', scope: args.scope, digest: prepared.digest, resumed: prepared.resumed, affectedFiles: prepared.affectedFiles, requiresConfirmation: true, nextAction: 'done' });
    console.log('Dry run complete. No files changed.');
    return;
  }
  if (!args.digest || !args.yes) {
    throw new KyroCoreError('CONFIRMATION_REQUIRED', `Discarding scope "${args.scope}" requires the reviewed --digest and --yes.`, 'Run kyro scope discard --kyro-scope <scope> --reason "..." --dry-run, present the complete plan to a human, then rerun with its exact --digest and --yes.');
  }
  if (args.digest !== prepared.digest) {
    throw new KyroCoreError('DIVERGED', 'The supplied discard digest does not match the prepared lifecycle plan.', 'Prepare the discard again and apply only the newly reviewed digest with --yes.');
  }

  const closeNote = `scope-discard:${prepared.digest}`;
  const closeSummary = `Scope discarded: ${args.reason}`;
  let sprint = prepared.sprint;
  if (sprint.activeSprint) {
    for (const task of undisposedCloseTasks(sprint.activeSprint)) {
      const evidenceArgs: RecordEvidenceArgs = {
        taskId: task.id, scope: args.scope, summary: closeSummary,
        validation: ['scope discard lifecycle operation'], files: [], notes: null, by: 'scope discard',
        status: 'done', statusExplicit: false, dispositionKind: 'cancelled', reason: args.reason,
        targetRaw: null, dryRun: false, help: false,
      };
      const result = buildRecordEvidencePlan(args.scope, evidenceArgs);
      applyPlan(result.plan);
      sprint = result.sprint;
    }
  }

  // The close builder's immutable checkpoint freezes the cancellation after-image.  Retrying this
  // exact external digest replays the same frozen close inputs before continuing to retirement.
  if (!sprint.retirement) {
    const close = buildClosePlan(args.scope, {
      scope: args.scope, outcome: 'abandoned', outcomeExplicit: true, note: closeNote,
      summary: closeSummary, recommendations: [], learnings: [], dryRun: false, yes: true, help: false,
    });
    applySprintCloseTransaction(close.transaction);
  }

  const retirementRequest: ScopeRetirementRequest = { scope: args.scope, reason: closeSummary, supersededBy: null };
  const retirement = buildScopeRetirementPreparation(retirementRequest);
  applyScopeRetirement(retirementRequest, retirement.planDigest);
  setCliMachineResult('applied', { outcome: 'applied', scope: args.scope, digest: prepared.digest, resumed: prepared.resumed, affectedFiles: prepared.affectedFiles, requiresConfirmation: false, nextAction: 'done' });
  console.log(`Scope "${args.scope}" discarded. Sprint closed as abandoned and scope retired.`);
}

function prepareScopeDiscard(scope: string, reason: string): { sprint: SprintFile; digest: string; resumed: boolean; affectedFiles: string[] } {
  if (reason.trim() === '') throw new KyroCoreError('INVALID_INPUT', '--reason must be non-empty.', 'Explain why this live scope is being discarded.');
  const read = readJsonSafely(sprintJsonPath(scope));
  if (!read.exists || read.error) throw new KyroCoreError('SCOPE_NOT_FOUND', `Scope "${scope}" has no readable sprint.json.`, 'Select an existing scope and run kyro doctor --artifacts first.');
  const sprint = asSprintFile(read.value);
  if (!sprint) throw new KyroCoreError('INVALID_SPRINT_SHAPE', `Scope "${scope}" does not have a valid v4 sprint.json.`, 'Run kyro doctor --artifacts before discarding.');
  let digest: string;
  let resumed = false;
  if (sprint.activeSprint) {
    digest = sha256({ kind: 'scope-discard', schemaVersion: 4, scope, reason: reason.trim(), beforeSprint: sha256(sprint) });
  } else {
    const checkpointPath = sprint.ledger[sprint.ledger.length - 1]?.checkpoint;
    const checkpoint = checkpointPath ? readSprintCloseCheckpoint(`${scopeRoot(scope)}/${checkpointPath}`) : null;
    const note = checkpoint?.close.note ?? '';
    const match = /^scope-discard:([a-f0-9]{64})$/.exec(note);
    if (!match || checkpoint?.close.outcome !== 'abandoned' || checkpoint.close.summary !== `Scope discarded: ${reason}`) {
      throw new KyroCoreError('DIVERGED', `Scope "${scope}" is not at a resumable discard checkpoint.`, 'Prepare a discard only from an active scope, or retry with the exact original reason and digest.');
    }
    digest = match[1];
    resumed = true;
  }
  const affectedFiles = [sprintJsonPath(scope), `${archiveDir(scope)}/`, scopeRetirementCheckpointPath(scope)];
  if (!hasLayeredProjectStateOnDisk()) affectedFiles.push('.agents/kyro/project.json', '.agents/kyro/local.json', '.agents/kyro/kyro.json', '.agents/kyro/kyro.json.migrated');
  else affectedFiles.push('.agents/kyro/local.json');
  return { sprint, digest, resumed, affectedFiles };
}

const DISCARD_FLAGS: readonly FlagSpec<ScopeDiscardArgs>[] = [
  helpFlag(),
  yesFlag(['--yes', '-y']),
  dryRunFlag(),
  scopeOption('--kyro-scope', (a: ScopeDiscardArgs, v) => { a.scope = v; }),
  scopeOption('--reason', (a: ScopeDiscardArgs, v) => { a.reason = v; }),
  scopeOption('--digest', (a: ScopeDiscardArgs, v) => { a.digest = v; }),
];

function parseDiscardArgs(args: string[]): ScopeDiscardArgs {
  const parsed: ScopeDiscardArgs = { scope: '', reason: '', digest: null, yes: false, dryRun: false, help: false };
  parseFlags(DISCARD_FLAGS, args, parsed, (arg) => {
    throw new KyroCoreError('INVALID_INPUT', `Unknown scope discard option: ${arg}`, 'Run kyro scope discard --help.');
  });
  if (!parsed.help && (!parsed.scope || !parsed.reason)) throw new KyroCoreError('INVALID_INPUT', 'Usage: kyro scope discard --kyro-scope <scope> --reason <reason> [--dry-run | --digest <sha256> --yes].');
  return parsed;
}

function printScopeDiscardPlan(prepared: ReturnType<typeof prepareScopeDiscard>): void {
  console.log(`Scope discard ${prepared.resumed ? 'resume' : 'plan'}: ${prepared.sprint.scope}`);
  console.log('Stages: cancel undisposed active tasks → close-sprint --outcome abandoned → scope retire.');
  console.log('Archive policy: existing archives are immutable; no WAL is created.');
  console.log(`Plan digest: ${prepared.digest}`);
}

function printScopeDiscardHelp(): void {
  console.log(`Usage:\n  kyro scope discard --kyro-scope <scope> --reason <reason> --dry-run\n  kyro scope discard --kyro-scope <scope> --reason <reason> --digest <sha256> --yes\n\nPrepares one informed lifecycle operation that cancels undisposed work, closes the active sprint as abandoned, and retires the scope. Retry an interrupted operation with the same reason and digest.`);
}

function scopeExists(scope: string, state: KyroProjectState): boolean {
  return state.scopes.some((entry) => entry.id === scope);
}

function runScopeRetire(args: ScopeRetireArgs): void {
  if (args.dryRun && (args.digest || args.yes)) {
    throw new KyroCoreError('INVALID_INPUT', '--dry-run cannot be combined with --digest or --yes.', 'Prepare with no apply flags, then apply the reviewed digest with --yes.');
  }
  assertCloseCheckpointsHealthy(args.scope);
  const preparation = buildScopeRetirementPreparation(args);
  printRetirementPlan(preparation);
  if (!args.digest && !args.yes) {
    console.log('\nPreparation complete. No files changed. Human approval is required before apply.');
    console.log(`Approval question: ¿Autorizas retirar de forma irreversible el scope \`${args.scope}\` (obsoleto, reemplazado o descartado) con este plan?`);
    return;
  }
  if (!args.digest || !args.yes) {
    throw new KyroCoreError(
      'HUMAN_APPROVAL_REQUIRED',
      `Retiring scope "${args.scope}" requires both the reviewed --digest and explicit --yes confirmation.`,
      'Present the complete prepared plan to a human, ask the exact approval question, stop, and apply only after an affirmative response.',
    );
  }
  const guard = evaluateGuard('scope_retire', { surface: 'cli', scope: args.scope, confirmed: true });
  if (guard.kind === 'blocked') {
    emitBlockedReason(args.scope, guard.message, guard.code);
    throw new KyroCoreError(guard.code ?? 'POLICY_BLOCKED', guard.message, guard.remedy);
  }
  const applied = applyScopeRetirement(args, args.digest);
  emitGateApproved(args.scope, 'scope_retire');
  emitToolCommandRun(args.scope, 'cli', 'scope retire', { digest: args.digest, superseded: Boolean(args.supersededBy) });
  console.log(`\nScope "${args.scope}" retired. nextAction=done; checkpoint=${applied.checkpointPath}; resumed=${applied.resumed}.`);
  console.log('Existing archive/ files were not modified or removed.');
}

function assertCloseCheckpointsHealthy(scope: string): void {
  // A valid retirement checkpoint is the authority for an interrupted/idempotent apply. Its frozen
  // before-state was checkpoint-clean when prepared, so do not misread its partial after-state as
  // fresh sprint-close divergence and block the only safe resume path.
  if (readScopeRetirementCheckpoint(scope)) return;
  const unhealthy = inspectSprintCloseCheckpoints(scope).filter((check) => check.status !== 'pass');
  if (unhealthy.length === 0) return;
  const detail = unhealthy.map((check) => `${check.name}: ${check.detail}`).join('; ');
  const corruptCheckpoint = unhealthy.some((check) => /CORRUPT|UNSUPPORTED_VERSION/i.test(check.detail));
  throw new KyroCoreError(
    corruptCheckpoint ? 'CHECKPOINT_CORRUPT' : 'DIVERGED',
    `Cannot retire scope "${scope}": close checkpoint validation failed — ${detail}`,
    unhealthy[0]?.remedy ?? 'Run kyro doctor --artifacts for the scope and reconcile the checkpoint before preparing retirement.',
  );
}

function printRetirementPlan(preparation: ReturnType<typeof buildScopeRetirementPreparation>): void {
  console.log(`Scope retirement ${preparation.alreadyApplied ? 'record' : 'plan'}: ${preparation.request.scope}`);
  console.log(`Current status: ${preparation.currentStatus}`);
  console.log(`Reason: ${preparation.request.reason}`);
  console.log(`Superseded by: ${preparation.request.supersededBy ?? 'none'}`);
  console.log('Files affected:');
  for (const file of preparation.affectedFiles) console.log(`- ${file}`);
  console.log('Archive policy: archive/ is read-only and bound by fingerprint.');
  console.log('Validations:');
  for (const validation of preparation.validations) console.log(`- ${validation}`);
  console.log(`Plan digest: ${preparation.planDigest}`);
  if (preparation.alreadyApplied) console.log('State: already applied; an identical apply is a safe no-op.');
}

const RETIRE_FLAGS: readonly FlagSpec<ScopeRetireArgs>[] = [
  helpFlag(),
  yesFlag(['--yes', '-y']),
  dryRunFlag(),
  scopeOption('--kyro-scope', (a: ScopeRetireArgs, v) => { a.scope = v; }),
  scopeOption('--reason', (a: ScopeRetireArgs, v) => { a.reason = v; }),
  scopeOption('--superseded-by', (a: ScopeRetireArgs, v) => { a.supersededBy = v; }),
  scopeOption('--digest', (a: ScopeRetireArgs, v) => { a.digest = v; }),
];

function parseRetireArgs(args: string[]): ScopeRetireArgs {
  const parsed: ScopeRetireArgs = { scope: '', reason: '', supersededBy: null, digest: null, yes: false, dryRun: false, help: false };
  parseFlags(RETIRE_FLAGS, args, parsed, (arg) => {
    throw new KyroCoreError('INVALID_INPUT', `Unknown scope retire option: ${arg}`, 'Run kyro scope retire --help.');
  });
  if (!parsed.help && (!parsed.scope || !parsed.reason)) throw new KyroCoreError('INVALID_INPUT', 'Usage: kyro scope retire --kyro-scope <scope> --reason <reason> [--superseded-by <scope>] [--digest <sha256> --yes].');
  return parsed;
}

function printScopeRetireHelp(): void {
  console.log(`Usage:
  kyro scope retire --kyro-scope <scope> --reason <reason> [--superseded-by <scope>]
  kyro scope retire --kyro-scope <scope> --reason <reason> [--superseded-by <scope>] --digest <sha256> --yes

The first form is read-only preparation. The second applies only the exact reviewed digest with
explicit one-use human confirmation. Any state change requires a new preparation and approval.`);
}

interface ScopeCompleteArgs {
  scope: string;
  summary: string | null;
  yes: boolean;
  dryRun: boolean;
  help: boolean;
  acceptOpenDebt: boolean;
  reconcileDebt: boolean;
  reason: string | null;
  expectDigest: string | null;
}

/**
 * Explicit, tool-owned scope completion (T2.2). Distinct from retirement: completion is not a
 * human-gated terminal retire — it is a confirmed statement that an open scope's work is done and
 * the scope stays structurally non-retired. It writes only sprint.json completion metadata plus the
 * project-state scope entry, under one locked, revalidated, idempotent transaction (see
 * checkpoints/scope-completion.ts); it never touches archive/ or mints a retirement checkpoint.
 */
function runScopeComplete(args: ScopeCompleteArgs): void {
  if (args.dryRun && args.yes) {
    throw new KyroCoreError('INVALID_INPUT', '--dry-run and --yes are mutually exclusive.', 'Use --dry-run to preview, or --yes to confirm the write — not both.');
  }
  const request: ScopeCompletionRequest = { scope: args.scope, summary: args.summary, acceptOpenDebt: args.acceptOpenDebt, reconcileDebt: args.reconcileDebt, reason: args.reason, expectDigest: args.expectDigest };
  const preparation = buildScopeCompletionPreparation(request, assertScopeHealthyForCompletion);
  printCompletionPlan(preparation);
  if (args.dryRun) {
    console.log('Dry run complete. No files changed.');
    return;
  }
  const guard = evaluateGuard('scope_complete', { surface: 'cli', scope: args.scope, confirmed: args.yes });
  if (guard.kind !== 'allow') {
    emitBlockedReason(args.scope, guard.message, guard.code);
    throw new KyroCoreError(guard.code ?? 'CONFIRMATION_REQUIRED', guard.message, guard.remedy);
  }
  emitGateApproved(args.scope, 'scope_complete');
  emitToolCommandRun(args.scope, 'cli', 'scope complete', {});
  const result = applyScopeCompletion(request, assertScopeHealthyForCompletion);
  console.log(`\nScope "${args.scope}" completed. nextAction=done; resumed=${result.resumed}; retirement metadata untouched.`);
}

function printCompletionPlan(preparation: ScopeCompletionPreparation): void {
  console.log(`Scope completion plan: ${preparation.request.scope}`);
  console.log(`Current status: ${preparation.currentStatus}`);
  console.log(`Summary: ${preparation.normalizedSummary ?? 'none'}`);
  console.log('Files affected:');
  for (const file of preparation.affectedFiles) console.log(`- ${file}`);
  console.log('Validations:');
  for (const validation of preparation.validations) console.log(`- ${validation}`);
  console.log(`Request digest: ${preparation.requestDigest}`);
  console.log(`Plan digest: ${preparation.planDigest}`);
  if (preparation.request.acceptOpenDebt) console.log(`Accepted pending debt: ${preparation.acceptedDebt.map((item) => `${item.id} (${item.status}, ${item.priority})`).join(', ') || 'none'}; reason: ${preparation.request.reason}`);
  if (preparation.reconciliation) {
    console.log(`Debt reconciliation: ${preparation.reconciliation.remediationId}`);
    for (const operation of preparation.reconciliation.record.operations) console.log(`- ${JSON.stringify(operation)}`);
    console.log(`Apply this reviewed plan with --expect-digest ${preparation.planDigest} --yes.`);
  }
  console.log('\nCompletion is a confirmed statement that the scope work is done. It does NOT retire the scope and never rewrites archive/.');
  if (preparation.state === 'already-applied') console.log('State: already applied; an identical apply is a safe no-op.');
  else if (preparation.state === 'resumable') console.log('State: partially applied; an identical apply will resume and finish the registry update.');
}

function assertScopeHealthyForCompletion(scope: string, options?: { sprint?: SprintFile; acceptOpenDebt?: boolean; historicalOnly?: boolean }): void {
  const onDisk = loadScopeSprint(scope, { action: 'complete' });
  const sprint = options?.sprint ?? onDisk;
  const active = sprint.activeSprint;
  if (active) {
    throw new KyroCoreError('NOT_READY_TO_COMPLETE', `Cannot complete scope "${scope}": sprint ${active.n} (${active.slug}) is active.`, 'Close the active sprint first, or defer completion until no sprint is in progress.');
  }
  if (!options?.acceptOpenDebt && sprint.debt.some((d) => d.status === 'open' || d.status === 'in_progress')) {
    throw new KyroCoreError('NOT_READY_TO_COMPLETE', `Cannot complete scope "${scope}": open debt remains.`, 'Resolve or explicitly defer all debt before completing the scope.');
  }
  // Review debt: any done task without a pass verdict (read-only projection, same as status).
  for (const task of activeTasks(sprint)) {
    if (task.status === 'done' && asTaskVerdict(task.verdict)?.result !== 'pass') {
      throw new KyroCoreError('NOT_READY_TO_COMPLETE', `Cannot complete scope "${scope}": task ${task.id} is done without a pass verdict.`, 'Run kyro review for the pending task before completing the scope.');
    }
  }
  const principles = readProjectState()?.principles ?? [];
  const blocking = collectFindings(sprint, principles).filter((finding) => finding.severity === 'CRITICAL' || finding.severity === 'HIGH');
  if (blocking.length > 0) {
    const detail = blocking.map((finding) => finding.detail).join('; ');
    throw new KyroCoreError('BLOCKING_FINDINGS', `Cannot complete scope "${scope}": ${blocking.length} blocking analyze finding(s) remain — ${detail}`, 'Run kyro analyze, resolve CRITICAL/HIGH findings, then complete the scope.');
  }
  const unhealthy = inspectSprintCloseCheckpoints(scope, options?.historicalOnly).filter((check) => check.status !== 'pass');
  if (unhealthy.length > 0) {
    const detail = unhealthy.map((check) => `${check.name}: ${check.detail}`).join('; ');
    throw new KyroCoreError('DIVERGED', `Cannot complete scope "${scope}": artifact validation failed — ${detail}`, unhealthy[0]?.remedy ?? 'Run kyro doctor --artifacts for the scope and reconcile the divergence before completing.');
  }
}

function activeTasks(sprint: SprintFile): Task[] {
  const active = sprint.activeSprint;
  if (!active) return [];
  return active.phases.flatMap((phase) => phase.tasks).concat(active.emergentTasks);
}

const COMPLETE_FLAGS: readonly FlagSpec<ScopeCompleteArgs>[] = [
  helpFlag(),
  yesFlag(['--yes', '-y', '--confirm']),
  dryRunFlag(),
  scopeOption('--kyro-scope', (a: ScopeCompleteArgs, v) => { a.scope = v; }),
  scopeOption('--summary', (a: ScopeCompleteArgs, v) => { a.summary = v; }),
  flag(['--accept-open-debt'], (a: ScopeCompleteArgs) => { a.acceptOpenDebt = true; }),
  flag(['--reconcile-debt'], (a: ScopeCompleteArgs) => { a.reconcileDebt = true; }),
  scopeOption('--reason', (a: ScopeCompleteArgs, v) => { a.reason = v; }),
  scopeOption('--expect-digest', (a: ScopeCompleteArgs, v) => { a.expectDigest = v; }),
];

function parseCompleteArgs(args: string[]): ScopeCompleteArgs {
  const parsed: ScopeCompleteArgs = { scope: '', summary: null, yes: false, dryRun: false, help: false, acceptOpenDebt: false, reconcileDebt: false, reason: null, expectDigest: null };
  parseFlags(COMPLETE_FLAGS, args, parsed, (arg) => {
    throw new KyroCoreError('INVALID_INPUT', `Unknown scope complete option: ${arg}`, 'Run kyro scope complete --help.');
  });
  if (!parsed.help && !parsed.scope) throw new KyroCoreError('INVALID_INPUT', 'Usage: kyro scope complete --kyro-scope <scope> [--summary <text>] [--yes].');
  if (parsed.expectDigest && !/^[a-f0-9]{64}$/.test(parsed.expectDigest)) throw new KyroCoreError('INVALID_INPUT', '--expect-digest must be a SHA-256 digest.');
  return parsed;
}

function printScopeCompleteHelp(): void {
  console.log(`Usage:
  kyro scope complete --kyro-scope <scope> [--summary <text>] [--accept-open-debt] [--reconcile-debt] [--reason <text>] [--expect-digest <sha256>] [--dry-run | --yes]

Records explicit scope completion as a lifecycle fact distinct from retirement. Refuses active
sprints, open debt, pending review, blocking findings, and artifact divergence without writing.
--accept-open-debt explicitly accepts pending debt without changing it. --reconcile-debt records
authorized debt-only divergence. Either requires --reason; applying reconciliation also requires
--expect-digest from the --dry-run preview. Neither bypasses active work or historical integrity.
Completion never creates a retirement checkpoint and never rewrites archive/.`);
}

interface ScopeReopenArgs {
  scope: string;
  reason: string;
  yes: boolean;
  dryRun: boolean;
  help: boolean;
}

/**
 * Explicit, tool-owned scope reopen (T2.3). The lawful route from an explicitly completed scope back
 * into planning: it supersedes the live completion, preserves it in append-only history with the
 * reason, and hands off to `plan_sprint` so a later sprint needs no recovery or manual state edit.
 * Retirement stays terminal — this path refuses retired scopes and never touches archive/.
 */
function runScopeReopen(args: ScopeReopenArgs): void {
  if (args.dryRun && args.yes) {
    throw new KyroCoreError('INVALID_INPUT', '--dry-run and --yes are mutually exclusive.', 'Use --dry-run to preview, or --yes to confirm the write — not both.');
  }
  const request: ScopeReopenRequest = { scope: args.scope, reason: args.reason };
  const preparation = buildScopeReopenPreparation(request);
  printReopenPlan(preparation);
  if (args.dryRun) {
    console.log('Dry run complete. No files changed.');
    return;
  }
  const guard = evaluateGuard('scope_reopen', { surface: 'cli', scope: args.scope, confirmed: args.yes });
  if (guard.kind !== 'allow') {
    emitBlockedReason(args.scope, guard.message, guard.code);
    throw new KyroCoreError(guard.code ?? 'CONFIRMATION_REQUIRED', guard.message, guard.remedy);
  }
  emitGateApproved(args.scope, 'scope_reopen');
  emitToolCommandRun(args.scope, 'cli', 'scope reopen', {});
  const result = applyScopeReopen(request);
  console.log(`\nScope "${args.scope}" reopened. nextAction=plan_sprint; resumed=${result.resumed}; completion history preserved.`);
}

function printReopenPlan(preparation: ScopeReopenPreparation): void {
  console.log(`Scope reopen plan: ${preparation.request.scope}`);
  console.log(`Current status: ${preparation.currentStatus}`);
  console.log(`Reason: ${preparation.request.reason}`);
  console.log(`Superseding completion from: ${preparation.supersededCompletion.completedAt}`);
  console.log('Files affected:');
  for (const file of preparation.affectedFiles) console.log(`- ${file}`);
  console.log('Validations:');
  for (const validation of preparation.validations) console.log(`- ${validation}`);
  console.log(`Request digest: ${preparation.requestDigest}`);
  console.log('\nReopen returns the scope to planning. It is NOT a retirement reversal and never rewrites archive/.');
  if (preparation.state === 'already-applied') console.log('State: already applied; an identical apply is a safe no-op.');
  else if (preparation.state === 'resumable') console.log('State: partially applied; an identical apply will resume and finish the registry update.');
}

/** Completion and reopen are lifecycle facts a reader must still see after the scope is open again. */
function printLifecycleHistory(sprint: SprintFile): void {
  if (sprint.completion) {
    console.log(`Completed at: ${sprint.completion.completedAt}${sprint.completion.summary ? ` — ${sprint.completion.summary}` : ''}`);
    if (sprint.completion.debtAcceptance) console.log(`Accepted pending debt at completion: ${JSON.stringify(sprint.completion.debtAcceptance)}`);
  }
  for (const record of sprint.completionHistory ?? []) {
    console.log(`Reopened at: ${record.reopenedAt} (completed ${record.completion.completedAt}) — ${record.reason}`);
  }
}

const REOPEN_FLAGS: readonly FlagSpec<ScopeReopenArgs>[] = [
  helpFlag(),
  yesFlag(['--yes', '-y', '--confirm']),
  dryRunFlag(),
  scopeOption('--kyro-scope', (a: ScopeReopenArgs, v) => { a.scope = v; }),
  scopeOption('--reason', (a: ScopeReopenArgs, v) => { a.reason = v; }),
];

function parseReopenArgs(args: string[]): ScopeReopenArgs {
  const parsed: ScopeReopenArgs = { scope: '', reason: '', yes: false, dryRun: false, help: false };
  parseFlags(REOPEN_FLAGS, args, parsed, (arg) => {
    throw new KyroCoreError('INVALID_INPUT', `Unknown scope reopen option: ${arg}`, 'Run kyro scope reopen --help.');
  });
  if (!parsed.help && (!parsed.scope || !parsed.reason)) throw new KyroCoreError('INVALID_INPUT', 'Usage: kyro scope reopen --kyro-scope <scope> --reason <reason> [--yes].');
  return parsed;
}

function printScopeReopenHelp(): void {
  console.log(`Usage:
  kyro scope reopen --kyro-scope <scope> --reason <reason> [--yes]

Returns an explicitly completed, non-retired scope to planning so a later sprint can be planned
normally. The superseded completion is preserved in append-only history with this reason. Refuses
retired, active, malformed, and already-open scopes without writing, and never rewrites archive/.`);
}

function printScopeHelp(): void {
  console.log(`Usage:
  kyro scope list
  kyro scope inspect <scope>
  kyro scope set-active <scope> --yes|--confirm
  kyro scope complete --kyro-scope <scope> [--summary <text>] [--yes]
  kyro scope reopen --kyro-scope <scope> --reason <reason> [--yes]
  kyro scope discard --kyro-scope <scope> --reason <reason> [--dry-run | --digest <sha256> --yes]
  kyro scope retire --kyro-scope <scope> --reason <reason> [--superseded-by <scope>]
`);
}
