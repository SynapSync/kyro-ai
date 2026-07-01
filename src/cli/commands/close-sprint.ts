import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { applyPlan, printPlan, resolveManagedPath } from '../fs';
import { readProjectState } from '../state';
import { readJsonSafely } from '../artifacts/json';
import { archiveDir, projectStatePath, scopeRoot, sprintJsonPath } from '../artifacts/paths';
import { asSprintFile, validateSprintFile } from '../artifacts/schema';
import { listScopeFolders } from '../artifacts/scopes';
import type { ActiveSprint, LedgerEntry, OperationPlan, SprintFile } from '../types';

/**
 * Deterministic, zero-loss sprint close. The TOOL — not the agent — owns the destructive step.
 *
 * Guarantee: the verbatim JSON snapshot of `activeSprint` is written to `archive/` BEFORE the live
 * `activeSprint` is ever cleared. A model cannot skip the snapshot or do a partial string edit here;
 * the whole `sprint.json` is re-serialized and re-parsed to verify. If a snapshot for this sprint
 * number already exists, the command refuses to run (double-close / audit-trail protection).
 *
 * The agent still owns the *judgment* work (narrative .md, conventions, debt extraction) — all of
 * which is additive. Only the irreversible snapshot+clear lives here.
 */
export interface CloseSprintArgs {
  scope: string | null;
  outcome: string;
  note: string | null;
  summary: string | null;
  recommendations: string[];
  learnings: string[];
  dryRun: boolean;
  yes: boolean;
  help: boolean;
}

export async function runCloseSprintCommand(rawArgs: string[]): Promise<void> {
  const args = parseCloseSprintArgs(rawArgs);
  if (args.help) {
    printCloseSprintHelp();
    return;
  }

  const scope = resolveScope(args.scope);
  const { sprint, plan, snapshotPath } = buildClosePlan(scope, args);
  printPlan(`Close sprint ${sprint.activeSprint!.n} (${sprint.activeSprint!.slug}) — zero-loss`, plan);
  console.log(`\nSnapshot (written first, never overwritten): ${snapshotPath}`);

  if (args.dryRun) {
    console.log('Dry run complete. No files changed.');
    return;
  }
  if (!args.yes) {
    const confirmed = await confirm(`Snapshot and close sprint ${sprint.activeSprint!.n} in scope "${scope}"? [y/N] `);
    if (!confirmed) {
      console.log('No changes made.');
      return;
    }
  }

  applyPlan(plan);

  // Re-parse the written sprint.json to prove validity (the safe-write verify step).
  const verify = readJsonSafely(sprintJsonPath(scope));
  if (verify.error || !verify.exists) {
    throw new Error(`Close wrote sprint.json but re-parse failed (${verify.error ?? 'missing'}). The snapshot at ${snapshotPath} preserves the sprint.`);
  }
  const issues = validateSprintFile(verify.value, `${scope}/sprint.json`);
  if (issues.length > 0) {
    const detail = issues.map((i) => `${i.field} ${i.message}`).join('; ');
    throw new Error(`Close wrote sprint.json but it failed validation — ${detail}. The snapshot at ${snapshotPath} preserves the sprint.`);
  }

  console.log(`\nSprint ${sprint.activeSprint!.n} closed. activeSprint cleared; ledger entry + snapshot recorded.`);
  console.log(`Next action: ${(verify.value as SprintFile).handoff.nextAction}.`);
}

