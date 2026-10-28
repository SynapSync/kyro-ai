import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { KyroCoreError } from '../core/errors';

/**
 * Bounded, no-follow, lossless UTF-8 source ingestion shared by `work create`
 * and `work amend-brief`.
 *
 * Policy (documented in docs/work.md):
 * - Never follow a symbolic link. The path is lstat'ed first and a link (or any
 *   non-regular entry) is refused before it is opened. The open adds O_NOFOLLOW
 *   where the platform has it (not on Windows); either way the opened
 *   descriptor's device/inode must equal the lstat'ed entry (bigint, so large
 *   Windows file IDs compare exactly), and the path is lstat'ed again after the
 *   open: it must still be that same non-link entry. A swap to a link or another
 *   file therefore fails closed. Residual (no O_NOFOLLOW, i.e. Windows): a link
 *   that appears and disappears entirely between the two checks can only be
 *   traversed to the verified file itself — never to different bytes.
 * - The opened descriptor must be a regular file. Directories, FIFOs, sockets,
 *   and devices are rejected even when opening them succeeds.
 * - A pre-read size check rejects sources larger than the documented bound.
 *   The descriptor read itself is capped at bound + 1 bytes, so a file that
 *   grows after the size check is still rejected instead of unboundedly read.
 * - A post-read identity check fails closed on source swap or in-place growth:
 *   device/inode must be unchanged, the final size must equal the bytes read,
 *   and mtime must be unchanged. Virtual files that misreport size (st_size 0
 *   with readable content) are rejected as changed during read.
 * - Bytes decode as strict UTF-8 (fatal) and must round-trip exactly, so a
 *   malformed sequence is never silently stored as U+FFFD. A leading UTF-8 BOM
 *   is preserved as U+FEFF (it re-encodes to the original bytes); valid
 *   Unicode and CRLF line endings pass through untouched.
 */
export const BRIEF_SOURCE_LIMIT = 1_048_576;

export interface BriefSource {
  bytes: Buffer;
  text: string;
  digest: string;
}

