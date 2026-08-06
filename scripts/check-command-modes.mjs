#!/usr/bin/env node
// Static guard: every mode/helper/template file a command router references must exist.
// Command files (commands/*.md) use the stable projected-runtime path `skills/...`.
// The full package stores those assets under `internal/skills/...` so Claude does not auto-register
// them as slash commands. A rename or typo is still a silent routing break; map the runtime path
// back to its package source before checking existence.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(fileURLToPath(import.meta.url), '../..');
const commandsDir = resolve(repo, 'commands');

// Matches repo-root-relative references into any skill's asset tree.
const assetRe = /skills\/[a-z][a-z0-9-]*\/assets\/(?:modes|helpers|templates)\/[A-Za-z0-9_./-]+\.md/g;

const failures = [];
let referenceCount = 0;

for (const entry of readdirSync(commandsDir, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
  const commandPath = resolve(commandsDir, entry.name);
  const text = readFileSync(commandPath, 'utf-8');
  const refs = new Set(text.match(assetRe) ?? []);
  for (const ref of refs) {
    referenceCount++;
    const packageSource = ref.replace(/^skills\//, 'internal/skills/');
    if (!existsSync(resolve(repo, packageSource))) {
      failures.push(`commands/${entry.name} -> ${ref} (file not found)`);
    }
  }
}

if (failures.length > 0) {
  console.error(`ERROR: command references point at missing asset files:\n${failures.map((f) => `  - ${f}`).join('\n')}`);
  process.exit(1);
}

console.log(`check:command-modes — ${referenceCount} command asset references all resolve`);
