import { lstatSync } from 'node:fs';
import { ARTIFACT_ROOT } from '../constants';
import { SCOPE_DIR_CLASS, classifyScopeDirectory, listScopeFolders } from '../artifacts/scopes';
import { resolveManagedPath } from '../fs';
import { readProjectState } from '../state';
import { KyroCoreError } from './errors';

/**
 * Shared by every entry point that accepts an explicit --kyro-scope. Commands that bypass
 * resolveScope (integrity prepare, artifact doctor) must call this themselves, or a foreign
 * directory would still be reported as a damaged scope instead of a wrong name.
 *
 * Both axes decide, not the directory alone. Only UNREGISTERED + FOREIGN is a wrong name.
 * REGISTERED + FOREIGN is contamination an earlier rehydrate wrote into project.json: the id is a
 * real registry entry that must stay addressable, or `repair integrity prepare --kyro-scope <id>`
 * could never reach unregister-orphan and the only cleanup path would be a global scan.
 */
export function assertNotForeignDirectory(scope: string): void {
  let root: string;
  try {
    root = resolveManagedPath(`${ARTIFACT_ROOT}/${scope}`);
  } catch {
    return;
  }
  try {
    lstatSync(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
  }
  if (classifyScopeDirectory(scope).class !== SCOPE_DIR_CLASS.FOREIGN) return;
  if (isRegisteredScope(scope)) return;
  throw new KyroCoreError(
    'SCOPE_NOT_FOUND',
    `Scope not found: ${scope}. A directory of that name exists under ${ARTIFACT_ROOT}, but it holds no Kyro artifacts.`,
    'Run kyro scope list to see real scopes, or move that directory out of the scopes folder if it does not belong there.',
  );
}

function isRegisteredScope(scope: string): boolean {
  return (readProjectState()?.scopes ?? []).some((entry) => entry.id === scope);
}

export function resolveScope(explicit: string | null): string {
  if (explicit) {
    // An explicit --kyro-scope must not be a way around discovery. Pointing at a directory that
    // holds no Kyro artifacts is a wrong scope name, not a damaged scope, and must never be
    // reported as an integrity problem or become a registry entry.
    assertNotForeignDirectory(explicit);
    return explicit;
  }
  const state = readProjectState();
  if (state?.activeScope) return state.activeScope;
  const scopes = new Set<string>((state?.scopes ?? []).map((s) => s.id));
  for (const folder of listScopeFolders()) scopes.add(folder);
  if (scopes.size === 1) return [...scopes][0];
  if (scopes.size === 0) throw new KyroCoreError('SCOPE_NOT_FOUND', 'No Kyro scopes found. Pass --kyro-scope <scope>.', 'Run kyro scope list or create a scope with /kyro:forge (INIT).');
  throw new KyroCoreError('SCOPE_NOT_FOUND', `Multiple scopes found (${[...scopes].sort().join(', ')}). Pass --kyro-scope <scope>.`, 'Choose a scope explicitly with --kyro-scope.');
}
