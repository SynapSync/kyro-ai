import { asSprintFile } from '../artifacts/schema';
import type { SprintFile } from '../types';
import { remediationStateDigest } from './canonical-state';
import { SCOPE_REMEDIATION_SCHEMA_VERSION } from './protocol';

/**
 * Replay witnesses are versioned at the immutable-record boundary. Adding a version requires an
 * explicit parser here; unknown records never fall through to the current SprintFile parser.
 */
export const REMEDIATION_REPLAY_WITNESS_VERSION = {
  V1: SCOPE_REMEDIATION_SCHEMA_VERSION,
} as const;
export type RemediationReplayWitnessVersion = (typeof REMEDIATION_REPLAY_WITNESS_VERSION)[keyof typeof REMEDIATION_REPLAY_WITNESS_VERSION];

export const REPLAY_WITNESS_VALIDATION_STATUS = {
  VALID: 'valid',
  UNSUPPORTED: 'unsupported',
  INVALID: 'invalid',
} as const;
export type ReplayWitnessValidationStatus = (typeof REPLAY_WITNESS_VALIDATION_STATUS)[keyof typeof REPLAY_WITNESS_VALIDATION_STATUS];

/** Parsed v1 evidence, after the raw archival snapshot crossed its strict parser boundary. */
export interface ReplayWitnessV1 {
  version: typeof REMEDIATION_REPLAY_WITNESS_VERSION.V1;
  snapshot: SprintFile;
}

export interface ReplayWitnessValidationInput {
  recordSchemaVersion: unknown;
  snapshot: unknown;
  expectedStateSha256: string;
}

export interface ValidReplayWitness {
  status: typeof REPLAY_WITNESS_VALIDATION_STATUS.VALID;
  witness: ReplayWitnessV1;
}

export interface UnsupportedReplayWitness {
  status: typeof REPLAY_WITNESS_VALIDATION_STATUS.UNSUPPORTED;
  detail: string;
}

export interface InvalidReplayWitness {
  status: typeof REPLAY_WITNESS_VALIDATION_STATUS.INVALID;
  detail: string;
}

export type ReplayWitnessValidation = ValidReplayWitness | UnsupportedReplayWitness | InvalidReplayWitness;

type ReplayWitnessParser = (input: ReplayWitnessValidationInput) => ReplayWitnessValidation;

const REPLAY_WITNESS_PARSERS: Record<RemediationReplayWitnessVersion, ReplayWitnessParser> = {
  [REMEDIATION_REPLAY_WITNESS_VERSION.V1]: parseV1ReplayWitness,
};

export function isRemediationReplayWitnessVersion(value: unknown): value is RemediationReplayWitnessVersion {
  return Object.values(REMEDIATION_REPLAY_WITNESS_VERSION).includes(value as RemediationReplayWitnessVersion);
}

/** Raw archival data crosses this parser boundary before callers can consume a typed witness. */
export function validateReplayWitness(input: ReplayWitnessValidationInput): ReplayWitnessValidation {
  if (!isRemediationReplayWitnessVersion(input.recordSchemaVersion)) {
    return {
      status: REPLAY_WITNESS_VALIDATION_STATUS.UNSUPPORTED,
      detail: `replay witness schemaVersion=${String(input.recordSchemaVersion ?? '(missing)')} is unsupported`,
    };
  }
  return REPLAY_WITNESS_PARSERS[input.recordSchemaVersion](input);
}

function parseV1ReplayWitness(input: ReplayWitnessValidationInput): ReplayWitnessValidation {
  const snapshot = asSprintFile(input.snapshot);
  if (snapshot === null) {
    return {
      status: REPLAY_WITNESS_VALIDATION_STATUS.INVALID,
      detail: 'v1 replay witness snapshot is not a valid v1 SprintFile',
    };
  }
  if (remediationStateDigest(snapshot) !== input.expectedStateSha256) {
    return {
      status: REPLAY_WITNESS_VALIDATION_STATUS.INVALID,
      detail: 'v1 replay witness snapshot does not reproduce the recorded result digest',
    };
  }
  return {
    status: REPLAY_WITNESS_VALIDATION_STATUS.VALID,
    witness: { version: REMEDIATION_REPLAY_WITNESS_VERSION.V1, snapshot },
  };
}
