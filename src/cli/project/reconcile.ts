import { existsSync } from 'node:fs';
import { ARTIFACT_ROOT, KYRO_PROJECT_ROOT } from '../constants';
import { resolveManagedPath } from '../fs';
import { readJsonSafely } from '../artifacts/json';
import { sprintJsonPath } from '../artifacts/paths';
import { listScopeFolders } from '../artifacts/scopes';
import { asSprintFile, validateSprintFile } from '../artifacts/schema';
import { deriveScopeStatus } from '../core/status';
import { readProjectState } from '../state';
import type { KyroScopeEntry } from '../types';

export const REGISTRY_CLASS = {
  PRESENT_AND_REGISTERED: 'present-and-registered',
  ON_DISK_UNREGISTERED: 'on-disk-unregistered',
  REGISTERED_ORPHAN: 'registered-orphan',
  IDENTITY_CONFLICT: 'identity-conflict',
  IRRECONCILABLE: 'irreconcilable',
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
  return [...ids].sort().map((id) => classifyOne(id, registered.find((entry) => entry.id === id) ?? null, folders.includes(id)));
}

function classifyOne(id: string, registered: KyroScopeEntry | null, onDisk: boolean): RegistryClassification {
  if (registered && onDisk) {
    const derived = deriveFromSprint(id);
    if (derived && derived.id !== id) {
      return { id, classification: REGISTRY_CLASS.IDENTITY_CONFLICT, derivedEntry: derived, registeredEntry: registered, detail: `sprint.scope ${derived.id} does not match folder ${id}` };
    }
    if (derived && registered.id !== derived.id) {
      return { id, classification: REGISTRY_CLASS.IDENTITY_CONFLICT, derivedEntry: derived, registeredEntry: registered, detail: 'registered id does not match derived sprint identity' };
    }
    return { id, classification: REGISTRY_CLASS.PRESENT_AND_REGISTERED, derivedEntry: derived, registeredEntry: registered, detail: 'registered and present on disk' };
  }
  if (onDisk && !registered) {
    const derived = deriveFromSprint(id);
    if (!derived) {
      return { id, classification: REGISTRY_CLASS.IRRECONCILABLE, derivedEntry: null, registeredEntry: null, detail: `${sprintJsonPath(id)} is missing or invalid` };
    }
    if (derived.id !== id) {
      return { id, classification: REGISTRY_CLASS.IDENTITY_CONFLICT, derivedEntry: derived, registeredEntry: null, detail: `sprint.scope ${derived.id} does not match folder ${id}` };
    }
    return { id, classification: REGISTRY_CLASS.ON_DISK_UNREGISTERED, derivedEntry: derived, registeredEntry: null, detail: 'on disk with valid sprint.json; not in project.json' };
  }
  if (registered && !onDisk) {
    const root = resolveManagedPath(`${ARTIFACT_ROOT}/${id}`);
    if (existsSync(root)) {
      return { id, classification: REGISTRY_CLASS.IRRECONCILABLE, derivedEntry: null, registeredEntry: registered, detail: 'directory appeared during classification' };
    }
    return { id, classification: REGISTRY_CLASS.REGISTERED_ORPHAN, derivedEntry: null, registeredEntry: registered, detail: 'registered in project.json; directory absent' };
  }
  return { id, classification: REGISTRY_CLASS.IRRECONCILABLE, derivedEntry: null, registeredEntry: null, detail: 'neither registered nor present on disk' };
}

function deriveFromSprint(id: string): KyroScopeEntry | null {
  const read = readJsonSafely(sprintJsonPath(id));
  if (!read.exists || read.error) return null;
  if (validateSprintFile(read.value, sprintJsonPath(id)).length > 0) return null;
  const sprint = asSprintFile(read.value);
  if (!sprint) return null;
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
