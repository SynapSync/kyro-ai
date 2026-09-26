import { existsSync, lstatSync, readdirSync } from 'node:fs';
import { ARTIFACT_ROOT, KYRO_STATE_PATH, LOCAL_STATE_PATH, PROJECT_STATE_PATH } from '../constants';
import { resolveManagedPath } from '../fs';
import { readJsonSafely } from '../artifacts/json';
import { sprintJsonPath } from '../artifacts/paths';
import { validateSprintFile } from '../artifacts/schema';
import { readScopeSprint } from '../artifacts/scopes';
import { resolveEffectiveCheckpointAtPath } from '../checkpoints/effective';
import { SCOPE_DIR_CLASS, classifyScopeDirectory } from '../artifacts/scopes';
import {
  CHECKPOINT_DISCOVERY_STATUS,
  inspectManagedRegularFile,
  MANAGED_PATH_LEVEL,
} from '../checkpoints/discovery';
import {
  canonicalJson,
  atomicReplace,
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
  validateRegistryReconciliationRecord,
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
import { scopeEntryFromDisk } from '../core/scope-entries';
import {
  SCOPE_LIFECYCLE_VERIFICATION_STATUS,
  completedScopeEntry,
  completedSprintState,
  verifyScopeLifecycleEvolution,
} from '../checkpoints/lifecycle-state';
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
  const freshPlan = warrant ? null : prepareIntegrityPlan({ kyroScope: options.kyroScope, reason: options.reason });
  const targets = warrant?.targets ?? freshPlan!.targets;
  return options.kyroScope
    ?? targets.live[0]?.scope
    ?? targets.register[0]
    ?? targets.unregister[0]
    ?? targets.canonicalize[0]?.scope
    ?? warrant?.operations.find((operation) => operation.kind === 'scope.completion.restore-from-legacy')?.scope
    ?? freshPlan?.operations.find((operation) => operation.kind === 'scope.completion.restore-from-legacy')?.scope
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
    assertNoLegacyRegistryOperations(operations);
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
    assertNoLegacyRegistryOperations(plan.operations);
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
    if (operation.kind === 'legacy-scope.discard' ? applyLegacyDiscard(operation, actor, now)
      : operation.kind === 'scope.completion.restore-from-legacy' ? applyLegacyCompletionRestore(operation)
      : operation.kind === 'registry.unregister-orphan' ? applyUnregister(operation, actor, now)
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

function assertNoLegacyRegistryOperations(operations: IntegrityOperation[]): void {
  if (!operations.some((operation) => operation.kind === 'registry.register-on-disk' || operation.kind === 'registry.unregister-orphan')) return;
  throw new KyroCoreError(
    'CHECKPOINT_UNSUPPORTED_VERSION',
    'This integrity plan contains registry operations that no longer write scope entries.',
    'Run kyro install --init-workspace --yes to migrate project state, then prepare a new integrity plan.',
  );
}

function applyLegacyDiscard(operation: Extract<IntegrityOperation, { kind: 'legacy-scope.discard' }>, actor: string, now: string): boolean {
  if (operation.sourcePath !== PROJECT_STATE_PATH && operation.sourcePath !== KYRO_STATE_PATH) {
    throw new KyroCoreError('DIVERGED', 'Legacy discard targets an unsupported state file.', 'Prepare a new integrity plan.');
  }
  const root = resolveManagedPath(`${ARTIFACT_ROOT}/${operation.scope}`);
  if (pathEntryExists(root)) {
    const directory = classifyScopeDirectory(operation.scope);
    if (directory.class !== SCOPE_DIR_CLASS.FOREIGN || directory.issues.length > 0) {
      throw new KyroCoreError('DIVERGED', `${operation.scope} now has Kyro artifacts (${directory.detail}).`, 'Restore or investigate the scope; discard is no longer safe.');
    }
  }
  const read = readJsonSafely(operation.sourcePath);
  if (!read.exists || read.error || !read.value || typeof read.value !== 'object' || Array.isArray(read.value)) {
    throw new KyroCoreError('DIVERGED', `${operation.sourcePath} is missing or unreadable.`, 'Prepare a new integrity plan.');
  }
  const source = read.value as Record<string, unknown>;
  const currentDigest = sha256(source);
  const alreadyApplied = currentDigest === operation.afterSha256;
  if (!alreadyApplied && currentDigest !== operation.sourceSha256) {
    throw new KyroCoreError('DIVERGED', `${operation.sourcePath} changed after approval.`, 'Prepare and approve a new digest.');
  }
  if (!alreadyApplied) {
    if (!Array.isArray(source.scopes)) throw new KyroCoreError('DIVERGED', `${operation.sourcePath}.scopes is missing.`, 'Prepare a new integrity plan.');
    const matching = source.scopes.filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry) && (entry as { id?: unknown }).id === operation.scope);
    if (matching.length !== 1 || canonicalJson(matching[0]) !== canonicalJson(operation.entry)) {
      throw new KyroCoreError('DIVERGED', `${operation.scope} no longer matches its approved legacy entry.`, 'Prepare and approve a new digest.');
    }
  }
  const records = validatedRegistryReconciliations();
  const matchingEvidence = records.filter((record) => {
    return record.sourcePath === operation.sourcePath
      && record.beforeDigest === operation.sourceSha256
      && record.afterDigest === operation.afterSha256
      && canonicalJson(record.retiredEntry) === canonicalJson(operation.entry);
  });
  if (matchingEvidence.length > 1) throw new KyroCoreError('DIVERGED', `Multiple reconciliation records claim the same discard for ${operation.scope}.`, 'Inspect the evidence chain before retrying.');
  const alreadyEvidenced = matchingEvidence.length === 1;
  if (!alreadyEvidenced) {
    const evidenceId = nextSequentialId(registryReconciliationsDir(), 'reconciliation');
    const evidence = {
      schemaVersion: REGISTRY_RECONCILIATION_SCHEMA_VERSION,
      kind: REGISTRY_RECONCILIATION_KIND,
      id: evidenceId,
      sourcePath: operation.sourcePath,
      retiredEntry: operation.entry,
      beforeDigest: operation.sourceSha256,
      afterDigest: operation.afterSha256,
      reason: operation.reason,
      actor,
      kyroVersion: readPackageVersion(),
      createdAt: now,
      previousChainHead: records.length > 0 ? sha256(records[records.length - 1]) : null,
    };
    publishExclusive(registryReconciliationPath(evidenceId), `${JSON.stringify(evidence, null, 2)}\n`, 'registry reconciliation');
  }
  if (!alreadyApplied) {
    const scopes = (source.scopes as unknown[]).filter((entry) => !(entry && typeof entry === 'object' && !Array.isArray(entry) && (entry as { id?: unknown }).id === operation.scope));
    const after = { ...source, scopes, ...(operation.sourcePath === KYRO_STATE_PATH && source.activeScope === operation.scope ? { activeScope: '' } : {}) };
    if (sha256(after) !== operation.afterSha256) throw new KyroCoreError('DIVERGED', 'The approved after-image no longer matches.', 'Prepare a new integrity plan.');
    atomicReplace(operation.sourcePath, `${JSON.stringify(after, null, 2)}\n`);
  }
  if (operation.sourcePath === PROJECT_STATE_PATH) {
    const local = readJsonSafely(LOCAL_STATE_PATH);
    if (local.exists && !local.error && local.value && typeof local.value === 'object' && !Array.isArray(local.value)) {
      const value = local.value as Record<string, unknown>;
      if (value.activeScope === operation.scope) atomicReplace(LOCAL_STATE_PATH, `${JSON.stringify({ ...value, activeScope: '' }, null, 2)}\n`);
    }
  }
  return !alreadyApplied || !alreadyEvidenced;
}

