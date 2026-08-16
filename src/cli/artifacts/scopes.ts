import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
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
    .filter((name) => !isLegacyTraceOnlyLeftover(root, name))
    .sort();
}

/**
 * Through 4.47.0 trace events lived under scopes/{id}/trace/, so an install upgraded from that can
 * carry orphan directories holding nothing but that leftover. A directory whose only entry is
 * `trace` was never a real scope (a real scope always has sprint.json) — never let scope discovery
 * treat it as one.
 */
function isLegacyTraceOnlyLeftover(root: string, name: string): boolean {
  try {
    const entries = readdirSync(join(root, name));
    return entries.length === 1 && entries[0] === 'trace';
  } catch {
    return false;
  }
}
