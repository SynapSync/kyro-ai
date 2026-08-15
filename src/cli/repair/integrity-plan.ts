import { existsSync, readdirSync } from 'node:fs';
import { KYRO_PROJECT_ROOT } from '../constants';
import { resolveManagedPath } from '../fs';
import { readJsonSafely } from '../artifacts/json';
import { archiveDir, sprintJsonPath } from '../artifacts/paths';
import { listScopeFolders } from '../artifacts/scopes';
import { asSprintFile } from '../artifacts/schema';
import { canonicalJson, sha256 } from '../checkpoints/sprint-close';
import { rebuildCanonicalCheckpointFromDisk } from '../checkpoints/canonicalize';
import { EFFECTIVE_CHECKPOINT_STATUS, resolveEffectiveCheckpointAtPath } from '../checkpoints/effective';
import { observedValueDigest } from '../remediation/canonical-state';
import { resolveRemediationReplayState } from '../remediation/plan';
import {
  classifyRegistry,
  REGISTRY_CLASS,
  type RegistryClassification,
} from '../project/reconcile';
import { readProjectState } from '../state';
import { readPackageVersion } from '../help';
import type { Convention, KyroScopeEntry, SprintFile } from '../types';

export const INTEGRITY_REPAIR_KIND = 'kyro.integrity-repair' as const;
export const INTEGRITY_REPAIR_SCHEMA_VERSION = 1 as const;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

interface IntegrityCanonicalizationTarget {
  scope: string;
  sprintN: number;
  sprintSlug: string;
}

interface IntegrityAdrTarget {
  id: string;
  title: string;
}

interface IntegrityLedgerReanchorTarget {
  sprintN: number;
  sprintSlug: string;
  from: string;
  to: string;
}

interface IntegrityLiveTarget {
  scope: string;
  conventions: Convention[];
  adrs: IntegrityAdrTarget[];
  ledgerReanchors: IntegrityLedgerReanchorTarget[];
}

interface IntegrityActiveScopeTarget {
  before: string | null;
  after: string | null;
}

interface IntegrityCheckpointCommitment {
  path: string;
  sha256: string;
}

interface IntegrityLiveStateCommitment {
  scope: string;
  sha256: string;
}

export interface IntegrityBeforeCommitments {
  projectSha256: string;
  checkpointFiles: IntegrityCheckpointCommitment[];
  liveStates: IntegrityLiveStateCommitment[];
}

export interface IntegrityTargets {
  register: string[];
  unregister: string[];
  canonicalize: IntegrityCanonicalizationTarget[];
  live: IntegrityLiveTarget[];
  activeScope: IntegrityActiveScopeTarget;
}

export type IntegrityOperation =
  | { kind: 'registry.register-on-disk'; scope: string; entry: KyroScopeEntry }
  | { kind: 'registry.unregister-orphan'; scope: string; entry: KyroScopeEntry; reason: string }
  | {
    kind: 'checkpoint.canonicalize';
    scope: string;
    sprintN: number;
    sprintSlug: string;
    originalPath: string;
    originalSha256: string;
    reason: string;
  }
  | { kind: 'convention.append'; scope: string; expectedConventionCollectionSha256: string; after: Convention; reason: string }
  | { kind: 'adr.append'; scope: string; expectedAdrCollectionSha256: string; after: NonNullable<SprintFile['adrs']>[number]; reason: string }
  | {
    kind: 'ledger.checkpoint.reanchor';
    scope: string;
    sprintN: number;
    sprintSlug: string;
    expectedOldSha256: string;
    afterSha256: string;
    reason: string;
  };

export type IntegrityFindingClass = 'register' | 'unregister' | 'canonicalize' | 'live' | 'activeScope' | 'blocker';
export type IntegrityBlockerCode = 'unsupported' | 'diverged' | 'irreconcilable' | 'identity-conflict' | 'unrecoverable';