function validatedRegistryReconciliations(): Array<Record<string, unknown>> {
  const directory = registryReconciliationsDir();
  const absolute = resolveManagedPath(directory);
  if (!existsSync(absolute)) return [];
  const records: Array<Record<string, unknown>> = [];
  for (const file of readdirSync(absolute).filter((name) => name.endsWith('.json')).sort()) {
    const path = `${directory}/${file}`;
    const read = readJsonSafely(path);
    if (!read.exists || read.error) throw new KyroCoreError('DIVERGED', `Reconciliation evidence ${path} is missing or invalid.`, read.error ?? 'Restore the original record before retrying.');
    const issues = validateRegistryReconciliationRecord(read.value, path);
    if (issues.length > 0) throw new KyroCoreError('DIVERGED', `Reconciliation evidence ${path} is invalid.`, issues.join('; '));
    const record = read.value as Record<string, unknown>;
    const expectedPrevious = records.length > 0 ? sha256(records[records.length - 1]) : null;
    if (record.previousChainHead !== expectedPrevious) {
      throw new KyroCoreError('DIVERGED', `Reconciliation evidence chain diverged at ${path}.`, 'Restore the original record before retrying.');
    }
    records.push(record);
  }
  return records;
}

function applyLegacyCompletionRestore(
  operation: Extract<IntegrityOperation, { kind: 'scope.completion.restore-from-legacy' }>,
): boolean {
  if (operation.sourcePath !== PROJECT_STATE_PATH && operation.sourcePath !== KYRO_STATE_PATH) {
    throw new KyroCoreError('DIVERGED', 'Legacy completion source is not a supported state file.', 'Prepare a new integrity plan.');
  }
  const raw = readJsonSafely(operation.sourcePath);
  if (!raw.exists || raw.error || !raw.value || typeof raw.value !== 'object' || Array.isArray(raw.value)) {
    throw new KyroCoreError('DIVERGED', `${operation.sourcePath} is missing or unreadable.`, 'Prepare a new integrity plan.');
  }
  const source = raw.value as Record<string, unknown>;
  const entries = Array.isArray(source.scopes) ? source.scopes : [];
  const matches = entries.filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry)
    && (entry as { id?: unknown }).id === operation.scope);
  if (matches.length !== 1 || canonicalJson(matches[0]) !== canonicalJson(operation.sourceEntry)) {
    throw new KyroCoreError('DIVERGED', `${operation.scope} legacy completion changed after approval.`, 'Prepare and approve a new digest.');
  }
  const legacyEntry = matches[0] as Record<string, unknown>;
  if (canonicalJson(legacyEntry.completion) !== canonicalJson(operation.completion)) {
    throw new KyroCoreError('DIVERGED', `${operation.scope} legacy completion differs from the approved value.`, 'Prepare and approve a new digest.');
  }

  const read = readScopeSprint(operation.scope);
  if (read.kind !== 'valid') throw new KyroCoreError('DIVERGED', `${operation.scope}/sprint.json is missing or invalid.`, 'Restore the scope evidence before retrying.');
  const alreadyApplied = canonicalJson(read.sprint.completion) === canonicalJson(operation.completion);
  if (!alreadyApplied && sha256(read.sprint) !== operation.expectedSprintSha256) {
    throw new KyroCoreError('DIVERGED', `${operation.scope}/sprint.json changed after approval.`, 'Prepare and approve a new digest.');
  }
  const diskEntry = scopeEntryFromDisk(operation.scope);
  if (!diskEntry) throw new KyroCoreError('DIVERGED', `${operation.scope} no longer has a valid on-disk scope.`, 'Restore the scope evidence before retrying.');
  const candidateSprint = completedSprintState(read.sprint, operation.completion);
  const candidateEntry = completedScopeEntry(diskEntry, operation.completion);
  const shapeIssues = validateSprintFile(candidateSprint, `${operation.scope}/sprint.json`);
  if (shapeIssues.length > 0) throw new KyroCoreError('DIVERGED', 'Restored completion would produce an invalid sprint.', shapeIssues.join('; '));

  const checkpointRead = readJsonSafely(operation.checkpointPath);
  if (!checkpointRead.exists || checkpointRead.error || sha256(checkpointRead.value) !== operation.checkpointSha256) {
    throw new KyroCoreError('DIVERGED', `${operation.checkpointPath} changed after approval.`, 'Prepare and approve a new digest.');
  }
  const resolved = resolveEffectiveCheckpointAtPath(operation.scope, operation.checkpointPath);
  const after = resolved.checkpoint?.intendedAfterClose;
  const afterEntry = resolved.checkpoint?.projectScopeAfter;
  if (!after || !afterEntry) throw new KyroCoreError('DIVERGED', 'The approved checkpoint no longer has a usable after-image.', 'Restore the checkpoint before retrying.');
  const replay = verifyScopeLifecycleEvolution(after, afterEntry, candidateSprint, candidateEntry);
  if (replay.status !== SCOPE_LIFECYCLE_VERIFICATION_STATUS.LIFECYCLE_REPLAYED) {
    throw new KyroCoreError('DIVERGED', `Checkpoint no longer proves the legacy completion (${replay.reason}).`, 'Prepare a new plan or restore the incompatible evidence.');
  }
  if (alreadyApplied) return false;
  atomicReplace(sprintJsonPath(operation.scope), `${JSON.stringify(candidateSprint, null, 2)}\n`);
  return true;
}

