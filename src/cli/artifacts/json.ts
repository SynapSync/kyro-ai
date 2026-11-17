import { existsSync } from 'node:fs';
import { readFileValidated } from './read-cache';
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
    return { path, exists: true, value: JSON.parse(readFileValidated(absolutePath).text) as unknown, error: null };
  } catch (error) {
    return { path, exists: true, value: null, error: error instanceof Error ? error.message : String(error) };
  }
}

export interface JsonReadWithDigest extends JsonReadResult {
  /** SHA-256 hex of the exact bytes `value` was parsed from; null when the file is absent or unreadable. */
  sha256: string | null;
}

/** Like readJsonSafely, but also returns the digest of the very bytes that were parsed (no second read, no race). */
export function readJsonWithDigest(path: string): JsonReadWithDigest {
  const absolutePath = resolveManagedPath(path);
  if (!existsSync(absolutePath)) {
    return { path, exists: false, value: null, error: null, sha256: null };
  }
  let file;
  try {
    file = readFileValidated(absolutePath);
  } catch (error) {
    return { path, exists: true, value: null, error: error instanceof Error ? error.message : String(error), sha256: null };
  }
  try {
    return { path, exists: true, value: JSON.parse(file.text) as unknown, error: null, sha256: file.sha256 };
  } catch (error) {
    return { path, exists: true, value: null, error: error instanceof Error ? error.message : String(error), sha256: file.sha256 };
  }
}
