import { existsSync, readdirSync } from 'node:fs';
import { ARTIFACT_ROOT, KYRO_STATE_PATH } from '../constants';
import { resolveManagedPath } from '../fs';
import { readJsonSafely } from './json';
import { asProjectState } from './schema';

export function listScopeNames(): string[] {
  const names = new Set<string>();
  const projectStateRead = readJsonSafely(KYRO_STATE_PATH);
  if (projectStateRead.exists && !projectStateRead.error) {
    const projectState = asProjectState(projectStateRead.value);
    for (const scope of projectState?.scopes ?? []) names.add(scope.id);
    if (projectState?.activeScope) names.add(projectState.activeScope);
  }
  for (const scope of listScopeFolders()) names.add(scope);
  return [...names].sort();
}

export function listScopeFolders(): string[] {
  const root = resolveManagedPath(ARTIFACT_ROOT);
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}
