import { readPackageVersion } from '../help';

/**
 * The verbs the orchestrator verifies at forge start. A runtime missing any of them — or the
 * capabilities command itself — is too old for the installed skill assets and must be upgraded.
 *
 * Inclusion rule (enforced by scripts/check-capabilities.mjs): a verb belongs here if the shipped
 * assets invoke it as `{{KYRO_CLI}} <verb>`, OR it is a tool-owned state writer documented for
 * agent use. `scenario`, `adr`, and `rule` qualify under the second half (they mutate Kyro state — see
 * isMutatingInvocation in app.ts — and docs/spec-traceability.md drives agents to them).
 *
 * Deliberately excluded: install, sync, uninstall, detect, eval, tui, mcp, trace —
 * operator/runtime surface, not sprint-lifecycle verbs. Also excluded: `capabilities` itself, since
 * the handshake cannot verify itself; its absence IS the staleness signal.
 */
export const TOOL_OWNED_VERBS = [
  'add-emergent',
  'adr',
  'analyze',
  'close-sprint',
  'clarify',
  'context-pack',
  'debt',
  'doctor',
  'plan',
  'record-evidence',
  'repair',
  'review',
  'rule',
  'scenario',
  'scope',
  'status',
] as const;

export interface CapabilitiesPayload {
  version: string;
  capabilities: string[];
}

export function buildCapabilitiesPayload(): CapabilitiesPayload {
  return { version: readPackageVersion(), capabilities: [...TOOL_OWNED_VERBS] };
}
