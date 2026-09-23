import { listScopeFolders } from '../artifacts/scopes';
import { readProjectState } from '../state';
import type { KyroProjectState } from '../types';
import { scopeEntriesFromDisk } from './scope-entries';

export interface ScopeListEntry { id: string; title: string; status: string; active: boolean }
export interface ScopeListResult { scopes: ScopeListEntry[] }

export function listScopes(): ScopeListResult {
  const state = readProjectState();
  return { scopes: scopeEntriesFromDisk().map((entry) => ({
    id: entry.id, title: entry.title, status: entry.status, active: entry.id === state?.activeScope,
  })) };
}

/**
 * Refresh the effective scope list from disk during install/sync. Local activeScope is
 * selected automatically only when exactly one valid scope exists.
 */
export function rehydrateScopesFromDisk(state: KyroProjectState): KyroProjectState {
  const scopes = scopeEntriesFromDisk();
  let activeScope = state.activeScope ?? null;
  if (activeScope !== null && !scopes.some((entry) => entry.id === activeScope)) activeScope = null;
  if (activeScope == null && scopes.length === 1) {
    activeScope = scopes[0].id;
  }

  return { ...state, scopes, activeScope };
}

/** Without project state, existing scope folders require workspace initialization. */
export function unregisteredScopeFolders(state: KyroProjectState | null): string[] {
  if (!state) return listScopeFolders();
  return [];
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
    '  Valid sprint.json files will define scopes (activeScope left unset if more than one).\n' +
    'Initialize? [y/N] '
  );
}
