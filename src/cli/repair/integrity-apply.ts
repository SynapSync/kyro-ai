import { existsSync, readdirSync } from 'node:fs';
import { ARTIFACT_ROOT } from '../constants';
import { resolveManagedPath } from '../fs';
import { readJsonSafely } from '../artifacts/json';
import { sprintJsonPath } from '../artifacts/paths';
import {
  canonicalJson,
  publishExclusive,
  sha256,
} from '../checkpoints/sprint-close';
import {
  CHECKPOINT_CANONICALIZATION_KIND,
  CHECKPOINT_CANONICALIZATION_SCHEMA_VERSION,
  canonicalizationChainIssues,
  canonicalizationRecordCommitment,
  canonicalizationRecordPath,
  checkpointRemediationsDir,
  listCanonicalizationCandidates,
  listCanonicalizationRecords,
  rebuildCanonicalCheckpointFromDisk,
  validateCanonicalizationRecord,
} from '../checkpoints/canonicalize';
import {
  REGISTRY_RECONCILIATION_KIND,
  REGISTRY_RECONCILIATION_SCHEMA_VERSION,
  classifyRegistry,
  REGISTRY_CLASS,
  registryReconciliationPath,
  registryReconciliationsDir,
} from '../project/reconcile';
import { type RemediationOperation } from '../remediation/protocol';
import {
  latestValidCloseCheckpoint,
  latestValidCloseCheckpointEntry,
  planExplanationRemediation,
  remediationBatchAlreadyApplied,
  REMEDIATION_TRANSACTION_STATUS,
  resolveRemediationReplayState,
} from '../remediation/plan';
import { commitRemediationPlanUnlocked } from '../remediation/transaction';
import { KyroCoreError } from '../core/errors';
import { readProjectState, updateProjectStateLayersUnlocked } from '../state';
import { withStateWriterLock } from '../pipeline/state-writer-lock';
import { readPackageVersion } from '../help';
import {
  INTEGRITY_REPAIR_KIND,
  INTEGRITY_REPAIR_SCHEMA_VERSION,
  integrityRepairsDir,
  prepareIntegrityPlan,
  validateIntegrityWarrant,
  type IntegrityOperation,
  type IntegrityWarrant,
} from './integrity-plan';
import type { KyroScopeEntry, SprintFile } from '../types';

export interface IntegrityApplyResult {
  digest: string;
  resumed: boolean;
  applied: string[];
  skipped: string[];
}

export function resolveIntegrityTraceScope(
  approvedDigest: string,
  options: { kyroScope?: string | null; reason?: string },
): string {
  assertIntegrityDigest(approvedDigest);
  const warrant = findWarrantByDigest(approvedDigest);
  const targets = warrant?.targets ?? prepareIntegrityPlan({ kyroScope: options.kyroScope, reason: options.reason }).targets;
  return options.kyroScope
    ?? targets.live[0]?.scope
    ?? targets.register[0]
    ?? targets.unregister[0]
    ?? targets.canonicalize[0]?.scope
    ?? 'project';
}

export function applyIntegrityPlan(approvedDigest: string, options: { kyroScope?: string | null; reason?: string; now?: string; actor?: string }): IntegrityApplyResult {
  assertIntegrityDigest(approvedDigest);
  return withStateWriterLock(() => applyIntegrityPlanUnlocked(approvedDigest, options));
}

