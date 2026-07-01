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

export function projectStatePath(): string {
  return KYRO_STATE_PATH;
}
