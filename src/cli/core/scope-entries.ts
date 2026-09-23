import { listRegistrableScopeDirectories, readScopeSprint } from '../artifacts/scopes';
import type { KyroScopeEntry } from '../types';
import { deriveScopeStatus } from './status';

/** A valid sprint whose declared scope matches its directory is the registry entry. */
export function scopeEntryFromDisk(id: string): KyroScopeEntry | null {
  const read = readScopeSprint(id);
  if (read.kind !== 'valid' || read.sprint.scope !== id) return null;
  const sprint = read.sprint;
  return {
    id,
    title: sprint.title || id,
    status: deriveScopeStatus(sprint, Boolean(sprint.activeSprint)),
    ...(sprint.completion ? { completion: sprint.completion } : {}),
    ...(sprint.completionHistory ? { completionHistory: sprint.completionHistory } : {}),
    ...(sprint.retirement ? { retirement: sprint.retirement } : {}),
  };
}

export function scopeEntriesFromDisk(): KyroScopeEntry[] {
  return listRegistrableScopeDirectories()
    .flatMap((id) => {
      const entry = scopeEntryFromDisk(id);
      return entry ? [entry] : [];
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}