function applyIntegrityPlanUnlocked(
  approvedDigest: string,
  options: { kyroScope?: string | null; reason?: string; now?: string; actor?: string },
): IntegrityApplyResult {
  const existingWarrant = findWarrantByDigest(approvedDigest);
  const actor = options.actor ?? 'operator';
  const now = options.now ?? new Date().toISOString();
  let operations: IntegrityOperation[];
  let resumed = false;
  let digest = approvedDigest;

  if (existingWarrant) {
    operations = existingWarrant.operations;
    resumed = true;
    digest = existingWarrant.digest;
  } else {
    const plan = prepareIntegrityPlan({ kyroScope: options.kyroScope, reason: options.reason });
    if (plan.digest !== approvedDigest) {
      throw new KyroCoreError(
        'DIVERGED',
        `Observed integrity plan digest ${plan.digest} does not match the approved digest ${approvedDigest}.`,
        'State changed after preparation. Run prepare again, review the new targets, and approve the new digest.',
      );
    }
    if (plan.blockers.length > 0) {
      const unsupported = plan.blockers.some((blocker) => blocker.code === 'unsupported');
      throw new KyroCoreError(
        unsupported ? 'CHECKPOINT_UNSUPPORTED_VERSION' : 'CHECKPOINT_CORRUPT',
        `Integrity plan ${plan.digest} has blocking findings and cannot be applied.`,
        plan.blockers.map((blocker) => `[${blocker.code ?? 'blocker'}] ${blocker.summary}`).join(' '),
      );
    }
    if (plan.operations.length === 0) {
      return { digest: plan.digest, resumed: false, applied: [], skipped: [] };
    }
    const warrantPath = nextIntegrityRepairPath();
    const warrant: IntegrityWarrant = {
      schemaVersion: INTEGRITY_REPAIR_SCHEMA_VERSION,
      kind: INTEGRITY_REPAIR_KIND,
      id: warrantIdFromPath(warrantPath),
      digest: plan.digest,
      targets: plan.targets,
      operations: plan.operations,
      beforeCommitments: plan.beforeCommitments,
      actor,
      kyroVersion: plan.kyroVersion,
      createdAt: now,
    };
    publishExclusive(warrantPath, `${JSON.stringify(warrant, null, 2)}\n`, 'integrity-repair warrant');
    operations = plan.operations;
    digest = plan.digest;
  }

  const applied: string[] = [];
  const skipped: string[] = [];
  const liveBatches = new Map<string, Array<Extract<IntegrityOperation, { kind: 'convention.append' | 'adr.append' | 'ledger.checkpoint.reanchor' }>>>();
  for (const operation of operations) {
    if (operation.kind === 'convention.append' || operation.kind === 'adr.append' || operation.kind === 'ledger.checkpoint.reanchor') {
      const batch = liveBatches.get(operation.scope) ?? [];
      batch.push(operation);
      liveBatches.set(operation.scope, batch);
      continue;
    }
    const label = operationLabel(operation);
    if (operation.kind === 'registry.unregister-orphan' ? applyUnregister(operation, actor, now)
      : operation.kind === 'registry.register-on-disk' ? applyRegister(operation)
        : applyCanonicalize(operation, actor, now)) {
      applied.push(label);
    } else skipped.push(label);
  }
  for (const [scope, batch] of liveBatches) {
    const label = `live ${scope}`;
    if (applyLiveRemediationBatch(scope, batch, actor, now)) applied.push(label);
    else skipped.push(label);
  }
  return { digest, resumed, applied, skipped };
}

function applyUnregister(operation: Extract<IntegrityOperation, { kind: 'registry.unregister-orphan' }>, actor: string, now: string): boolean {
  const root = resolveManagedPath(`${ARTIFACT_ROOT}/${operation.scope}`);
  if (existsSync(root)) {
    throw new KyroCoreError('DIVERGED', `Scope directory ${operation.scope} reappeared before apply.`, 'Re-run prepare. Unregister only proceeds when the directory is absent.');
  }
  const state = readProjectState();
  if (!state) throw new KyroCoreError('INVALID_PROJECT_STATE', 'Project state is missing.', 'Initialize the workspace before repairing integrity.');
  const present = state.scopes.some((entry) => entry.id === operation.scope);
  const evidenceId = nextSequentialId(registryReconciliationsDir(), 'reconciliation');
  const evidencePath = registryReconciliationPath(evidenceId);
  const alreadyEvidenced = listJson(registryReconciliationsDir()).some((value) => {
    const record = value as { retiredEntry?: { id?: string }; reason?: string };
    return record.retiredEntry?.id === operation.scope;
  });
  if (!present && alreadyEvidenced) return false;
  if (!present && !alreadyEvidenced) {
    // Effect applied, evidence missing: write evidence only.
  }
  const beforeDigest = sha256(state);
  const nextScopes = state.scopes.filter((entry) => entry.id !== operation.scope);
  const clearActive = (state.activeScope || '') === operation.scope;
  const afterState = { ...state, scopes: nextScopes, ...(clearActive ? { activeScope: '' } : {}) };
  const afterDigest = sha256(afterState);
  if (!alreadyEvidenced) {
    const evidence = {
      schemaVersion: REGISTRY_RECONCILIATION_SCHEMA_VERSION,
      kind: REGISTRY_RECONCILIATION_KIND,
      id: evidenceId,
      retiredEntry: operation.entry,
      beforeDigest,
      afterDigest,
      reason: operation.reason,
      actor,
      kyroVersion: readPackageVersion(),
      createdAt: now,
      previousChainHead: lastEvidenceHead(),
    };
    publishExclusive(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'registry reconciliation');
  }
  if (present || clearActive) {
    updateProjectStateLayersUnlocked({
      scopes: nextScopes,
      ...(clearActive ? { activeScope: '' } : {}),
    });
  }
  return present || !alreadyEvidenced;
}

