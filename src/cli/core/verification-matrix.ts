import { readClosedSprint } from '../checkpoints/history';
import { allTasks, loadSprintForAnalysis } from './analysis';
import { hasStaleReview } from './review-material';
import type { ActiveSprint, SprintFile, Task } from '../types';

/**
 * Read-only scenario verification matrix: how much stored backing each spec scenario has.
 * Derived only from sprint.json and closed-sprint history; never writes, never gates, never traces.
 * Levels say what was recorded, not what is true: "verdict" means a pass verdict is on file.
 */
export type MatrixTaskLevel = 'linked' | 'evidence' | 'verdict';
export type MatrixLevel = 'none' | MatrixTaskLevel | 'unknown';

export const MATRIX_NOTE = 'Verdict recorded ≠ independent review: maker/checker identity is self-declared and not verified by Kyro.';
const RANK: Record<MatrixTaskLevel, number> = { linked: 1, evidence: 2, verdict: 3 };

export interface MatrixTask {
  id: string;
  sprint: number;
  source: 'active' | 'history';
  level: MatrixTaskLevel;
  /** False for disposed tasks: listed for honesty, excluded from the scenario level. */
  counted: boolean;
  evidenceBy: string | null;
  verdictBy: string | null;
  sameDeclaredActor?: true;
  disposition?: string;
  notes: string[];
}

export interface MatrixScenario { id: string; requirement: string; level: MatrixLevel; tasks: MatrixTask[]; notes: string[] }
export interface MatrixHistorySprint { n: number; slug: string; source: string; status: 'read' | 'unknown'; reason?: string }

export interface VerificationMatrix {
  scope: string;
  scenarios: MatrixScenario[];
  summary: Record<MatrixLevel, number>;
  history: MatrixHistorySprint[];
  note: string;
  /** Present when there is nothing to tabulate (no spec, or a spec without scenarios). */
  message?: string;
}

export function buildVerificationMatrix(requestedScope: string | null): VerificationMatrix {
  const { scope, sprint } = loadSprintForAnalysis(requestedScope);

  const summary: Record<MatrixLevel, number> = { none: 0, linked: 0, evidence: 0, verdict: 0, unknown: 0 };
  if (!sprint.spec) return { scope, scenarios: [], summary, note: MATRIX_NOTE, history: [], message: `no spec traceability: ${scope} has no sprint.json spec, so there are no scenarios to tabulate.` };

  const byScenario = new Map<string, MatrixTask[]>();
  const add = (task: Task, row: MatrixTask): void => {
    for (const ref of new Set(Array.isArray(task.scenario_refs) ? task.scenario_refs : [])) {
      if (typeof ref !== 'string') continue;
      const list = byScenario.get(ref) ?? [];
      list.push(row);
      byScenario.set(ref, list);
    }
  };
  const history = readHistory(scope, sprint, add);
  if (sprint.activeSprint) {
    for (const task of allTasks(sprint.activeSprint)) add(task, taskRow(task, sprint.activeSprint.n, 'active', sprint));
  }
  const unknownSprints = history.filter((item) => item.status === 'unknown');

  const scenarios = (sprint.spec.scenarios ?? []).map((scenario): MatrixScenario => {
    const tasks = byScenario.get(scenario.id) ?? [];
    const notes: string[] = [];
    if (!sprint.spec!.requirements.some((r) => r.id === scenario.requirement)) notes.push(`requirement ${scenario.requirement} is not in spec.requirements`);
    let best: MatrixLevel = 'none';
    for (const task of tasks) if (task.counted && (best === 'none' || RANK[task.level] > RANK[best as MatrixTaskLevel])) best = task.level;
    if (unknownSprints.length) {
      const which = unknownSprints.map((item) => `sprint ${item.n}`).join(', ');
      // Unreadable history can only add backing: a known level is a lower bound, "none" cannot be claimed.
      if (best === 'none') { best = 'unknown'; notes.push(`${which} history unreadable; backing cannot be ruled out`); }
      else if (best !== 'verdict') notes.push(`lower bound: ${which} history unreadable`);
    }
    summary[best] += 1;
    return { id: scenario.id, requirement: scenario.requirement, level: best, tasks, notes };
  });
  return { scope, scenarios, summary, note: MATRIX_NOTE, history, ...(scenarios.length ? {} : { message: `${scope} spec has no scenarios to tabulate.` }) };
}

/** Tolerant: any unreadable, unverifiable or mismatched closed sprint becomes an `unknown` entry, never a failure. */
function readHistory(scope: string, sprint: SprintFile, add: (task: Task, row: MatrixTask) => void): MatrixHistorySprint[] {
  const out: MatrixHistorySprint[] = [];
  for (const entry of sprint.ledger ?? []) {
    const item: MatrixHistorySprint = { n: entry.n, slug: entry.slug, source: entry.checkpoint ? 'checkpoint' : entry.snapshot ? 'snapshot' : 'none', status: 'read' };
    try {
      const closed = readClosedSprint(scope, sprint, entry);
      let active: ActiveSprint | null = null;
      if ('failure' in closed) item.reason = closed.detail;
      else if (!closed.active) item.reason = `checkpoint for sprint ${entry.n} has no activeSprint`;
      else if (closed.active.n !== entry.n || closed.active.slug !== entry.slug) item.reason = `sprint ${entry.n} history identity does not match its ledger entry`;
      else active = closed.active;
      if (!active) { item.status = 'unknown'; out.push(item); continue; }
      // Rows are built before any is added, so a sprint that fails midway contributes nothing.
      const rows = allTasks(active).map((task) => [task, taskRow(task, entry.n, 'history', null)] as const);
      for (const [task, row] of rows) add(task, row);
    } catch (error) {
      item.status = 'unknown';
      item.reason = error instanceof Error ? error.message : String(error);
    }
    out.push(item);
  }
  return out;
}

/** `live` is the scope for active tasks (staleness applies); null for closed history (verdict taken as recorded). */
function taskRow(task: Task, sprintN: number, source: MatrixTask['source'], live: SprintFile | null): MatrixTask {
  const notes: string[] = [];
  const evidence = record(task.evidence);
  const verdict = record(task.verdict);
  const evidenceBy = actor(evidence?.by);
  const verdictBy = actor(verdict?.by);
  let level: MatrixTaskLevel = evidence ? 'evidence' : 'linked';
  if (verdict?.result === 'pass') {
    if (live && hasStaleReview(live, task)) { level = 'evidence'; notes.push('pass verdict is stale (task material changed after review)'); }
    else level = 'verdict';
  } else if (verdict) {
    level = 'evidence';
    notes.push(`verdict ${typeof verdict.result === 'string' ? verdict.result : 'unrecognized'} recorded`);
  }
  const disposition = typeof task.disposition?.kind === 'string' ? task.disposition.kind : undefined;
  if (disposition) notes.push(`disposed (${disposition}); not counted`);
  return {
    id: task.id, sprint: sprintN, source, level, counted: !disposition, evidenceBy, verdictBy,
    ...(evidenceBy && verdictBy && evidenceBy === verdictBy ? { sameDeclaredActor: true as const } : {}),
    ...(disposition ? { disposition } : {}),
    notes,
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function actor(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
