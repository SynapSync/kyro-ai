export type Stage = 'prepare' | 'apply' | 'rollback';
export type StepStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'rolled-back';
export type FailurePolicy = 'stop-on-error' | 'continue-on-error';

export interface ProgressEvent {
  stage: Stage;
  stepId: string;
  status: StepStatus;
  error?: Error;
}

export type ProgressCallback = (event: ProgressEvent) => void;

export interface Step {
  readonly id: string;
  readonly description: string;
  run(): void;
  rollback?(): void;
}

export interface StagePlan {
  prepare: Step[];
  apply: Step[];
}

export interface StepResult {
  stepId: string;
  status: StepStatus;
  startedAt: Date;
  finishedAt?: Date;
  error?: Error;
}

export interface StageResult {
  stage: Stage;
  success: boolean;
  steps: StepResult[];
  error?: Error;
}

export interface PipelineResult {
  prepare: StageResult;
  apply: StageResult;
  rollback?: StageResult;
  error?: Error;
}
