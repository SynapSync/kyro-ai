import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { relative } from 'node:path';
import { archiveDir, scopeRoot, sprintJsonPath } from '../artifacts/paths';
import { readJsonSafely } from '../artifacts/json';
import { validateProjectStateShape, validateSprintFile } from '../artifacts/schema';
import { resolveManagedPath } from '../fs';
import { KyroCoreError } from '../core/errors';
import {
  hasLayeredProjectStateOnDisk,
  hasMonolitoProjectStateOnDisk,
  readProjectState,
  updateProjectStateLayersUnlocked,
} from '../state';
import {
  assertSafeManagedPath,
  assertSafePathSegment,
  withStateWriterLock,
} from '../pipeline/state-writer-lock';
import type {
  CheckResult,
  KyroProjectState,
  KyroScopeEntry,
  ScopeRetirement,
  SprintFile,
} from '../types';
import { atomicReplace, canonicalJson, publishExclusive, sha256 } from './sprint-close';

export const SCOPE_RETIREMENT_KIND = 'scope-retirement' as const;
export const SCOPE_RETIREMENT_SCHEMA_VERSION = 1 as const;

export interface ScopeRetirementRequest {
  scope: string;
  reason: string;
  supersededBy: string | null;
}

export interface ScopeRetirementObserved {
  sprintDigest: string;
  projectDigest: string;
  archiveDigest: string;
}

export interface ScopeRetirementPreparation {
  request: ScopeRetirementRequest;
  currentStatus: string;
  planDigest: string;
  checkpointPath: string;
  affectedFiles: string[];
  validations: string[];
  observed: ScopeRetirementObserved;
  alreadyApplied: boolean;
}

interface ScopeRetirementDigests {
  beforeSprint: string;
  afterSprint: string;
  beforeProject: string;
  afterProject: string;
  archive: string;
}

export interface ScopeRetirementCheckpointV1 {
  schemaVersion: 1;
  kind: typeof SCOPE_RETIREMENT_KIND;
  checkpointId: string;
  createdAt: string;
  request: ScopeRetirementRequest & { planDigest: string };
  approval: {
    decision: 'approved';
    mechanism: 'human-confirmed-cli-yes';
    approvedPlanDigest: string;
    identityVerified: false;
  };
  beforeSprint: SprintFile;
  afterSprint: SprintFile;
  beforeProject: KyroProjectState;
  afterProject: KyroProjectState;
  digests: ScopeRetirementDigests;
  commitment: string;
}

export interface ScopeRetirementApplyResult {
  checkpointPath: string;
  checkpointId: string;
  planDigest: string;
  resumed: boolean;
}

export function scopeRetirementCheckpointPath(scope: string): string {
  return `${scopeRoot(scope)}/retirement.checkpoint.json`;
}

export function buildScopeRetirementPreparation(request: ScopeRetirementRequest): ScopeRetirementPreparation {
  validateRequest(request);
  const existing = readScopeRetirementCheckpoint(request.scope);
  if (existing) {
    assertMatchingRequest(existing, request, existing.request.planDigest);
    return preparationFromCheckpoint(existing, retirementCheckpointIsApplied(request.scope));
  }

  const beforeSprint = readValidSprint(request.scope);
  const beforeProject = readRegisteredProject(request.scope);
  assertRetirementAllowed(request, beforeSprint, beforeProject);
  const observed = observedState(request.scope, beforeSprint, beforeProject);
  const planDigest = retirementPlanDigest(request, observed);
  return {
    request,
    currentStatus: beforeProject.scopes.find((entry) => entry.id === request.scope)?.status ?? beforeSprint.status,
    planDigest,
    checkpointPath: scopeRetirementCheckpointPath(request.scope),
    affectedFiles: affectedFiles(request.scope, beforeProject),
    validations: [
      'scope exists and is registered',
      'activeSprint is null',
      'all close checkpoints are intact and converged',
      'archive fingerprint is bound to the plan digest',
      'successor is registered and not retired when supplied',
      'apply requires this digest and --yes under the writer lock',
    ],
    observed,
    alreadyApplied: false,
  };
}

