import type { SprintGitEnd, SprintFile } from './sprint-model';
import { SPRINT_CLOSE_CHECKPOINT_SCHEMA_VERSION, SPRINT_CLOSE_CHECKPOINT_KIND } from './vocabularies';
import type { KyroScopeEntry } from './project-state';

export interface SprintCloseIdentity {
  scope: string;
  sprintN: number;
  sprintSlug: string;
}

export interface SprintCloseInputs {
  outcome: string;
  note: string | null;
  summary: string | null;
  recommendations: string[];
  learnings: string[];
  /** Frozen at the first close attempt; retries reuse it and never re-read HEAD. */
  git?: SprintGitEnd;
}

export interface SprintClosePaths {
  legacySnapshot: string;
  narrative: string;
}

export interface SprintCloseDigests {
  beforeClose: string;
  intendedAfterClose: string;
  projectScopeBefore: string;
  projectScopeAfter: string;
  legacySnapshot: string;
  narrative: string;
}

/** Immutable transaction record used to resume and audit a sprint close without losing scope state. */
export interface SprintCloseCheckpointV1 {
  schemaVersion: typeof SPRINT_CLOSE_CHECKPOINT_SCHEMA_VERSION;
  kind: typeof SPRINT_CLOSE_CHECKPOINT_KIND;
  checkpointId: string;
  createdAt: string;
  identity: SprintCloseIdentity;
  close: SprintCloseInputs;
  paths: SprintClosePaths;
  beforeClose: SprintFile;
  intendedAfterClose: SprintFile;
  projectScopeBefore: KyroScopeEntry;
  projectScopeAfter: KyroScopeEntry;
  digests: SprintCloseDigests;
}
