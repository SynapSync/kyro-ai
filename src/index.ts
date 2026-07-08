export const KYRO_WORKFLOW = {
  name: 'kyro-ai',
  stateModel: 'sprint-json',
  artifactRoot: '.agents/kyro/scopes',
  commands: ['forge', 'status', 'wrap-up', 'task-context'],
  agents: ['orchestrator'],
  skills: ['sprint-forge', 'qa-review']
} as const;

export type KyroWorkflow = typeof KYRO_WORKFLOW;
