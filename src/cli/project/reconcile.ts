import { lstatSync } from 'node:fs';
import { ARTIFACT_ROOT, KYRO_PROJECT_ROOT } from '../constants';
import { resolveManagedPath } from '../fs';
import { sprintJsonPath } from '../artifacts/paths';
import {
  SCOPE_DIR_CLASS,
  classifyScopeDirectory,
  listScopeFolders,
  readScopeSprint,
  type ScopeDirClass,
  type ScopeDirectory,
} from '../artifacts/scopes';
import { deriveScopeStatus } from '../core/status';
import { readProjectState } from '../state';
import type { KyroScopeEntry } from '../types';

export const REGISTRY_CLASS = {
  PRESENT_AND_REGISTERED: 'present-and-registered',
  ON_DISK_UNREGISTERED: 'on-disk-unregistered',
  REGISTERED_ORPHAN: 'registered-orphan',
  IDENTITY_CONFLICT: 'identity-conflict',
  /** sprint.json is present but unreadable/invalid. Fail closed for this scope only. */
  IRRECONCILABLE: 'irreconcilable',
  /** sprint.json is gone but a usable close checkpoint can resume it. */
  RECOVERABLE_CANDIDATE: 'recoverable-candidate',
  /** Kyro artifacts exist but nothing here can be resumed. Diagnose; promise nothing. */
  OWNED_DAMAGED: 'owned-damaged',
} as const;

export type RegistryClass = (typeof REGISTRY_CLASS)[keyof typeof REGISTRY_CLASS];

export interface RegistryClassification {
  id: string;
  classification: RegistryClass;
  derivedEntry: KyroScopeEntry | null;
  registeredEntry: KyroScopeEntry | null;
  detail: string;
}

export const REGISTRY_RECONCILIATION_KIND = 'kyro.registry-reconciliation' as const;
export const REGISTRY_RECONCILIATION_SCHEMA_VERSION = 1 as const;

export interface RegistryReconciliationRecord {
  schemaVersion: typeof REGISTRY_RECONCILIATION_SCHEMA_VERSION;
  kind: typeof REGISTRY_RECONCILIATION_KIND;
  id: string;
  retiredEntry: KyroScopeEntry;
  beforeDigest: string;
  afterDigest: string;
  reason: string;
  actor: string;
  kyroVersion: string;
  createdAt: string;
  previousChainHead: string | null;
}

export function registryReconciliationsDir(): string {
  return `${KYRO_PROJECT_ROOT}/registry-reconciliations`;
}

export function registryReconciliationPath(id: string): string {
  return `${registryReconciliationsDir()}/${id}.json`;
}

export function classifyRegistry(requestedScope: string | null = null): RegistryClassification[] {
  const state = readProjectState();
  const registered = state?.scopes ?? [];
  const folders = listScopeFolders();
  const ids = new Set<string>([...registered.map((entry) => entry.id), ...folders]);
  if (requestedScope) {
    ids.clear();
    ids.add(requestedScope);
  }
  return [...ids].sort().map((id) => classifyOne(id, registered.find((entry) => entry.id === id) ?? null));
}

/**
 * Classification is the cross product of two independent axes, not one flat list: what the
 * directory is (see SCOPE_DIR_CLASS) and whether project.json registers it. Collapsing them is what
 * previously made "sprint.json missing" and "sprint.json invalid" and "this is not a scope at all"
 * indistinguishable, so a stray folder produced the same hard blocker as real corruption.
 */
