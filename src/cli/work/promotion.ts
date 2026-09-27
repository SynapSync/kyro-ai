import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { sprintJsonPath } from '../artifacts/paths';
import { validateSprintFile } from '../artifacts/schema';
import { atomicReplace } from '../checkpoints/sprint-close';
import { sha256 } from '../core/digest';
import { KyroCoreError } from '../core/errors';
import { assertSafeManagedPath, ensureDurableDirectory, fsyncDirectory, fsyncParentDirectory } from '../pipeline/state-writer-lock';
import { buildPlanInitPlan, buildPlanSprintPlan } from '../commands/plan';
import type {
  SprintFile,
  WorkFile,
  WorkPromotionJournal,
  WorkPromotionPreview,
  WorkPromotionSidecar,
  WorkTask,
} from '../types';
import { sha256Bytes } from './brief-source';
import { validateWorkFile } from './schema';

type LeanPlanInput = Parameters<typeof buildPlanInitPlan>[1];
type LeanSprintInput = Parameters<typeof buildPlanSprintPlan>[2];

export const PROMOTION_SCHEMA_VERSION = 1 as const;
export const PROMOTION_JOURNAL_NAME = '.pending-promotion.json';
export const PROMOTION_SIDECAR_NAME = 'promotion-source.json';
export const PROMOTION_ORIGIN_NAME = 'promotion-initial-sprint.json';
const PROMOTION_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface PromotionRequest {
  toScope: string;
  actor: string;
  expectedRevision: number;
}

/** Workspace-relative path of the pending promotion journal for a Work. */
export function workPromotionJournalPath(id: string): string {
  return `.agents/kyro/work/${id}/${PROMOTION_JOURNAL_NAME}`;
}

/** Workspace-relative path of the reciprocal sidecar for a target scope. */
export function promotionSidecarPath(scope: string): string {
  return `.agents/kyro/scopes/${scope}/${PROMOTION_SIDECAR_NAME}`;
}

export function promotionOriginPath(scope: string): string {
  return `.agents/kyro/scopes/${scope}/${PROMOTION_ORIGIN_NAME}`;
}

/**
 * Canonical digest binding one exact promotion request. Any retry must present
 * the same source, target, actor, and revision to reproduce this digest;
 * anything else fails closed instead of overwriting the intent.
 */
export function promotionRequestDigest(workId: string, request: PromotionRequest): string {
  return sha256({
    kind: 'work-promotion-request',
    schemaVersion: PROMOTION_SCHEMA_VERSION,
    part: 'request',
    work: workId,
    toScope: request.toScope,
    expectedRevision: request.expectedRevision,
    actor: request.actor,
  });
}

/**
 * Pure promotion planner. Reads nothing except an optional target-collision
 * probe (no writes); throws fail-closed before any caller publishes state.
 *
 * Transfer rules:
 * - Only unfinished, nonterminal tasks transfer (pending, in_progress,
 *   awaiting_review). Verified and disposed tasks are named history, never imports.
 * - A blocked source task fails the whole promotion: it must be resolved first.
 * - A dependency on a disposed task fails the promotion: disposed prerequisites
 *   never auto-rewire.
 * - A dependency on verified source work is dropped only with an explicit
 *   adjudication naming that verified source.
 * - Wn maps deterministically to T1.n in transferred source order; edges among
 *   transferred tasks are preserved. In-progress and awaiting-review tasks reset
 *   to pending and the preview states that loss of approval.
 * - Work evidence, verdicts, and passes never become Forge approvals or QA.
 */
