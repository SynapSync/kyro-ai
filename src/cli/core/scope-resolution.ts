import { listScopeFolders } from '../artifacts/scopes';
import { readProjectState } from '../state';
import { KyroCoreError } from './errors';

export function resolveScope(explicit: string | null): string {
  if (explicit) return explicit;
  const state = readProjectState();
  if (state?.activeScope) return state.activeScope;
  const scopes = new Set<string>((state?.scopes ?? []).map((s) => s.id));
  for (const folder of listScopeFolders()) scopes.add(folder);
  if (scopes.size === 1) return [...scopes][0];
  if (scopes.size === 0) throw new KyroCoreError('SCOPE_NOT_FOUND', 'No Kyro scopes found. Pass --kyro-scope <scope>.', 'Run kyro scope list or create a scope with /kyro:forge (INIT).');
  throw new KyroCoreError('SCOPE_NOT_FOUND', `Multiple scopes found (${[...scopes].sort().join(', ')}). Pass --kyro-scope <scope>.`, 'Choose a scope explicitly with --kyro-scope.');
}
