import { existsSync, readdirSync } from 'node:fs';
import { ARTIFACT_ROOT } from '../constants';
import { resolveManagedPath } from '../fs';
import { readProjectState } from '../state';

export function listScopeNames(): string[] {
  const names = new Set<string>();
  const projectState = readProjectState();
  if (projectState) {
    for (const scope of projectState.scopes) names.add(scope.id);
    if (projectState.activeScope) names.add(projectState.activeScope);
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
