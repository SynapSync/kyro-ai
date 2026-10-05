#!/usr/bin/env node
import { scanLines } from './lib/scan.mjs';

const allowlist = new Set([
  'src/cli/commands/add-emergent.ts',
  'src/cli/commands/record-evidence.ts',
  'src/cli/commands/clarify.ts',
  'src/cli/commands/adr.ts',
  'src/cli/commands/plan.ts',
  'src/cli/commands/close-sprint.ts',
  'src/cli/commands/repair.ts',
  'src/cli/checkpoints/scope-completion.ts',
  'src/cli/checkpoints/scope-reopen.ts',
  'src/cli/commands/scope.ts',
  'src/cli/remediation/canonicalize-surface.ts',
]); // pending migration in step 2 — do not add new entries

const matches = scanLines("KyroCoreError\\(['\"](?:SCOPE_NOT_FOUND|INVALID_JSON)['\"]", 'src/cli');
const sprintErrors = matches.filter((line) =>
  /KyroCoreError\(['"]SCOPE_NOT_FOUND['"].*has no sprint\.json|KyroCoreError\(['"]INVALID_JSON['"].*sprint\.json (?:for|is invalid)/.test(line),
);
const found = new Set(sprintErrors.map((line) => line.split(':', 1)[0]));
const missing = [...allowlist].filter((file) => !found.has(file));
const extra = [...found].filter((file) => file !== 'src/cli/artifacts/load-sprint.ts' && !allowlist.has(file));
const unexpected = sprintErrors.filter((line) => !allowlist.has(line.split(':', 1)[0]) && line.split(':', 1)[0] !== 'src/cli/artifacts/load-sprint.ts');

if (missing.length || extra.length || unexpected.length) {
  if (missing.length) console.error(`Allowlisted files no longer match (remove from allowlist):\n${missing.map((file) => `  ${file}`).join('\n')}`);
  if (extra.length) console.error(`Unexpected files with live sprint loader errors:\n${extra.map((file) => `  ${file}`).join('\n')}`);
  if (unexpected.length) console.error(`Unexpected live sprint loader errors:\n${unexpected.join('\n')}`);
  process.exit(1);
}

console.log(`Sprint loader guard passed (${sprintErrors.length} known legacy lines in ${allowlist.size} allowlisted files).`);
