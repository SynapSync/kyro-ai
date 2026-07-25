import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  ARTIFACT_ROOT,
  KYRO_MANIFEST_PATH,
  KYRO_ROOT,
  KYRO_STATE_PATH,
  LOCAL_STATE_PATH,
  PROJECT_STATE_PATH,
} from './constants';
import { readJsonFromManagedPath, readJsonFromWorkspace, resolveManagedPath } from './fs';
import { KyroCoreError } from './core/errors';
import { assertSafeManagedPath, assertStateWriterLeaseHealthy, withStateWriterLock } from './pipeline/state-writer-lock';
import type {
  KyroLocalProjectState,
  KyroManifest,
  KyroProjectState,
  KyroSharedProjectState,
  KyroInstalledAdapter,
  KyroScopeEntry,
  Principle,
  TeamPolicy,
} from './types';

/** Backup name after monolito → layers split (dual-read no longer prefers monolito when layers exist). */
export const KYRO_STATE_MIGRATED_PATH = `${KYRO_STATE_PATH}.migrated`;

// ---------------------------------------------------------------------------
// Reads (never write)
// ---------------------------------------------------------------------------

export function readSharedProjectState(): KyroSharedProjectState | null {
  return readJsonFromWorkspace<KyroSharedProjectState>(PROJECT_STATE_PATH);
}

export function readLocalProjectState(): KyroLocalProjectState | null {
  return readJsonFromWorkspace<KyroLocalProjectState>(LOCAL_STATE_PATH);
}

/** True when local.json sets execution.delegationEnabled to true; false when absent or false. */
export function resolveDelegationEnabled(): boolean {
  const local = readLocalProjectState();
  return local?.execution?.delegationEnabled === true;
}

/** Raw legacy monolito file only — does not merge layers. */
export function readMonolitoProjectState(): KyroProjectState | null {
  return readJsonFromWorkspace<KyroProjectState>(KYRO_STATE_PATH);
}

export function hasLayeredProjectStateOnDisk(): boolean {
  return workspacePathExists(PROJECT_STATE_PATH) || workspacePathExists(LOCAL_STATE_PATH);
}

export function hasMonolitoProjectStateOnDisk(): boolean {
  return workspacePathExists(KYRO_STATE_PATH);
}

/** True when any persisted project state file exists (layers or legacy monolito). */
export function hasPersistedProjectStateOnDisk(): boolean {
  return hasLayeredProjectStateOnDisk() || hasMonolitoProjectStateOnDisk();
}

/**
 * One-line install/bootstrap remedy for missing or incomplete project state (D7a / R5).
 * Read-only commands surface this string; they never create the files themselves.
 */
export const PROJECT_STATE_BOOTSTRAP_REMEDY =
  'Run: npx kyro-ai install --init-workspace --yes  (writes project.json + local.json; rehydrates on-disk scopes).';

/**
 * Format a one-line actionable bootstrap remedy. Optional reason prefixes the install line.
 * Never creates files.
 */
export function formatBootstrapRemedy(reason?: string): string {
  if (reason && reason.trim()) {
    const trimmed = reason.trim().replace(/\s+/g, ' ');
    const base = trimmed.endsWith('.') ? trimmed : `${trimmed}.`;
    return `${base} ${PROJECT_STATE_BOOTSTRAP_REMEDY}`;
  }
  return PROJECT_STATE_BOOTSTRAP_REMEDY;
}

/**
 * Detect whether a read-only command should surface a bootstrap remedy.
 * Callers pass unregistered on-disk scope ids (from unregisteredScopeFolders) so this module
 * stays free of scopes imports. Never writes.
 *
 * @returns one-line remedy, or null when persisted state exists and all listed scopes are registered
 */
export function detectProjectStateBootstrapNeed(unregisteredScopeIds: string[] = []): string | null {
  if (!hasPersistedProjectStateOnDisk()) {
    return formatBootstrapRemedy(
      'No project state on disk (expected project.json + local.json, or legacy kyro.json)',
    );
  }
  if (unregisteredScopeIds.length > 0) {
    const sorted = [...unregisteredScopeIds].sort((a, b) => a.localeCompare(b));
    return formatBootstrapRemedy(
      `${sorted.length} on-disk scope(s) not registered in project state: ${sorted.join(', ')}`,
    );
  }
  return null;
}

