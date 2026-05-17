export const KYRO_WORKFLOW = {
  name: 'kyro-workflow',
  stateModel: 'markdown',
  artifactRoot: '.agents/sprint-forge',
  commands: ['forge', 'status', 'wrap-up'],
  agents: ['orchestrator'],
  skills: ['sprint-forge', 'qa-review']
} as const;

export type KyroWorkflow = typeof KYRO_WORKFLOW;