export function applyScopeRetirement(request: ScopeRetirementRequest, approvedDigest: string): ScopeRetirementApplyResult {
  if (!/^[0-9a-f]{64}$/.test(approvedDigest)) {
    throw new KyroCoreError('DIVERGED', 'The supplied retirement digest is missing or malformed.', 'Run preparation again, review the complete plan, and use its exact digest with --yes.');
  }
  return withStateWriterLock(() => {
    const existing = readScopeRetirementCheckpoint(request.scope);
    if (existing) {
      assertMatchingRequest(existing, request, approvedDigest);
      return applyCheckpoint(existing, true);
    }

    const preparation = buildScopeRetirementPreparation(request);
    if (preparation.planDigest !== approvedDigest) {
      throw diverged('The observed state or retirement inputs no longer match the approved plan digest.');
    }
    const checkpoint = buildCheckpoint(request, preparation);
    publishExclusive(
      preparation.checkpointPath,
      `${JSON.stringify(checkpoint, null, 2)}\n`,
      'scope retirement checkpoint',
    );
    failAfter('checkpoint');
    const published = readScopeRetirementCheckpoint(request.scope);
    if (!published || canonicalJson(published) !== canonicalJson(checkpoint)) {
      throw new KyroCoreError('CHECKPOINT_CONFLICT', 'The published retirement checkpoint changed unexpectedly.', 'Stop and inspect retirement.checkpoint.json before retrying.');
    }
    return applyCheckpoint(published, false);
  });
}

export function readScopeRetirementCheckpoint(scope: string): ScopeRetirementCheckpointV1 | null {
  assertSafePathSegment(scope, 'Scope');
  const path = scopeRetirementCheckpointPath(scope);
  assertSafeManagedPath(path);
  const read = readJsonSafely(path);
  if (!read.exists) return null;
  if (read.error) throw corrupt(path, read.error);
  const issues = validateScopeRetirementCheckpoint(read.value, path);
  if (issues.length > 0) throw corrupt(path, issues.join('; '));
  return read.value as ScopeRetirementCheckpointV1;
}

export function validateScopeRetirementCheckpoint(value: unknown, path: string): string[] {
  const issues: string[] = [];
  if (!isRecord(value)) return [`${path}: must be an object`];
  if (value.schemaVersion !== SCOPE_RETIREMENT_SCHEMA_VERSION) issues.push(`${path}: schemaVersion must be 1`);
  if (value.kind !== SCOPE_RETIREMENT_KIND) issues.push(`${path}: kind must be ${SCOPE_RETIREMENT_KIND}`);
  for (const field of ['checkpointId', 'createdAt', 'commitment']) {
    if (typeof value[field] !== 'string' || value[field] === '') issues.push(`${path}: ${field} must be a non-empty string`);
  }
  if (!isRecord(value.request)) issues.push(`${path}: request must be an object`);
  if (!isRecord(value.approval)) issues.push(`${path}: approval must be an object`);
  if (!isRecord(value.digests)) issues.push(`${path}: digests must be an object`);
  if (issues.length > 0) return issues;

  const checkpoint = value as unknown as ScopeRetirementCheckpointV1;
  try { validateRequest(checkpoint.request); }
  catch (error) { issues.push(`${path}: invalid request (${message(error)})`); }
  if (!/^[0-9a-f]{64}$/.test(checkpoint.request.planDigest)) issues.push(`${path}: request.planDigest must be SHA-256`);
  if (checkpoint.approval.decision !== 'approved') issues.push(`${path}: approval.decision must be approved`);
  if (checkpoint.approval.mechanism !== 'human-confirmed-cli-yes') issues.push(`${path}: approval.mechanism must record the explicit CLI gate`);
  if (checkpoint.approval.approvedPlanDigest !== checkpoint.request.planDigest) issues.push(`${path}: approval digest must match request.planDigest`);
  if (checkpoint.approval.identityVerified !== false) issues.push(`${path}: approval must not claim cryptographic identity verification`);
  for (const name of ['beforeSprint', 'afterSprint', 'beforeProject', 'afterProject', 'archive'] as const) {
    if (!/^[0-9a-f]{64}$/.test(checkpoint.digests[name])) issues.push(`${path}: digests.${name} must be SHA-256`);
  }
  if (Number.isNaN(Date.parse(checkpoint.createdAt))) issues.push(`${path}: createdAt must be an ISO timestamp`);
  issues.push(...validateSprintFile(checkpoint.beforeSprint, `${path}:beforeSprint`).map(formatIssue));
  issues.push(...validateSprintFile(checkpoint.afterSprint, `${path}:afterSprint`).map(formatIssue));
  issues.push(...validateProjectStateShape(checkpoint.beforeProject, `${path}:beforeProject`).map(formatIssue));
  issues.push(...validateProjectStateShape(checkpoint.afterProject, `${path}:afterProject`).map(formatIssue));
  if (issues.length > 0) return issues;

  if (checkpoint.digests.beforeSprint !== sha256(checkpoint.beforeSprint)) issues.push(`${path}: beforeSprint digest mismatch`);
  if (checkpoint.digests.afterSprint !== sha256(checkpoint.afterSprint)) issues.push(`${path}: afterSprint digest mismatch`);
  if (checkpoint.digests.beforeProject !== sha256(checkpoint.beforeProject)) issues.push(`${path}: beforeProject digest mismatch`);
  if (checkpoint.digests.afterProject !== sha256(checkpoint.afterProject)) issues.push(`${path}: afterProject digest mismatch`);
  const observed: ScopeRetirementObserved = {
    sprintDigest: checkpoint.digests.beforeSprint,
    projectDigest: checkpoint.digests.beforeProject,
    archiveDigest: checkpoint.digests.archive,
  };
  if (checkpoint.request.planDigest !== retirementPlanDigest(checkpoint.request, observed)) issues.push(`${path}: planDigest does not bind the frozen request and before-state`);
  if (checkpoint.commitment !== checkpointCommitment(checkpoint)) issues.push(`${path}: commitment mismatch`);
  if (!authorizedAfterImages(checkpoint)) issues.push(`${path}: after-images are not the authorized retired transition`);
  return issues;
}

