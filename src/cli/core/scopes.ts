import { listScopeFolders, listScopeNames } from '../artifacts/scopes';
import { readJsonSafely } from '../artifacts/json';
import { sprintJsonPath } from '../artifacts/paths';
import { asSprintFile } from '../artifacts/schema';
import { readProjectState } from '../state';
import type { KyroProjectState, KyroScopeEntry } from '../types';
import { deriveScopeStatus } from './status';

export interface ScopeListEntry { id: string; title: string; status: string; active: boolean }
export interface ScopeListResult { scopes: ScopeListEntry[] }

export function listScopes(): ScopeListResult {
  const state = readProjectState();
  const byId = new Map<string, ScopeListEntry>();
  for (const entry of state?.scopes ?? []) byId.set(entry.id, { id: entry.id, title: entry.title, status: entry.status, active: entry.id === state?.activeScope });
  for (const id of listScopeNames()) if (!byId.has(id)) byId.set(id, { id, title: id, status: 'unknown', active: id === state?.activeScope });
  return { scopes: [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)) };
}

/**
 * Union on-disk scope folders into `kyro.json.scopes[]` without clobbering existing registry
 * entries. Used by install/sync so a workspace that only has committed scopes (kyro.json
 * gitignored) still gets a usable registry after init.
 *
 * - Existing scopes[] entries are left as-is (title/status owned by repair/analyze).
 * - Missing folder ids are appended with title/status derived from sprint.json when readable.
 * - activeScope is only auto-set when currently null and exactly one scope is known after merge.
 */
export function rehydrateScopesFromDisk(state: KyroProjectState): KyroProjectState {
  const byId = new Map<string, KyroScopeEntry>();
  for (const entry of state.scopes ?? []) {
    if (entry && typeof entry.id === 'string' && entry.id.length > 0) byId.set(entry.id, entry);
  }

  for (const id of listScopeFolders()) {
    if (byId.has(id)) continue;
    byId.set(id, discoverScopeEntry(id));
  }

  const scopes = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  let activeScope = state.activeScope ?? null;
  if (activeScope == null && scopes.length === 1) {
    activeScope = scopes[0].id;
  }

  return { ...state, scopes, activeScope };
}

/** Scope folders present under artifactRoot but missing from kyro.json.scopes[]. */
export function unregisteredScopeFolders(state: KyroProjectState | null): string[] {
  const folders = listScopeFolders();
  if (!state || !Array.isArray(state.scopes)) return folders;
  const registered = new Set(state.scopes.map((entry) => entry.id));
  return folders.filter((id) => !registered.has(id));
}

/** Interactive install prompt; mentions on-disk scopes when present. */
export function formatWorkspaceInitPrompt(scopeFolders: string[]): string {
  if (scopeFolders.length === 0) {
    return 'Initialize Kyro in this workspace? [y/N] ';
  }
  const sorted = [...scopeFolders].sort((a, b) => a.localeCompare(b));
  const list = sorted.join(', ');
  return (
    'Initialize Kyro in this workspace?\n' +
    `  Found ${sorted.length} existing scope(s) on disk: ${list}\n` +
    '  They will be registered in .agents/kyro/kyro.json (activeScope left unset if more than one).\n' +
    'Initialize? [y/N] '
  );
}

function discoverScopeEntry(id: string): KyroScopeEntry {
  const read = readJsonSafely(sprintJsonPath(id));
  if (read.exists && !read.error) {
    const sprint = asSprintFile(read.value);
    if (sprint) {
      return {
        id,
        title: sprint.title || id,
        status: deriveScopeStatus(sprint, Boolean(sprint.activeSprint)),
      };
    }
  }
  return { id, title: id, status: 'planning' };
}
