export interface JsonSchemaObject {
  type: 'object';
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
  additionalProperties: false;
}

export type JsonSchemaProperty =
  | { type: 'string'; description?: string; enum?: string[] }
  | { type: 'boolean'; description?: string }
  | { type: 'array'; description?: string; items: { type: 'string' } };

export interface McpToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchemaObject;
  annotations: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean };
}

const scope = { type: 'string', description: 'Kyro scope id. Omit to use activeScope or the only existing scope.' } as const;
const confirm = { type: 'boolean', description: 'Required for mutation. Omit or false to return the dry-run plan without writing.' } as const;

export const MCP_TOOLS = [
  {
    name: 'context_pack',
    title: 'Build Kyro context pack',
    description: 'Return the minimal routing/task context an agent should load for a Kyro scope. Use before resuming work or executing a task.',
    inputSchema: { type: 'object', properties: { scope, task_id: { type: 'string', description: 'Optional active sprint task id. Empty string means handoff.nextTaskId.' }, verbosity: { type: 'string', enum: ['concise', 'detailed'], description: 'Output verbosity hint.' } }, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'doctor_artifacts',
    title: 'Run Kyro artifact doctor',
    description: 'Validate Kyro project and scope artifact shape, snapshots, narratives, and clarity markers.',
    inputSchema: { type: 'object', properties: { scope }, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'analyze_scope',
    title: 'Analyze Kyro scope semantics',
    description: 'Run semantic cross-checks for clarity, coverage, dependencies, debt, and project principles.',
    inputSchema: { type: 'object', properties: { scope }, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'scope_list',
    title: 'List Kyro scopes',
    description: 'List known Kyro scopes, their status, and which one is active.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'scope_inspect',
    title: 'Inspect Kyro scope',
    description: 'Return artifact doctor checks for one scope.',
    inputSchema: { type: 'object', properties: { scope: { type: 'string', description: 'Kyro scope id to inspect.' } }, required: ['scope'], additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'close_sprint',
    title: 'Close active Kyro sprint',
    description: 'Build or apply the deterministic zero-loss close-sprint plan. Without confirm:true it returns the plan and writes nothing.',
    inputSchema: { type: 'object', properties: { scope, outcome: { type: 'string', enum: ['shipped', 'partial', 'aborted'], description: 'Sprint outcome.' }, note: { type: 'string' }, summary: { type: 'string' }, recommendations: { type: 'array', items: { type: 'string' } }, learnings: { type: 'array', items: { type: 'string' } }, confirm }, required: ['outcome'], additionalProperties: false },
    annotations: { destructiveHint: true, idempotentHint: false },
  },
  {
    name: 'repair_scope',
    title: 'Repair Kyro scope formatting',
    description: 'Build or apply a sprint.json normalization plan. Without confirm:true it returns the plan and writes nothing.',
    inputSchema: { type: 'object', properties: { scope, confirm }, additionalProperties: false },
    annotations: { destructiveHint: true, idempotentHint: true },
  },
] as const satisfies readonly McpToolDefinition[];

export function getTool(name: string): McpToolDefinition | null {
  return MCP_TOOLS.find((tool) => tool.name === name) ?? null;
}
