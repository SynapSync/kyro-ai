import { existsSync, readFileSync } from 'node:fs';
import { resolveManagedPath } from '../fs';

export interface JsonReadResult {
  path: string;
  exists: boolean;
  value: unknown | null;
  error: string | null;
}

export function readJsonSafely(path: string): JsonReadResult {
  const absolutePath = resolveManagedPath(path);
  if (!existsSync(absolutePath)) {
    return { path, exists: false, value: null, error: null };
  }
  try {
    return { path, exists: true, value: JSON.parse(readFileSync(absolutePath, 'utf-8')) as unknown, error: null };
  } catch (error) {
    return { path, exists: true, value: null, error: error instanceof Error ? error.message : String(error) };
  }
}
