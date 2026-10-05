#!/usr/bin/env node
import { scanLines } from './lib/scan.mjs';

// Live sprint.json readers that cannot use loadScopeSprint without changing behavior or error codes.
const exemptions = new Map([
  ['src/cli/commands/plan.ts', 'init mode tolerates a missing sprint.json; roadmap maps missing/invalid JSON to INVALID_SPRINT_SHAPE'],
  ['src/cli/commands/close-sprint.ts', 'a missing sprint.json falls back to checkpoint recovery'],
  ['src/cli/commands/repair.ts', 'normalizes the raw value before validating it'],
  ['src/cli/remediation/canonicalize-surface.ts', 'needs the raw value of legacy-shaped state'],
]); // do not add entries without a reason the loader cannot cover

const matches = scanLines("KyroCoreError\\(['\"](?:SCOPE_NOT_FOUND|INVALID_JSON)['\"]", 'src/cli');
const sprintErrors = matches.filter((line) =>
  /KyroCoreError\(['"]SCOPE_NOT_FOUND['"].*has no sprint\.json|KyroCoreError\(['"]INVALID_JSON['"].*sprint\.json (?:for|is invalid)/.test(line),
);
const found = new Set(sprintErrors.map((line) => line.split(':', 1)[0]));
const missing = [...exemptions.keys()].filter((file) => !found.has(file));
const extra = [...found].filter((file) => file !== 'src/cli/artifacts/load-sprint.ts' && !exemptions.has(file));
const unexpected = sprintErrors.filter((line) => !exemptions.has(line.split(':', 1)[0]) && line.split(':', 1)[0] !== 'src/cli/artifacts/load-sprint.ts');

// Post-write re-parse of sprint.json belongs to verifyWrittenSprint; no exemptions.
const postWrite = scanLines('wrote sprint\\.json but|Post-write sprint\\.json', 'src/cli').filter((line) => line.split(':', 1)[0] !== 'src/cli/artifacts/load-sprint.ts');

if (missing.length || extra.length || unexpected.length || postWrite.length) {
  if (missing.length) console.error(`Exempt files no longer match (remove the exemption):\n${missing.map((file) => `  ${file}`).join('\n')}`);
  if (extra.length) console.error(`Unexpected files with live sprint loader errors:\n${extra.map((file) => `  ${file}`).join('\n')}`);
  if (unexpected.length) console.error(`Unexpected live sprint loader errors:\n${unexpected.join('\n')}`);
  if (postWrite.length) console.error(`Hand-written post-write sprint.json re-parse (use verifyWrittenSprint):\n${postWrite.join('\n')}`);
  process.exit(1);
}

console.log(`Sprint loader guard passed (${sprintErrors.length} exempt lines in ${exemptions.size} files; no hand-written post-write re-parse).`);
