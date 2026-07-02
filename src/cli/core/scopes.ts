import { listScopeNames } from '../artifacts/scopes';
import { readProjectState } from '../state';

export interface ScopeListEntry { id: string; title: string; status: string; active: boolean }
export interface ScopeListResult { scopes: ScopeListEntry[] }

export function listScopes(): ScopeListResult {
  const state = readProjectState();
  const byId = new Map<string, ScopeListEntry>();
  for (const entry of state?.scopes ?? []) byId.set(entry.id, { id: entry.id, title: entry.title, status: entry.status, active: entry.id === state?.activeScope });
  for (const id of listScopeNames()) if (!byId.has(id)) byId.set(id, { id, title: id, status: 'unknown', active: id === state?.activeScope });
  return { scopes: [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)) };
}
