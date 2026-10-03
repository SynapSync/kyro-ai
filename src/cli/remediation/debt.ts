import { readJsonSafely } from '../artifacts/json';
import { canonicalJson } from '../core/digest';
import { applyDebtChange, type DebtChangeAction } from '../core/debt-transition';
import { KyroCoreError } from '../core/errors';
import { readPackageVersion } from '../help';
import { readProjectState } from '../state';
import type { Debt, SprintFile } from '../types';
import { canonicalRemediationState, debtCollectionDigest, remediationStateDigest } from './canonical-state';
import { latestValidCloseCheckpointEntry, planExplanationRemediation, resolveScopeEvolution, verifyLedgerCheckpoints, type RemediationPlan } from './plan';
import type { ChangeDebtOperation, RemediationManifestV1 } from './protocol';

export function debtOperation(sprint: SprintFile, action: DebtChangeAction, after: Debt, reason: string, index = 1): ChangeDebtOperation {
  return { id: `O${index}`, kind: 'debt.change', resolves: [`I${index}`], action, debtId: after.id, expectedDebtCollectionSha256: debtCollectionDigest(sprint.debt), after, reason };
}

export function debtManifest(scope: string, sprint: SprintFile, operation: ChangeDebtOperation): RemediationManifestV1 {
  return {
    schemaVersion: 5, kind: 'scope-remediation-manifest', scope,
    base: { stateSha256: remediationStateDigest(sprint), remediationHead: sprint.remediations?.at(-1)?.commitment ?? null },
    operations: [operation],
    issues: [{ id: operation.resolves[0], code: 'DEBT_TRANSITION', path: `debt[${operation.debtId}]`, observedValueSha256: operation.expectedDebtCollectionSha256 }],
    provenance: { reason: operation.reason, actor: process.env.KYRO_ACTOR ?? 'maker' },
  };
}

export function debtEvolution(scope: string, sprint: SprintFile, allowPreparedDebtWrite = false) {
  const latest = latestValidCloseCheckpointEntry(scope);
  if (!latest) return null;
  const physical = readJsonSafely(latest.path).value as { intendedAfterClose?: SprintFile } | null;
  const entry = readProjectState()?.scopes.find((item) => item.id === scope);
  return resolveScopeEvolution(scope, physical?.intendedAfterClose ?? latest.checkpoint.intendedAfterClose, latest.checkpoint.projectScopeAfter, sprint, entry, allowPreparedDebtWrite);
}

/** Explicitly explain only observed debt evolution; no edits to historical artifacts or invented actor history. */
export function planDebtRecovery(scope: string, live: SprintFile, reason: string): RemediationPlan | null {
  verifyLedgerCheckpoints(scope, live as unknown as Record<string, unknown>);
  const replay = debtEvolution(scope, live, true);
  if (!replay) throw new KyroCoreError('DIVERGED', 'Debt reconciliation requires a valid anchored close checkpoint.');
  if (replay.kind === 'broken') throw new KyroCoreError('DIVERGED', replay.detail);
  if (replay.matchesLive) return null;
  let baseline = replay.state;
  const operations: ChangeDebtOperation[] = [];
  if (live.debt.length < baseline.debt.length) throw new KyroCoreError('DIVERGED', 'Debt reconciliation cannot delete debt.');
  for (let index = 0; index < live.debt.length; index += 1) {
    const after = live.debt[index];
    const before = baseline.debt[index];
    if (before && canonicalJson(before) === canonicalJson(after)) continue;
    const action: DebtChangeAction = before ? 'reconcile' : 'add';
    if (before && before.id !== after.id) throw new KyroCoreError('DIVERGED', 'Debt reconciliation cannot reorder or rename debt.');
    const operation = debtOperation(baseline, action, after, reason, operations.length + 1);
    baseline = { ...baseline, debt: applyDebtChange(baseline, action, after) };
    operations.push(operation);
  }
  if (!operations.length || canonicalJson(canonicalRemediationState(baseline)) !== canonicalJson(canonicalRemediationState(live))) throw new KyroCoreError('DIVERGED', 'Changes outside debt remain unexplained; debt reconciliation cannot authorize them.');
  return planExplanationRemediation({
    scope, operations, baseState: replay.state as unknown as Record<string, unknown>, liveState: live as unknown as Record<string, unknown>,
    issues: operations.map((operation) => ({ id: operation.resolves[0], code: 'UNRECORDED_DEBT_CHANGE', path: `debt[${operation.debtId}]`, observedValueSha256: operation.expectedDebtCollectionSha256 })),
    reason, actor: process.env.KYRO_ACTOR ?? 'maker', now: new Date().toISOString(), kyroVersion: readPackageVersion(),
  });
}
