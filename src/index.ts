export const KYRO_WORKFLOW = {
  name: 'kyro-ai',
  stateModel: 'sprint-json',
  artifactRoot: '.agents/kyro/scopes',
  commands: ['forge', 'status', 'task-context'],
  agents: ['orchestrator'],
  skills: ['sprint-forge', 'qa-review']
} as const;

export type KyroWorkflow = typeof KYRO_WORKFLOW;

export {
  SPRINT_CLOSE_CHECKPOINT_KIND,
  SPRINT_CLOSE_CHECKPOINT_SCHEMA_VERSION,
  SPRINT_CLOSE_TRANSACTION_STATUS,
} from './cli/types';
export type {
  SprintCloseCheckpointV1,
  SprintCloseDigests,
  SprintCloseIdentity,
  SprintCloseInputs,
  SprintClosePaths,
  SprintCloseTransactionStatus,
} from './cli/types';
