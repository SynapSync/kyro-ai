import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

function isMdFile(path) {
  return path.endsWith('.md') && statSync(path).isFile();
}

import { readdirSync } from 'node:fs';

function* walkMdFiles(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkMdFiles(full);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      yield full;
    }
  }
}

function collectFiles(patterns) {
  const files = [];
  for (const pattern of patterns) {
    const full = resolve(root, pattern);
    try {
      if (statSync(full).isDirectory()) {
        files.push(...walkMdFiles(full));
      } else if (isMdFile(full)) {
        files.push(full);
      }
    } catch {
      // skip missing patterns
    }
  }
  return files;
}

const linkRe = /\[([^\]]*)\]\(([^)]+)\)/g;

let exitCode = 0;

function checkFile(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const baseDir = dirname(filePath);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let match;
    linkRe.lastIndex = 0;

    while ((match = linkRe.exec(line)) !== null) {
      const target = match[2].trim();

      // Skip external URLs, anchors, and wiki-links
      if (target.startsWith('http://') || target.startsWith('https://') || target.startsWith('#') || target.startsWith('mailto:')) {
        continue;
      }

      // Skip references starting with a slash (absolute paths in the filesystem, not markdown relative)
      if (target.startsWith('/')) {
        continue;
      }

      const resolved = resolve(baseDir, target);
      if (!existsSync(resolved)) {
        const relPath = relative(root, filePath);
        console.error(`BROKEN LINK: ${relPath}:${i + 1} -> ${target}`);
        exitCode = 1;
      }
    }
  }
}

const patterns = [
  'README.md',
  'docs',
  'skills',
  'agents',
  'commands',
];

const allFiles = collectFiles(patterns);

for (const file of allFiles) {
  checkFile(file);
}

if (exitCode === 0) {
  console.log(`All relative links valid (${allFiles.length} files checked)`);
}
process.exit(exitCode);
