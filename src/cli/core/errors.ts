export type KyroErrorCode =
  | 'SCOPE_NOT_FOUND'
  | 'INVALID_JSON'
  | 'INVALID_SPRINT_SHAPE'
  | 'INVALID_PROJECT_STATE'
  | 'SNAPSHOT_EXISTS'
  | 'CHECKPOINT_CORRUPT'
  | 'CHECKPOINT_UNSUPPORTED_VERSION'
  | 'CHECKPOINT_CONFLICT'
  | 'STATE_DIVERGED'
  | 'CONFIRMATION_REQUIRED'
  | 'POLICY_BLOCKED'
  | 'CHECKER_FAILED'
  | 'SELF_REVIEW_BLOCKED'
  | 'CLARIFICATION_REQUIRED'
  | 'BLOCKING_FINDINGS'
  | 'INVALID_INPUT'
  | 'UNKNOWN_COMMAND'
  | 'UNKNOWN_SUBCOMMAND'
  | 'UNKNOWN_TOOL'
  | 'NO_ACTIVE_SPRINT'
  | 'TASK_NOT_FOUND'
  | 'DEBT_NOT_FOUND'
  | 'SCOPE_ALREADY_INITIALIZED'
  | 'SPRINT_ALREADY_ACTIVE'
  | 'NOT_READY_TO_PLAN'
  | 'WRITE_NOT_PERMITTED'
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

/**
 * Recognize durable-write failures caused by the environment (read-only filesystem, permission
 * denied, disk full) and translate them into an actionable KyroCoreError. Returns null for any
 * other error so callers can fall back to their existing generic handling.
 */
export function describeWriteFailure(error: unknown): KyroCoreError | null {
  const errno = error as NodeJS.ErrnoException | undefined;
  const code = errno?.code;
  if (code !== 'EROFS' && code !== 'EACCES' && code !== 'ENOSPC') return null;
  const path = errno?.path ? ` (${errno.path})` : '';
  const message = `Kyro could not write${path}: ${code}.`;
  const remedy =
    code === 'ENOSPC'
      ? 'The filesystem is out of space. Free space and re-run the command.'
      : "Kyro needs write access under .agents/kyro but the path is read-only for this process (EROFS/EACCES). On sandboxed agents (Codex/OpenCode) re-run the command with write access to the project's .agents/kyro directory.";
  return new KyroCoreError('WRITE_NOT_PERMITTED', message, remedy);
}