export interface IntegrityFinding {
  class: IntegrityFindingClass;
  summary: string;
  code?: IntegrityBlockerCode;
}

export interface IntegrityPlan {
  schemaVersion: typeof INTEGRITY_REPAIR_SCHEMA_VERSION;
  kind: typeof INTEGRITY_REPAIR_KIND;
  targets: IntegrityTargets;
  findings: IntegrityFinding[];
  blockers: IntegrityFinding[];
  operations: IntegrityOperation[];
  beforeCommitments: IntegrityBeforeCommitments;
  digest: string;
  kyroVersion: string;
  classifications: RegistryClassification[];
}

export interface IntegrityWarrant {
  schemaVersion: typeof INTEGRITY_REPAIR_SCHEMA_VERSION;
  kind: typeof INTEGRITY_REPAIR_KIND;
  id: string;
  digest: string;
  targets: IntegrityTargets;
  operations: IntegrityOperation[];
  beforeCommitments: IntegrityBeforeCommitments;
  actor: string;
  kyroVersion: string;
  createdAt: string;
}

export interface IntegrityApprovalPayload {
  targets: IntegrityTargets;
  operations: IntegrityOperation[];
  beforeCommitments: IntegrityBeforeCommitments;
  kyroVersion: string;
}

export function integrityApprovalDigest(payload: IntegrityApprovalPayload): string {
  return sha256(canonicalJson({
    targets: payload.targets,
    operations: payload.operations,
    beforeCommitments: payload.beforeCommitments,
    kyroVersion: payload.kyroVersion,
  }));
}

export function validateIntegrityWarrant(value: unknown, path: string): string[] {
  const issues: string[] = [];
  const record = asRecord(value);
  if (!record) return [`${path}: must be an object`];
  requireExactKeys(record, ['schemaVersion', 'kind', 'id', 'digest', 'targets', 'operations', 'beforeCommitments', 'actor', 'kyroVersion', 'createdAt'], path, issues);
  if (record.schemaVersion !== INTEGRITY_REPAIR_SCHEMA_VERSION) issues.push(`${path}:schemaVersion must be 1`);
  if (record.kind !== INTEGRITY_REPAIR_KIND) issues.push(`${path}:kind must be ${INTEGRITY_REPAIR_KIND}`);
  for (const key of ['id', 'digest', 'actor', 'kyroVersion', 'createdAt'] as const) {
    if (typeof record[key] !== 'string' || record[key].length === 0) issues.push(`${path}:${key} must be a non-empty string`);
  }
  requireDigest(record.digest, `${path}:digest`, issues);
  validateIntegrityTargets(record.targets, `${path}:targets`, issues);
  validateIntegrityOperations(record.operations, `${path}:operations`, issues);
  validateBeforeCommitments(record.beforeCommitments, `${path}:beforeCommitments`, issues);
  if (issues.length === 0) {
    const warrant = record as unknown as IntegrityWarrant;
    const expected = integrityApprovalDigest(warrant);
    if (warrant.digest !== expected) {
      issues.push(`${path}:digest does not authenticate targets, operations, beforeCommitments and kyroVersion`);
    }
  }
  return issues;
}

export function integrityRepairsDir(): string {
  return `${KYRO_PROJECT_ROOT}/integrity-repairs`;
}

