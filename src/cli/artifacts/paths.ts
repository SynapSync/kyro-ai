import { ARTIFACT_ROOT, KYRO_PROJECT_ROOT, KYRO_STATE_PATH } from '../constants';

export function scopeRoot(scope: string): string {
  return `${ARTIFACT_ROOT}/${scope}`;
}

/** v4 single source of truth for a scope. */
export function sprintJsonPath(scope: string): string {
  return `${scopeRoot(scope)}/sprint.json`;
}

export function archiveDir(scope: string): string {
  return `${scopeRoot(scope)}/archive`;
}

/**
 * Sibling of `scopes/`, never a child of it (v4). A trace writer must never be able to create a
 * directory under ARTIFACT_ROOT that scope discovery (listScopeFolders) could mistake for a scope.
 */
export function traceDir(scope: string): string {
  return `${KYRO_PROJECT_ROOT}/trace/${scope}`;
}

export function traceEventsPath(scope: string): string {
  return `${traceDir(scope)}/${['events', 'ndjson'].join('.')}`;
}

/**
 * The trace location used through 4.47.0 (child of `scopes/{scope}/`). Writers never use this again
 * — it exists only so the trace reader can still surface history recorded before the trace root
 * moved. Never write here; do not resurrect this as the active trace path.
 */
export function legacyTraceEventsPath(scope: string): string {
  return `${scopeRoot(scope)}/trace/${['events', 'ndjson'].join('.')}`;
}

export function projectStatePath(): string {
  return KYRO_STATE_PATH;
}