function applyRegister(operation: Extract<IntegrityOperation, { kind: 'registry.register-on-disk' }>): boolean {
  const classified = classifyRegistry(operation.scope)[0];
  if (classified?.classification === REGISTRY_CLASS.IDENTITY_CONFLICT) {
    throw new KyroCoreError('DIVERGED', classified.detail, 'Identity conflicts cannot be registered automatically.');
  }
  const state = readProjectState();
  if (!state) throw new KyroCoreError('INVALID_PROJECT_STATE', 'Project state is missing.', 'Initialize the workspace before repairing integrity.');
  const existing = state.scopes.find((entry) => entry.id === operation.scope);
  if (existing && canonicalJson(existing) === canonicalJson(operation.entry)) return false;
  if (existing && existing.id === operation.entry.id && existing.title === operation.entry.title && existing.status === operation.entry.status) {
    return false;
  }
  if (existing && existing.id !== operation.entry.id) {
    throw new KyroCoreError('DIVERGED', `Registered identity for ${operation.scope} conflicts with the derived sprint.`, 'Do not overwrite a conflicting registry row.');
  }
  const scopes: KyroScopeEntry[] = existing
    ? state.scopes.map((entry) => (entry.id === operation.scope ? operation.entry : entry))
    : [...state.scopes, operation.entry].sort((left, right) => left.id.localeCompare(right.id));
  updateProjectStateLayersUnlocked({ scopes });
  return true;
}

function applyCanonicalize(operation: Extract<IntegrityOperation, { kind: 'checkpoint.canonicalize' }>, actor: string, now: string): boolean {
  const rebuilt = rebuildCanonicalCheckpointFromDisk(operation.originalPath);
  if (!rebuilt || rebuilt.originalSha256 !== operation.originalSha256) {
    throw new KyroCoreError(
      'DIVERGED',
      `Checkpoint ${operation.originalPath} is no longer the approved original bytes.`,
      'A byte change invalidates canonicalization. Restore the original file or prepare again.',
    );
  }
  const chainIssues = canonicalizationChainIssues(operation.scope);
  if (chainIssues.length > 0) {
    throw new KyroCoreError(
      'DIVERGED',
      `Canonicalization chain for ${operation.scope} is not valid.`,
      chainIssues.join('; '),
    );
  }
  const matches = listCanonicalizationCandidates(operation.scope).filter((candidate) => {
    const value = candidate.value as { originalPath?: unknown; originalSha256?: unknown } | null;
    return value?.originalPath === operation.originalPath && value.originalSha256 === operation.originalSha256;
  });
  if (matches.length > 1) {
    throw new KyroCoreError('DIVERGED', `Checkpoint ${operation.originalPath} has multiple canonicalization overlays.`, 'Do not append another overlay. Reconcile the duplicate evidence explicitly.');
  }
  if (matches.length === 1) {
    const issues = validateCanonicalizationRecord(matches[0].value, matches[0].path);
    if (issues.length > 0) {
      throw new KyroCoreError('DIVERGED', `Canonicalization overlay ${matches[0].path} is invalid.`, issues.join('; '));
    }
    return false;
  }
  const id = nextSequentialId(checkpointRemediationsDir(operation.scope), 'canonicalization');
  const path = canonicalizationRecordPath(operation.scope, id);
  const previous = listCanonicalizationRecords(operation.scope);
  const previousHead = previous.length > 0 ? canonicalizationRecordCommitment(previous[previous.length - 1]) : null;
  const record = {
    schemaVersion: CHECKPOINT_CANONICALIZATION_SCHEMA_VERSION,
    kind: CHECKPOINT_CANONICALIZATION_KIND,
    id,
    scope: operation.scope,
    sprintN: operation.sprintN,
    sprintSlug: operation.sprintSlug,
    originalPath: operation.originalPath,
    originalSha256: rebuilt.originalSha256,
    observedLedgerCommitment: rebuilt.observedLedgerCommitment,
    originalIntegrityIssues: rebuilt.originalIntegrityIssues,
    snapshotSha256: rebuilt.snapshotSha256,
    narrativeSha256: rebuilt.narrativeSha256,
    canonicalProjection: rebuilt.projection,
    canonicalCommitment: rebuilt.canonicalCommitment,
    previousChainHead: previousHead,
    reason: operation.reason,
    actor,
    kyroVersion: readPackageVersion(),
    createdAt: now,
    recordCommitment: '',
  };
  record.recordCommitment = canonicalizationRecordCommitment(record);
  publishExclusive(path, `${JSON.stringify(record, null, 2)}\n`, 'checkpoint canonicalization');
  const published = readJsonSafely(path);
  const publishedIssues = published.exists && !published.error
    ? validateCanonicalizationRecord(published.value, path)
    : [`${path}: ${published.error ?? 'missing after publish'}`];
  if (publishedIssues.length > 0) {
    throw new KyroCoreError('DIVERGED', `Published canonicalization overlay ${path} failed verification.`, publishedIssues.join('; '));
  }
  return true;
}