export function prepareIntegrityPlan(options: {
  kyroScope?: string | null;
  reason?: string;
}): IntegrityPlan {
  const requested = options.kyroScope ?? null;
  const classifications = classifyRegistry(requested);
  const operations: IntegrityOperation[] = [];
  const findings: IntegrityFinding[] = [];
  const blockers: IntegrityFinding[] = [];
  const targets: IntegrityTargets = {
    register: [],
    unregister: [],
    canonicalize: [],
    live: [],
    activeScope: { before: readProjectState()?.activeScope ?? null, after: readProjectState()?.activeScope ?? null },
  };

  const unregisterReason = options.reason?.trim() || 'registered scope directory is absent';
  for (const row of classifications) {
    if (row.classification === REGISTRY_CLASS.ON_DISK_UNREGISTERED && row.derivedEntry) {
      operations.push({ kind: 'registry.register-on-disk', scope: row.id, entry: row.derivedEntry });
      targets.register.push(row.id);
      findings.push({ class: 'register', summary: row.id });
    } else if (row.classification === REGISTRY_CLASS.REGISTERED_ORPHAN && row.registeredEntry) {
      operations.push({
        kind: 'registry.unregister-orphan',
        scope: row.id,
        entry: row.registeredEntry,
        reason: unregisterReason,
      });
      targets.unregister.push(row.id);
      findings.push({ class: 'unregister', summary: row.id });
    } else if (row.classification === REGISTRY_CLASS.IDENTITY_CONFLICT) {
      const blocker: IntegrityFinding = { class: 'blocker', code: 'identity-conflict', summary: `${row.id}: ${row.detail}` };
      blockers.push(blocker);
      findings.push(blocker);
    } else if (row.classification === REGISTRY_CLASS.IRRECONCILABLE) {
      const blocker: IntegrityFinding = { class: 'blocker', code: 'irreconcilable', summary: `${row.id}: ${row.detail}` };
      blockers.push(blocker);
      findings.push(blocker);
    }
  }

  const scopesForCheckpoints = requested
    ? [requested]
    : unique([
      ...classifications.filter((row) => row.classification === REGISTRY_CLASS.PRESENT_AND_REGISTERED || row.classification === REGISTRY_CLASS.ON_DISK_UNREGISTERED).map((row) => row.id),
      ...listArchiveScopes(),
    ]);

  const checkpointFiles: Array<{ path: string; sha256: string }> = [];
  for (const scope of scopesForCheckpoints) {
    for (const file of listCheckpointFiles(scope)) {
      const path = `${archiveDir(scope)}/${file}`;
      const resolved = resolveEffectiveCheckpointAtPath(scope, path);
      if (resolved.status === EFFECTIVE_CHECKPOINT_STATUS.VALID || resolved.status === EFFECTIVE_CHECKPOINT_STATUS.CANONICALIZED) continue;
      if (resolved.status === EFFECTIVE_CHECKPOINT_STATUS.UNSUPPORTED) {
        const blocker: IntegrityFinding = { class: 'blocker', code: 'unsupported', summary: `${path}: ${resolved.detail}` };
        blockers.push(blocker);
        findings.push(blocker);
        continue;
      }
      if (resolved.status === EFFECTIVE_CHECKPOINT_STATUS.DIVERGED) {
        const blocker: IntegrityFinding = { class: 'blocker', code: 'diverged', summary: `${path}: ${resolved.detail}` };
        blockers.push(blocker);
        findings.push(blocker);
        continue;
      }
      const rebuilt = rebuildCanonicalCheckpointFromDisk(path);
      if (!rebuilt) {
        const blocker: IntegrityFinding = { class: 'blocker', code: 'unrecoverable', summary: `${path}: ${resolved.detail}` };
        blockers.push(blocker);
        findings.push(blocker);
        continue;
      }
      const identity = rebuilt.projection.identity;
      operations.push({
        kind: 'checkpoint.canonicalize',
        scope: identity.scope,
        sprintN: identity.sprintN,
        sprintSlug: identity.sprintSlug,
        originalPath: path,
        originalSha256: rebuilt.originalSha256,
        reason: 'legacy checkpoint metadata is incompatible with the current integrity algorithm; identity and artifacts are reproducible',
      });
      targets.canonicalize.push({ scope: identity.scope, sprintN: identity.sprintN, sprintSlug: identity.sprintSlug });
      findings.push({ class: 'canonicalize', summary: `${identity.scope} / sprint ${identity.sprintN} / ${identity.sprintSlug}` });
      checkpointFiles.push({ path, sha256: rebuilt.originalSha256 });
    }
  }

  const liveStates: Array<{ scope: string; sha256: string }> = [];
  const liveScopes = requested ? [requested] : unique([...scopesForCheckpoints, ...listScopeFolders()]);
  for (const scope of liveScopes) {
    const live = readLiveSprint(scope);
    if (!live) continue;
    liveStates.push({ scope, sha256: sha256(live) });
    const latestPath = latestCheckpointPath(scope);
    if (!latestPath) continue;
    const resolved = resolveEffectiveCheckpointAtPath(scope, latestPath);
    const rebuilt = resolved.checkpoint ? null : rebuildCanonicalCheckpointFromDisk(latestPath);
    const after = resolved.checkpoint?.intendedAfterClose ?? rebuilt?.projection.intendedAfterClose;
    if (!after) continue;
    const physicalRead = readJsonSafely(latestPath);
    const physicalAfter = physicalRead.exists && !physicalRead.error
      ? (physicalRead.value as { intendedAfterClose?: SprintFile }).intendedAfterClose
      : null;
    const replay = resolveRemediationReplayState(scope, physicalAfter ?? after);
    if (replay.kind === 'broken') {
      const blocker: IntegrityFinding = {
        class: 'blocker',
        code: 'diverged',
        summary: `${scope}: ${replay.detail}`,
      };
      blockers.push(blocker);
      findings.push(blocker);
      continue;
    }
    const baseline = replay.state as unknown as SprintFile;
    const liveOps = planLiveEvolution(scope, live, baseline, { includeReanchor: Boolean(resolved.checkpoint) });
    for (const op of liveOps) operations.push(op);
    if (liveOps.length > 0) {
      targets.live.push({
        scope,
        conventions: liveOps.filter((op): op is Extract<IntegrityOperation, { kind: 'convention.append' }> => op.kind === 'convention.append').map((op) => op.after),
        adrs: liveOps.filter((op): op is Extract<IntegrityOperation, { kind: 'adr.append' }> => op.kind === 'adr.append').map((op) => ({ id: op.after.id, title: op.after.title })),
        ledgerReanchors: liveOps.filter((op): op is Extract<IntegrityOperation, { kind: 'ledger.checkpoint.reanchor' }> => op.kind === 'ledger.checkpoint.reanchor').map((op) => ({
          sprintN: op.sprintN,
          sprintSlug: op.sprintSlug,
          from: op.expectedOldSha256,
          to: op.afterSha256,
        })),
      });
      findings.push({ class: 'live', summary: scope });
    }
  }

  if (targets.unregister.includes(targets.activeScope.before ?? '')) {
    targets.activeScope.after = '';
    findings.push({ class: 'activeScope', summary: `clear activeScope ${targets.activeScope.before}` });
  }

  const project = readProjectState();
  const beforeCommitments = {
    projectSha256: project ? sha256(project) : sha256(null),
    checkpointFiles,
    liveStates,
  };
  const kyroVersion = readPackageVersion();
  const digest = integrityApprovalDigest({
    targets,
    operations,
    beforeCommitments,
    kyroVersion,
  });

  return {
    schemaVersion: INTEGRITY_REPAIR_SCHEMA_VERSION,
    kind: INTEGRITY_REPAIR_KIND,
    targets,
    findings,
    blockers,
    operations,
    beforeCommitments,
    digest,
    kyroVersion,
    classifications,
  };
}

