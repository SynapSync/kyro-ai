import { existsSync } from 'node:fs';
import { ARTIFACT_ROOT, KYRO_PROJECT_ROOT } from '../constants';
import { readJsonSafely } from '../artifacts/json';
import { sprintJsonPath } from '../artifacts/paths';
import { asSprintFile } from '../artifacts/schema';
import { formatScopeAuthor } from '../core/actor';
import { resolveManagedPath } from '../fs';
import { readProjectState, updateProjectStateLayers } from '../state';
import { KyroCoreError } from '../core/errors';
import { evaluateGuard } from '../core/policy';
import { emitBlockedReason, emitGateApproved } from '../core/trace';
import { emitToolCommandRun } from '../core/trace';
import { inspectScope, inspectSprintCloseCheckpoints } from './artifact-doctor';
import { listScopeNames } from '../artifacts/scopes';
import type { KyroProjectState } from '../types';
import {
  applyScopeRetirement,
  buildScopeRetirementPreparation,
  readScopeRetirementCheckpoint,
  type ScopeRetirementRequest,
} from '../checkpoints/scope-retirement';

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
  if (subcommand === 'retire') {
    const parsed = parseRetireArgs(args.slice(1));
    if (parsed.help) {
      printScopeRetireHelp();
      return;
    }
    runScopeRetire(parsed);
    return;
  }
  throw new KyroCoreError('UNKNOWN_SUBCOMMAND', `Unknown scope subcommand: ${subcommand}.`, 'Run kyro scope --help.');
}

function listScopes(): void {
  const state = readProjectState();
  const scopes = listScopeNames();
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
  if (failed) process.exit(1);
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
  const scopes = [...state.scopes];
  let scopesChanged = false;
  if (!scopes.some((entry) => entry.id === scope)) {
    scopes.push({ id: scope, title: scope, status: 'active' });
    scopes.sort((a, b) => a.id.localeCompare(b.id));
    scopesChanged = true;
  }
  if (dryRun) {
    console.log(`Would set active Kyro scope to: ${scope}`);
    return;
  }
  emitGateApproved(scope, 'scope_set_active');
  // Layer-targeted: activeScope → local only; scopes registry → shared only when the entry was added.
  // Monolito-only workspaces migrate to layers on first personal write.
  if (scopesChanged) {
    updateProjectStateLayers({ scopes, activeScope: scope });
  } else {
    updateProjectStateLayers({ activeScope: scope });
  }
  console.log(`Active Kyro scope set to: ${scope}`);
}

function parseSetActiveArgs(args: string[]): { scope: string; yes: boolean; dryRun: boolean } {
  let scope = '';
  let yes = false;
  let dryRun = false;
  for (const arg of args) {
    if (arg === '--yes' || arg === '-y' || arg === '--confirm') yes = true;
    else if (arg === '--dry-run') dryRun = true;
    else if (!arg.startsWith('--') && !scope) scope = arg;
    else throw new KyroCoreError('INVALID_INPUT', `Unknown scope set-active option: ${arg}`);
  }
  return { scope, yes, dryRun };
}

function scopeExists(scope: string, state: KyroProjectState): boolean {
  if (state.scopes.some((entry) => entry.id === scope) || state.activeScope === scope) return true;
  return existsSync(resolveManagedPath(`${ARTIFACT_ROOT}/${scope}`));
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
    console.log(`Approval question: ¿Autorizas retirar el scope \`${args.scope}\` con este plan?`);
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

function parseRetireArgs(args: string[]): ScopeRetireArgs {
  let scope = '';
  let reason = '';
  let supersededBy: string | null = null;
  let digest: string | null = null;
  let yes = false;
  let dryRun = false;
  let help = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') help = true;
    else if (arg === '--yes' || arg === '-y') yes = true;
    else if (arg === '--dry-run') dryRun = true;
    else if (arg === '--kyro-scope') scope = requiredValue(args, ++index, arg);
    else if (arg === '--reason') reason = requiredValue(args, ++index, arg);
    else if (arg === '--superseded-by') supersededBy = requiredValue(args, ++index, arg);
    else if (arg === '--digest') digest = requiredValue(args, ++index, arg);
    else throw new KyroCoreError('INVALID_INPUT', `Unknown scope retire option: ${arg}`, 'Run kyro scope retire --help.');
  }
  if (!help && (!scope || !reason)) throw new KyroCoreError('INVALID_INPUT', 'Usage: kyro scope retire --kyro-scope <scope> --reason <reason> [--superseded-by <scope>] [--digest <sha256> --yes].');
  return { scope, reason, supersededBy, digest, yes, dryRun, help };
}

function requiredValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith('--')) throw new KyroCoreError('INVALID_INPUT', `${flag} requires a value.`);
  return value;
}

function printScopeRetireHelp(): void {
  console.log(`Usage:
  kyro scope retire --kyro-scope <scope> --reason <reason> [--superseded-by <scope>]
  kyro scope retire --kyro-scope <scope> --reason <reason> [--superseded-by <scope>] --digest <sha256> --yes

The first form is read-only preparation. The second applies only the exact reviewed digest with
explicit one-use human confirmation. Any state change requires a new preparation and approval.`);
}

function printScopeHelp(): void {
  console.log(`Usage:
  kyro scope list
  kyro scope inspect <scope>
  kyro scope set-active <scope> --yes|--confirm
  kyro scope retire --kyro-scope <scope> --reason <reason> [--superseded-by <scope>]
`);
}
