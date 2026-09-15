import { sha256 } from './digest';
import type { ActiveSprint, SprintFile, Task } from '../types';

/** v1 material contract, unchanged so existing recorded digests remain comparable. */
export function reviewedMaterialDigest(scope: string, active: Pick<ActiveSprint, 'n' | 'slug'>, task: Task): string {
  return sha256({
    schemaVersion: 1,
    scope,
    sprint: { n: active.n, slug: active.slug },
    task: {
      id: task.id,
      title: task.title,
      description: task.description,
      filesToTouch: task.files_to_touch,
      context: task.context,
      acceptanceCriteria: task.acceptance_criteria,
      dependsOn: task.depends_on,
      scenarioRefs: task.scenario_refs ?? [],
      status: task.status,
      evidence: task.evidence,
      disposition: task.disposition ?? null,
    },
  });
}

/** Live freshness only. Never reinterpret immutable historical checkpoint transitions. */
export function hasStaleReview(sprint: Pick<SprintFile, 'scope' | 'activeSprint'>, task: Task): boolean {
  return Boolean(sprint.activeSprint && task.verdict?.result === 'pass'
    && task.verdict.reviewedMaterialDigest
    && task.verdict.reviewedMaterialDigest !== reviewedMaterialDigest(sprint.scope, sprint.activeSprint, task));
}
