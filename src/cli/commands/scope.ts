import { existsSync, writeFileSync } from 'node:fs';
import { ARTIFACT_ROOT, KYRO_STATE_PATH } from '../constants';
import { readJsonSafely } from '../artifacts/json';
import { sprintJsonPath } from '../artifacts/paths';
import { asSprintFile } from '../artifacts/schema';
import { resolveManagedPath } from '../fs';
import { readProjectState } from '../state';
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
    if (!maybeScope) throw new Error('Usage: kyro scope inspect <scope>');
    inspectScopeCommand(maybeScope);
    return;
  }
  if (subcommand === 'set-active') {
    if (!maybeScope) throw new Error('Usage: kyro scope set-active <scope>');
    setActiveScope(maybeScope);
    return;
  }
  throw new Error(`Unknown scope subcommand: ${subcommand}. Run kyro scope --help.`);
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
    console.log(`Active sprint: ${sprint.activeSprint ? `${sprint.activeSprint.n} — ${sprint.activeSprint.slug}` : 'none'}`);
    console.log(`Next action: ${sprint.handoff.nextAction}`);
    console.log(`Next task: ${sprint.handoff.nextTaskId ?? 'none'}`);
    console.log(`Open debt: ${sprint.debt.filter((d) => d.status === 'open' || d.status === 'in_progress').length}`);
  } else {
    console.log('sprint.json: missing or invalid (run /kyro:forge INIT to create it)');
  }
  console.log('');
}

function setActiveScope(scope: string): void {
  const state = readProjectState();
  if (!state) throw new Error(`Kyro project state not found: ${KYRO_STATE_PATH}`);
  if (!scopeExists(scope, state)) throw new Error(`Scope not found: ${scope}`);
  const scopes = [...state.scopes];
  if (!scopes.some((entry) => entry.id === scope)) {
    scopes.push({ id: scope, title: scope, status: 'active' });
  }
  scopes.sort((a, b) => a.id.localeCompare(b.id));
  const nextState: KyroProjectState = { ...state, scopes, activeScope: scope };
  writeFileSync(resolveManagedPath(KYRO_STATE_PATH), `${JSON.stringify(nextState, null, 2)}\n`, 'utf-8');
  console.log(`Active Kyro scope set to: ${scope}`);
}

function scopeExists(scope: string, state: KyroProjectState): boolean {
  if (state.scopes.some((entry) => entry.id === scope) || state.activeScope === scope) return true;
  return existsSync(resolveManagedPath(`${ARTIFACT_ROOT}/${scope}`));
}

function printScopeHelp(): void {
  console.log(`Usage:
  kyro scope list
  kyro scope inspect <scope>
  kyro scope set-active <scope>
`);
}