export function planPromotionPreview(work: WorkFile, request: PromotionRequest): WorkPromotionPreview {
  const issues = validateWorkFile(work, `.agents/kyro/work/${work.id}/work.json`);
  if (issues.length) {
    throw new KyroCoreError(
      'INVALID_INPUT',
      `Work ${work.id} violates its contract at ${issues[0].field}: ${issues[0].message}.`,
      'Restore a CLI-owned Work before previewing promotion.',
    );
  }
  if (!PROMOTION_SLUG.test(request.toScope)) {
    throw new KyroCoreError(
      'INVALID_INPUT',
      `Promotion target scope is unsafe: ${request.toScope}.`,
      'Choose a lowercase hyphenated scope slug for the new Forge scope.',
    );
  }
  if (typeof request.actor !== 'string' || !request.actor.trim() || request.actor.length > 128) {
    throw new KyroCoreError(
      'INVALID_INPUT',
      'Promotion requires an explicit actor of 1-128 characters.',
      'Name the actor confirming this promotion.',
    );
  }
  if (!Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 1) {
    throw new KyroCoreError(
      'INVALID_INPUT',
      '--expect-revision must be a positive integer.',
      'Read Work status and retry from the current revision.',
    );
  }
  if (work.state === 'promoted') {
    throw new KyroCoreError(
      'INVALID_INPUT',
      `Work ${work.id} is already promoted and cannot be promoted again.`,
      'Promote a different unfinished Work; promotion is never repeated against another target.',
    );
  }
  if (work.state !== 'active' && work.state !== 'closed') {
    throw new KyroCoreError(
      'INVALID_INPUT',
      `Work ${work.id} is ${work.state} and has no transferable tasks.`,
      'Plan tasks before promoting; only unfinished Work promotes.',
    );
  }
  if (work.revision !== request.expectedRevision) {
    throw new KyroCoreError(
      'STATE_DIVERGED',
      `Work ${work.id} revision ${work.revision} does not match expected ${request.expectedRevision}.`,
      'Read Work status and retry from the current revision.',
    );
  }
  assertPromotionTargetAvailable(request.toScope);

  const blocked = work.tasks.filter((task) => task.status === 'blocked');
  if (blocked.length) {
    throw new KyroCoreError(
      'INVALID_INPUT',
      `Promotion blocked by ${blocked.length} blocked source task(s): ${blocked.map((task) => task.id).join(', ')}.`,
      'Resolve each blocked task before promotion; blocked work never transfers silently.',
    );
  }
  const byId = new Map(work.tasks.map((task) => [task.id, task]));
  const transferable = work.tasks.filter((task) => ['pending', 'in_progress', 'awaiting_review'].includes(task.status));
  if (!transferable.length) {
    throw new KyroCoreError(
      'INVALID_INPUT',
      `Work ${work.id} has no transferable unfinished tasks.`,
      'Promotion transfers only unfinished work; verified and disposed history stays behind.',
    );
  }
  for (const task of transferable) {
    for (const dependencyId of task.dependsOn) {
      const dependency = byId.get(dependencyId);
      if (!dependency) {
        throw new KyroCoreError(
          'INVALID_INPUT',
          `Work task ${task.id} depends on missing task ${dependencyId}.`,
          'Restore a CLI-owned Work; dependency mapping cannot be invented.',
        );
      }
      if (dependency.status === 'cancelled' || dependency.status === 'superseded') {
        throw new KyroCoreError(
          'INVALID_INPUT',
          `Work task ${task.id} depends on disposed prerequisite ${dependencyId}.`,
          'Amend the Work plan explicitly before promotion; disposed dependencies never auto-rewire.',
        );
      }
    }
  }

  const targetById = new Map<string, string>();
  transferable.forEach((task, index) => targetById.set(task.id, `T1.${index + 1}`));
  const transferred = transferable.map((task) => ({
    sourceId: task.id,
    targetId: targetById.get(task.id)!,
    title: task.title,
    acceptanceCriteria: [...task.acceptanceCriteria],
    filesToTouch: [...task.filesToTouch],
    dependsOn: task.dependsOn
      .filter((dependencyId) => targetById.has(dependencyId))
      .map((dependencyId) => targetById.get(dependencyId)!),
    sourceStatus: task.status,
    approvalReset: `Work ${task.status} does not carry approval: the Forge task starts pending with no evidence, no verdict, and no pass.`,
  }));
  const dependencyAdjudications = transferable.flatMap((task) =>
    task.dependsOn
      .filter((dependencyId) => {
        const dependency = byId.get(dependencyId)!;
        return dependency.status === 'verified' && !targetById.has(dependencyId);
      })
      .map((dependencyId) => ({
        task: targetById.get(task.id)!,
        dependsOn: targetById.get(dependencyId) ?? dependencyId,
        resolution: 'omitted_verified_source' as const,
        detail: `Source edge ${task.id} -> ${dependencyId} adjudicated explicitly: ${dependencyId} is verified Work history, so the Forge task starts without that prerequisite and its criteria must stand alone.`,
      })),
  );
  const omitted = (statuses: WorkTask['status'][], note: string) =>
    work.tasks
      .filter((task) => statuses.includes(task.status))
      .map((task) => ({ sourceId: task.id, status: task.status, note }));

  return {
    schemaVersion: PROMOTION_SCHEMA_VERSION,
    kind: 'work-promotion-preview',
    sourceWorkId: work.id,
    sourceRevision: work.revision,
    sourceBriefDigest: work.brief.digest,
    toScope: request.toScope,
    targetPath: sprintJsonPath(request.toScope),
    actor: request.actor,
    expectedRevision: request.expectedRevision,
    requestDigest: promotionRequestDigest(work.id, request),
    transferred,
    omittedVerified: omitted(['verified'], 'Verified Work history is excluded; only unfinished tasks transfer.'),
    omittedDisposed: omitted(
      ['cancelled', 'superseded'],
      'Disposed Work history is excluded; only unfinished tasks transfer.',
    ),
    dependencyAdjudications,
    workVerdictsImportedAsForgePass: false,
    forgeTasksStartPending: true,
  };
}