export function inspectScopeRetirement(scope: string): CheckResult[] {
  const path = scopeRetirementCheckpointPath(scope);
  let checkpoint: ScopeRetirementCheckpointV1 | null;
  try { checkpoint = readScopeRetirementCheckpoint(scope); }
  catch (error) { return [{ status: 'fail', name: `${scope}/retirement`, detail: message(error), remedy: 'Restore the immutable retirement checkpoint from versioned storage; do not overwrite it.' }]; }
  if (!checkpoint) return [];
  const sprint = readJsonSafely(sprintJsonPath(scope));
  const project = readProjectState();
  let archive: string;
  try { archive = archiveFingerprint(scope); }
  catch (error) {
    return [{ status: 'fail', name: `${scope}/retirement`, detail: message(error), remedy: 'Restore archive/ to the exact regular-file tree bound by the retirement checkpoint.' }];
  }
  const applied = sprint.exists && !sprint.error
    && project !== null
    && sha256(sprint.value) === checkpoint.digests.afterSprint
    && sha256(project) === checkpoint.digests.afterProject
    && archive === checkpoint.digests.archive;
  if (applied) {
    return [{ status: 'pass', name: `${scope}/retirement`, detail: `APPLIED: ${path} matches the retired sprint/project state and archive fingerprint.` }];
  }
  return [{
    status: 'fail',
    name: `${scope}/retirement`,
    detail: 'DIVERGED: live sprint/project state or archive fingerprint does not match the retirement checkpoint.',
    remedy: 'Do not edit archive history. Re-run the identical approved apply to resume only when live state matches a frozen before/after image; otherwise reconcile explicitly.',
  }];
}

export function retirementCheckpointIsApplied(scope: string): boolean {
  return inspectScopeRetirement(scope).some((check) => check.status === 'pass');
}