export function sha256Bytes(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Test seams for the portable no-follow open; production callers pass nothing. */
export interface BriefSourceOpenOptions {
  /** Override the platform O_NOFOLLOW flag (`null` simulates a platform without it, e.g. Windows). */
  noFollowFlag?: number | null;
  /** Runs between the lstat check and the open, to exercise swap races. */
  afterLinkCheck?: () => void;
}

/**
 * Open one brief source without following symbolic links, verify it, and read
 * its exact bytes. Throws INVALID_INPUT before any caller publishes state.
 */
export function readBriefSourceBytes(source: string, displayPath: string, openOptions: BriefSourceOpenOptions = {}): BriefSource {
  const platformNoFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : null;
  const noFollowFlag = openOptions.noFollowFlag === undefined ? platformNoFollow : openOptions.noFollowFlag;
  let entry;
  try {
    entry = lstatSync(source, { bigint: true });
  } catch (error) {
    throw new KyroCoreError(
      'INVALID_INPUT',
      `Brief source cannot be opened: ${displayPath}.`,
      `Provide an existing regular UTF-8 file. ${String(error)}`,
    );
  }
  if (entry.isSymbolicLink()) {
    throw new KyroCoreError(
      'INVALID_INPUT',
      `Brief source cannot be opened without following symbolic links: ${displayPath} is a symbolic link.`,
      'Pass the regular file itself; brief sources never follow symbolic links.',
    );
  }
  if (!entry.isFile()) {
    throw new KyroCoreError(
      'INVALID_INPUT',
      `Brief source is not a regular file: ${displayPath}.`,
      'Provide a regular UTF-8 brief file.',
    );
  }
  openOptions.afterLinkCheck?.();
  let descriptor: number;
  try {
    descriptor = openSync(source, constants.O_RDONLY | (noFollowFlag ?? 0));
  } catch (error) {
    throw new KyroCoreError(
      'INVALID_INPUT',
      `Brief source cannot be opened without following symbolic links: ${displayPath}.`,
      `Provide an existing regular UTF-8 file. ${String(error)}`,
    );
  }
  try {
    const opened = fstatSync(descriptor, { bigint: true });
    if (!opened.isFile()) {
      throw new KyroCoreError(
        'INVALID_INPUT',
        `Brief source is not a regular file: ${displayPath}.`,
        'Provide a regular UTF-8 brief file.',
      );
    }
    if (opened.dev !== entry.dev || opened.ino !== entry.ino) {
      throw new KyroCoreError(
        'INVALID_INPUT',
        `Brief source was replaced before it was opened: ${displayPath}.`,
        'Provide a stable regular file; retry once writers have finished.',
      );
    }
    // Without O_NOFOLLOW the open may traverse a link that replaced the path after the check. Re-check
    // the path itself: it must still be the same non-link entry, so a persistent swap fails closed.
    let after;
    try {
      after = lstatSync(source, { bigint: true });
    } catch {
      after = null;
    }
    if (!after || after.isSymbolicLink() || after.dev !== entry.dev || after.ino !== entry.ino) {
      throw new KyroCoreError(
        'INVALID_INPUT',
        `Brief source cannot be opened without following symbolic links: ${displayPath} changed while it was opened.`,
        'Provide a stable regular file that is not a symbolic link; retry once writers have finished.',
      );
    }
    if (opened.size > BigInt(BRIEF_SOURCE_LIMIT)) {
      throw new KyroCoreError(
        'INVALID_INPUT',
        'Brief source exceeds the 1 MiB input limit.',
        'Keep the brief concise; reference external material instead of embedding it.',
      );
    }
    const bytes = readBoundedBriefDescriptor(descriptor);
    return decodeBriefSourceBytes(bytes, displayPath);
  } finally {
    closeSync(descriptor);
  }
}

/**
 * Read at most the limit plus one byte from an already verified descriptor,
 * then fail closed when the source changed identity or size mid-read.
 */
export function readBoundedBriefDescriptor(descriptor: number): Buffer {
  const before = fstatSync(descriptor);
  const buffer = Buffer.allocUnsafe(BRIEF_SOURCE_LIMIT + 1);
  let length = 0;
  while (length < buffer.length) {
    const received = readSync(descriptor, buffer, length, buffer.length - length, null);
    if (received === 0) break;
    length += received;
  }
  if (length > BRIEF_SOURCE_LIMIT) {
    throw new KyroCoreError(
      'INVALID_INPUT',
      'Brief source exceeds the 1 MiB input limit.',
      'Keep the brief concise; reference external material instead of embedding it.',
    );
  }
  assertStableSourceIdentity(before, fstatSync(descriptor), length);
  return buffer.subarray(0, length);
}

interface SourceIdentity {
  dev: number | bigint;
  ino: number | bigint;
  size: number;
  mtimeMs: number;
}

/** Fail closed when the descriptor no longer names the verified source bytes. */
export function assertStableSourceIdentity(
  before: SourceIdentity,
  after: SourceIdentity,
  bytesRead: number,
): void {
  if (before.dev !== after.dev || before.ino !== after.ino) {
    throw new KyroCoreError(
      'INVALID_INPUT',
      'Brief source was replaced during read.',
      'Provide a stable regular file; retry once writers have finished.',
    );
  }
  if (after.size !== bytesRead) {
    throw new KyroCoreError(
      'INVALID_INPUT',
      'Brief source changed size during read.',
      'Provide a stable regular file; retry once writers have finished.',
    );
  }
  if (after.mtimeMs !== before.mtimeMs) {
    throw new KyroCoreError(
      'INVALID_INPUT',
      'Brief source was modified during read.',
      'Provide a stable regular file; retry once writers have finished.',
    );
  }
}

/** Strictly decode source bytes; malformed input never becomes U+FFFD. */
export function decodeBriefSourceBytes(bytes: Buffer, displayPath: string): BriefSource {
  void displayPath;
  let text: string;
  try {
    // ignoreBOM keeps a leading BOM as U+FEFF so valid BOM sources round-trip
    // byte-for-byte instead of being rejected or silently stripped.
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new KyroCoreError(
      'INVALID_INPUT',
      'Brief source contains malformed UTF-8.',
      'Provide a valid UTF-8 brief without malformed byte sequences.',
    );
  }
  if (!Buffer.from(text, 'utf8').equals(bytes)) {
    throw new KyroCoreError(
      'INVALID_INPUT',
      'Brief source cannot be decoded losslessly as UTF-8.',
      'Provide a valid UTF-8 brief whose bytes round-trip exactly.',
    );
  }
  return { bytes: Buffer.from(bytes), text, digest: sha256Bytes(bytes) };
}
