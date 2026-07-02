import { readJsonSafely } from '../artifacts/json';
import { sprintJsonPath } from '../artifacts/paths';
import { asSprintFile } from '../artifacts/schema';
import { readProjectState } from '../state';
import type { ActiveSprint, AnalysisFinding, AnalysisSeverity, Phase, Principle, PrincipleCheck, SprintFile, Task } from '../types';
import { KyroCoreError } from './errors';
import { policyIssues } from './policy';
import { resolveScope } from './scope-resolution';
import { emitBlockedReason, emitTraceEvent } from './trace';

const SEVERITY_ORDER: AnalysisSeverity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
const MAX_FINDINGS = 50;

export interface AnalysisResult {
  scope: string;
  findings: AnalysisFinding[];
  blocking: boolean;
}

export function runAnalysis(requestedScope: string | null): AnalysisResult {
  const scope = resolveScope(requestedScope);
  const read = readJsonSafely(sprintJsonPath(scope));
  if (!read.exists) throw new KyroCoreError('SCOPE_NOT_FOUND', `Scope "${scope}" has no sprint.json. Run /kyro:forge (INIT).`, 'Create the scope with /kyro:forge (INIT) or choose another scope.');
  if (read.error) throw new KyroCoreError('INVALID_JSON', `sprint.json for "${scope}" is invalid JSON (${read.error}).`, 'Fix invalid JSON or restore from an archive snapshot.');
  const sprint = asSprintFile(read.value);
  if (!sprint) throw new KyroCoreError('INVALID_SPRINT_SHAPE', `sprint.json for "${scope}" is not a valid v4 file.`, 'Run kyro doctor --artifacts for shape details.');

  const principles = readProjectState()?.principles ?? [];
  const findings = [
    ...collectPolicyFindings(),
    ...collectFindings(sprint, principles),
  ].slice(0, MAX_FINDINGS);
  const blocking = findings.some((f) => f.severity === 'CRITICAL' || f.severity === 'HIGH');
  emitTraceEvent({
    v: 1,
    ts: new Date().toISOString(),
    scope,
    type: 'validation_result',
    source: 'analyze',
    blocking,
    findingCount: findings.length,
    codes: findings.map((finding) => finding.id),
  });
  for (const finding of findings.filter((f) => f.severity === 'CRITICAL' || f.severity === 'HIGH').slice(0, 3)) {
    emitBlockedReason(scope, finding.detail, finding.id);
  }
  return { scope, findings, blocking };
}

function collectPolicyFindings(): AnalysisFinding[] {
  return policyIssues().map((issue, index) => ({
    id: `P${String(index + 1).padStart(3, '0')}`,
    severity: 'HIGH',
    category: 'policy',
    detail: `policy.json ${issue.field}: ${issue.message}`,
    remedy: 'Fix .agents/kyro/policy.json or remove it to use the safe default policy.',
  }));
}

export function collectFindings(sprint: SprintFile, principles: Principle[]): AnalysisFinding[] {
  const out: AnalysisFinding[] = [];
  let n = 0;
  const add = (severity: AnalysisSeverity, category: string, detail: string, remedy: string): void => {
    n += 1;
    out.push({ id: `A${String(n).padStart(3, '0')}`, severity, category, detail, remedy });
  };
  for (const p of principles) {
    if (!p.check) continue;
    if (principleViolated(p.check, sprint)) {
      const severity: AnalysisSeverity = p.severity === 'non-negotiable' ? 'CRITICAL' : p.severity === 'strong' ? 'HIGH' : 'MEDIUM';
      add(severity, 'principle', `principle ${p.id} violated (${p.rule})`, `Satisfy the principle or amend it explicitly. Rationale: ${p.rationale}`);
    }
  }
  const markers = (JSON.stringify(sprint).match(/\[NEEDS CLARIFICATION/g) ?? []).length;
  if (markers > 0) add('CRITICAL', 'clarity', `${markers} unresolved [NEEDS CLARIFICATION] marker(s)`, 'Resolve via the clarify mode before planning/executing.');
  const active = sprint.activeSprint;
  if (active) {
    const tasks = allTasks(active);
    if (tasks.length === 0) add('CRITICAL', 'coverage', 'active sprint has zero tasks', 'Generate tasks with plan-sprint, or this sprint cannot be executed or verified.');
    for (const t of tasks) if (!Array.isArray(t.acceptance_criteria) || t.acceptance_criteria.length === 0) add('CRITICAL', 'coverage', `task ${t.id} has no acceptance_criteria`, 'Every task must carry verifiable acceptance criteria (see plan-sprint).');
    const ids = new Set(tasks.map((t) => t.id));
    for (const t of tasks) for (const dep of t.depends_on ?? []) if (!ids.has(dep)) add('HIGH', 'dependencies', `task ${t.id} depends_on "${dep}" which does not exist`, 'Fix the depends_on reference or add the missing task.');
    const seen = new Set<string>();
    for (const t of tasks) { if (seen.has(t.id)) add('MEDIUM', 'consistency', `duplicate task id "${t.id}"`, 'Task ids must be unique within a sprint.'); seen.add(t.id); }
    for (const d of sprint.debt) if ((d.status === 'open' || d.status === 'in_progress') && typeof d.targetSprint === 'number' && d.targetSprint < active.n) add('HIGH', 'debt', `debt ${d.id} was due in sprint ${d.targetSprint} and is still ${d.status}`, 'Address it this sprint or re-target it explicitly with a reason.');
  }
  if (!Array.isArray(sprint.successCriteria) || sprint.successCriteria.length === 0) add('MEDIUM', 'spec', 'scope has no successCriteria', 'Add 2–5 technology-agnostic, measurable outcomes (see INIT).');
  return out.sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
}

function principleViolated(check: PrincipleCheck, sprint: SprintFile): boolean {
  switch (check) {
    case 'no-clarification-markers': return /\[NEEDS CLARIFICATION/.test(JSON.stringify(sprint));
    case 'success-criteria-present': return !Array.isArray(sprint.successCriteria) || sprint.successCriteria.length === 0;
    case 'tasks-have-acceptance-criteria': return sprint.activeSprint ? allTasks(sprint.activeSprint).some((t) => !Array.isArray(t.acceptance_criteria) || t.acceptance_criteria.length === 0) : false;
    default: return false;
  }
}

function allTasks(active: ActiveSprint): Task[] {
  const out: Task[] = [];
  for (const phase of active.phases ?? ([] as Phase[])) for (const task of phase.tasks ?? []) out.push(task);
  for (const task of active.emergentTasks ?? []) out.push(task);
  return out;
}