function validateIntegrityTargets(value: unknown, path: string, issues: string[]): void {
  const targets = asRecord(value);
  if (!targets) {
    issues.push(`${path} must be an object`);
    return;
  }
  requireExactKeys(targets, ['register', 'unregister', 'canonicalize', 'live', 'activeScope'], path, issues);
  validateStringArray(targets.register, `${path}.register`, issues);
  validateStringArray(targets.unregister, `${path}.unregister`, issues);
  validateRecordArray(targets.canonicalize, `${path}.canonicalize`, issues, (entry, entryPath) => {
    requireExactKeys(entry, ['scope', 'sprintN', 'sprintSlug'], entryPath, issues);
    requireNonEmptyString(entry.scope, `${entryPath}.scope`, issues);
    requirePositiveInteger(entry.sprintN, `${entryPath}.sprintN`, issues);
    requireNonEmptyString(entry.sprintSlug, `${entryPath}.sprintSlug`, issues);
  });
  validateRecordArray(targets.live, `${path}.live`, issues, (entry, entryPath) => {
    requireExactKeys(entry, ['scope', 'conventions', 'adrs', 'ledgerReanchors'], entryPath, issues);
    requireNonEmptyString(entry.scope, `${entryPath}.scope`, issues);
    validateRecordArray(entry.conventions, `${entryPath}.conventions`, issues, (item, itemPath) => validateConvention(item, itemPath, issues));
    validateRecordArray(entry.adrs, `${entryPath}.adrs`, issues, (item, itemPath) => {
      requireExactKeys(item, ['id', 'title'], itemPath, issues);
      requireNonEmptyString(item.id, `${itemPath}.id`, issues);
      requireNonEmptyString(item.title, `${itemPath}.title`, issues);
    });
    validateRecordArray(entry.ledgerReanchors, `${entryPath}.ledgerReanchors`, issues, (item, itemPath) => {
      requireExactKeys(item, ['sprintN', 'sprintSlug', 'from', 'to'], itemPath, issues);
      requirePositiveInteger(item.sprintN, `${itemPath}.sprintN`, issues);
      requireNonEmptyString(item.sprintSlug, `${itemPath}.sprintSlug`, issues);
      requireDigest(item.from, `${itemPath}.from`, issues);
      requireDigest(item.to, `${itemPath}.to`, issues);
    });
  });
  const activeScope = asRecord(targets.activeScope);
  if (!activeScope) issues.push(`${path}.activeScope must be an object`);
  else {
    requireExactKeys(activeScope, ['before', 'after'], `${path}.activeScope`, issues);
    requireNullableString(activeScope.before, `${path}.activeScope.before`, issues);
    requireNullableString(activeScope.after, `${path}.activeScope.after`, issues);
  }
}