/** Fail closed when the destination already exists or the path is unsafe. */
export function assertPromotionTargetAvailable(toScope: string): void {
  const sprintPath = sprintJsonPath(toScope);
  const absolute = assertSafeManagedPath(sprintPath);
  void absolute;
  if (existsSync(assertSafeManagedPath(`.agents/kyro/scopes/${toScope}`))) {
    throw new KyroCoreError(
      'CHECKPOINT_CONFLICT',
      `Promotion target scope "${toScope}" already exists.`,
      'Choose a fresh --to-scope slug; promotion never merges into an existing or retired scope.',
    );
  }
}

/**
 * Build the reciprocal sidecar from a preview plus the exact digests of the
 * bytes the commit publishes. All digests bind external bytes; the sidecar
 * never hashes itself.
 */
export function buildPromotionSidecar(
  preview: WorkPromotionPreview,
  digests: { sourceDigest: string; targetDigest: string; promotedAt: string },
): WorkPromotionSidecar {
  return {
    schemaVersion: PROMOTION_SCHEMA_VERSION,
    kind: 'work-promotion-source',
    sourceWorkId: preview.sourceWorkId,
    sourcePath: `.agents/kyro/work/${preview.sourceWorkId}/work.json`,
    sourceRevision: preview.expectedRevision + 1,
    sourceDigest: digests.sourceDigest,
    sourceBriefDigest: preview.sourceBriefDigest,
    targetScope: preview.toScope,
    targetPath: preview.targetPath,
    targetDigest: digests.targetDigest,
    promotedTaskIds: preview.transferred.map((transfer) => transfer.sourceId),
    actor: preview.actor,
    preparedAt: digests.promotedAt,
    promotedAt: digests.promotedAt,
    requestDigest: preview.requestDigest,
  };
}

/**
 * Dedicated promotion adapter: build the destination Forge scope document
 * through the SAME pure builders the `plan` command uses, without any of its
 * side effects (no applyPlan, no scope registration, no activeScope switch).
 *
 * The shell (scope title/objective/spec/roadmap) comes from buildPlanInitPlan;
 * Sprint 1 (phases, mapped tasks, derived handoff) comes from
 * buildPlanSprintPlan. Only the mapped Sprint 1 content differs from an
 * ordinary Forge plan: every imported task starts pending with null
 * evidence/verdict and carries its exact source identity in context.
 * The git-derived author is stripped so staged bytes are deterministic;
 * provenance lives in the reciprocal sidecar and the Work history.
 */