function applyUnregister(operation: Extract<IntegrityOperation, { kind: 'registry.unregister-orphan' }>, actor: string, now: string): boolean {
  // Two things can make a registry entry an orphan: the directory is gone, or the directory is not
  // Kyro's at all (an earlier install/sync rehydrate registered a stray folder). Both are cleaned
  // the same way — by removing the registry entry and nothing else. Refusing whenever the path
  // merely exists would leave that contamination unfixable.
  const root = resolveManagedPath(`${ARTIFACT_ROOT}/${operation.scope}`);
  if (pathEntryExists(root)) {
    const directory = classifyScopeDirectory(operation.scope);
    if (directory.class !== SCOPE_DIR_CLASS.FOREIGN || directory.issues.length > 0) {
      throw new KyroCoreError('DIVERGED', `Scope directory ${operation.scope} reappeared before apply (${directory.detail}).`, 'Re-run prepare. Unregister only proceeds when the directory is absent or holds no Kyro artifacts.');
    }
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

function pathEntryExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    return true;
  }
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
  const inspection = inspectManagedRegularFile(operation.originalPath, MANAGED_PATH_LEVEL.CHECKPOINT);
  if (inspection.status !== CHECKPOINT_DISCOVERY_STATUS.SAFE) {
    throw new KyroCoreError(
      'DIVERGED',
      `Checkpoint ${operation.originalPath} is no longer a safe regular file (${inspection.detail}).`,
      'Restore the approved regular checkpoint file or prepare again.',
    );
  }
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
  if (operation.kind === 'legacy-scope.discard') return `discard ${operation.scope} from ${operation.sourcePath}`;
  if (operation.kind === 'scope.completion.restore-from-legacy') return `restore proven completion for ${operation.scope}`;
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