function validateIntegrityOperations(value: unknown, path: string, issues: string[]): void {
  validateRecordArray(value, path, issues, (operation, operationPath) => {
    requireNonEmptyString(operation.kind, `${operationPath}.kind`, issues);
    requireNonEmptyString(operation.scope, `${operationPath}.scope`, issues);
    switch (operation.kind) {
      case 'registry.register-on-disk':
        requireExactKeys(operation, ['kind', 'scope', 'entry'], operationPath, issues);
        validateScopeEntry(operation.entry, `${operationPath}.entry`, operation.scope, issues);
        return;
      case 'registry.unregister-orphan':
        requireExactKeys(operation, ['kind', 'scope', 'entry', 'reason'], operationPath, issues);
        validateScopeEntry(operation.entry, `${operationPath}.entry`, operation.scope, issues);
        requireNonEmptyString(operation.reason, `${operationPath}.reason`, issues);
        return;
      case 'checkpoint.canonicalize':
        requireExactKeys(operation, ['kind', 'scope', 'sprintN', 'sprintSlug', 'originalPath', 'originalSha256', 'reason'], operationPath, issues);
        requirePositiveInteger(operation.sprintN, `${operationPath}.sprintN`, issues);
        requireNonEmptyString(operation.sprintSlug, `${operationPath}.sprintSlug`, issues);
        requireNonEmptyString(operation.originalPath, `${operationPath}.originalPath`, issues);
        requireDigest(operation.originalSha256, `${operationPath}.originalSha256`, issues);
        requireNonEmptyString(operation.reason, `${operationPath}.reason`, issues);
        return;
      case 'convention.append':
        requireExactKeys(operation, ['kind', 'scope', 'expectedConventionCollectionSha256', 'after', 'reason'], operationPath, issues);
        requireDigest(operation.expectedConventionCollectionSha256, `${operationPath}.expectedConventionCollectionSha256`, issues);
        validateConvention(operation.after, `${operationPath}.after`, issues);
        requireNonEmptyString(operation.reason, `${operationPath}.reason`, issues);
        return;
      case 'adr.append':
        requireExactKeys(operation, ['kind', 'scope', 'expectedAdrCollectionSha256', 'after', 'reason'], operationPath, issues);
        requireDigest(operation.expectedAdrCollectionSha256, `${operationPath}.expectedAdrCollectionSha256`, issues);
        validateAdr(operation.after, `${operationPath}.after`, issues);
        requireNonEmptyString(operation.reason, `${operationPath}.reason`, issues);
        return;
      case 'ledger.checkpoint.reanchor':
        requireExactKeys(operation, ['kind', 'scope', 'sprintN', 'sprintSlug', 'expectedOldSha256', 'afterSha256', 'reason'], operationPath, issues);
        requirePositiveInteger(operation.sprintN, `${operationPath}.sprintN`, issues);
        requireNonEmptyString(operation.sprintSlug, `${operationPath}.sprintSlug`, issues);
        requireDigest(operation.expectedOldSha256, `${operationPath}.expectedOldSha256`, issues);
        requireDigest(operation.afterSha256, `${operationPath}.afterSha256`, issues);
        requireNonEmptyString(operation.reason, `${operationPath}.reason`, issues);
        return;
      default:
        issues.push(`${operationPath}.kind is unsupported`);
    }
  });
}

