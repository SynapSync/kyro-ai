import { KyroCoreError } from './errors';
import type { Debt, SprintFile } from '../types';

export const DEBT_CHANGE_ACTIONS = ['add', 'start', 'resolve', 'defer', 'escalate', 'reconcile'] as const;
export type DebtChangeAction = (typeof DEBT_CHANGE_ACTIONS)[number];
const RANK: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };

export function nextDebtId(debt: readonly Debt[]): string {
  return `debt-${Math.max(0, ...debt.map((item) => Number(/^debt-(\d+)$/.exec(item.id)?.[1] ?? 0))) + 1}`;
}

export function debtOrigin(sprint: SprintFile): number {
  return sprint.activeSprint?.n ?? Math.max(1, ...sprint.ledger.map((entry) => entry.n));
}

/** Shared closed transition contract for CLI writes and historical replay. */
export function applyDebtChange(sprint: SprintFile, action: DebtChangeAction, after: Debt): Debt[] {
  const debt = sprint.debt;
  const index = debt.findIndex((item) => item.id === after.id);
  const invalid = (message: string): never => { throw new KyroCoreError('INVALID_INPUT', message); };
  if (action === 'add') {
    if (index !== -1 || after.id !== nextDebtId(debt) || after.origin !== debtOrigin(sprint) || after.status !== 'open') {
      return invalid('Debt add must append the next unused id, with the current origin and open status.');
    }
    return [...debt, { ...after }];
  }
  const before = debt[index];
  if (!before) return invalid(`Debt not found: ${after.id}`);
  for (const key of ['id', 'title', 'origin'] as const) {
    if (before[key] !== after[key]) return invalid(`Debt ${action} cannot change ${key}.`);
  }
  const expected: Debt = { ...before };
  switch (action) {
    case 'start':
      if (before.status === 'resolved') return invalid('Resolved debt cannot be restarted.');
      expected.status = 'in_progress';
      break;
    case 'resolve':
      expected.status = 'resolved';
      expected.note = after.note;
      break;
    case 'defer':
      if (after.targetSprint === null || after.note.trim() === '') return invalid('Deferring debt requires a target sprint and a concrete reason.');
      expected.status = 'deferred';
      expected.targetSprint = after.targetSprint;
      expected.note = after.note;
      break;
    case 'escalate':
      if (RANK[after.priority] <= RANK[before.priority]) return invalid('Debt escalation must raise priority.');
      expected.priority = after.priority;
      break;
    case 'reconcile':
      expected.status = after.status;
      expected.priority = after.priority;
      expected.targetSprint = after.targetSprint;
      expected.note = after.note;
      break;
  }
  if (Object.keys(expected).length !== Object.keys(after).length || Object.entries(expected).some(([key, value]) => value !== (after as unknown as Record<string, unknown>)[key])) return invalid(`Debt ${action} contains changes outside its transition contract.`);
  return debt.map((item, i) => i === index ? { ...after } : item);
}
