import { existsSync, readFileSync } from 'node:fs';
import { normalize } from 'node:path';
import { KyroCoreError } from './errors';

/**
 * Fail closed at the shared write boundary when a command attempts to overwrite a retired scope.
 * The retirement transaction itself reaches this boundary only for the initial non-retired image;
 * identical retries observe the frozen after-image and perform no sprint write.
 */
export function assertNotRetiredSprintOverwrite(path: string): void {
  const normalized = normalize(path).split('\\').join('/');
  if (!normalized.endsWith('/sprint.json') || !normalized.includes('/.agents/kyro/scopes/')) return;
  if (!existsSync(path)) return;
  let value: unknown;
  try { value = JSON.parse(readFileSync(path, 'utf-8')) as unknown; }
  catch { return; }
  if (!isRecord(value) || (value.status !== 'retired' && value.retirement === undefined)) return;
  const scope = typeof value.scope === 'string' && value.scope ? value.scope : '(unknown)';
  throw new KyroCoreError(
    'SCOPE_RETIRED',
    `Cannot modify retired scope "${scope}".`,
    'Retirement is terminal. Use status, context-pack, doctor, or analyze for read-only inspection; only an identical approved retirement retry may resume its transaction.',
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
