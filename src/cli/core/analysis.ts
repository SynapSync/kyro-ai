import { readJsonSafely } from '../artifacts/json';
import { sprintJsonPath } from '../artifacts/paths';
import { asSprintFile, asTaskEvidence, asTaskVerdict, taskEvidenceIssues } from '../artifacts/schema';
import { readProjectState } from '../state';
import type { ActiveSprint, AnalysisFinding, AnalysisSeverity, Phase, Principle, PrincipleCheck, SprintFile, Task } from '../types';
import { KyroCoreError } from './errors';
import { makerCheckerPolicy, policyIssues } from './policy';
import { resolveScope } from './scope-resolution';
import { deriveActiveSprintStatus, derivePhaseStatus, deriveScopeStatus, normalizeStoredPhaseStatus } from './status';
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
  const markers = countClarificationMarkers(sprint);
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
    collectCheckerFindings(sprint, principles).forEach((finding) => {
      n += 1;
      out.push({ ...finding, id: `A${String(n).padStart(3, '0')}` });
    });
    // Status coherence: a stored phase.status must match what its task leaves imply — the orphan-status
    // class of bug (a phase left "pending"/"executing" while all its tasks are "done"). This is
    // advisory (MEDIUM): it is surfaced here and in context-pack, and normalized by review/close/repair,
    // but it never blocks a user-invoked close — status bookkeeping should not wall a destructive gate.
    // Synonyms are normalized so vocabulary drift ("executing" ≈ "active") is not mistaken for real drift.
    for (const phase of active.phases ?? []) {
      const derived = derivePhaseStatus(phase);
      if (typeof phase.status === 'string' && normalizeStoredPhaseStatus(phase.status) !== derived) {
        add('MEDIUM', 'coherence', `phase ${phase.id} status "${phase.status}" contradicts task states (should be "${derived}")`, 'Run kyro review to advance tasks, or kyro repair to normalize phase status.');
      }
    }
    const derivedSprintStatus = deriveActiveSprintStatus(active);
    if (typeof active.status === 'string' && active.status !== derivedSprintStatus) {
      add('MEDIUM', 'coherence', `activeSprint status "${active.status}" contradicts task states (should be "${derivedSprintStatus}")`, 'Run kyro repair to normalize active sprint status.');
    }
  }
  // kyro.json scope status is a display cache; drift is MEDIUM (advisory), reconciled by repair.
  const scopeEntry = readProjectState()?.scopes?.find((entry) => entry.id === sprint.scope);
  if (scopeEntry) {
    const derivedScope = deriveScopeStatus(sprint, Boolean(sprint.activeSprint));
    if (scopeEntry.status !== derivedScope) {
      add('MEDIUM', 'coherence', `kyro.json scope status "${scopeEntry.status}" is stale (scope is "${derivedScope}")`, 'Run kyro repair to reconcile kyro.json with the sprint.');
    }
  }
  for (const finding of collectSpecFindings(sprint)) {
    n += 1;
    out.push({ ...finding, id: `A${String(n).padStart(3, '0')}` });
  }
  if (!Array.isArray(sprint.successCriteria) || sprint.successCriteria.length === 0) add('MEDIUM', 'spec', 'scope has no successCriteria', 'Add 2–5 technology-agnostic, measurable outcomes (see INIT).');
  return out.sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
}

