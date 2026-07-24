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
import { inspectScope } from './artifact-doctor';
import { listScopeNames } from '../artifacts/scopes';
import type { KyroProjectState } from '../types';

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
    console.log(`${marker} ${scope}`);
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

function printScopeHelp(): void {
  console.log(`Usage:
  kyro scope list
  kyro scope inspect <scope>
  kyro scope set-active <scope> --yes|--confirm
`);
}