export function archiveFingerprint(scope: string): string {
  assertSafePathSegment(scope, 'Scope');
  const directory = assertSafeManagedPath(archiveDir(scope));
  const hash = createHash('sha256');
  if (!existsSync(directory)) return hash.digest('hex');
  const entries = collectArchiveEntries(directory).sort((left, right) => left.localeCompare(right));
  for (const absolute of entries) {
    const stats = lstatSync(absolute);
    if (stats.isSymbolicLink()) throw new KyroCoreError('CHECKPOINT_CORRUPT', `Archive entry is a symlink: ${relative(directory, absolute)}.`, 'Replace it with the original regular file inside archive/.');
    hash.update(stats.isDirectory() ? 'directory' : 'file');
    hash.update('\0');
    hash.update(relative(directory, absolute));
    hash.update('\0');
    if (stats.isFile()) hash.update(readFileSync(absolute));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function buildCheckpoint(request: ScopeRetirementRequest, preparation: ScopeRetirementPreparation): ScopeRetirementCheckpointV1 {
  const beforeSprint = readValidSprint(request.scope);
  const beforeProject = readRegisteredProject(request.scope);
  const observed = observedState(request.scope, beforeSprint, beforeProject);
  if (retirementPlanDigest(request, observed) !== preparation.planDigest) throw diverged('State changed while acquiring the writer lock.');
  const createdAt = new Date().toISOString();
  const retirement: ScopeRetirement = {
    reason: request.reason,
    retiredAt: createdAt,
    ...(request.supersededBy ? { supersededBy: request.supersededBy } : {}),
    planDigest: preparation.planDigest,
  };
  const afterSprint: SprintFile = {
    ...clone(beforeSprint),
    status: 'retired',
    activeSprint: null,
    retirement,
    handoff: {
      nextAction: 'done',
      nextTaskId: null,
      blockers: [],
      note: request.supersededBy
        ? `Scope retired by explicit human approval; superseded by ${request.supersededBy}.`
        : 'Scope retired by explicit human approval.',
      lastUpdated: createdAt.slice(0, 10),
    },
  };
  const afterProject = clone(beforeProject);
  afterProject.scopes = afterProject.scopes.map((entry) => entry.id === request.scope
    ? { ...entry, status: 'retired', retirement }
    : entry);
  if (afterProject.activeScope === request.scope) afterProject.activeScope = null;
  const checkpoint: ScopeRetirementCheckpointV1 = {
    schemaVersion: SCOPE_RETIREMENT_SCHEMA_VERSION,
    kind: SCOPE_RETIREMENT_KIND,
    checkpointId: randomUUID(),
    createdAt,
    request: { ...request, planDigest: preparation.planDigest },
    approval: {
      decision: 'approved',
      mechanism: 'human-confirmed-cli-yes',
      approvedPlanDigest: preparation.planDigest,
      identityVerified: false,
    },
    beforeSprint,
    afterSprint,
    beforeProject,
    afterProject,
    digests: {
      beforeSprint: sha256(beforeSprint),
      afterSprint: sha256(afterSprint),
      beforeProject: sha256(beforeProject),
      afterProject: sha256(afterProject),
      archive: observed.archiveDigest,
    },
    commitment: '',
  };
  checkpoint.commitment = checkpointCommitment(checkpoint);
  const issues = validateScopeRetirementCheckpoint(checkpoint, preparation.checkpointPath);
  if (issues.length > 0) throw new KyroCoreError('INTERNAL', `Retirement checkpoint generation failed: ${issues.join('; ')}`);
  return checkpoint;
}

function applyCheckpoint(checkpoint: ScopeRetirementCheckpointV1, resumed: boolean): ScopeRetirementApplyResult {
  const scope = checkpoint.request.scope;
  preflight(checkpoint);
  const sprint = readJsonSafely(sprintJsonPath(scope));
  if (sprint.exists && !sprint.error && sha256(sprint.value) === checkpoint.digests.beforeSprint) {
    atomicReplace(sprintJsonPath(scope), `${JSON.stringify(checkpoint.afterSprint, null, 2)}\n`);
  }
  failAfter('sprint');
  const project = readProjectState();
  if (!project) throw diverged('project state is missing.');
  assertProjectTransitionState(project, checkpoint);
  if (sha256(project) !== checkpoint.digests.afterProject) {
    updateProjectStateLayersUnlocked({
      scopes: checkpoint.afterProject.scopes,
      ...(checkpoint.beforeProject.activeScope === scope ? { activeScope: null } : {}),
    });
  }
  failAfter('project');
  verifyApplied(checkpoint);
  return {
    checkpointPath: scopeRetirementCheckpointPath(scope),
    checkpointId: checkpoint.checkpointId,
    planDigest: checkpoint.request.planDigest,
    resumed,
  };
}

function preflight(checkpoint: ScopeRetirementCheckpointV1): void {
  const sprint = readJsonSafely(sprintJsonPath(checkpoint.request.scope));
  if (sprint.error || !sprint.exists) throw diverged(`sprint.json is ${sprint.error ?? 'missing'}`);
  const sprintDigest = sha256(sprint.value);
  if (sprintDigest !== checkpoint.digests.beforeSprint && sprintDigest !== checkpoint.digests.afterSprint) {
    throw diverged('sprint.json matches neither the approved before-state nor after-state.');
  }
  const project = readProjectState();
  if (!project) throw diverged('project state is missing.');
  assertProjectTransitionState(project, checkpoint);
  if (archiveFingerprint(checkpoint.request.scope) !== checkpoint.digests.archive) {
    throw diverged('archive/ changed after preparation; immutable history will not be touched.');
  }
}

function assertProjectTransitionState(
  project: KyroProjectState,
  checkpoint: ScopeRetirementCheckpointV1,
): void {
  const digest = sha256(project);
  if (digest === checkpoint.digests.beforeProject || digest === checkpoint.digests.afterProject) return;

  // Project state is physically layered: the shared registry and local active scope are written
  // separately. Accept only the two authorized field transitions so an interrupted layered write
  // can converge on retry without accepting unrelated concurrent edits.
  const scope = checkpoint.request.scope;
  const beforeEntry = checkpoint.beforeProject.scopes.find((entry) => entry.id === scope);
  const afterEntry = checkpoint.afterProject.scopes.find((entry) => entry.id === scope);
  const currentEntry = project.scopes.find((entry) => entry.id === scope);
  if (!beforeEntry || !afterEntry || !currentEntry) {
    throw diverged('project scope registry no longer contains the approved retirement transition.');
  }
  const entryDigest = sha256(currentEntry);
  if (entryDigest !== sha256(beforeEntry) && entryDigest !== sha256(afterEntry)) {
    throw diverged('project scope registry entry differs from both approved states.');
  }
  const activeScopeAllowed = project.activeScope === checkpoint.beforeProject.activeScope
    || project.activeScope === checkpoint.afterProject.activeScope;
  if (!activeScopeAllowed) throw diverged('activeScope differs from both approved states.');

  const normalized = clone(project);
  normalized.scopes = normalized.scopes.map((entry) => entry.id === scope ? clone(beforeEntry) : entry);
  normalized.activeScope = checkpoint.beforeProject.activeScope;
  if (sha256(normalized) !== checkpoint.digests.beforeProject) {
    throw diverged('project state contains changes outside the approved retirement transition.');
  }
}

function verifyApplied(checkpoint: ScopeRetirementCheckpointV1): void {
  const sprint = readJsonSafely(sprintJsonPath(checkpoint.request.scope));
  const project = readProjectState();
  if (sprint.error || !sprint.exists || sha256(sprint.value) !== checkpoint.digests.afterSprint) throw diverged('post-write sprint verification failed.');
  if (!project || sha256(project) !== checkpoint.digests.afterProject) throw diverged('post-write project verification failed.');
  if (archiveFingerprint(checkpoint.request.scope) !== checkpoint.digests.archive) throw diverged('archive fingerprint changed during apply.');
}

function assertRetirementAllowed(request: ScopeRetirementRequest, sprint: SprintFile, project: KyroProjectState): void {
  if (sprint.retirement || project.scopes.find((entry) => entry.id === request.scope)?.status === 'retired') {
    throw new KyroCoreError('SCOPE_RETIRED', `Scope "${request.scope}" is already retired.`, 'Use status or doctor to inspect its immutable retirement record.');
  }
  if (sprint.activeSprint) {
    throw new KyroCoreError('SPRINT_ALREADY_ACTIVE', `Cannot retire scope "${request.scope}" while sprint ${sprint.activeSprint.n} (${sprint.activeSprint.slug}) is active.`, 'Complete or otherwise resolve the active sprint first; retirement never closes or discards it.');
  }
  if (request.supersededBy) {
    const successor = project.scopes.find((entry) => entry.id === request.supersededBy);
    if (!successor) throw new KyroCoreError('SCOPE_NOT_FOUND', `Successor scope is not registered: ${request.supersededBy}.`, 'Register the successor scope before preparing retirement.');
    if (successor.status === 'retired') throw new KyroCoreError('INVALID_INPUT', `Successor scope "${request.supersededBy}" is retired.`, 'Choose a non-retired registered successor.');
  }
}

function readValidSprint(scope: string): SprintFile {
  assertSafePathSegment(scope, 'Scope');
  const root = scopeRoot(scope);
  assertSafeManagedPath(root);
  if (!existsSync(resolveManagedPath(root))) throw new KyroCoreError('SCOPE_NOT_FOUND', `Scope not found: ${scope}`, 'Run kyro scope list to see registered scopes.');
  const sprintPath = sprintJsonPath(scope);
  assertSafeManagedPath(sprintPath);
  const read = readJsonSafely(sprintPath);
  if (!read.exists) throw new KyroCoreError('SCOPE_NOT_FOUND', `Scope "${scope}" has no sprint.json.`, 'Restore its live state before retirement.');
  if (read.error) throw new KyroCoreError('INVALID_JSON', `Cannot retire "${scope}": sprint.json is invalid (${read.error}).`, 'Restore from an intact checkpoint; do not edit archive history.');
  const issues = validateSprintFile(read.value, `${scope}/sprint.json`);
  if (issues.length > 0) throw new KyroCoreError('INVALID_SPRINT_SHAPE', `Cannot retire "${scope}": ${issues.map(formatIssue).join('; ')}.`, 'Run kyro doctor --artifacts and repair only through supported tool-owned operations.');
  return clone(read.value as SprintFile);
}

function readRegisteredProject(scope: string): KyroProjectState {
  const project = readProjectState();
  if (!project) throw new KyroCoreError('INVALID_PROJECT_STATE', 'Kyro project state is missing.', 'Run kyro install --init-workspace --yes before retiring a scope.');
  const issues = validateProjectStateShape(project, '.agents/kyro/(effective project state)');
  if (issues.length > 0) throw new KyroCoreError('INVALID_PROJECT_STATE', `Project state is invalid: ${issues.map(formatIssue).join('; ')}.`, 'Run kyro doctor and repair the project-state layers with supported tooling.');
  if (!project.scopes.some((entry) => entry.id === scope)) {
    throw new KyroCoreError('SCOPE_NOT_FOUND', `Scope "${scope}" exists on disk but is not registered in project state.`, 'Run kyro install --init-workspace --yes to rehydrate the registry, then prepare retirement again.');
  }
  return clone(project);
}

function observedState(scope: string, sprint: SprintFile, project: KyroProjectState): ScopeRetirementObserved {
  return {
    sprintDigest: sha256(sprint),
    projectDigest: sha256(project),
    archiveDigest: archiveFingerprint(scope),
  };
}

function retirementPlanDigest(request: ScopeRetirementRequest, observed: ScopeRetirementObserved): string {
  return sha256({
    kind: SCOPE_RETIREMENT_KIND,
    schemaVersion: SCOPE_RETIREMENT_SCHEMA_VERSION,
    request: { scope: request.scope, reason: request.reason, supersededBy: request.supersededBy },
    observed,
  });
}

function checkpointCommitment(checkpoint: ScopeRetirementCheckpointV1): string {
  const { commitment: _commitment, ...body } = checkpoint;
  return sha256(body);
}

function authorizedAfterImages(checkpoint: ScopeRetirementCheckpointV1): boolean {
  const metadata = checkpoint.afterSprint.retirement;
  const entry = checkpoint.afterProject.scopes.find((candidate) => candidate.id === checkpoint.request.scope);
  if (!metadata || !entry?.retirement) return false;
  if (checkpoint.beforeSprint.activeSprint !== null) return false;
  const expectedRetirement: ScopeRetirement = {
    reason: checkpoint.request.reason,
    retiredAt: checkpoint.createdAt,
    ...(checkpoint.request.supersededBy ? { supersededBy: checkpoint.request.supersededBy } : {}),
    planDigest: checkpoint.request.planDigest,
  };
  const expectedSprint: SprintFile = {
    ...clone(checkpoint.beforeSprint),
    status: 'retired',
    activeSprint: null,
    retirement: expectedRetirement,
    handoff: {
      nextAction: 'done',
      nextTaskId: null,
      blockers: [],
      note: checkpoint.request.supersededBy
        ? `Scope retired by explicit human approval; superseded by ${checkpoint.request.supersededBy}.`
        : 'Scope retired by explicit human approval.',
      lastUpdated: checkpoint.createdAt.slice(0, 10),
    },
  };
  const expectedProject = clone(checkpoint.beforeProject);
  expectedProject.scopes = expectedProject.scopes.map((candidate) => candidate.id === checkpoint.request.scope
    ? { ...candidate, status: 'retired', retirement: expectedRetirement }
    : candidate);
  if (expectedProject.activeScope === checkpoint.request.scope) expectedProject.activeScope = null;
  return canonicalJson(checkpoint.afterSprint) === canonicalJson(expectedSprint)
    && canonicalJson(checkpoint.afterProject) === canonicalJson(expectedProject)
    && canonicalJson(metadata) === canonicalJson(entry.retirement);
}

function assertMatchingRequest(checkpoint: ScopeRetirementCheckpointV1, request: ScopeRetirementRequest, digest: string): void {
  if (checkpoint.request.planDigest !== digest) throw diverged('The supplied digest does not match the immutable retirement checkpoint.');
  if (checkpoint.request.scope !== request.scope
    || checkpoint.request.reason !== request.reason
    || checkpoint.request.supersededBy !== request.supersededBy) {
    throw new KyroCoreError('CHECKPOINT_CONFLICT', 'Retirement inputs conflict with the immutable checkpoint.', 'Use the exact reason, successor, scope and digest originally approved.');
  }
}

function preparationFromCheckpoint(checkpoint: ScopeRetirementCheckpointV1, alreadyApplied: boolean): ScopeRetirementPreparation {
  return {
    request: checkpoint.request,
    currentStatus: alreadyApplied ? 'retired' : checkpoint.beforeProject.scopes.find((entry) => entry.id === checkpoint.request.scope)?.status ?? checkpoint.beforeSprint.status,
    planDigest: checkpoint.request.planDigest,
    checkpointPath: scopeRetirementCheckpointPath(checkpoint.request.scope),
    affectedFiles: affectedFiles(checkpoint.request.scope, checkpoint.beforeProject),
    validations: ['immutable retirement checkpoint validated', 'apply is resumable only from its frozen before/after images', 'archive fingerprint remains immutable'],
    observed: {
      sprintDigest: checkpoint.digests.beforeSprint,
      projectDigest: checkpoint.digests.beforeProject,
      archiveDigest: checkpoint.digests.archive,
    },
    alreadyApplied,
  };
}

function affectedFiles(scope: string, project: KyroProjectState): string[] {
  const files = [scopeRetirementCheckpointPath(scope), sprintJsonPath(scope), '.agents/kyro/project.json'];
  if (!hasLayeredProjectStateOnDisk() && hasMonolitoProjectStateOnDisk()) {
    files.push('.agents/kyro/local.json', '.agents/kyro/kyro.json', '.agents/kyro/kyro.json.migrated');
  } else if (project.activeScope === scope) {
    files.push('.agents/kyro/local.json');
  }
  return files;
}

function validateRequest(request: ScopeRetirementRequest): void {
  assertSafePathSegment(request.scope, 'Scope');
  if (request.reason.trim() === '') throw new KyroCoreError('INVALID_INPUT', '--reason must be non-empty.');
  if (request.supersededBy) {
    assertSafePathSegment(request.supersededBy, 'Successor scope');
    if (request.supersededBy === request.scope) throw new KyroCoreError('INVALID_INPUT', '--superseded-by must name a different scope.');
  }
}

function collectArchiveEntries(directory: string): string[] {
  const entries: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = `${directory}/${entry.name}`;
    entries.push(absolute);
    if (entry.isDirectory()) entries.push(...collectArchiveEntries(absolute));
  }
  return entries;
}

function failAfter(boundary: string): void {
  if (process.env.KYRO_TEST_RETIRE_FAIL_AFTER === boundary) {
    throw new KyroCoreError('INTERNAL', `Injected retirement failure after ${boundary}.`, 'Retry the identical approved command; retirement.checkpoint.json is resumable.');
  }
}

function corrupt(path: string, detail: string): KyroCoreError {
  return new KyroCoreError('CHECKPOINT_CORRUPT', `Retirement checkpoint ${path} is corrupt: ${detail}.`, 'Restore the immutable checkpoint from versioned storage; do not overwrite it.');
}

function diverged(detail: string): KyroCoreError {
  return new KyroCoreError('DIVERGED', `Retirement plan diverged: ${detail}`, 'No live or archive files were overwritten. Prepare a new plan and request fresh human approval.');
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatIssue(issue: { path: string; field: string; message: string }): string {
  return `${issue.path}:${issue.field} ${issue.message}`;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
