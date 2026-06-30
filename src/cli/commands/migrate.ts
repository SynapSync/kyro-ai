import { existsSync, readFileSync, readdirSync, mkdirSync, renameSync } from 'node:fs';
import { basename } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { KYRO_STATE_PATH } from '../constants';
import { resolveManagedPath } from '../fs';
import { readJsonSafely } from '../artifacts/json';
import { readProjectState } from '../state';
import { listScopeFolders } from '../artifacts/scopes';
import {
  archiveDir,
  scopeRoot,
  sprintJsonPath,
} from '../artifacts/paths';
import { validateSprintFile } from '../artifacts/schema';
import type {
  CliOptions,
  Convention,
  Debt,
  DebtStatus,
  KyroProjectState,
  KyroScopeEntry,
  NextAction,
  Roadmap,
  SprintFile,
} from '../types';

/** v3 files that get consolidated into sprint.json, then archived. */
const V3_SCOPE_FILES = [
  'state.json', 'index.json', 'events.ndjson', 'ROADMAP.md', 'ROADMAP.summary.json',
  'DEBT.summary.json', 'RE-ENTRY-PROMPTS.md', 'REENTRY-PROMPTS.md', 'README.md', 'PROJECT-README.md',
];

export async function migrate(options: CliOptions): Promise<void> {
  const scopes = resolveScopes(options.kyroScope);
  if (scopes.length === 0) {
    console.log('No Kyro scopes found to migrate.');
    return;
  }

  const targets = scopes.filter((scope) => needsMigration(scope));
  if (targets.length === 0) {
    console.log('All scopes are already v4 (sprint.json present). Nothing to migrate.');
    return;
  }

  console.log(`Will migrate to v4: ${targets.join(', ')}`);
  console.log('Each scope gets a new sprint.json; v3 files move to archive/v3-backup/.');
  if (options.dryRun) {
    console.log('Dry run complete. No files changed.');
    return;
  }
  if (!options.yes && !(await confirm())) {
    console.log('No changes made.');
    return;
  }

  for (const scope of targets) migrateScope(scope);
  upgradeProjectState(targets);
  console.log(`Migrated ${targets.length} scope(s) to v4.`);
}

function needsMigration(scope: string): boolean {
  return !existsSync(resolveManagedPath(sprintJsonPath(scope)));
}

function migrateScope(scope: string): void {
  const root = scopeRoot(scope);
  const sprint = buildSprintFromV3(scope);

  const issues = validateSprintFile(sprint, `${scope}/sprint.json`);
  if (issues.length > 0) {
    throw new Error(`Migration produced an invalid sprint.json for ${scope}: ${issues.map((i) => `${i.field} ${i.message}`).join('; ')}`);
  }

  // Safe-write sprint.json.
  writeJson(sprintJsonPath(scope), sprint);

  // Archive v3 files (preserve user evidence; never delete).
  const backup = `${archiveDir(scope)}/v3-backup`;
  mkdirSync(resolveManagedPath(backup), { recursive: true });
  for (const name of [...V3_SCOPE_FILES, 'rules.md']) {
    moveIfExists(`${root}/${name}`, `${backup}/${name}`);
  }
  // Move phases/ wholesale.
  const phases = resolveManagedPath(`${root}/phases`);
  if (existsSync(phases)) renameSync(phases, resolveManagedPath(`${backup}/phases`));

  console.log(`  ${scope}: sprint.json written, v3 files archived to ${backup}`);
}

function buildSprintFromV3(scope: string): SprintFile {
  const state = readJsonSafely(`${scopeRoot(scope)}/state.json`).value as Record<string, unknown> | null;
  const roadmapText = readTextIfExists(`${scopeRoot(scope)}/ROADMAP.md`);
  const rulesText = readTextIfExists(`${scopeRoot(scope)}/rules.md`) ?? readTextIfExists('.agents/kyro/scopes/rules.md');

  const title = firstHeading(roadmapText) ?? scope;
  const status = typeof state?.status === 'string' ? state.status : 'planning';
  const objective = firstParagraph(roadmapText) ?? `Migrated scope ${scope}.`;
  const conventions = parseConventions(rulesText);
  const roadmap = parseRoadmap(roadmapText, scope);
  const debt = parseDebt(scope);
  const ledger = buildLedger(scope, roadmap);

  return {
    schemaVersion: 4,
    scope,
    title,
    status,
    objective,
    conventions,
    roadmap,
    ledger,
    previousSprint: null,
    activeSprint: null,
    debt,
    handoff: {
      nextAction: mapNextAction(state?.nextAction),
      nextTaskId: null,
      blockers: [],
      note: `Migrated from v3. Re-plan the active sprint with /kyro:forge. Original v3 artifacts are in archive/v3-backup/.`,
      lastUpdated: today(),
    },
  };
}

function parseConventions(rulesText: string | null): Convention[] {
  if (!rulesText) return [];
  const conventions: Convention[] = [];
  let n = 0;
  for (const line of rulesText.split('\n')) {
    const match = line.match(/\[RULE-\d+\]\s*(.+)/i);
    if (match) {
      n += 1;
      const rule = match[1].replace(/\((?:\d{4}-\d{2}-\d{2}[^)]*)\)\s*$/, '').trim();
      conventions.push({ id: `rule-${n}`, rule, tags: ['migrated'], addedSprint: 1 });
    }
  }
  return conventions;
}

