import type { SprintFile, Task } from '../types';

/** Linear-time cycle check; does not recurse on user-controlled dependency depth. */
export function dependencyCycle(tasks: Task[]): string[] {
  const ids = new Set(tasks.map((task) => task.id));
  const degree = new Map(tasks.map((task) => [task.id, 0]));
  const consumers = new Map<string, string[]>();
  for (const task of tasks) {
    for (const dep of new Set(task.depends_on ?? [])) {
      if (!ids.has(dep)) continue;
      degree.set(task.id, (degree.get(task.id) ?? 0) + 1);
      if (!consumers.has(dep)) consumers.set(dep, []);
      consumers.get(dep)!.push(task.id);
    }
  }
  const ready = [...degree].filter(([, n]) => n === 0).map(([id]) => id);
  for (let i = 0; i < ready.length; i += 1) {
    for (const id of consumers.get(ready[i]) ?? []) {
      const n = degree.get(id)! - 1;
      degree.set(id, n);
      if (n === 0) ready.push(id);
    }
  }
  return [...degree].filter(([, n]) => n > 0).map(([id]) => id).sort();
}

export function activeGraphIssues(sprint: SprintFile): string[] {
  const tasks = sprint.activeSprint
    ? [...sprint.activeSprint.phases.flatMap((phase) => phase.tasks), ...(sprint.activeSprint.emergentTasks ?? [])] : [];
  const scenarios = sprint.spec?.scenarios ?? [];
  const requirements = sprint.spec?.requirements ?? [];
  const issues: string[] = [];
  const unique = (ids: string[], kind: string): Set<string> => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) issues.push(`duplicate ${kind} id ${id}`);
      seen.add(id);
    }
    return seen;
  };
  const ids = unique(tasks.map((t) => t.id), 'task');
  unique(scenarios.map((s) => s.id), 'scenario');
  unique(requirements.map((r) => r.id), 'requirement');
  for (const t of tasks) {
    if (!t.acceptance_criteria?.length) issues.push(`task ${t.id} has no acceptance criteria`);
    for (const dep of t.depends_on ?? []) if (!ids.has(dep)) issues.push(`task ${t.id} depends on missing ${dep}`);
  }
  // Spec-reference decisions live in core/analysis.ts; callers must include its findings.
  const cycle = dependencyCycle(tasks);
  if (cycle.length) issues.push(`dependency cycle affects ${cycle.join(', ')}`);
  return issues;
}
