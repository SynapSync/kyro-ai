import { ARTIFACT_ROOT, KYRO_STATE_PATH } from '../constants';

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

export function traceDir(scope: string): string {
  return `${scopeRoot(scope)}/trace`;
}

export function traceEventsPath(scope: string): string {
  return `${traceDir(scope)}/${['events', 'ndjson'].join('.')}`;
}

export function projectStatePath(): string {
  return KYRO_STATE_PATH;
}
