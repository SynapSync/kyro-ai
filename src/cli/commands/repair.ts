import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { applyPlan, printPlan, resolveManagedPath } from '../fs';
import { readProjectState } from '../state';
import { readJsonSafely } from '../artifacts/json';
import { scopeRoot, sprintJsonPath } from '../artifacts/paths';
import { validateSprintFile } from '../artifacts/schema';
import { listScopeFolders } from '../artifacts/scopes';
import type { CliOptions, OperationPlan } from '../types';

/**
 * v4 repair: validate and normalize a scope's sprint.json (stable formatting + trailing newline).
 * It does NOT regenerate v3 summaries/state/index — those artifacts no longer exist. To upgrade a
 * v3 scope, use `kyro migrate`.
 */
export async function repair(options: CliOptions): Promise<void> {
  const scope = resolveRepairScope(options.kyroScope);
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
    throw new Error(`Cannot repair ${scope}: sprint.json not found. Run 'kyro migrate --kyro-scope ${scope}' to upgrade a v3 scope.`);
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

function resolveRepairScope(requestedScope: string | null): string {
  if (requestedScope) return requestedScope;
  const state = readProjectState();
  if (state?.activeScope) return state.activeScope;
  const scopes = new Set<string>((state?.scopes ?? []).map((s) => s.id));
  for (const folder of listScopeFolders()) scopes.add(folder);
  if (scopes.size === 1) return [...scopes][0];
  if (scopes.size === 0) throw new Error('No Kyro scopes found. Pass --kyro-scope <scope>.');
  throw new Error(`Multiple scopes found (${[...scopes].sort().join(', ')}). Pass --kyro-scope <scope>.`);
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
