import { ARTIFACT_ROOT, KYRO_STATE_PATH } from '../constants';

export function scopeRoot(scope: string): string {
  return `${ARTIFACT_ROOT}/${scope}`;
}

export function scopeStatePath(scope: string): string {
  return `${scopeRoot(scope)}/state.json`;
}

export function scopeIndexPath(scope: string): string {
  return `${scopeRoot(scope)}/index.json`;
}

export function roadmapPath(scope: string): string {
  return `${scopeRoot(scope)}/ROADMAP.md`;
}

export function roadmapSummaryPath(scope: string): string {
  return `${scopeRoot(scope)}/ROADMAP.summary.json`;
}

export function debtSummaryPath(scope: string): string {
  return `${scopeRoot(scope)}/DEBT.summary.json`;
}

export function eventsPath(scope: string): string {
  return `${scopeRoot(scope)}/events.ndjson`;
}

export function rulesPath(): string {
  return `${ARTIFACT_ROOT}/rules.md`;
}

export function rulesIndexPath(): string {
  return `${ARTIFACT_ROOT}/rules.index.json`;
}

export function phasesPath(scope: string): string {
  return `${scopeRoot(scope)}/phases`;
}

export function sprintMarkdownPath(scope: string, sprint: string): string {
  return `${phasesPath(scope)}/${sprint}.md`;
}

export function sprintSummaryPath(scope: string, sprint: string): string {
  return `${phasesPath(scope)}/${sprint}.summary.json`;
}

export function projectStatePath(): string {
  return KYRO_STATE_PATH;
}