function validateBeforeCommitments(value: unknown, path: string, issues: string[]): void {
  const commitments = asRecord(value);
  if (!commitments) {
    issues.push(`${path} must be an object`);
    return;
  }
  requireExactKeys(commitments, ['projectSha256', 'checkpointFiles', 'liveStates'], path, issues);
  requireDigest(commitments.projectSha256, `${path}.projectSha256`, issues);
  validateRecordArray(commitments.checkpointFiles, `${path}.checkpointFiles`, issues, (entry, entryPath) => {
    requireExactKeys(entry, ['path', 'sha256'], entryPath, issues);
    requireNonEmptyString(entry.path, `${entryPath}.path`, issues);
    requireDigest(entry.sha256, `${entryPath}.sha256`, issues);
  });
  validateRecordArray(commitments.liveStates, `${path}.liveStates`, issues, (entry, entryPath) => {
    requireExactKeys(entry, ['scope', 'sha256'], entryPath, issues);
    requireNonEmptyString(entry.scope, `${entryPath}.scope`, issues);
    requireDigest(entry.sha256, `${entryPath}.sha256`, issues);
  });
}

function validateScopeEntry(value: unknown, path: string, expectedId: unknown, issues: string[]): void {
  const entry = asRecord(value);
  if (!entry) {
    issues.push(`${path} must be an object`);
    return;
  }
  requireExactKeys(entry, ['id', 'title', 'status'], path, issues);
  requireNonEmptyString(entry.id, `${path}.id`, issues);
  requireNonEmptyString(entry.title, `${path}.title`, issues);
  requireNonEmptyString(entry.status, `${path}.status`, issues);
  if (typeof expectedId === 'string' && entry.id !== expectedId) issues.push(`${path}.id must match operation scope`);
}

function validateConvention(value: unknown, path: string, issues: string[]): void {
  const convention = asRecord(value);
  if (!convention) {
    issues.push(`${path} must be an object`);
    return;
  }
  requireExactKeys(convention, ['id', 'rule', 'tags', 'addedSprint'], path, issues);
  requireNonEmptyString(convention.id, `${path}.id`, issues);
  requireNonEmptyString(convention.rule, `${path}.rule`, issues);
  validateStringArray(convention.tags, `${path}.tags`, issues);
  requirePositiveInteger(convention.addedSprint, `${path}.addedSprint`, issues);
}

