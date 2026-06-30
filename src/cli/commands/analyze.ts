import { readJsonSafely } from '../artifacts/json';
import { sprintJsonPath } from '../artifacts/paths';
import { asSprintFile } from '../artifacts/schema';
import { listScopeFolders } from '../artifacts/scopes';
import { readProjectState } from '../state';
import type { ActiveSprint, CliOptions, Phase, SprintFile, Task } from '../types';

/**
 * `kyro analyze` — semantic cross-check of a scope's sprint.json, modeled on spec-kit's `analyze`.
 * Where `doctor` validates SHAPE, this validates MEANING: unresolved ambiguity, coverage gaps,
 * broken dependencies, overdue debt. Findings are severity-triaged. Deterministic and harness-neutral
 * (the lesson: prose gets ignored by weak models, a CLI gate does not). Read-only — never writes.
 */
type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

interface Finding {
  id: string;
  severity: Severity;
  category: string;
  detail: string;
  remedy: string;
}

const SEVERITY_ORDER: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
const MAX_FINDINGS = 50;

export function analyze(options: Pick<CliOptions, 'kyroScope' | 'json'>): void {
  const scope = resolveScope(options.kyroScope);
  const read = readJsonSafely(sprintJsonPath(scope));
  if (!read.exists) {
    fail(`Scope "${scope}" has no sprint.json. Run kyro migrate or /kyro:forge (INIT).`);
  }
  if (read.error) {
    fail(`sprint.json for "${scope}" is invalid JSON (${read.error}).`);
  }
  const sprint = asSprintFile(read.value);
  if (!sprint) {
    fail(`sprint.json for "${scope}" is not a valid v4 file. Run kyro doctor --artifacts for shape details.`);
  }

  const findings = collectFindings(sprint).slice(0, MAX_FINDINGS);
  const blocking = findings.some((f) => f.severity === 'CRITICAL' || f.severity === 'HIGH');

  if (options.json) {
    console.log(JSON.stringify({ scope, findings, blocking }, null, 2));
  } else {
    printReport(scope, findings);
  }
  if (blocking) process.exit(1);
}

function collectFindings(sprint: SprintFile): Finding[] {
  const out: Finding[] = [];
  let n = 0;
  const add = (severity: Severity, category: string, detail: string, remedy: string): void => {
    n += 1;
    out.push({ id: `A${String(n).padStart(3, '0')}`, severity, category, detail, remedy });
  };

  // CRITICAL — unresolved ambiguity anywhere in the file.
  const markers = (JSON.stringify(sprint).match(/\[NEEDS CLARIFICATION/g) ?? []).length;
  if (markers > 0) {
    add('CRITICAL', 'clarity', `${markers} unresolved [NEEDS CLARIFICATION] marker(s)`, 'Resolve via the clarify mode before planning/executing.');
  }

  const active = sprint.activeSprint;
  if (active) {
    const tasks = allTasks(active);

    // CRITICAL — an active sprint with no tasks, or a task with no acceptance criteria.
    if (tasks.length === 0) {
      add('CRITICAL', 'coverage', 'active sprint has zero tasks', 'Generate tasks with plan-sprint, or this sprint cannot be executed or verified.');
    }
    for (const t of tasks) {
      if (!Array.isArray(t.acceptance_criteria) || t.acceptance_criteria.length === 0) {
        add('CRITICAL', 'coverage', `task ${t.id} has no acceptance_criteria`, 'Every task must carry verifiable acceptance criteria (see plan-sprint).');
      }
    }

    // HIGH — depends_on pointing at a task id that does not exist in the sprint.
    const ids = new Set(tasks.map((t) => t.id));
    for (const t of tasks) {
      for (const dep of t.depends_on ?? []) {
        if (!ids.has(dep)) add('HIGH', 'dependencies', `task ${t.id} depends_on "${dep}" which does not exist`, 'Fix the depends_on reference or add the missing task.');
      }
    }

    // MEDIUM — duplicate task ids make routing ambiguous.
    const seen = new Set<string>();
    for (const t of tasks) {
      if (seen.has(t.id)) add('MEDIUM', 'consistency', `duplicate task id "${t.id}"`, 'Task ids must be unique within a sprint.');
      seen.add(t.id);
    }

    // HIGH — debt that was targeted at an earlier sprint and is still open (overdue).
    for (const d of sprint.debt) {
      if ((d.status === 'open' || d.status === 'in_progress') && typeof d.targetSprint === 'number' && d.targetSprint < active.n) {
        add('HIGH', 'debt', `debt ${d.id} was due in sprint ${d.targetSprint} and is still ${d.status}`, 'Address it this sprint or re-target it explicitly with a reason.');
      }
    }
  }

  // MEDIUM — no measurable success criteria for the scope (the WHAT/WHY layer).
  if (!Array.isArray(sprint.successCriteria) || sprint.successCriteria.length === 0) {
    add('MEDIUM', 'spec', 'scope has no successCriteria', 'Add 2–5 technology-agnostic, measurable outcomes (see INIT).');
  }

  return out.sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
}

function allTasks(active: ActiveSprint): Task[] {
  const out: Task[] = [];
  for (const phase of active.phases ?? ([] as Phase[])) {
    for (const task of phase.tasks ?? []) out.push(task);
  }
  for (const task of active.emergentTasks ?? []) out.push(task);
  return out;
}

function printReport(scope: string, findings: Finding[]): void {
  if (findings.length === 0) {
    console.log(`[OK] ${scope}: no semantic issues found.`);
    return;
  }
  const counts = SEVERITY_ORDER.map((s) => `${s}=${findings.filter((f) => f.severity === s).length}`).join('  ');
  console.log(`Analysis of ${scope} — ${findings.length} finding(s)  (${counts})\n`);
  for (const f of findings) {
    console.log(`[${f.severity}] ${f.id} (${f.category}): ${f.detail}`);
    console.log(`        ${f.remedy}`);
  }
}

function resolveScope(requested: string | null): string {
  if (requested) return requested;
  const state = readProjectState();
  if (state?.activeScope) return state.activeScope;
  const scopes = new Set<string>((state?.scopes ?? []).map((s) => s.id));
  for (const folder of listScopeFolders()) scopes.add(folder);
  if (scopes.size === 1) return [...scopes][0];
  if (scopes.size === 0) fail('No Kyro scopes found. Pass --kyro-scope <scope>.');
  fail(`Multiple scopes found (${[...scopes].sort().join(', ')}). Pass --kyro-scope <scope>.`);
}

function fail(message: string): never {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}