function applyLiveRemediationBatch(
  scope: string,
  operations: Array<Extract<IntegrityOperation, { kind: 'convention.append' | 'adr.append' | 'ledger.checkpoint.reanchor' }>>,
  actor: string,
  now: string,
): boolean {
  const liveRead = readJsonSafely(sprintJsonPath(scope));
  if (!liveRead.exists || liveRead.error || !liveRead.value || typeof liveRead.value !== 'object') {
    throw new KyroCoreError('SCOPE_NOT_FOUND', `${sprintJsonPath(scope)} is missing or unreadable.`);
  }
  const live = liveRead.value as Record<string, unknown>;
  const closed = latestClosedState(scope);
  if (!closed) {
    throw new KyroCoreError('CHECKPOINT_CORRUPT', `Cannot explain live drift in ${scope} without an effective close checkpoint.`);
  }
  const remediationsOps = operations.map((operation, index) => ({
    ...toRemediationOperation(operation),
    id: `OP-${String(index + 1).padStart(3, '0')}`,
    resolves: [`I-${String(index + 1).padStart(3, '0')}`],
  }));
  const replay = resolveRemediationReplayState(scope, closed);
  if (replay.kind === 'broken') {
    throw new KyroCoreError('DIVERGED', `Cannot extend the remediation chain for ${scope}: ${replay.detail}.`, 'Restore or reconcile the existing chain before applying another integrity warrant.');
  }
  if (remediationBatchAlreadyApplied(scope, remediationsOps, live)) return false;
  const plan = planExplanationRemediation({
    scope,
    operations: remediationsOps,
    issues: operations.map((operation, index) => ({
      id: `I-${String(index + 1).padStart(3, '0')}`,
      code: operation.kind === 'convention.append' ? 'POST_CLOSE_CONVENTION' : operation.kind === 'adr.append' ? 'POST_CLOSE_ADR' : 'POST_CLOSE_LEDGER_REANCHOR',
      path: operation.kind === 'convention.append' ? 'conventions' : operation.kind === 'adr.append' ? 'adrs' : `ledger[${operation.sprintN}].checkpointSha256`,
      observedValueSha256: operation.kind === 'convention.append'
        ? operation.expectedConventionCollectionSha256
        : operation.kind === 'adr.append'
          ? operation.expectedAdrCollectionSha256
          : operation.expectedOldSha256,
    })),
    baseState: replay.state,
    liveState: live,
    now,
    kyroVersion: readPackageVersion(),
    reason: operations.map((operation) => operation.reason).join(' '),
    actor,
  });
  if (plan.transactionStatus === REMEDIATION_TRANSACTION_STATUS.APPLIED) return false;
  commitRemediationPlanUnlocked(plan);
  return true;
}

function latestClosedState(scope: string): SprintFile | null {
  const entry = latestValidCloseCheckpointEntry(scope);
  if (!entry) return latestValidCloseCheckpoint(scope)?.intendedAfterClose ?? null;
  const physical = readJsonSafely(entry.path);
  const after = physical.exists && !physical.error
    ? (physical.value as { intendedAfterClose?: SprintFile }).intendedAfterClose
    : null;
  return after ?? entry.checkpoint.intendedAfterClose;
}

