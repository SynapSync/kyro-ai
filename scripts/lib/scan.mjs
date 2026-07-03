import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

/**
 * Node-native replacement for `rg -n <pattern> <dir>`.
 *
 * Check scripts must run on any clean machine that has Node — they are part of
 * `npm run check`. Shelling out to ripgrep introduced a hidden host dependency
 * (a runner without `rg` failed with a cryptic `null`). This helper walks the
 * directory tree, applies a JavaScript RegExp per line, and returns matches as
 * `relPath:lineNumber:content` (forward slashes), matching the `rg -n` shape the
 * callers already parse.
 *
 * @param {string} pattern  RegExp source (case-sensitive, like default rg).
 * @param {string} dir       Directory to scan, relative to `cwd`.
 * @param {{ cwd?: string }} options
 * @returns {string[]} matching lines as `relPath:lineNumber:content`
 */
export function scanLines(pattern, dir, { cwd = process.cwd() } = {}) {
  const re = new RegExp(pattern);
  const root = resolve(cwd, dir);
  const results = [];
  for (const file of walkFiles(root)) {
    let text;
    try {
      text = readFileSync(file, 'utf-8');
    } catch {
      continue;
    }
    const relPath = file.slice(resolve(cwd).length + 1).split(sep).join('/');
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      if (re.test(lines[i])) results.push(`${relPath}:${i + 1}:${lines[i]}`);
    }
  }
  return results;
}

function walkFiles(current) {
  const files = [];
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const full = join(current, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}
