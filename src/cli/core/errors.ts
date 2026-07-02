export type KyroErrorCode =
  | 'SCOPE_NOT_FOUND'
  | 'INVALID_JSON'
  | 'INVALID_SPRINT_SHAPE'
  | 'SNAPSHOT_EXISTS'
  | 'CONFIRMATION_REQUIRED'
  | 'POLICY_BLOCKED'
  | 'BLOCKING_FINDINGS'
  | 'INVALID_INPUT'
  | 'INTERNAL';

export class KyroCoreError extends Error {
  constructor(
    public readonly code: KyroErrorCode,
    message: string,
    public readonly remedy?: string,
  ) {
    super(message);
    this.name = 'KyroCoreError';
  }
}

export function toErrorEnvelope(error: unknown): { code: KyroErrorCode; message: string; remedy?: string } {
  if (error instanceof KyroCoreError) {
    return { code: error.code, message: error.message, ...(error.remedy ? { remedy: error.remedy } : {}) };
  }
  return { code: 'INTERNAL', message: error instanceof Error ? error.message : String(error) };
}