export function buildClosePlan(
  scope: string,
  args: CloseSprintArgs,
): { sprint: SprintFile; plan: OperationPlan[]; snapshotPath: string } {
  const root = scopeRoot(scope);
  if (!existsSync(resolveManagedPath(root))) {
    throw new Error(`Scope not found: ${scope}`);
  }

  const read = readJsonSafely(sprintJsonPath(scope));
  if (!read.exists) {
    throw new Error(`Cannot close ${scope}: sprint.json not found. Run /kyro:forge (INIT) to create it.`);
  }
  if (read.error) {
    throw new Error(`Cannot close ${scope}: sprint.json is invalid JSON (${read.error}). Restore from an archive snapshot.`);
  }
  const issues = validateSprintFile(read.value, `${scope}/sprint.json`);
  if (issues.length > 0) {
    const detail = issues.map((i) => `${i.field} ${i.message}`).join('; ');
    throw new Error(`Cannot close ${scope}: sprint.json has shape drift — ${detail}. Fix it before closing.`);
  }

  const sprint = asSprintFile(read.value);
  if (!sprint) {
    throw new Error(`Cannot close ${scope}: sprint.json is not a valid v4 SprintFile.`);
  }
  const active = sprint.activeSprint;
  if (!active) {
    throw new Error(`Cannot close ${scope}: activeSprint is null (no sprint in progress). Nothing to snapshot.`);
  }

  const nnn = String(active.n).padStart(3, '0');
  const snapshotPath = `${archiveDir(scope)}/sprint-${nnn}-${active.slug}.json`;
  const narrativePath = `${archiveDir(scope)}/sprint-${nnn}-${active.slug}.md`;
  const archiveMdPath = `archive/sprint-${nnn}-${active.slug}.md`;
  const snapshotRel = `archive/sprint-${nnn}-${active.slug}.json`;

  // Audit-trail protection: never overwrite an existing snapshot. A collision means this sprint
  // number was already closed — exactly the double-close that destroyed Sprint 1 data before.
  if (existsSync(resolveManagedPath(snapshotPath))) {
    throw new Error(
      `Refusing to close: snapshot already exists at ${snapshotPath}. Sprint ${active.n} appears already closed; overwriting would destroy the audit trail.`,
    );
  }

  const closedAt = new Date().toISOString().slice(0, 10);
  const closed = applyClose(sprint, active, args, archiveMdPath, snapshotRel, closedAt);

  const plan: OperationPlan[] = [
    // 1. Snapshot FIRST — the verbatim, zero-loss record. Written before any mutation.
    { action: 'write', path: snapshotPath, content: `${JSON.stringify(active, null, 2)}\n` },
    // 2. Render the human narrative deterministically (title from roadmap — never undefined).
    { action: 'write', path: narrativePath, content: renderNarrative(sprint, active, args, closedAt) },
    // 3. Overwrite the whole sprint.json with activeSprint cleared.
    { action: 'write', path: sprintJsonPath(scope), content: `${JSON.stringify(closed, null, 2)}\n` },
  ];

  // 3. If this was the last sprint, flip the scope status in kyro.json (single, additive field).
  const remaining = closed.roadmap.sprints.filter((s) => s.state !== 'closed').length;
  if (remaining === 0) {
    const statePlan = buildScopeCompletedPlan(scope);
    if (statePlan) plan.push(statePlan);
  }

  return { sprint, plan, snapshotPath };
}

function applyClose(
  sprint: SprintFile,
  active: ActiveSprint,
  args: CloseSprintArgs,
  archiveMdPath: string,
  snapshotRel: string,
  closedAt: string,
): SprintFile {
  const ledgerEntry: LedgerEntry = {
    n: active.n,
    slug: active.slug,
    outcome: args.outcome,
    closedAt,
    archive: archiveMdPath,
    snapshot: snapshotRel,
    ...(args.recommendations.length > 0 ? { recommendations: args.recommendations } : {}),
  };

  const roadmapSprints = sprint.roadmap.sprints.map((s) =>
    s.n === active.n ? { ...s, state: 'closed' } : s,
  );
  const remaining = roadmapSprints.filter((s) => s.state !== 'closed').length;

  return {
    ...sprint,
    status: remaining === 0 ? 'completed' : sprint.status,
    ledger: [...sprint.ledger, ledgerEntry],
    previousSprint: {
      n: active.n,
      slug: active.slug,
      outcome: args.outcome,
      summary: args.summary ?? active.objective,
    },
    activeSprint: null,
    roadmap: { ...sprint.roadmap, sprints: roadmapSprints },
    handoff: {
      ...sprint.handoff,
      nextAction: remaining > 0 ? 'plan_sprint' : 'wrap_up',
      nextTaskId: null,
      note:
        args.note ??
        `Sprint ${active.n} (${active.slug}) closed as ${args.outcome}. ${remaining > 0 ? `${remaining} sprint(s) remain.` : 'No sprints remain — scope objective met.'}`,
      lastUpdated: closedAt,
    },
  };
}

/**
 * Render the human narrative .md deterministically. The TITLE is taken from `roadmap.sprints[]`
 * (the authoritative source, always present) with safe fallbacks — so it can never render
 * `Sprint N: undefined`, the failure that hand-rendered narratives produced. The agent supplies
 * only judgment text (learnings, recommendations) via args; structure comes from the snapshot.
 */