export function countClarificationMarkers(sprint: SprintFile): number {
  return (JSON.stringify(sprint).match(/\[NEEDS CLARIFICATION/g) ?? []).length;
}

export function collectSpecFindings(sprint: SprintFile): AnalysisFinding[] {
  const spec = sprint.spec;
  if (!spec) return [];

  const out: AnalysisFinding[] = [];
  let n = 0;
  const add = (severity: AnalysisSeverity, detail: string, remedy: string): void => {
    n += 1;
    out.push({ id: `SPEC${String(n).padStart(3, '0')}`, severity, category: 'spec', detail, remedy });
  };

  const requirementIds = new Set(spec.requirements.map((requirement) => requirement.id));
  const scenarioIds = new Set(spec.scenarios.map((scenario) => scenario.id));
  const tasks = sprint.activeSprint ? allTasks(sprint.activeSprint) : [];
  const referencedRequirements = new Set<string>();
  const referencedScenarios = new Set<string>();

  for (const id of duplicateStrings(spec.requirements.map((requirement) => requirement.id))) {
    add('MEDIUM', `duplicate spec requirement id "${id}"`, 'Requirement ids must be unique within sprint.spec.requirements.');
  }
  for (const id of duplicateStrings(spec.scenarios.map((scenario) => scenario.id))) {
    add('MEDIUM', `duplicate spec scenario id "${id}"`, 'Scenario ids must be unique within sprint.spec.scenarios.');
  }

  for (const scenario of spec.scenarios) {
    if (requirementIds.has(scenario.requirement)) {
      referencedRequirements.add(scenario.requirement);
    } else {
      add('HIGH', `scenario ${scenario.id} references missing requirement "${scenario.requirement}"`, 'Fix scenario.requirement or add the missing requirement.');
    }
  }

  for (const task of tasks) {
    for (const scenarioRef of task.scenario_refs ?? []) {
      if (scenarioIds.has(scenarioRef)) {
        referencedScenarios.add(scenarioRef);
      } else {
        add('HIGH', `task ${task.id} scenario_refs "${scenarioRef}" which does not exist`, 'Fix task.scenario_refs or add the missing scenario.');
      }
    }
  }

  for (const requirement of spec.requirements) {
    if (!referencedRequirements.has(requirement.id)) {
      add('MEDIUM', `requirement ${requirement.id} has no scenario coverage`, 'Add at least one scenario that references this requirement, or remove/defer the requirement.');
    }
  }
  for (const scenario of spec.scenarios) {
    if (!referencedScenarios.has(scenario.id)) {
      add('MEDIUM', `scenario ${scenario.id} has no task coverage`, 'Add scenario_refs to at least one task, or remove/defer the scenario.');
    }
  }
  if (spec.openQuestions.length > 0) {
    add('MEDIUM', `${spec.openQuestions.length} spec open question(s) remain`, 'Resolve open questions via clarify before treating the spec as stable.');
  }

  for (const task of tasks) {
    const verdict = asTaskVerdict(task.verdict);
    if (task.status === 'done' && verdict?.result === 'pass' && (task.scenario_refs ?? []).length === 0) {
      add('MEDIUM', `task ${task.id} shipped without a scenario reference`, 'Add task.scenario_refs so completed work remains traceable to the spec.');
    }
  }

  return out;
}

export function collectCheckerFindings(sprint: SprintFile, principles: Principle[]): AnalysisFinding[] {
  const out: AnalysisFinding[] = [];
  let n = 0;
  const add = (severity: AnalysisSeverity, detail: string, remedy: string): void => {
    n += 1;
    out.push({ id: `CHECKER${String(n).padStart(3, '0')}`, severity, category: 'checker', detail, remedy });
  };
  const active = sprint.activeSprint;
  if (!active) return out;
  const nonNegotiableViolations = principles.filter((p) => p.check && p.severity === 'non-negotiable' && principleViolated(p.check, sprint));
  const requireSeparateChecker = makerCheckerPolicy().requireSeparateChecker;

  for (const task of allTasks(active)) {
    const evidence = asTaskEvidence(task.evidence);
    const verdict = asTaskVerdict(task.verdict);
    // A plain non-empty string counts as (minimal) recorded evidence — common for emergent tasks. The
    // richer checks below (timestamp ordering, separate-checker) need the structured object and simply
    // do not apply to string evidence; they are skipped rather than treated as failures.
    const rawEvidence = task.evidence as unknown;
    const hasEvidence = evidence !== null || (typeof rawEvidence === 'string' && rawEvidence.trim().length > 0);
    if (task.status === 'done' && !hasEvidence) {
      // Name the exact failing field(s) when evidence is a malformed object; keep the base wording
      // for null/absent evidence (validateTaskEvidence's "must be an object … or null" message is
      // misleading there). The substring "missing or malformed evidence" is preserved either way —
      // check:maker-checker asserts on it.
      const malformedObject = typeof rawEvidence === 'object' && rawEvidence !== null;
      const detail = malformedObject
        ? `task ${task.id} is done but has missing or malformed evidence: ${taskEvidenceIssues(rawEvidence).join('; ')}`
        : `task ${task.id} is done but has missing or malformed evidence`;
      add('CRITICAL', detail, 'Record task.evidence with summary, validation, files_changed, by, and recordedAt before review.');
    }
    if (task.status === 'done' && !verdict) {
      add('CRITICAL', `task ${task.id} is done but has missing or malformed verdict`, 'Run kyro review for the task so the tool owns the verdict write.');
    }
    if (!verdict || verdict.result !== 'pass') continue;
    // A pass verdict is only meaningful on an executed task. Without this, a pass written onto a
    // still-pending task produces no finding (every check below is done-gated), so review's own gate
    // never fires and the sprint lands in the inconsistent state pass+pending+handoff-stuck.
    if (task.status !== 'done') {
      add('CRITICAL', `task ${task.id} has a pass verdict but status is "${task.status}", not done`, 'A task must be executed (status done with recorded evidence) before it can be pass-reviewed. Run execute-task first, then kyro review.');
      continue;
    }
    const waived = (verdict.waived_criteria ?? []).map((w) => w.criterion);
    const missingCriteria = missingCheckedCriteria(task.acceptance_criteria ?? [], verdict.checked_criteria, waived);
    if (missingCriteria.length > 0) {
      add('CRITICAL', `task ${task.id} pass verdict did not check all acceptance_criteria (${missingCriteria.join('; ')})`, 'A pass verdict must check or waive (with a reason) every acceptance_criteria entry.');
    }
    if (nonNegotiableViolations.length > 0) {
      add('CRITICAL', `task ${task.id} has pass verdict while non-negotiable principle(s) are violated (${nonNegotiableViolations.map((p) => p.id).join(', ')})`, 'A non-negotiable principle violation must fail the review; fix the principle breach before passing the task.');
    }
    if (evidence && Date.parse(verdict.reviewedAt) < Date.parse(evidence.recordedAt)) {
      add('HIGH', `task ${task.id} verdict predates its evidence`, 'Re-run kyro review after recording the current task evidence.');
    }
    if (requireSeparateChecker && evidence && verdict.by === evidence.by) {
      add('CRITICAL', `task ${task.id} pass verdict was self-reviewed by ${verdict.by}`, 'Use a separate checker actor or disable maker_checker.requireSeparateChecker in policy.');
    }
  }
  return out;
}

function principleViolated(check: PrincipleCheck, sprint: SprintFile): boolean {
  switch (check) {
    case 'no-clarification-markers': return /\[NEEDS CLARIFICATION/.test(JSON.stringify(sprint));
    case 'success-criteria-present': return !Array.isArray(sprint.successCriteria) || sprint.successCriteria.length === 0;
    case 'tasks-have-acceptance-criteria': return sprint.activeSprint ? allTasks(sprint.activeSprint).some((t) => !Array.isArray(t.acceptance_criteria) || t.acceptance_criteria.length === 0) : false;
    default: return false;
  }
}

function missingCheckedCriteria(acceptanceCriteria: string[], checkedCriteria: string[], waivedCriteria: string[] = []): string[] {
  const satisfied = new Set([...checkedCriteria, ...waivedCriteria]);
  return acceptanceCriteria.filter((criterion) => !satisfied.has(criterion));
}

function duplicateStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

export function allTasks(active: ActiveSprint): Task[] {
  const out: Task[] = [];
  for (const phase of active.phases ?? ([] as Phase[])) for (const task of phase.tasks ?? []) out.push(task);
  for (const task of active.emergentTasks ?? []) out.push(task);
  return out;
}
