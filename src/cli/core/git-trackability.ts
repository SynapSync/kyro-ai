import { execFileSync } from 'node:child_process';

export interface GitTrackabilityDiagnostic {
  status: 'pass' | 'warn' | 'fail';
  name: string;
  detail: string;
  remedy?: string;
}

const ROOT_NEGATIONS = '!/.agents/\n!/.agents/kyro/\n!/.agents/kyro/.gitignore\n!/.agents/kyro/project.json\n!/.agents/kyro/scopes/';

/** Read-only Git diagnosis. Install/sync deliberately never writes a consumer's root .gitignore. */
export function diagnoseKyroGitTrackability(cwd = process.cwd()): GitTrackabilityDiagnostic {
  if (!isGitWorkspace(cwd)) {
    return { status: 'pass', name: 'Git trackability', detail: 'workspace is not a Git repository (check skipped)' };
  }

  const projectIgnored = isIgnored(cwd, '.agents/kyro/project.json');
  const scopesIgnored = isIgnored(cwd, '.agents/kyro/scopes/__kyro_trackability_probe__/sprint.json');
  if (projectIgnored || scopesIgnored) {
    const targets = [projectIgnored ? 'project.json' : null, scopesIgnored ? 'scopes/**' : null].filter(Boolean).join(', ');
    return {
      status: 'fail',
      name: 'Git trackability',
      detail: `shared Kyro state is ignored: ${targets}`,
      remedy: `Add these negations to the workspace root .gitignore, then commit the shared state:\n${ROOT_NEGATIONS}`,
    };
  }

  if (isIgnored(cwd, '.agents/kyro/.gitignore')) {
    return {
      status: 'warn',
      name: 'Git trackability',
      detail: '.agents/kyro/.gitignore is ignored; project.json and scopes/** remain trackable',
      remedy: `Add this exact negation to the workspace root .gitignore:\n!/.agents/kyro/.gitignore`,
    };
  }

  return { status: 'pass', name: 'Git trackability', detail: 'project.json, scopes/**, and .agents/kyro/.gitignore are trackable' };
}

function isGitWorkspace(cwd: string): boolean {
  try {
    return execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() === 'true';
  } catch {
    return false;
  }
}

function isIgnored(cwd: string, path: string): boolean {
  try {
    execFileSync('git', ['check-ignore', '-q', '--no-index', '--', path], { cwd, stdio: 'ignore' });
    return true;
  } catch (error: unknown) {
    const status = (error as { status?: number }).status;
    return status !== 1;
  }
}