function classifyOne(id: string, registered: KyroScopeEntry | null): RegistryClassification {
  const directory = directoryStateOf(id);

  if (!directory.present) {
    if (registered) {
      return { id, classification: REGISTRY_CLASS.REGISTERED_ORPHAN, derivedEntry: null, registeredEntry: registered, detail: 'registered in project.json; directory absent' };
    }
    return { id, classification: REGISTRY_CLASS.IRRECONCILABLE, derivedEntry: null, registeredEntry: null, detail: 'neither registered nor present on disk' };
  }

  if (directory.issues.length > 0 && (registered || directory.class !== SCOPE_DIR_CLASS.FOREIGN)) {
    return {
      id,
      classification: REGISTRY_CLASS.OWNED_DAMAGED,
      derivedEntry: null,
      registeredEntry: registered,
      detail: directory.detail,
    };
  }

  if (directory.class === SCOPE_DIR_CLASS.FOREIGN) {
    // A foreign directory is not a scope, so a registry entry pointing at it is a bogus entry, not
    // a scope in trouble. Treating it as an orphan is what lets unregister-orphan clean up the
    // contamination an earlier install/sync rehydrate wrote into project.json.
    if (registered) {
      return { id, classification: REGISTRY_CLASS.REGISTERED_ORPHAN, derivedEntry: null, registeredEntry: registered, detail: 'registered in project.json; directory is not a Kyro scope' };
    }
    return { id, classification: REGISTRY_CLASS.IRRECONCILABLE, derivedEntry: null, registeredEntry: null, detail: 'neither registered nor a Kyro scope directory' };
  }

  if (directory.class === SCOPE_DIR_CLASS.CORRUPT_SPRINT) {
    // Previously a registered scope with an invalid sprint.json fell through to
    // PRESENT_AND_REGISTERED because deriveFromSprint returned null and nothing checked. Corruption
    // must classify as corruption whether or not the scope is registered.
    return { id, classification: REGISTRY_CLASS.IRRECONCILABLE, derivedEntry: null, registeredEntry: registered, detail: `${sprintJsonPath(id)} is present but invalid (${directory.detail})` };
  }

  if (directory.class === SCOPE_DIR_CLASS.RECOVERABLE) {
    return { id, classification: REGISTRY_CLASS.RECOVERABLE_CANDIDATE, derivedEntry: null, registeredEntry: registered, detail: directory.detail };
  }

  if (directory.class === SCOPE_DIR_CLASS.OWNED_DAMAGED) {
    return { id, classification: REGISTRY_CLASS.OWNED_DAMAGED, derivedEntry: null, registeredEntry: registered, detail: directory.detail };
  }

  const derived = deriveFromSprint(id);
  if (derived && derived.id !== id) {
    return { id, classification: REGISTRY_CLASS.IDENTITY_CONFLICT, derivedEntry: derived, registeredEntry: registered, detail: `sprint.scope ${derived.id} does not match folder ${id}` };
  }
  if (!derived) {
    return { id, classification: REGISTRY_CLASS.IRRECONCILABLE, derivedEntry: null, registeredEntry: registered, detail: `${sprintJsonPath(id)} could not be read as a scope identity` };
  }
  if (registered) {
    if (registered.id !== derived.id) {
      return { id, classification: REGISTRY_CLASS.IDENTITY_CONFLICT, derivedEntry: derived, registeredEntry: registered, detail: 'registered id does not match derived sprint identity' };
    }
    return { id, classification: REGISTRY_CLASS.PRESENT_AND_REGISTERED, derivedEntry: derived, registeredEntry: registered, detail: 'registered and present on disk' };
  }
  return { id, classification: REGISTRY_CLASS.ON_DISK_UNREGISTERED, derivedEntry: derived, registeredEntry: null, detail: 'on disk with valid sprint.json; not in project.json' };
}

interface DirectoryState {
  class: ScopeDirClass | null;
  present: boolean;
  detail: string;
  issues: ScopeDirectory['issues'];
}

function directoryStateOf(id: string): DirectoryState {
  // Re-stat rather than trusting the caller's folder list: the list excludes foreign directories,
  // so "not listed" alone cannot distinguish absent from present-but-not-ours.
  const path = resolveManagedPath(`${ARTIFACT_ROOT}/${id}`);
  try {
    lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { class: null, present: false, detail: 'directory absent', issues: [] };
    }
  }
  const classified = classifyScopeDirectory(id);
  return {
    class: classified.class,
    present: true,
    detail: classified.detail,
    issues: classified.issues,
  };
}

function deriveFromSprint(id: string): KyroScopeEntry | null {
  const read = readScopeSprint(id);
  if (read.kind !== 'valid') return null;
  const sprint = read.sprint;
  return {
    id: sprint.scope || id,
    title: sprint.title || id,
    status: deriveScopeStatus(sprint, Boolean(sprint.activeSprint)),
  };
}

export function validateRegistryReconciliationRecord(value: unknown, path: string): string[] {
  const issues: string[] = [];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return [`${path}: must be an object`];
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== REGISTRY_RECONCILIATION_SCHEMA_VERSION) issues.push(`${path}:schemaVersion must be 1`);
  if (record.kind !== REGISTRY_RECONCILIATION_KIND) issues.push(`${path}:kind must be ${REGISTRY_RECONCILIATION_KIND}`);
  for (const key of ['id', 'beforeDigest', 'afterDigest', 'reason', 'actor', 'kyroVersion', 'createdAt'] as const) {
    if (typeof record[key] !== 'string' || record[key].length === 0) issues.push(`${path}:${key} must be a non-empty string`);
  }
  if (typeof record.retiredEntry !== 'object' || record.retiredEntry === null) issues.push(`${path}:retiredEntry must be an object`);
  return issues;
}