/**
 * Effective project state façade used by all CLI/MCP readers.
 *
 * Resolution order (deterministic, read-only — never creates files):
 * 1. If either layer file exists → merge shared + local (defaults fill missing layer).
 * 2. Else if legacy monolito exists → return sanitized monolito as effective state.
 * 3. Else → null.
 *
 * Disk scope rehydrate is NOT applied here (D7a); install/sync/bootstrap own that.
 */
export function readProjectState(): KyroProjectState | null {
  const sharedRaw = readSharedProjectState();
  const localRaw = readLocalProjectState();
  if (sharedRaw !== null || localRaw !== null) {
    return mergeProjectLayers(sharedRaw, localRaw);
  }
  const monolito = readMonolitoProjectState();
  if (monolito) return effectiveFromMonolito(monolito);
  return null;
}

export function readManifest(): KyroManifest | null {
  return readJsonFromManagedPath<KyroManifest>(KYRO_MANIFEST_PATH);
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

/**
 * Deterministic merge: shared owns principles/team/scopes/artifactRoot;
 * local owns activeScope/installedAdapters (+ optional runtimePath).
 */
export function mergeProjectLayers(
  sharedRaw: KyroSharedProjectState | null,
  localRaw: KyroLocalProjectState | null,
): KyroProjectState {
  const shared = normalizeShared(sharedRaw);
  const local = normalizeLocal(localRaw);
  const effective: KyroProjectState = {
    schemaVersion: 4,
    artifactRoot: shared.artifactRoot,
    scopes: shared.scopes,
    activeScope: local.activeScope,
    runtimePath: local.runtimePath ?? KYRO_ROOT,
    installedAdapters: local.installedAdapters,
  };
  if (shared.principles !== undefined) effective.principles = shared.principles;
  if (shared.team !== undefined) effective.team = shared.team;
  return stripLegacyProjectFields(effective);
}

export function effectiveFromMonolito(monolito: KyroProjectState): KyroProjectState {
  const base = stripLegacyProjectFields({ ...monolito });
  return {
    schemaVersion: 4,
    artifactRoot: typeof base.artifactRoot === 'string' && base.artifactRoot ? base.artifactRoot : ARTIFACT_ROOT,
    scopes: Array.isArray(base.scopes) ? base.scopes : [],
    activeScope: base.activeScope ?? null,
    runtimePath: typeof base.runtimePath === 'string' && base.runtimePath ? base.runtimePath : KYRO_ROOT,
    installedAdapters: Array.isArray(base.installedAdapters) ? base.installedAdapters : [],
    ...(base.principles !== undefined ? { principles: base.principles } : {}),
    ...(base.team !== undefined ? { team: base.team } : {}),
  };
}

// ---------------------------------------------------------------------------
// Split / migrate monolito → layers
// ---------------------------------------------------------------------------

export interface SplitMonolitoResult {
  shared: KyroSharedProjectState;
  local: KyroLocalProjectState;
}

/**
 * Pure split of a legacy effective/monolito state into layer payloads.
 * v1: scopes registry cache lives on **shared** (team-visible); personal fields on local.
 */
export function splitMonolitoToLayers(monolito: KyroProjectState): SplitMonolitoResult {
  const effective = effectiveFromMonolito(monolito);
  const shared: KyroSharedProjectState = {
    schemaVersion: 4,
    artifactRoot: effective.artifactRoot,
    scopes: effective.scopes.map(cloneScopeEntry),
  };
  if (effective.principles !== undefined) {
    shared.principles = effective.principles.map(clonePrinciple);
  }
  if (effective.team !== undefined) {
    shared.team = cloneTeamPolicy(effective.team);
  }
  const local: KyroLocalProjectState = {
    schemaVersion: 4,
    activeScope: effective.activeScope,
    installedAdapters: effective.installedAdapters.map(cloneInstalledAdapter),
    runtimePath: effective.runtimePath,
  };
  return { shared: sanitizeSharedForWrite(shared), local: sanitizeLocalForWrite(local) };
}

export interface MigrateMonolitoOptions {
  /**
   * When true (default), rename `.agents/kyro/kyro.json` → `kyro.json.migrated` after a successful
   * layer write so dual-read prefers layers and writers stop targeting monolito.
   */
  archiveMonolito?: boolean;
  /** Optional source; defaults to on-disk monolito. */
  monolito?: KyroProjectState;
}

export interface MigrateMonolitoResult extends SplitMonolitoResult {
  archivedMonolitoPath: string | null;
}

/**
 * Split monolito into layers and persist under the state-writer lock.
 * Does not write monolito. Callers (install/sync/repair) own when to invoke this.
 */
export function migrateMonolitoToLayers(options: MigrateMonolitoOptions = {}): MigrateMonolitoResult {
  return withStateWriterLock(() => migrateMonolitoToLayersUnlocked(options));
}

/** Assumes the caller already holds the state-writer lock (re-entrant safe via withStateWriterLock). */
export function migrateMonolitoToLayersUnlocked(options: MigrateMonolitoOptions = {}): MigrateMonolitoResult {
  assertStateWriterLeaseHealthy();
  const source = options.monolito ?? readMonolitoProjectState();
  if (!source) {
    throw new KyroCoreError(
      'INVALID_INPUT',
      'Cannot migrate monolito project state: .agents/kyro/kyro.json not found.',
      'Run kyro install --init-workspace or provide monolito state to migrateMonolitoToLayers.',
    );
  }
  const { shared, local } = splitMonolitoToLayers(source);
  writeProjectLayersUnlocked({ shared, local });
  let archivedMonolitoPath: string | null = null;
  const archive = options.archiveMonolito !== false;
  if (archive && workspacePathExists(KYRO_STATE_PATH)) {
    const from = assertSafeManagedPath(KYRO_STATE_PATH);
    const to = assertSafeManagedPath(KYRO_STATE_MIGRATED_PATH);
    renameSync(from, to);
    archivedMonolitoPath = KYRO_STATE_MIGRATED_PATH;
  }
  return { shared, local, archivedMonolitoPath };
}

// ---------------------------------------------------------------------------
// Layer writers
// ---------------------------------------------------------------------------

/**
 * Persist shared project state only. Never writes activeScope / installedAdapters / monolito.
 * Acquires the state-writer lock (re-entrant).
 */
export function writeSharedProjectState(shared: KyroSharedProjectState): void {
  withStateWriterLock(() => writeSharedProjectStateUnlocked(shared));
}

/** Persist local overlay only. Never writes principles / team / monolito. */
export function writeLocalProjectState(local: KyroLocalProjectState): void {
  withStateWriterLock(() => writeLocalProjectStateUnlocked(local));
}

export interface ProjectLayerWrite {
  shared?: KyroSharedProjectState;
  local?: KyroLocalProjectState;
}

/**
 * Multi-file layer write in one lock critical section (R11).
 * Does not write monolito KYRO_STATE_PATH.
 */
export function writeProjectLayers(layers: ProjectLayerWrite): void {
  withStateWriterLock(() => writeProjectLayersUnlocked(layers));
}

export function writeSharedProjectStateUnlocked(shared: KyroSharedProjectState): void {
  assertStateWriterLeaseHealthy();
  writeJsonManaged(PROJECT_STATE_PATH, sanitizeSharedForWrite(shared));
}

export function writeLocalProjectStateUnlocked(local: KyroLocalProjectState): void {
  assertStateWriterLeaseHealthy();
  writeJsonManaged(LOCAL_STATE_PATH, sanitizeLocalForWrite(local));
}

export function writeProjectLayersUnlocked(layers: ProjectLayerWrite): void {
  assertStateWriterLeaseHealthy();
  if (layers.shared) writeSharedProjectStateUnlocked(layers.shared);
  if (layers.local) writeLocalProjectStateUnlocked(layers.local);
}

/** Partial update applied on top of the current effective project state. */
export interface ProjectStateLayerUpdate {
  scopes?: KyroScopeEntry[];
  activeScope?: string | null;
  installedAdapters?: KyroInstalledAdapter[];
  principles?: Principle[];
  team?: TeamPolicy;
  artifactRoot?: string;
  runtimePath?: string;
}

/**
 * Apply a partial update to the correct layer(s). Never writes monolito.
 *
 * - When layered files are missing but monolito exists: split the merged next state into layers,
 *   write both, archive monolito.
 * - When layers exist: write only the layers touched by the update (shared for scopes/principles/team/
 *   artifactRoot; local for activeScope/installedAdapters/runtimePath).
 * - When neither exists: create both layers from the update merged with defaults.
 */
export function updateProjectStateLayers(update: ProjectStateLayerUpdate): void {
  withStateWriterLock(() => updateProjectStateLayersUnlocked(update));
}

export function updateProjectStateLayersUnlocked(update: ProjectStateLayerUpdate): void {
  assertStateWriterLeaseHealthy();
  const current = readProjectState();
  const base: KyroProjectState = current ?? {
    schemaVersion: 4,
    artifactRoot: ARTIFACT_ROOT,
    scopes: [],
    activeScope: null,
    runtimePath: KYRO_ROOT,
    installedAdapters: [],
  };
  const next: KyroProjectState = {
    ...base,
    ...(update.artifactRoot !== undefined ? { artifactRoot: update.artifactRoot } : {}),
    ...(update.scopes !== undefined ? { scopes: update.scopes } : {}),
    ...(update.activeScope !== undefined ? { activeScope: update.activeScope } : {}),
    ...(update.installedAdapters !== undefined ? { installedAdapters: update.installedAdapters } : {}),
    ...(update.runtimePath !== undefined ? { runtimePath: update.runtimePath } : {}),
    ...(update.principles !== undefined ? { principles: update.principles } : {}),
    ...(update.team !== undefined ? { team: update.team } : {}),
  };

  const touchShared =
    update.scopes !== undefined
    || update.principles !== undefined
    || update.team !== undefined
    || update.artifactRoot !== undefined;
  const touchLocal =
    update.activeScope !== undefined
    || update.installedAdapters !== undefined
    || update.runtimePath !== undefined;

  const { shared, local } = splitMonolitoToLayers(next);

  if (!hasLayeredProjectStateOnDisk()) {
    writeProjectLayersUnlocked({ shared, local });
    archiveMonolitoIfPresentUnlocked();
    return;
  }

  if (touchShared) writeSharedProjectStateUnlocked(shared);
  if (touchLocal) writeLocalProjectStateUnlocked(local);
  // If update is empty, still a no-op; callers always pass at least one field.
  if (!touchShared && !touchLocal) {
    writeProjectLayersUnlocked({ shared, local });
  }
}

function archiveMonolitoIfPresentUnlocked(): void {
  if (!workspacePathExists(KYRO_STATE_PATH)) return;
  const from = assertSafeManagedPath(KYRO_STATE_PATH);
  const to = assertSafeManagedPath(KYRO_STATE_MIGRATED_PATH);
  renameSync(from, to);
}

// ---------------------------------------------------------------------------
// Sanitizers / normalizers
// ---------------------------------------------------------------------------

export function sanitizeSharedForWrite(shared: KyroSharedProjectState): KyroSharedProjectState {
  const cleaned = stripLegacyProjectFields({
    schemaVersion: 4 as const,
    artifactRoot: shared.artifactRoot || ARTIFACT_ROOT,
    scopes: Array.isArray(shared.scopes) ? shared.scopes.map(cloneScopeEntry) : [],
    ...(shared.principles !== undefined ? { principles: shared.principles.map(clonePrinciple) } : {}),
    ...(shared.team !== undefined ? { team: cloneTeamPolicy(shared.team) } : {}),
  }) as KyroSharedProjectState & Record<string, unknown>;
  delete cleaned.activeScope;
  delete cleaned.installedAdapters;
  delete cleaned.runtimePath;
  delete cleaned.kyroInvocation;
  delete cleaned.runtimeVersion;
  return {
    schemaVersion: 4,
    artifactRoot: cleaned.artifactRoot,
    scopes: cleaned.scopes,
    ...(cleaned.principles !== undefined ? { principles: cleaned.principles as Principle[] } : {}),
    ...(cleaned.team !== undefined ? { team: cleaned.team as TeamPolicy } : {}),
  };
}

export function sanitizeLocalForWrite(local: KyroLocalProjectState): KyroLocalProjectState {
  const cleaned = stripLegacyProjectFields({
    schemaVersion: 4 as const,
    activeScope: local.activeScope ?? null,
    installedAdapters: Array.isArray(local.installedAdapters)
      ? local.installedAdapters.map(cloneInstalledAdapter)
      : [],
    ...(local.runtimePath !== undefined ? { runtimePath: local.runtimePath } : {}),
  }) as KyroLocalProjectState & Record<string, unknown>;
  delete cleaned.principles;
  delete cleaned.team;
  delete cleaned.scopes;
  delete cleaned.artifactRoot;
  delete cleaned.kyroInvocation;
  delete cleaned.runtimeVersion;
  const result: KyroLocalProjectState = {
    schemaVersion: 4,
    activeScope: (cleaned.activeScope as string | null) ?? null,
    installedAdapters: (cleaned.installedAdapters as KyroInstalledAdapter[]) ?? [],
  };
  if (typeof cleaned.runtimePath === 'string' && cleaned.runtimePath) {
    result.runtimePath = cleaned.runtimePath;
  }
  if (
    typeof cleaned.execution === 'object'
    && cleaned.execution !== null
    && !Array.isArray(cleaned.execution)
    && typeof (cleaned.execution as { delegationEnabled?: unknown }).delegationEnabled === 'boolean'
  ) {
    result.execution = { delegationEnabled: (cleaned.execution as { delegationEnabled: boolean }).delegationEnabled };
  }
  return result;
}

/** Remove global-only / retired fields from any project-state-shaped object. */
export function stripLegacyProjectFields<T extends object>(value: T): T {
  const next = { ...value } as T & { runtimeVersion?: unknown; kyroInvocation?: unknown };
  delete next.runtimeVersion;
  delete next.kyroInvocation;
  return next;
}

function normalizeShared(raw: KyroSharedProjectState | null): KyroSharedProjectState {
  if (!raw) {
    return { schemaVersion: 4, artifactRoot: ARTIFACT_ROOT, scopes: [] };
  }
  const stripped = stripLegacyProjectFields({ ...raw }) as KyroSharedProjectState & {
    activeScope?: unknown;
    installedAdapters?: unknown;
  };
  delete stripped.activeScope;
  delete stripped.installedAdapters;
  return {
    schemaVersion: 4,
    artifactRoot: typeof stripped.artifactRoot === 'string' && stripped.artifactRoot
      ? stripped.artifactRoot
      : ARTIFACT_ROOT,
    scopes: Array.isArray(stripped.scopes) ? stripped.scopes : [],
    ...(stripped.principles !== undefined ? { principles: stripped.principles } : {}),
    ...(stripped.team !== undefined ? { team: stripped.team } : {}),
  };
}

function normalizeLocal(raw: KyroLocalProjectState | null): KyroLocalProjectState {
  if (!raw) {
    return { schemaVersion: 4, activeScope: null, installedAdapters: [] };
  }
  const stripped = stripLegacyProjectFields({ ...raw }) as KyroLocalProjectState & {
    principles?: unknown;
    team?: unknown;
  };
  delete stripped.principles;
  delete stripped.team;
  return {
    schemaVersion: 4,
    activeScope: stripped.activeScope ?? null,
    installedAdapters: Array.isArray(stripped.installedAdapters) ? stripped.installedAdapters : [],
    ...(typeof stripped.runtimePath === 'string' && stripped.runtimePath
      ? { runtimePath: stripped.runtimePath }
      : {}),
    ...(typeof stripped.execution === 'object'
      && stripped.execution !== null
      && !Array.isArray(stripped.execution)
      && typeof (stripped.execution as { delegationEnabled?: unknown }).delegationEnabled === 'boolean'
      ? { execution: { delegationEnabled: (stripped.execution as { delegationEnabled: boolean }).delegationEnabled } }
      : {}),
  };
}

function writeJsonManaged(relativePath: string, value: unknown): void {
  const absolute = assertSafeManagedPath(relativePath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

function workspacePathExists(relativePath: string): boolean {
  return existsSync(resolveManagedPath(relativePath));
}

function cloneScopeEntry(entry: KyroScopeEntry): KyroScopeEntry {
  return { id: entry.id, title: entry.title, status: entry.status };
}

function clonePrinciple(principle: Principle): Principle {
  return {
    id: principle.id,
    rule: principle.rule,
    severity: principle.severity,
    rationale: principle.rationale,
    ...(principle.check !== undefined ? { check: principle.check } : {}),
  };
}

function cloneTeamPolicy(team: TeamPolicy): TeamPolicy {
  return {
    ...(team.minPackageVersion !== undefined ? { minPackageVersion: team.minPackageVersion } : {}),
    ...(team.recommendedAdapters !== undefined
      ? { recommendedAdapters: [...team.recommendedAdapters] }
      : {}),
  };
}

function cloneInstalledAdapter(adapter: KyroInstalledAdapter): KyroInstalledAdapter {
  return {
    agent: adapter.agent,
    scope: adapter.scope,
    installedAt: adapter.installedAt,
    corePath: adapter.corePath,
    ...(adapter.commandsPath !== undefined ? { commandsPath: adapter.commandsPath } : {}),
    ...(adapter.skillsPath !== undefined ? { skillsPath: adapter.skillsPath } : {}),
  };
}
