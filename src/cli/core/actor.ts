import { execFileSync } from 'node:child_process';
import type { ScopeAuthor } from '../types';

const GIT_CONFIG_TIMEOUT_MS = 2000;

/**
 * Lightweight email shape check — must stay in sync with validateScopeAuthor in schema.ts.
 * Not full RFC validation; only rejects values that would fail sprint.json schema.
 */
export function isPlausibleAuthorEmail(email: string): boolean {
  const trimmed = email.trim();
  return trimmed.length > 0 && trimmed.includes('@') && !/\s/.test(trimmed);
}

/**
 * Resolve the scope creator from local Git identity.
 *
 * Best-effort only: returns an author when at least one of `user.name` or a
 * schema-valid `user.email` is available. Present fields only; missing/invalid
 * fields are omitted (not empty strings).
 *
 * **Never throws and never blocks scope init.** Missing git, empty config,
 * timeouts, malformed values, or unexpected errors all yield `null`.
 * Does not fall back to USER/LOGNAME/KYRO_ACTOR — those are not scope-author identity.
 */
export function resolveScopeAuthorFromGit(
  options: { cwd?: string; now?: () => Date } = {},
): ScopeAuthor | null {
  try {
    const name = readGitConfig('user.name', options.cwd);
    const rawEmail = readGitConfig('user.email', options.cwd);
    // Drop emails that would fail schema validation — never write unvalidatable author data.
    const email = rawEmail && isPlausibleAuthorEmail(rawEmail) ? rawEmail.trim() : null;
    if (!name && !email) return null;
    const now = options.now ?? (() => new Date());
    return {
      ...(name ? { name } : {}),
      ...(email ? { email } : {}),
      source: 'git',
      capturedAt: now().toISOString(),
    };
  } catch {
    // Absolute last resort: identity capture must never surface as a hard failure.
    return null;
  }
}

/** Human-readable author line for CLI output (handles name-only / email-only). */
export function formatScopeAuthor(author: ScopeAuthor): string {
  if (author.name && author.email) return `${author.name} <${author.email}>`;
  if (author.name) return author.name;
  if (author.email) return author.email;
  return '';
}

function readGitConfig(key: string, cwd?: string): string | null {
  try {
    const raw = execFileSync('git', ['config', '--get', key], {
      encoding: 'utf8',
      timeout: GIT_CONFIG_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(cwd ? { cwd } : {}),
    });
    const value = raw.trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}
