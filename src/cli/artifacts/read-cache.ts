import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';

/**
 * In-process memo of file text, validated against the file on every use.
 *
 * An entry is served only when one fresh `stat` still matches the signature taken when the text was
 * read: device, inode, size, and nanosecond mtime and ctime. A rewrite by this or any other process
 * changes at least one of them (an atomic rename changes the inode; an in-place write moves mtime and
 * ctime). Kernel timestamps are coarse, so a same-size in-place rewrite inside one clock tick could
 * keep the signature; to close that window an entry is stored only when the file's mtime and ctime
 * are older than RACY_WINDOW_MS at read time (the "racily clean" rule git uses). Recently touched
 * files are simply re-read every time.
 *
 * The cache holds immutable strings only. Callers parse their own copy, so no caller can observe
 * another caller's mutation.
 */
const RACY_WINDOW_NS = 2_000n * 1_000_000n;
const MAX_ENTRIES = 512;
const MAX_ENTRY_BYTES = 8 * 1024 * 1024;

interface Entry {
  dev: bigint;
  ino: bigint;
  size: bigint;
  mtimeNs: bigint;
  ctimeNs: bigint;
  text: string;
  sha256: string;
}

export interface ValidatedFile {
  text: string;
  /** SHA-256 hex of the raw bytes (not of the decoded text). */
  sha256: string;
}

const entries = new Map<string, Entry>();

/** Read a file, serving the memoised text and byte digest while the file is provably unchanged. */
export function readFileValidated(absolutePath: string): ValidatedFile {
  const before = statSync(absolutePath, { bigint: true });
  const hit = entries.get(absolutePath);
  if (hit && hit.dev === before.dev && hit.ino === before.ino && hit.size === before.size
    && hit.mtimeNs === before.mtimeNs && hit.ctimeNs === before.ctimeNs) {
    return { text: hit.text, sha256: hit.sha256 };
  }
  entries.delete(absolutePath);
  const bytes = readFileSync(absolutePath);
  const result: ValidatedFile = {
    text: bytes.toString('utf-8'),
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
  if (!before.isFile() || before.size > BigInt(MAX_ENTRY_BYTES)) return result;
  // The signature must describe the bytes just read: re-stat after the read and require agreement.
  const after = statSync(absolutePath, { bigint: true });
  if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size
    || after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs) return result;
  const nowNs = BigInt(Date.now()) * 1_000_000n;
  if (before.mtimeNs > nowNs - RACY_WINDOW_NS || before.ctimeNs > nowNs - RACY_WINDOW_NS) return result;
  if (entries.size >= MAX_ENTRIES) entries.delete(entries.keys().next().value as string);
  entries.set(absolutePath, { dev: before.dev, ino: before.ino, size: before.size, mtimeNs: before.mtimeNs, ctimeNs: before.ctimeNs, ...result });
  return result;
}

/** Read a UTF-8 file through the validated memo. */
export function readTextValidated(absolutePath: string): string {
  return readFileValidated(absolutePath).text;
}

/** Drop every memoised entry (test hook and explicit invalidation). */
export function clearReadCache(): void {
  entries.clear();
}
