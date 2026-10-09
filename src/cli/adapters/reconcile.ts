import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { AGENT, AGENT_SKILLS_ROOT } from '../constants';
import { resolveManagedPath } from '../fs';
import { KyroCoreError } from '../core/errors';
import { assertInstallableAgents } from '../options';
import { readLegacyInstalledAdapters } from '../state';
import type { Agent, MachineAdapterRegistry, OperationPlan, OperationProjectionResult } from '../types';
import { mergeMachineAdapters, readMachineAdapterRegistry } from './machine-registry';
import { getInstallableAdapters } from './registry';
import { upsertManagedBlock } from '../injectors/managed-block';
import { mergeJsonObjectContent } from '../injectors/json-merge';

export interface AdapterReconciliation {
  registry: MachineAdapterRegistry;
  desired: Agent[];
  outcomes: { agent: Agent; status: 'added' | 'refreshed' | 'unchanged' | 'skipped(disabled)' | 'not-detected'; projection: string }[];
}
const reconciliations = new WeakMap<OperationPlan[], AdapterReconciliation>();

/** Pure machine selection. Explicit selection enables a detected harness; absent homes stay untouched. */
export function reconcileAdapters(explicit: Agent[], integrations = false): AdapterReconciliation {
  assertInstallableAgents(explicit);
  const now = new Date().toISOString();
  const registry = mergeMachineAdapters(readMachineAdapterRegistry(), readLegacyInstalledAdapters(), [], now);
  const desired: Agent[] = [];
  const outcomes: AdapterReconciliation['outcomes'] = [];
  for (const adapter of getInstallableAdapters()) {
    let entry = registry.adapters.find((entry) => entry.agent === adapter.agent);
    const detected = adapter.agent === AGENT.STANDARD || adapter.detect({ homeDir: homedir(), envPath: process.env.PATH ?? '' }).installed;
    const selected = explicit.includes(adapter.agent);
    if (selected && !detected) throw new KyroCoreError('INVALID_INPUT', `Agent adapter not detected: ${adapter.agent}.`, `Install ${adapter.displayName} or create its config directory, then retry --agent ${adapter.agent}.`);
    const disabled = adapter.agent !== AGENT.STANDARD && entry?.state === 'disabled' && !selected;
    const wanted = !disabled && (detected || selected);
    const projection = adapter.agent === AGENT.STANDARD ? 'canonical' : adapter.agent === AGENT.CODEX ? 'canonical' : 'none';
    outcomes.push({ agent: adapter.agent, status: disabled ? 'skipped(disabled)' : !wanted ? 'not-detected' : entry ? 'unchanged' : 'added', projection });
    if (!wanted) continue;
    desired.push(adapter.agent);
    if (!entry) {
      entry = { agent: adapter.agent, state: 'enabled', projection: null, integrations: false, updatedAt: now };
      registry.adapters.push(entry);
    }
    if (selected || entry.state !== 'enabled') entry.updatedAt = now;
    entry.state = 'enabled';
    if (integrations && (explicit.length === 0 || selected)) entry.integrations = true;
  }
  registry.adapters.sort((a, b) => a.agent.localeCompare(b.agent));
  return { registry, desired, outcomes };
}

function textAt(path: string): string {
  try { return readFileSync(resolveManagedPath(path), 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''; throw error; }
}

/** Compare projection bytes/targets before apply; a version bump is observable even through links. */
export function recordReconciliation(plan: OperationPlan[], reconciliation: AdapterReconciliation, projections: Map<Agent, OperationPlan[]>): void {
  for (const outcome of reconciliation.outcomes) {
    const operations = projections.get(outcome.agent);
    if (!operations) continue;
    const links = operations.filter((operation) => operation.action === 'link');
    if (links.length) outcome.projection = process.env.KYRO_LINK_MODE === 'copy' || links.every((operation) => operation.projection === 'copy') ? 'copy' : 'link';
    let missing = false;
    let changed = false;
    for (const operation of operations) {
      try { lstatSync(resolveManagedPath(operation.path)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') missing = true; else throw error; }
      const current = textForOperation(operation);
      if (operation.action === 'write') changed ||= current !== operation.content;
      if (operation.action === 'upsert-block') changed ||= current !== upsertManagedBlock(current, operation.blockName!, operation.content!, operation.commentStyle);
      if (operation.action === 'merge-json') changed ||= current !== mergeJsonObjectContent(current, operation.content!);
      if (operation.action === 'link') {
        try {
          const isLink = lstatSync(resolveManagedPath(operation.path)).isSymbolicLink();
          changed ||= (process.env.KYRO_LINK_MODE === 'copy' || operation.projection === 'copy' ? isLink : !isLink)
            || (isLink && realpathSync(resolveManagedPath(operation.path)) !== resolveManagedPath(operation.source!));
        } catch { changed = true; }
        for (const canonical of plan.filter((item) => item.action === 'write' && item.path.startsWith(`${operation.source}/`))) {
          changed ||= textAt(canonical.path.replace(operation.source!, operation.path)) !== canonical.content;
        }
      }
    }
    if (outcome.status !== 'added') outcome.status = missing ? 'added' : changed ? 'refreshed' : 'unchanged';
  }
  reconciliations.set(plan, reconciliation);
}

function textForOperation(operation: OperationPlan): string {
  return operation.action === 'link' ? '' : textAt(operation.path);
}

export function printReconciliation(plan: OperationPlan[], results?: OperationProjectionResult[]): void {
  const reconciliation = reconciliations.get(plan);
  if (!reconciliation) return;
  for (const outcome of reconciliation.outcomes) {
    const adapterResults = results?.filter((result) => result.path.startsWith(outcome.agent === AGENT.CLAUDE ? '~/.claude/skills/' : outcome.agent === AGENT.OPENCODE ? '~/.config/opencode/skills/' : '\0'));
    if (adapterResults?.length) outcome.projection = [...new Set(adapterResults.map((result) => result.projection))].join('+');
    console.log(`Adapter ${outcome.agent}: ${outcome.status}; projection=${outcome.projection}`);
  }
  if (reconciliation.desired.length === 1 && reconciliation.desired[0] === AGENT.STANDARD) {
    console.log(`No harness detected; standard skills at ${AGENT_SKILLS_ROOT}`);
  }
}
