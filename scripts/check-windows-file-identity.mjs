#!/usr/bin/env node
import { closeSync, fstatSync, lstatSync, mkdtempSync, openSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'kyro-file-identity-'));
const path = join(root, 'identity.txt');
let fd = null;

try {
  writeFileSync(path, 'identity probe\n', 'utf8');
  const before = lstatSync(path, { bigint: true });
  fd = openSync(path, 'r');
  const opened = fstatSync(fd, { bigint: true });
  const result = {
    platform: process.platform,
    node: process.version,
    lstat: { dev: String(before.dev), ino: String(before.ino) },
    fstat: { dev: String(opened.dev), ino: String(opened.ino) },
  };
  console.log(JSON.stringify(result));
  if (before.dev !== opened.dev || before.ino !== opened.ino) {
    throw new Error(`lstat/fstat identity mismatch: ${JSON.stringify(result)}`);
  }
} finally {
  if (fd !== null) closeSync(fd);
  rmSync(root, { recursive: true, force: true });
}

console.log('Windows file identity probe passed');
