import { existsSync } from 'node:fs';
import { LOCAL_STATE_PATH, PROJECT_STATE_PATH } from '../constants';
import { applyPlan, printPlan, resolveManagedPath } from '../fs';
import { readJsonSafely } from '../artifacts/json';
import { scopeRoot, sprintJsonPath } from '../artifacts/paths';
import { asSprintFile, validateSprintFile } from '../artifacts/schema';
import {
  hasLayeredProjectStateOnDisk,
  readProjectState,
  sanitizeLocalForWrite,
  sanitizeSharedForWrite,
  splitMonolitoToLayers,
} from '../state';
import { deriveActiveSprintStatus, derivePhaseStatus, deriveScopeStatus } from '../core/status';
import type { ActiveSprint, CliOptions, OperationPlan, Phase } from '../types';
import { resolveScope } from '../core/scope-resolution';
import { KyroCoreError } from '../core/errors';
import { evaluateGuard } from '../core/policy';
import { emitBlockedReason, emitGateApproved, emitToolCommandRun } from '../core/trace';

/**
 * Repair: validate and normalize a scope's sprint.json (derived status fields + stable formatting).
 * Does NOT restore checkpoint after-images or reverse tool-owned post-close mutations (rules, debt, ADRs).
 * The sprint.json is the single source of truth for live scope state.
 */
export async function repair(options: CliOptions): Promise<void> {
  const scope = resolveScope(options.kyroScope);
  const plan = buildRepairPlan(scope);
  printPlan('Repair plan', plan);

  if (options.dryRun) {
    console.log('Dry run complete. No files changed.');
    return;
  }
  const guard = evaluateGuard('repair_scope', { surface: 'cli', scope, confirmed: options.yes === true });
  if (guard.kind === 'blocked') {
    emitBlockedReason(scope, guard.message, guard.code);
    throw new KyroCoreError(guard.code ?? 'POLICY_BLOCKED', guard.message, guard.remedy);
  }
  if (guard.kind === 'confirmation_required') {
    emitBlockedReason(scope, guard.message, guard.code);
    throw new KyroCoreError(guard.code ?? 'CONFIRMATION_REQUIRED', guard.message, guard.remedy);
  }
  emitGateApproved(scope, 'repair_scope');
  emitToolCommandRun(scope, 'cli', 'repair');
  applyPlan(plan);
  console.log(`sprint.json normalized for scope: ${scope}`);
}

export function buildRepairPlan(scope: string): OperationPlan[] {
  const root = scopeRoot(scope);
  if (!existsSync(resolveManagedPath(root))) {
    throw new KyroCoreError('SCOPE_NOT_FOUND', `Scope not found: ${scope}`, 'Run kyro scope list to see available scopes.');
  }
  const read = readJsonSafely(sprintJsonPath(scope));
  if (!read.exists) {
    throw new KyroCoreError('SCOPE_NOT_FOUND', `Cannot repair ${scope}: sprint.json not found.`, 'Run /kyro:forge (INIT) to create it.');
  }
  if (read.error) {
    throw new KyroCoreError('INVALID_JSON', `Cannot repair ${scope}: sprint.json is invalid JSON (${read.error}).`, 'Restore from an archive snapshot.');
  }
  // Lenient-first: normalize status on the raw parsed JSON BEFORE validating, so files whose only
  // drift is stale/legacy status (e.g. a phase left "executing" while its tasks are done) become
  // coherent and pass. Genuine shape drift unrelated to status still fails validation after the pass.
  const normalized = normalizeStatus(read.value);
  const issues = validateSprintFile(normalized, `${scope}/sprint.json`);
  if (issues.length > 0) {
    const detail = issues.map((i) => `${i.field} ${i.message}`).join('; ');
    throw new KyroCoreError('INVALID_SPRINT_SHAPE', `Cannot repair ${scope}: sprint.json has shape drift that needs manual review — ${detail}`, 'Fix the reported fields manually.');
  }
  const plan: OperationPlan[] = [{ action: 'write', path: sprintJsonPath(scope), content: `${JSON.stringify(normalized, null, 2)}\n` }];
  plan.push(...buildScopeStatusReconcilePlan(scope, normalized));
  return plan;
}

/**
 * Set phase.status and activeSprint.status to their derived values so status fields stop being orphans
 * the instruction layer forgot to update. Operates defensively on the raw parsed JSON (repair runs
 * before validation). Does not touch task/evidence/verdict content — only derived status fields.
 */
function normalizeStatus(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const clone = JSON.parse(JSON.stringify(value)) as { activeSprint?: { phases?: unknown[]; emergentTasks?: unknown[]; status?: string } };
  const active = clone.activeSprint;
  const phases = active?.phases;
  if (Array.isArray(phases)) {
    for (const phase of phases) {
      if (phase && typeof phase === 'object' && Array.isArray((phase as { tasks?: unknown }).tasks)) {
        (phase as { status?: string }).status = derivePhaseStatus(phase as Phase);
      }
    }
  }
  if (active && typeof active === 'object' && Array.isArray(active.phases) && Array.isArray(active.emergentTasks)) {
    active.status = deriveActiveSprintStatus(active as ActiveSprint);
  }
  return clone;
}

/**
 * Reconcile the shared scopes[] status cache with the derived scope status.
 * Writes layered project files (never dumps full effective state to monolito kyro.json).
 */
function buildScopeStatusReconcilePlan(scope: string, normalizedSprint: unknown): OperationPlan[] {
  const state = readProjectState();
  if (!state) return [];
  const entry = state.scopes.find((s) => s.id === scope);
  if (!entry) return [];
  const sprint = asSprintFile(normalizedSprint);
  if (!sprint) return [];
  const derived = deriveScopeStatus(sprint, Boolean(sprint.activeSprint));
  if (entry.status === derived) return [];
  const updated = { ...state, scopes: state.scopes.map((s) => (s.id === scope ? { ...s, status: derived } : s)) };
  const { shared, local } = splitMonolitoToLayers(updated);
  const sharedContent = `${JSON.stringify(sanitizeSharedForWrite(shared), null, 2)}\n`;
  // When layers already exist, only the shared registry cache changes.
  if (hasLayeredProjectStateOnDisk()) {
    return [{ action: 'write', path: PROJECT_STATE_PATH, content: sharedContent }];
  }
  // Monolito-only (or missing layers): materialize both layers so dual-read prefers them.
  return [
    { action: 'write', path: PROJECT_STATE_PATH, content: sharedContent },
    { action: 'write', path: LOCAL_STATE_PATH, content: `${JSON.stringify(sanitizeLocalForWrite(local), null, 2)}\n` },
  ];
}
