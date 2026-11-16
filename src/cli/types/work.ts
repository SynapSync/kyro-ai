import type { ScopeAuthor } from './sprint-model';

export type WorkState = 'draft' | 'active' | 'closed' | 'promoted';
export type WorkTaskStatus = 'pending' | 'in_progress' | 'blocked' | 'awaiting_review' | 'verified' | 'cancelled' | 'superseded';
export type WorkNextAction = 'plan_tasks' | 'execute_task' | 'review_task' | 'resolve_blocker' | 'ready_to_close' | 'done';

export interface WorkFileReference { path: string; digest: string; }
export interface WorkSourceIdea extends WorkFileReference { title: string; }
export interface WorkBrief extends WorkFileReference { sourceIdea: WorkSourceIdea | null; }
export interface WorkHandoff { nextAction: WorkNextAction; nextTaskId: string | null; blockedReason: string | null; }
export interface WorkValidation { command: string; result: 'passed' | 'failed' | 'not_run'; note: string | null; }
export interface WorkTaskDefinition { id: string; title: string; description: string; context: string; filesToTouch: string[]; acceptanceCriteria: string[]; dependsOn: string[]; definitionRevision: number; }
export interface WorkEvidence { summary: string; validations: WorkValidation[]; filesChanged: string[]; notes: string | null; by: string; recordedAt: string; definitionRevision: number; materialDigest: string; }
export interface WorkFinding { severity: 'critical' | 'warning' | 'suggestion'; detail: string; }
export interface WorkVerdict { result: 'pass' | 'fail'; checkedCriteria: string[]; findings: WorkFinding[]; by: string; reviewedAt: string; definitionRevision: number; evidenceDigest: string; reviewedMaterialDigest: string; }
export interface WorkBlocker { reason: string; by: string; recordedAt: string; }
export interface WorkDisposition { kind: 'cancelled' | 'superseded'; reason: string; by: string; recordedAt: string; replacementTaskId: string | null; }
export interface WorkTask extends WorkTaskDefinition { status: WorkTaskStatus; blocker: WorkBlocker | null; evidence: WorkEvidence | null; verdict: WorkVerdict | null; disposition: WorkDisposition | null; }
export interface WorkActivity { seq: number; at: string; event: 'created' | 'brief_amended' | 'tasks_planned' | 'task_started' | 'task_blocked' | 'task_unblocked' | 'evidence_recorded' | 'review_recorded' | 'task_amended' | 'task_disposed' | 'work_closed' | 'work_reopened' | 'promotion_prepared' | 'work_promoted'; taskId: string | null; by: string; reason: string; revision: number; }
export interface WorkClosure { outcome: 'completed' | 'stopped'; reason: string; by: string; closedAt: string; briefDigest: string; finalRevision: number; }
export interface WorkPromotion { targetScope: string; targetPath: string; sourceRevision: number; sourceDigest: string; promotedTaskIds: string[]; promotedAt: string; by: string; }

/**
 * Work-to-Forge promotion contract (Sprint 4).
 *
 * Digest discipline (non-circular by construction): every digest binds bytes
 * EXTERNAL to the record that carries it. requestDigest binds the promotion
 * request; sourceDigest binds the pre-promotion work.json bytes
 * (oldWorkDigest) while sourceRevision is the post-promotion revision;
 * targetDigest binds the published target sprint.json bytes; brief digests
 * bind brief.md bytes. No record ever hashes its own serialization.
 */
export type WorkPromotionKind = 'work-promotion-preview' | 'work-promotion-source' | 'work-promotion-intent';

/** One eligible Work task mapped deterministically to a fresh Forge Sprint 1 task. */
export interface WorkPromotionTransfer {
  sourceId: string;
  /** Deterministic Forge ID: T1.<n> in transferred source order. */
  targetId: string;
  title: string;
  acceptanceCriteria: string[];
  filesToTouch: string[];
  /** Mapped Forge dependencies (T1.* IDs), preserved among transferred tasks. */
  dependsOn: string[];
  sourceStatus: WorkTaskStatus;
  /** Explicit approval-reset disclosure: the Work status is never carried as Forge approval. */
  approvalReset: string;
}

/** A terminal Work task explicitly excluded from the transfer. */
export interface WorkPromotionOmission {
  sourceId: string;
  status: WorkTaskStatus;
  note: string;
}

/** Explicit adjudication of one source dependency edge. */
export interface WorkPromotionAdjudication {
  task: string;
  dependsOn: string;
  resolution: 'preserved' | 'omitted_verified_source';
  detail: string;
}

/** Read-only promotion preview: the exact translation disclosed before confirmation. */
export interface WorkPromotionPreview {
  schemaVersion: 1;
  kind: 'work-promotion-preview';
  sourceWorkId: string;
  sourceRevision: number;
  sourceBriefDigest: string;
  toScope: string;
  targetPath: string;
  actor: string;
  expectedRevision: number;
  requestDigest: string;
  transferred: WorkPromotionTransfer[];
  omittedVerified: WorkPromotionOmission[];
  omittedDisposed: WorkPromotionOmission[];
  dependencyAdjudications: WorkPromotionAdjudication[];
  /** Always false: Work verdicts are never imported as Forge passes or QA. */
  workVerdictsImportedAsForgePass: false;
  /** Always true: every imported Forge task starts pending without evidence or verdict. */
  forgeTasksStartPending: true;
}

/** Reciprocal link published under the target Forge scope (never inside sprint.json). */
export interface WorkPromotionSidecar {
  schemaVersion: 1;
  kind: 'work-promotion-source';
  sourceWorkId: string;
  sourcePath: string;
  sourceRevision: number;
  sourceDigest: string;
  sourceBriefDigest: string;
  targetScope: string;
  targetPath: string;
  targetDigest: string;
  promotedTaskIds: string[];
  actor: string;
  preparedAt: string;
  promotedAt: string;
  requestDigest: string;
}

/** Durable pending intent under the source Work directory (git-ignored, never authority). */
export interface WorkPromotionJournal {
  schemaVersion: 1;
  kind: 'work-promotion-intent';
  workId: string;
  toScope: string;
  expectedRevision: number;
  actor: string;
  requestDigest: string;
  sourceBriefDigest: string;
  oldWorkDigest: string;
  newWorkDigest: string;
  stagedTargetDigest: string;
  preparedAt: string;
}
export interface WorkFile {
  schemaVersion: 1;
  kind: 'organic-work';
  id: string;
  title: string;
  objective: string;
  brief: WorkBrief;
  state: WorkState;
  revision: number;
  createdAt: string;
  updatedAt: string;
  /** Creation-time Git metadata, immutable thereafter; omitted for historical or unavailable identities. */
  author?: ScopeAuthor;
  handoff: WorkHandoff;
  tasks: WorkTask[];
  activity: WorkActivity[];
  closure: WorkClosure | null;
  promotion: WorkPromotion | null;
}