function renderNarrative(sprint: SprintFile, active: ActiveSprint, args: CloseSprintArgs, closedAt: string): string {
  const roadmapTitle = sprint.roadmap.sprints.find((s) => s.n === active.n)?.title;
  const title = roadmapTitle ?? active.title ?? active.objective;
  const nextN = active.n + 1;

  const lines: string[] = [];
  lines.push('---');
  lines.push(`title: '${sprint.scope} — Sprint ${active.n}: ${title.replace(/'/g, "''")}'`);
  lines.push(`date: '${closedAt}'`);
  lines.push(`scope: '${sprint.scope}'`);
  lines.push(`sprint: ${active.n}`);
  lines.push(`slug: '${active.slug}'`);
  lines.push(`outcome: '${args.outcome}'`);
  lines.push("type: 'sprint-archive'");
  lines.push('---');
  lines.push('');
  lines.push(`# Sprint ${active.n}: ${title}`);
  lines.push('');
  lines.push(`> Closed: ${closedAt}`);
  lines.push(`> Outcome: ${args.outcome}`);
  lines.push('');
  lines.push('## Objective');
  lines.push('');
  lines.push(active.objective);
  lines.push('');

  lines.push('## Definition of Done');
  lines.push('');
  if (active.definitionOfDone.length > 0) {
    for (const item of active.definitionOfDone) lines.push(`- ${item}`);
  } else {
    lines.push('_None recorded._');
  }
  lines.push('');

  lines.push('## Phases');
  lines.push('');
  for (const phase of active.phases) {
    lines.push(`### ${phase.id} — ${phase.title}`);
    lines.push('');
    if (phase.objective) {
      lines.push(`> ${phase.objective}`);
      lines.push('');
    }
    for (const task of phase.tasks) {
      lines.push(`#### ${task.id}: ${task.title}`);
      lines.push('');
      lines.push(`**Status**: ${task.status}`);
      lines.push('');
      if (task.description) {
        lines.push(`**Description**: ${task.description}`);
        lines.push('');
      }
      lines.push(...renderEvidence(task.evidence));
      lines.push(`**Verdict**: ${renderVerdict(task.verdict)}`);
      lines.push('');
      lines.push('---');
    }
  }
  lines.push('');

  lines.push('## Learnings');
  lines.push('');
  if (args.learnings.length > 0) {
    for (const item of args.learnings) lines.push(`- ${item}`);
  } else {
    lines.push('_No learnings recorded._');
  }
  lines.push('');

  lines.push('## Resolved Debt');
  lines.push('');
  const resolved = sprint.debt.filter((d) => d.status === 'resolved');
  if (resolved.length > 0) {
    for (const d of resolved) lines.push(`- **${d.id}**: ${d.title}`);
  } else {
    lines.push('_No debt resolved in this sprint._');
  }
  lines.push('');

  lines.push(`## Recommendations for Sprint ${nextN}`);
  lines.push('');
  if (args.recommendations.length > 0) {
    for (const item of args.recommendations) lines.push(`- ${item}`);
  } else {
    lines.push('_None recorded._');
  }
  lines.push('');

  return `${lines.join('\n')}`;
}