function validateAdr(value: unknown, path: string, issues: string[]): void {
  const adr = asRecord(value);
  if (!adr) {
    issues.push(`${path} must be an object`);
    return;
  }
  requireExactKeys(adr, ['id', 'title', 'status', 'date', 'context', 'decision', 'consequences', 'alternatives', 'links'], path, issues, ['links']);
  for (const key of ['id', 'title', 'status', 'date', 'context', 'decision'] as const) {
    requireNonEmptyString(adr[key], `${path}.${key}`, issues);
  }
  validateStringArray(adr.consequences, `${path}.consequences`, issues);
  validateStringArray(adr.alternatives, `${path}.alternatives`, issues);
  if (adr.links !== undefined) {
    const links = asRecord(adr.links);
    if (!links) issues.push(`${path}.links must be an object`);
    else for (const [key, item] of Object.entries(links)) validateStringArray(item, `${path}.links.${key}`, issues);
  }
}

function validateRecordArray(
  value: unknown,
  path: string,
  issues: string[],
  validate: (entry: Record<string, unknown>, entryPath: string) => void,
): void {
  if (!Array.isArray(value)) {
    issues.push(`${path} must be an array`);
    return;
  }
  value.forEach((item, index) => {
    const entry = asRecord(item);
    if (!entry) issues.push(`${path}[${index}] must be an object`);
    else validate(entry, `${path}[${index}]`);
  });
}

function requireExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  issues: string[],
  optional: readonly string[] = [],
): void {
  const accepted = new Set(allowed);
  for (const key of Object.keys(value)) if (!accepted.has(key)) issues.push(`${path}.${key} is not allowed`);
  const optionalKeys = new Set(optional);
  for (const key of allowed) if (!optionalKeys.has(key) && !(key in value)) issues.push(`${path}.${key} is required`);
}

function requireNonEmptyString(value: unknown, path: string, issues: string[]): void {
  if (typeof value !== 'string' || value.trim().length === 0) issues.push(`${path} must be a non-empty string`);
}

function requireNullableString(value: unknown, path: string, issues: string[]): void {
  if (value !== null && typeof value !== 'string') issues.push(`${path} must be a string or null`);
}

function requirePositiveInteger(value: unknown, path: string, issues: string[]): void {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) issues.push(`${path} must be an integer >= 1`);
}

function requireDigest(value: unknown, path: string, issues: string[]): void {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) issues.push(`${path} must be a sha-256 hex digest`);
}

function validateStringArray(value: unknown, path: string, issues: string[]): void {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) issues.push(`${path} must be an array of strings`);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function planLiveEvolution(scope: string, live: SprintFile, after: SprintFile, options: { includeReanchor: boolean }): IntegrityOperation[] {
  const operations: IntegrityOperation[] = [];
  const afterIds = new Set(after.conventions.map((convention) => convention.id));
  const conventionCollection = [...after.conventions];
  for (const convention of live.conventions) {
    if (afterIds.has(convention.id)) continue;
    operations.push({
      kind: 'convention.append',
      scope,
      expectedConventionCollectionSha256: observedValueDigest(conventionCollection),
      after: convention,
      reason: 'live convention added after close; record the observed append',
    });
    conventionCollection.push(convention);
  }
  const afterAdrIds = new Set((after.adrs ?? []).map((adr) => adr.id));
  const adrCollection = [...(after.adrs ?? [])];
  for (const adr of live.adrs ?? []) {
    if (afterAdrIds.has(adr.id)) continue;
    operations.push({
      kind: 'adr.append',
      scope,
      expectedAdrCollectionSha256: observedValueDigest(adrCollection),
      after: adr,
      reason: 'live ADR added after close; record the observed append',
    });
    adrCollection.push(adr);
  }
  if (!options.includeReanchor) return operations;
  for (const liveEntry of live.ledger) {
    const afterEntry = after.ledger.find((entry) => entry.n === liveEntry.n && entry.slug === liveEntry.slug);
    if (!afterEntry) continue;
    if (!liveEntry.checkpointSha256 || !afterEntry.checkpointSha256) continue;
    if (liveEntry.checkpointSha256 === afterEntry.checkpointSha256) continue;
    operations.push({
      kind: 'ledger.checkpoint.reanchor',
      scope,
      sprintN: liveEntry.n,
      sprintSlug: liveEntry.slug,
      expectedOldSha256: afterEntry.checkpointSha256,
      afterSha256: liveEntry.checkpointSha256,
      reason: 'live ledger commitment was reanchored to the effective checkpoint',
    });
  }
  return operations;
}

