#!/usr/bin/env node
// Static guard: every mode/helper/template file a command router references must exist.
// Command files (commands/*.md) point agents at specific sprint-forge assets by repo-root
// relative path (e.g. `skills/sprint-forge/assets/modes/idea.md`). A rename or typo that
// leaves a command pointing at a missing asset is a silent routing break the link checker
// misses (these paths live in code spans, not markdown links). This asserts they resolve.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(fileURLToPath(import.meta.url), '../..');
const commandsDir = resolve(repo, 'commands');

// Matches repo-root-relative references into the sprint-forge asset tree.
const assetRe = /skills\/sprint-forge\/assets\/(?:modes|helpers|templates)\/[A-Za-z0-9_./-]+\.md/g;

const failures = [];
let referenceCount = 0;

for (const entry of readdirSync(commandsDir, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
  const commandPath = resolve(commandsDir, entry.name);
  const text = readFileSync(commandPath, 'utf-8');
  const refs = new Set(text.match(assetRe) ?? []);
  for (const ref of refs) {
    referenceCount++;
    if (!existsSync(resolve(repo, ref))) {
      failures.push(`commands/${entry.name} -> ${ref} (file not found)`);
    }
  }
}

if (failures.length > 0) {
  console.error(`ERROR: command references point at missing asset files:\n${failures.map((f) => `  - ${f}`).join('\n')}`);
  process.exit(1);
}

console.log(`check:command-modes — ${referenceCount} command asset references all resolve`);
