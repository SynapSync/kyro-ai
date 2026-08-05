#!/usr/bin/env node
// Runs ONLY the token-audit assertions, so eager-context growth is caught by `npm run check`.
//
// Why this exists separately from `check:tokens` (`dist/cli.js doctor --tokens`): that command also
// runs the environment-dependent doctor checks — installed runtime version, CLI capabilities,
// project state on disk. Those legitimately FAIL on a dev machine with a stale global install, so
// the whole command could not be wired into `npm run check` without making local runs red for
// reasons unrelated to the code under review.
//
// The result was that budget regressions only surfaced in CI. 4.42.0 shipped a SKILL.md that blew
// its ceiling by 363 words and nobody found out until the pipeline went red. This script closes
// that gap: pure package-file measurement, no network, no installed runtime required.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(fileURLToPath(import.meta.url), '../..');
const require = createRequire(import.meta.url);

const { runTokenAuditChecks } = require(resolve(repo, 'dist/cli/commands/token-audit.js'));

const checks = runTokenAuditChecks();
const failures = checks.filter((check) => check.status === 'fail');
const warnings = checks.filter((check) => check.status === 'warn');

if (failures.length > 0) {
  console.error(`check:token-budgets — ${failures.length} budget failure(s):`);
  for (const check of failures) {
    console.error(`  [FAIL] ${check.name}: ${check.detail}`);
    if (check.remedy) console.error(`         ${check.remedy}`);
  }
  console.error('');
  console.error('Raising a ceiling is a deliberate policy change, not a formality: these files load');
  console.error('eagerly on every route. If the growth is load-bearing, raise the ceiling in');
  console.error('src/cli/commands/token-audit.ts and record why. Otherwise, move detail into a');
  console.error('lazy-loaded helper.');
  process.exit(1);
}

const label = warnings.length > 0 ? ` (${warnings.length} warn)` : '';
console.log(`check:token-budgets — ${checks.length - warnings.length} token-audit assertions passed${label}`);