export function buildPromotionTargetSprint(work: WorkFile, preview: WorkPromotionPreview, options: { allowExistingScope?: boolean } = {}): SprintFile {
  if (preview.sourceWorkId !== work.id) {
    throw new KyroCoreError(
      'INVALID_INPUT',
      'Promotion preview does not belong to this Work.',
      'Preview and stage the same Work before publishing.',
    );
  }
  const sourceById = new Map(work.tasks.map((task) => [task.id, task]));
  const leanTasks = preview.transferred.map((transfer) => {
    const source = sourceById.get(transfer.sourceId);
    if (!source) {
      throw new KyroCoreError(
        'INVALID_INPUT',
        `Promotion preview references missing Work task ${transfer.sourceId}.`,
        'Preview the current Work before staging; never stage a stale mapping.',
      );
    }
    const provenance = `Source: Work ${work.id} task ${transfer.sourceId} (Work status ${transfer.sourceStatus} at promotion; no Work approval is carried).`;
    return {
      id: transfer.targetId,
      title: transfer.title,
      description: source.description,
      files_to_touch: [...transfer.filesToTouch],
      context: source.context ? `${source.context}\n\n${provenance}` : provenance,
      acceptance_criteria: [...transfer.acceptanceCriteria],
      depends_on: [...transfer.dependsOn],
      scenario_refs: [],
    };
  });
  const taskIds = new Set(leanTasks.map((task) => task.id));
  for (const task of leanTasks) {
    for (const dependency of task.depends_on) {
      if (!taskIds.has(dependency)) {
        throw new KyroCoreError(
          'INVALID_INPUT',
          `Promotion mapping for ${task.id} references unknown Forge task ${dependency}.`,
          'Preview the current Work before staging; never stage a stale mapping.',
        );
      }
    }
  }
  const leanPlan = {
    scope: preview.toScope,
    title: work.title,
    objective: work.objective,
    successCriteria: [work.objective],
    spec: {
      requirements: [
        {
          id: 'R1',
          statement: work.objective,
          priority: 'must',
          rationale: `Promoted from Work ${work.id} revision ${preview.sourceRevision} with ${preview.transferred.length} unfinished task(s).`,
        },
      ],
      nonGoals: [],
      openQuestions: [],
    },
    roadmap: {
      plannedSprintCount: 1,
      sizingRationale: `Single Sprint 1 promoted from Work ${work.id}; Work task review is not Forge QA.`,
      sprints: [{ n: 1, slug: preview.toScope, title: work.title }],
    },
  } as unknown as LeanPlanInput;
  const leanSprint = {
    sprint: { n: 1, slug: preview.toScope, title: work.title, objective: work.objective },
    phases: [
      {
        id: 'P1',
        title: 'Promoted Work tasks',
        objective: `Complete every task transferred from Work ${work.id}.`,
        tasks: leanTasks,
      },
    ],
    definitionOfDone: [
      `Every task transferred from Work ${work.id} is done with a passing Forge checker verdict.`,
    ],
    scenarios: [],
  } as unknown as LeanSprintInput;
  const init = buildPlanInitPlan(preview.toScope, leanPlan, { allowExistingScope: options.allowExistingScope });
  if ('author' in init.sprint) delete init.sprint.author;
  const staged = buildPlanSprintPlan(preview.toScope, init.sprint, leanSprint);
  const issues = validateSprintFile(staged.sprint, `${preview.toScope}/sprint.json`);
  if (issues.length) {
    throw new KyroCoreError(
      'INVALID_SPRINT_SHAPE',
      `Promotion staging produced an invalid Forge scope: ${issues.map((entry) => `${entry.field} ${entry.message}`).join('; ')}.`,
      'Aborted before writing; preview the Work again from its current state.',
    );
  }
  for (const task of staged.sprint.activeSprint?.phases.flatMap((phase) => phase.tasks) ?? []) {
    if (task.status !== 'pending' || task.evidence !== null || task.verdict !== null) {
      throw new KyroCoreError(
        'INVALID_SPRINT_SHAPE',
        `Promotion staging must leave every Forge task pending without approval: ${task.id}.`,
        'Aborted before writing; preview the Work again from its current state.',
      );
    }
  }
  return staged.sprint;
}

export const PROMOTION_STAGE_DIR_NAME = '.promotion-stage';

/** Confined hidden staging directory for one promotion target (never a runnable scope). */
export function promotionStageDir(workId: string, toScope: string): string {
  return `.agents/kyro/work/${workId}/${PROMOTION_STAGE_DIR_NAME}/${toScope}`;
}

export interface StagedPromotionDestination {
  sprint: SprintFile;
  sprintBytes: string;
  sidecarBytes: string;
  targetDigest: string;
  stagedSprintPath: string;
  stagedSidecarPath: string;
  stagedOriginPath: string;
}

/**
 * Stage a validated Forge destination without touching the published Forge
 * tree, project.json, local.json (including activeScope), or the live Work.
 * Staged files land under a hidden Work-local directory that scope discovery
 * never treats as a scope. The caller must hold the state-writer lock.
 */
export function stagePromotionDestination(
  work: WorkFile,
  preview: WorkPromotionPreview,
  digests: { sourceDigest: string; promotedAt: string },
): StagedPromotionDestination {
  assertPromotionTargetAvailable(preview.toScope);
  return writeStagedPromotionDestination(work, preview, digests);
}

/**
 * Write the staged destination without the pre-publication availability
 * probe. Used by commit resume after the destination is legitimately
 * published; every byte is still rebuilt deterministically and compared to
 * the journal before publication or verification.
 */