function readLiveSprint(scope: string): SprintFile | null {
  const read = readJsonSafely(sprintJsonPath(scope));
  if (!read.exists || read.error) return null;
  return asSprintFile(read.value);
}

function listCheckpointFiles(scope: string): string[] {
  try {
    const absolute = resolveManagedPath(archiveDir(scope));
    if (!existsSync(absolute)) return [];
    return readdirSync(absolute).filter((file) => file.endsWith('.checkpoint.json')).sort();
  } catch {
    return [];
  }
}

function latestCheckpointPath(scope: string): string | null {
  const files = listCheckpointFiles(scope);
  if (files.length === 0) return null;
  return `${archiveDir(scope)}/${files[files.length - 1]}`;
}

function listArchiveScopes(): string[] {
  return listScopeFolders();
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

export function formatIntegritySummary(plan: IntegrityPlan): string {
  const lines: string[] = ['Kyro encontró problemas de integridad.', ''];
  if (plan.blockers.length > 0) {
    lines.push('No puedo reparar automáticamente:');
    for (const blocker of plan.blockers) {
      lines.push(`- [${blocker.code ?? 'blocker'}] ${blocker.summary}`);
    }
    lines.push('');
  }
  if (plan.targets.register.length > 0) {
    lines.push('Registrar scopes que ya existen en disco:');
    for (const id of plan.targets.register) lines.push(`- ${id}`);
    lines.push('');
  }
  if (plan.targets.unregister.length > 0) {
    lines.push('Eliminar registros cuyo directorio no existe:');
    for (const id of plan.targets.unregister) lines.push(`- ${id}`);
    lines.push('');
  }
  if (plan.targets.canonicalize.length > 0) {
    lines.push('Publicar compatibilidad (sin reescribir el archivo histórico) para:');
    for (const item of plan.targets.canonicalize) {
      lines.push(`- ${item.scope} / sprint ${item.sprintN} / ${item.sprintSlug}`);
    }
    lines.push('');
  }
  if (plan.targets.live.length > 0) {
    for (const item of plan.targets.live) {
      lines.push(`Estado vivo de ${item.scope}:`);
      for (const convention of item.conventions) {
        lines.push(`- añadir la convención ${convention.id} (ya observada en vivo)`);
      }
      for (const adr of item.adrs) {
        lines.push(`- añadir el ADR ${adr.id} (${adr.title})`);
      }
      for (const reanchor of item.ledgerReanchors) {
        lines.push(`- corregir el ancla del ledger sprint ${reanchor.sprintN} / ${reanchor.sprintSlug}`);
        lines.push(`  de ${reanchor.from.slice(0, 8)}… a ${reanchor.to.slice(0, 8)}…`);
      }
      lines.push('');
    }
  }
  const before = plan.targets.activeScope.before || '(vacío)';
  const after = plan.targets.activeScope.after || '(vacío)';
  lines.push(`activeScope: ${before === after ? `no cambia (${before})` : `${before} → ${after}`}.`);
  lines.push('');
  if (plan.blockers.length > 0) {
    lines.push('No apliques este digest. Restaura la evidencia incompatible o resuelve los bloqueos.');
  } else {
    lines.push('Puedo aplicar esto sin modificar los artefactos históricos originales.');
  }
  lines.push(`Plan digest: ${plan.digest}`);
  return lines.join('\n');
}