function parseRoadmap(roadmapText: string | null, scope: string): Roadmap {
  if (!roadmapText) {
    return { plannedSprintCount: 0, sizingRationale: `Migrated scope ${scope}; roadmap unknown.`, sprints: [] };
  }
  const numbers = new Set<number>();
  for (const m of roadmapText.matchAll(/Sprint\s+(\d+)/gi)) numbers.add(Number(m[1]));
  const sprints = [...numbers].sort((a, b) => a - b).map((nn) => ({ n: nn, slug: `sprint-${nn}`, title: `Sprint ${nn}`, state: 'closed' }));
  return { plannedSprintCount: sprints.length, sizingRationale: 'Reconstructed from v3 ROADMAP.md sprint references.', sprints };
}

function parseDebt(scope: string): Debt[] {
  const sources: string[] = [];
  const phases = resolveManagedPath(`${scopeRoot(scope)}/phases`);
  if (existsSync(phases)) {
    for (const entry of readdirSync(phases, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.md')) sources.push(readFileSync(`${phases}/${entry.name}`, 'utf-8'));
    }
  }
  const debt: Debt[] = [];
  let n = 0;
  for (const text of sources) {
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*\|\s*\d+\s*\|\s*([^|]+?)\s*\|[^|]*\|[^|]*\|\s*(open|in[- ]progress|resolved|deferred)\s*\|/i);
      if (m) {
        n += 1;
        debt.push({
          id: `debt-${n}`,
          title: m[1].trim(),
          origin: 1,
          priority: /critical/i.test(line) ? 'critical' : 'medium',
          status: normalizeDebtStatus(m[2]),
          targetSprint: null,
          note: 'Migrated from v3 debt table.',
        });
      }
    }
  }
  return debt;
}

function buildLedger(scope: string, roadmap: Roadmap): SprintFile['ledger'] {
  // Best-effort: each roadmap sprint with an archived markdown becomes a ledger line.
  return roadmap.sprints.map((s) => ({
    n: s.n,
    slug: s.slug,
    outcome: 'migrated',
    closedAt: today(),
    archive: `archive/v3-backup/phases/SPRINT-${s.n}-${s.slug}.md`,
  }));
}

function normalizeDebtStatus(raw: string): DebtStatus {
  const v = raw.toLowerCase().replace(/\s/g, '-');
  if (v === 'in-progress') return 'in_progress';
  if (v === 'resolved') return 'resolved';
  if (v === 'deferred') return 'deferred';
  return 'open';
}

function mapNextAction(raw: unknown): NextAction {
  const valid: NextAction[] = ['init', 'plan_sprint', 'execute_task', 'review_task', 'close_sprint', 'wrap_up'];
  if (typeof raw === 'string' && (valid as string[]).includes(raw)) return raw as NextAction;
  return 'plan_sprint';
}

function upgradeProjectState(migratedScopes: string[]): void {
  const state = readProjectState();
  const read = readJsonSafely(KYRO_STATE_PATH);
  const raw = (read.value ?? {}) as Record<string, unknown>;

  const existing: KyroScopeEntry[] = Array.isArray(state?.scopes)
    ? (state!.scopes as unknown[]).map(toScopeEntry).filter((s): s is KyroScopeEntry => s !== null)
    : Array.isArray(raw.scopes)
      ? (raw.scopes as unknown[]).map(toScopeEntry).filter((s): s is KyroScopeEntry => s !== null)
      : [];

  const byId = new Map(existing.map((s) => [s.id, s]));
  for (const scope of migratedScopes) {
    if (!byId.has(scope)) byId.set(scope, { id: scope, title: scope, status: 'active' });
  }

  const next: KyroProjectState = {
    schemaVersion: 4,
    artifactRoot: typeof raw.artifactRoot === 'string' ? raw.artifactRoot : '.agents/kyro/scopes',
    scopes: [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)),
    activeScope: typeof raw.activeScope === 'string' ? raw.activeScope : null,
    runtimeVersion: typeof raw.runtimeVersion === 'string' ? raw.runtimeVersion : '4.0.0',
    runtimePath: typeof raw.runtimePath === 'string' ? raw.runtimePath : '~/.agents/kyro/current',
    installedAdapters: Array.isArray(raw.installedAdapters) ? (raw.installedAdapters as KyroProjectState['installedAdapters']) : [],
  };
  writeJson(KYRO_STATE_PATH, next);
}

function toScopeEntry(value: unknown): KyroScopeEntry | null {
  if (typeof value === 'string') return { id: value, title: value, status: 'active' };
  if (value && typeof value === 'object' && typeof (value as KyroScopeEntry).id === 'string') {
    const v = value as KyroScopeEntry;
    return { id: v.id, title: v.title ?? v.id, status: v.status ?? 'active' };
  }
  return null;
}

function resolveScopes(requested: string | null): string[] {
  if (requested) return [requested];
  return listScopeFolders();
}

// --- small fs/text helpers ---

function writeJson(path: string, value: unknown): void {
  const abs = resolveManagedPath(path);
  const fs = require('node:fs') as typeof import('node:fs');
  fs.writeFileSync(abs, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
  JSON.parse(fs.readFileSync(abs, 'utf-8')); // re-parse to verify (safe-write contract)
}

function moveIfExists(from: string, to: string): void {
  const src = resolveManagedPath(from);
  if (existsSync(src)) renameSync(src, resolveManagedPath(to));
}

function readTextIfExists(path: string): string | null {
  const abs = resolveManagedPath(path);
  return existsSync(abs) ? readFileSync(abs, 'utf-8') : null;
}

function firstHeading(text: string | null): string | null {
  if (!text) return null;
  const m = text.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : null;
}

function firstParagraph(text: string | null): string | null {
  if (!text) return null;
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (t && !t.startsWith('#') && !t.startsWith('---') && !t.startsWith('|')) return t;
  }
  return null;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function confirm(): Promise<boolean> {
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question('Migrate v3 scopes to v4? [y/N] ');
    return answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes';
  } finally {
    rl.close();
  }
}

void basename;
