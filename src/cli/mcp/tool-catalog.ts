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
const taskId = { type: 'string', description: 'Active sprint task id.' } as const;

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
    description: 'Validate Kyro project and scope artifact shape, snapshots, narratives, and clarity markers. Use to check a scope is well-formed before planning or closing.',
    inputSchema: { type: 'object', properties: { scope }, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'analyze_scope',
    title: 'Analyze Kyro scope semantics',
    description: 'Run semantic cross-checks for clarity, coverage, dependencies, debt, spec traceability, and project principles. Use to find blocking findings before executing or closing.',
    inputSchema: { type: 'object', properties: { scope }, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'scope_list',
    title: 'List Kyro scopes',
    description: 'List known Kyro scopes, their status, and which one is active. Use to discover scopes before targeting one.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'scope_inspect',
    title: 'Inspect Kyro scope',
    description: 'Return artifact doctor checks for one scope. Use to inspect a single scope by id.',
    inputSchema: { type: 'object', properties: { scope: { type: 'string', description: 'Kyro scope id to inspect.' } }, required: ['scope'], additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'close_sprint',
    title: 'Close active Kyro sprint',
    description: 'Build or apply the deterministic lossless scope-checkpoint close plan. Use when every sprint task passed review and the sprint is ready to close. Without confirm:true it returns the plan and writes nothing.',
    inputSchema: { type: 'object', properties: { scope, outcome: { type: 'string', enum: ['shipped', 'partial', 'aborted'], description: 'Sprint outcome.' }, note: { type: 'string' }, summary: { type: 'string' }, recommendations: { type: 'array', items: { type: 'string' } }, learnings: { type: 'array', items: { type: 'string' } }, confirm }, required: ['outcome'], additionalProperties: false },
    annotations: { destructiveHint: true, idempotentHint: true },
  },
  {
    name: 'repair_scope',
    title: 'Repair Kyro scope formatting',
    description: 'Build or apply a sprint.json normalization plan. Use when doctor reports formatting drift. Without confirm:true it returns the plan and writes nothing.',
    inputSchema: { type: 'object', properties: { scope, confirm }, additionalProperties: false },
    annotations: { destructiveHint: true, idempotentHint: true },
  },
  {
    name: 'remediate_scope',
    title: 'Remediate a closed Kyro scope',
    description: 'Preview or apply a typed, append-only correction to a CLOSED scope whose live state no longer satisfies the contract. Use when doctor reports schema drift in a scope that was already closed, so its history must not be rewritten. Checkpoints, snapshots, narratives and ledger commitments are verified and never rewritten. Only registry operations are accepted (generic JSON Patch is rejected). Without confirm:true it returns the plan and writes nothing.',
    inputSchema: { type: 'object', properties: { scope, manifest: { type: 'string', description: 'Path to a scope-remediation-manifest v1 document.' }, confirm }, required: ['manifest'], additionalProperties: false },
    annotations: { destructiveHint: true, idempotentHint: true },
  },
  {
    name: 'recertify_scope',
    title: 'Certify a remediated Kyro scope',
    description: 'Preview or apply a certification recording that a remediated scope\'s corrected state was independently validated against named, re-verifiable evidence. Use after remediate, once the corrections have been checked. Every evidence digest is re-derived from the workspace; certification is refused when the chain does not replay to live state, when the chain head has moved, when evidence is empty, or when the verdict is not a pass. A certificate covers one chain head, so remediating again drops it. Without confirm:true it returns the plan and writes nothing.',
    inputSchema: { type: 'object', properties: { scope, manifest: { type: 'string', description: 'Path to a scope-certification-manifest v1 document.' }, confirm }, required: ['manifest'], additionalProperties: false },
    annotations: { destructiveHint: true, idempotentHint: true },
  },
  {
    name: 'review_task',
    title: 'Review a Kyro task (maker/checker)',
    description: 'Run the deterministic maker/checker on a task and write its verdict. Use when a task is done and needs verification. Without confirm:true it returns the plan and writes nothing; a pass that fails the deterministic checks is refused.',
    inputSchema: { type: 'object', properties: { scope, task_id: taskId, verdict: { type: 'string', enum: ['pass', 'fail'], description: 'Reviewer judgment. Defaults to pass.' }, checked_criteria: { type: 'array', items: { type: 'string' }, description: 'Acceptance criteria the reviewer checked. Defaults to all on a pass.' }, waived_criteria: { type: 'array', items: { type: 'string' }, description: 'Acceptance criteria waived as "criterion::reason". Reason is required.' }, findings: { type: 'array', items: { type: 'string' }, description: 'Reviewer findings as "severity:detail" (severity = critical|warning|suggestion).' }, by: { type: 'string', description: 'Reviewer actor id. Defaults to "checker".' }, confirm }, required: ['task_id'], additionalProperties: false },
    annotations: { destructiveHint: true, idempotentHint: false },
  },
  {
    name: 'trace_tail',
    title: 'Read recent Kyro trace events',
    description: 'Return the most recent append-only trace events for a scope. Use for observability or debugging a run. Read-only; trace never drives routing.',
    inputSchema: { type: 'object', properties: { scope, limit: { type: 'string', description: 'Max events to return (most recent). Defaults to 20.' } }, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
] as const satisfies readonly McpToolDefinition[];

export function getTool(name: string): McpToolDefinition | null {
  return MCP_TOOLS.find((tool) => tool.name === name) ?? null;
}