export function writeStagedPromotionDestination(
  work: WorkFile,
  preview: WorkPromotionPreview,
  digests: { sourceDigest: string; promotedAt: string },
  options: { allowExistingScope?: boolean; stage?: boolean } = {},
): StagedPromotionDestination {
  const sprint = buildPromotionTargetSprint(work, preview, options);
  const sprintBytes = `${JSON.stringify(sprint, null, 2)}\n`;
  const targetDigest = sha256Bytes(Buffer.from(sprintBytes, 'utf8'));
  const sidecar = buildPromotionSidecar(preview, {
    sourceDigest: digests.sourceDigest,
    targetDigest,
    promotedAt: digests.promotedAt,
  });
  const sidecarBytes = `${JSON.stringify(sidecar, null, 2)}\n`;
  const stagedSprintPath = `${promotionStageDir(work.id, preview.toScope)}/sprint.json`;
  const stagedSidecarPath = `${promotionStageDir(work.id, preview.toScope)}/${PROMOTION_SIDECAR_NAME}`;
  const stagedOriginPath = `${promotionStageDir(work.id, preview.toScope)}/${PROMOTION_ORIGIN_NAME}`;
  if (options.stage !== false) {
    const directory = assertSafeManagedPath(promotionStageDir(work.id, preview.toScope));
    const expected = new Map([['sprint.json', sprintBytes], [PROMOTION_SIDECAR_NAME, sidecarBytes], [PROMOTION_ORIGIN_NAME, sprintBytes]]);
    if (existsSync(directory)) {
      const actual = readdirSync(directory).sort();
      if (JSON.stringify(actual) !== JSON.stringify([...expected.keys()].sort())
        || [...expected].some(([name, bytes]) => readFileSync(assertSafeManagedPath(`${promotionStageDir(work.id, preview.toScope)}/${name}`), 'utf8') !== bytes)) {
        throw new KyroCoreError('STATE_DIVERGED', 'Staged promotion destination differs from the pending intent.', 'Restore the CLI-owned staging bytes before retrying.');
      }
    } else {
      const stageRoot = `.agents/kyro/work/${work.id}/${PROMOTION_STAGE_DIR_NAME}`;
      ensureDurableDirectory(assertSafeManagedPath(stageRoot));
      const temporaryRelative = `${stageRoot}/.${preview.toScope}.tmp-${randomUUID()}`;
      const temporary = assertSafeManagedPath(temporaryRelative);
      mkdirSync(temporary);
      try {
        for (const [name, bytes] of expected) {
          atomicReplace(`${temporaryRelative}/${name}`, bytes);
          if (name === 'sprint.json') throwInjectedPromotionFailure('promote-during-stage');
        }
        fsyncDirectory(temporary);
        renameSync(temporary, directory);
        fsyncParentDirectory(directory);
      } catch (error) {
        if (existsSync(temporary)) rmSync(temporary, { recursive: true, force: true });
        throw error;
      }
    }
    throwInjectedPromotionFailure('promote-after-stage');
  }
  return { sprint, sprintBytes, sidecarBytes, targetDigest, stagedSprintPath, stagedSidecarPath, stagedOriginPath };
}

export function throwInjectedPromotionFailure(boundary: string): void {
  if (process.env.KYRO_WORK_INJECT_FAILURE === boundary) {
    throw new KyroCoreError('INTERNAL', `Injected Work promotion failure at ${boundary}.`, 'Retry the same promote command from the current revision.');
  }
}

/** Build the durable pending intent record from a preview plus staging digests. */
export function buildPromotionJournal(
  preview: WorkPromotionPreview,
  digests: { oldWorkDigest: string; newWorkDigest: string; stagedTargetDigest: string; preparedAt: string },
): WorkPromotionJournal {
  return {
    schemaVersion: PROMOTION_SCHEMA_VERSION,
    kind: 'work-promotion-intent',
    workId: preview.sourceWorkId,
    toScope: preview.toScope,
    expectedRevision: preview.expectedRevision,
    actor: preview.actor,
    requestDigest: preview.requestDigest,
    sourceBriefDigest: preview.sourceBriefDigest,
    oldWorkDigest: digests.oldWorkDigest,
    newWorkDigest: digests.newWorkDigest,
    stagedTargetDigest: digests.stagedTargetDigest,
    preparedAt: digests.preparedAt,
  };
}