function toRemediationOperation(operation: Extract<IntegrityOperation, { kind: 'convention.append' | 'adr.append' | 'ledger.checkpoint.reanchor' }>): RemediationOperation {
  if (operation.kind === 'convention.append') {
    return {
      id: 'OP-001',
      kind: 'convention.append',
      resolves: ['I-001'],
      expectedConventionCollectionSha256: operation.expectedConventionCollectionSha256,
      after: operation.after,
      reason: operation.reason,
    };
  }
  if (operation.kind === 'adr.append') {
    return {
      id: 'OP-001',
      kind: 'adr.append',
      resolves: ['I-001'],
      expectedAdrCollectionSha256: operation.expectedAdrCollectionSha256,
      after: operation.after,
      reason: operation.reason,
    };
  }
  return {
    id: 'OP-001',
    kind: 'ledger.checkpoint.reanchor',
    resolves: ['I-001'],
    sprintN: operation.sprintN,
    sprintSlug: operation.sprintSlug,
    expectedOldSha256: operation.expectedOldSha256,
    afterSha256: operation.afterSha256,
    reason: operation.reason,
  };
}

function operationLabel(operation: IntegrityOperation): string {
  if (operation.kind === 'registry.register-on-disk') return `register ${operation.scope}`;
  if (operation.kind === 'registry.unregister-orphan') return `unregister ${operation.scope}`;
  if (operation.kind === 'checkpoint.canonicalize') return `canonicalize ${operation.scope}#${operation.sprintN}`;
  if (operation.kind === 'convention.append') return `convention ${operation.scope}:${operation.after.id}`;
  if (operation.kind === 'adr.append') return `adr ${operation.scope}:${operation.after.id}`;
  return `reanchor ${operation.scope}#${operation.sprintN}`;
}

function nextIntegrityRepairPath(): string {
  return `${integrityRepairsDir()}/${nextSequentialId(integrityRepairsDir(), 'repair')}.json`;
}

function warrantIdFromPath(path: string): string {
  return path.split('/').pop()?.replace(/\.json$/, '') ?? 'repair-001';
}

function findWarrantByDigest(digest: string): IntegrityWarrant | null {
  const directory = integrityRepairsDir();
  try {
    const absolute = resolveManagedPath(directory);
    if (!existsSync(absolute)) return null;
    for (const file of readdirSync(absolute).filter((name) => name.endsWith('.json')).sort()) {
      const path = `${directory}/${file}`;
      const read = readJsonSafely(path);
      if (!read.exists || read.error) continue;
      if ((read.value as { digest?: string }).digest !== digest) continue;
      const issues = validateIntegrityWarrant(read.value, path);
      if (issues.length > 0) {
        throw new KyroCoreError(
          'DIVERGED',
          `Integrity warrant ${path} is present for digest ${digest} but is not valid.`,
          issues.join('; '),
        );
      }
      return read.value as IntegrityWarrant;
    }
  } catch (error) {
    if (error instanceof KyroCoreError) throw error;
  }
  return null;
}

function assertIntegrityDigest(digest: string): void {
  if (!/^[0-9a-f]{64}$/.test(digest)) {
    throw new KyroCoreError('DIVERGED', 'The supplied integrity digest is missing or malformed.', 'Run repair integrity prepare again and use its exact digest with --yes.');
  }
}

function lastEvidenceHead(): string | null {
  const records = listJson(registryReconciliationsDir());
  if (records.length === 0) return null;
  return sha256(records[records.length - 1]);
}

function nextSequentialId(directory: string, prefix: string): string {
  let max = 0;
  try {
    const absolute = resolveManagedPath(directory);
    if (existsSync(absolute)) {
      for (const file of readdirSync(absolute)) {
        const match = file.match(new RegExp(`^${prefix}-(\\d+)\\.json$`));
        if (match) max = Math.max(max, Number(match[1]));
      }
    }
  } catch {
    // first record
  }
  return `${prefix}-${String(max + 1).padStart(3, '0')}`;
}

function listJson(directory: string): unknown[] {
  try {
    const absolute = resolveManagedPath(directory);
    if (!existsSync(absolute)) return [];
    return readdirSync(absolute).filter((file) => file.endsWith('.json')).sort().map((file) => {
      const read = readJsonSafely(`${directory}/${file}`);
      return read.exists && !read.error ? read.value : null;
    }).filter((value) => value !== null);
  } catch {
    return [];
  }
}
