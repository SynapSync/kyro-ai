export const KYRO_WORKFLOW = {
  name: 'kyro-ai',
  stateModel: 'markdown',
  artifactRoot: '.agents/kyro/scopes',
  commands: ['forge', 'status', 'wrap-up'],
  agents: ['orchestrator'],
  skills: ['core', 'qa-review']
} as const;

export type KyroWorkflow = typeof KYRO_WORKFLOW;
