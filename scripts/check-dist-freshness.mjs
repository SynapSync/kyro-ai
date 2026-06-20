#!/usr/bin/env node
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(fileURLToPath(import.meta.url), '../..');
const distDir = resolve(root, 'dist');
const tscPath = resolve(root, 'node_modules/typescript/bin/tsc');

function error(message) {
  console.error(`ERROR: ${message}`);
  return { code: 2, message };
}

function walk(dir, baseDir = dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(fullPath, baseDir));
    } else {
      files.push(relative(baseDir, fullPath));
    }
  }
  return files.sort();
}

function compareFiles(file, tempDir) {
  const distPath = join(distDir, file);
  const tempPath = join(tempDir, file);
  const distStat = statSync(distPath);
  const tempStat = statSync(tempPath);
  if (distStat.size !== tempStat.size) return true;
  return Buffer.compare(readFileSync(distPath), readFileSync(tempPath)) !== 0;
}

function checkFreshness() {
  if (!existsSync(distDir)) {
    return error('dist/ does not exist. Run npm run build first.');
  }

  if (!existsSync(tscPath)) {
    return error('TypeScript compiler not found. Run npm install first.');
  }

  // Build into a temp directory inside the repo root so source-map source paths
  // (relative to the output directory) match those in the committed dist/.
  const tempDir = mkdtempSync(join(root, '.kyro-dist-check-'));

  try {
    const result = spawnSync(process.execPath, [tscPath, '--outDir', tempDir], {
      cwd: root,
      stdio: 'pipe',
      encoding: 'utf-8',
    });
    if (result.status !== 0) {
      console.error(result.stdout || result.stderr || 'tsc exited with no output');
      return error('tsc failed to generate fresh dist.');
    }

    const distFiles = new Set(walk(distDir));
    const tempFiles = new Set(walk(tempDir));

    const onlyInDist = [...distFiles].filter((file) => !tempFiles.has(file));
    const onlyInTemp = [...tempFiles].filter((file) => !distFiles.has(file));
    const commonFiles = [...distFiles].filter((file) => tempFiles.has(file));
    const contentDiffs = commonFiles.filter((file) => compareFiles(file, tempDir));

    const stale = onlyInDist.length > 0 || onlyInTemp.length > 0 || contentDiffs.length > 0;

    if (!stale) {
      return { code: 0, message: 'dist/ is fresh: generated output matches current src/.' };
    }

    const lines = ['dist/ is stale: generated output differs from current src/.'];
    if (onlyInDist.length > 0) {
      lines.push(`\nFiles present in dist/ but missing from fresh build (${onlyInDist.length}):`);
      for (const file of onlyInDist.slice(0, 20)) lines.push(`  - ${file}`);
      if (onlyInDist.length > 20) lines.push(`  ... and ${onlyInDist.length - 20} more`);
    }
    if (onlyInTemp.length > 0) {
      lines.push(`\nFiles missing from dist/ but present in fresh build (${onlyInTemp.length}):`);
      for (const file of onlyInTemp.slice(0, 20)) lines.push(`  - ${file}`);
      if (onlyInTemp.length > 20) lines.push(`  ... and ${onlyInTemp.length - 20} more`);
    }
    if (contentDiffs.length > 0) {
      lines.push(`\nFiles with differing content (${contentDiffs.length}):`);
      for (const file of contentDiffs.slice(0, 20)) lines.push(`  - ${file}`);
      if (contentDiffs.length > 20) lines.push(`  ... and ${contentDiffs.length - 20} more`);
    }
    lines.push('\nFix: run npm run build and commit the updated dist/.');
    return { code: 1, message: lines.join('\n') };
  } finally {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup; do not mask the real exit code.
    }
  }
}

const outcome = checkFreshness();
if (outcome.code === 0) {
  console.log(outcome.message);
} else {
  console.error(outcome.message);
}
process.exit(outcome.code);
