import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { applyPlan, printPlan, resolveManagedPath } from '../fs';
import { readJsonSafely } from '../artifacts/json';
import { scopeRoot, sprintJsonPath } from '../artifacts/paths';
import { validateSprintFile } from '../artifacts/schema';
import type { CliOptions, OperationPlan } from '../types';
import { resolveScope } from '../core/scope-resolution';
import { emitToolCommandRun } from '../core/trace';

/**
 * Repair: validate and normalize a scope's sprint.json (stable formatting + trailing newline).
 * The sprint.json is the single source of truth; there is nothing else to regenerate.
 */
export async function repair(options: CliOptions): Promise<void> {
  const scope = resolveScope(options.kyroScope);
  const plan = buildRepairPlan(scope);
  printPlan('Repair plan', plan);

  if (options.dryRun) {
    console.log('Dry run complete. No files changed.');
    return;
  }
  if (!options.yes) {
    const confirmed = await confirmRepair();
    if (!confirmed) {
      console.log('No changes made.');
      return;
    }
  }
  emitToolCommandRun(scope, 'cli', 'repair');
  applyPlan(plan);
  console.log(`sprint.json normalized for scope: ${scope}`);
}

export function buildRepairPlan(scope: string): OperationPlan[] {
  const root = scopeRoot(scope);
  if (!existsSync(resolveManagedPath(root))) {
    throw new Error(`Scope not found: ${scope}`);
  }
  const read = readJsonSafely(sprintJsonPath(scope));
  if (!read.exists) {
    throw new Error(`Cannot repair ${scope}: sprint.json not found. Run /kyro:forge (INIT) to create it.`);
  }
  if (read.error) {
    throw new Error(`Cannot repair ${scope}: sprint.json is invalid JSON (${read.error}). Restore from an archive snapshot.`);
  }
  const issues = validateSprintFile(read.value, `${scope}/sprint.json`);
  if (issues.length > 0) {
    const detail = issues.map((i) => `${i.field} ${i.message}`).join('; ');
    throw new Error(`Cannot repair ${scope}: sprint.json has shape drift that needs manual review — ${detail}`);
  }
  // Valid: normalize formatting (2-space indent + trailing newline).
  return [{ action: 'write', path: sprintJsonPath(scope), content: `${JSON.stringify(read.value, null, 2)}\n` }];
}


async function confirmRepair(): Promise<boolean> {
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question('Normalize sprint.json? [y/N] ');
    return answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes';
  } finally {
    rl.close();
  }
}