/** Tolerate evidence as a plain string OR an object { summary, validation, files_changed, notes }. */
function renderEvidence(evidence: unknown): string[] {
  if (evidence === null || evidence === undefined) {
    return ['**Evidence**: _No evidence recorded._', ''];
  }
  if (typeof evidence === 'string') {
    return [`**Evidence**: ${evidence}`, ''];
  }
  if (typeof evidence === 'object') {
    const e = evidence as Record<string, unknown>;
    const out: string[] = ['**Evidence**:'];
    if (typeof e.summary === 'string') out.push(`- Summary: ${e.summary}`);
    if (typeof e.validation === 'string') out.push(`- Validation: ${e.validation}`);
    if (Array.isArray(e.files_changed)) out.push(`- Files changed: ${e.files_changed.map((f) => `\`${String(f)}\``).join(', ')}`);
    if (typeof e.notes === 'string') out.push(`- Notes: ${e.notes}`);
    if (out.length === 1) out.push('- _Recorded (unstructured)._');
    out.push('');
    return out;
  }
  return [`**Evidence**: ${String(evidence)}`, ''];
}

/** Tolerate verdict as an object { result, findings } or null. */
function renderVerdict(verdict: unknown): string {
  if (verdict === null || verdict === undefined) return '_Not reviewed._';
  if (typeof verdict === 'string') return verdict;
  if (typeof verdict === 'object') {
    const v = verdict as Record<string, unknown>;
    const result = typeof v.result === 'string' ? v.result : 'recorded';
    const findings = Array.isArray(v.findings) && v.findings.length > 0
      ? ` — ${v.findings.map((f) => String(f)).join('; ')}`
      : '';
    return `${result}${findings}`;
  }
  return String(verdict);
}

function buildScopeCompletedPlan(scope: string): OperationPlan | null {
  const state = readProjectState();
  if (!state) return null;
  const entry = state.scopes.find((s) => s.id === scope);
  if (!entry || entry.status === 'completed') return null;
  const updated = {
    ...state,
    scopes: state.scopes.map((s) => (s.id === scope ? { ...s, status: 'completed' as const } : s)),
  };
  return { action: 'write', path: projectStatePath(), content: `${JSON.stringify(updated, null, 2)}\n` };
}

function resolveScope(requested: string | null): string {
  if (requested) return requested;
  const state = readProjectState();
  if (state?.activeScope) return state.activeScope;
  const scopes = new Set<string>((state?.scopes ?? []).map((s) => s.id));
  for (const folder of listScopeFolders()) scopes.add(folder);
  if (scopes.size === 1) return [...scopes][0];
  if (scopes.size === 0) throw new Error('No Kyro scopes found. Pass --kyro-scope <scope>.');
  throw new Error(`Multiple scopes found (${[...scopes].sort().join(', ')}). Pass --kyro-scope <scope>.`);
}

function parseCloseSprintArgs(args: string[]): CloseSprintArgs {
  let scope: string | null = null;
  let outcome = 'shipped';
  let note: string | null = null;
  let summary: string | null = null;
  const recommendations: string[] = [];
  const learnings: string[] = [];
  let dryRun = false;
  let yes = false;
  let help = false;

  const takeValue = (arg: string, i: number): [string, number] => {
    const inline = arg.indexOf('=');
    if (inline !== -1) return [arg.slice(inline + 1), i];
    const value = args[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${arg} requires a value`);
    return [value, i + 1];
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '--yes' || arg === '-y') yes = true;
    else if (arg === '--help' || arg === '-h') help = true;
    else if (arg === '--kyro-scope' || arg.startsWith('--kyro-scope=')) [scope, i] = takeValue(arg, i);
    else if (arg === '--outcome' || arg.startsWith('--outcome=')) [outcome, i] = takeValue(arg, i);
    else if (arg === '--note' || arg.startsWith('--note=')) [note, i] = takeValue(arg, i);
    else if (arg === '--summary' || arg.startsWith('--summary=')) [summary, i] = takeValue(arg, i);
    else if (arg === '--recommendation' || arg.startsWith('--recommendation=')) {
      const [value, next] = takeValue(arg, i);
      recommendations.push(value);
      i = next;
    } else if (arg === '--learning' || arg.startsWith('--learning=')) {
      const [value, next] = takeValue(arg, i);
      learnings.push(value);
      i = next;
    } else throw new Error(`Unknown option: ${arg}`);
  }

  return { scope, outcome, note, summary, recommendations, learnings, dryRun, yes, help };
}

function printCloseSprintHelp(): void {
  console.log(`kyro close-sprint — deterministic, zero-loss sprint close

The tool snapshots activeSprint to archive/ BEFORE clearing it, then records the
ledger entry. The snapshot is never overwritten (double-close protection).

Usage:
  kyro close-sprint [--kyro-scope <scope>] [options]

Options:
  --kyro-scope <scope>     Scope to close (defaults to the active/only scope)
  --outcome <text>         Sprint outcome (default: shipped)
  --note <text>            handoff.note for the next session
  --summary <text>         previousSprint summary (defaults to the sprint objective)
  --recommendation <text>  Recommendation for the next sprint (repeatable)
  --learning <text>        Learning to record in the narrative (repeatable)
  --dry-run                Show the plan without writing
  -y, --yes                Skip confirmation
  -h, --help               Show this help

Run the narrative/conventions/debt work in the close-sprint mode first; this
command owns only the irreversible snapshot + activeSprint clear.`);
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input, output });
  try {
    const answer = (await rl.question(question)).trim().toLowerCase();
    return answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}
