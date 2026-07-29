import { readPackageVersion } from '../help';

// Every {{KYRO_CLI}} verb the shipped skill assets (skills/, agents/, commands/) invoke. The
// orchestrator verifies this list at forge start; a runtime missing any of these verbs — or the
// capabilities command itself — is too old for the installed skill assets and must be upgraded.
export const TOOL_OWNED_VERBS = [
  'add-emergent',
  'analyze',
  'close-sprint',
  'context-pack',
  'debt',
  'doctor',
  'plan',
  'record-evidence',
  'repair',
  'review',
] as const;

export interface CapabilitiesPayload {
  version: string;
  capabilities: string[];
}

export function buildCapabilitiesPayload(): CapabilitiesPayload {
  return { version: readPackageVersion(), capabilities: [...TOOL_OWNED_VERBS] };
}
