import type { FailurePolicy, PipelineResult, ProgressCallback, Stage, StagePlan, StageResult, Step, StepResult } from './types';

export class PipelineOrchestrator {
  constructor(
    private readonly policy: FailurePolicy = 'stop-on-error',
    private readonly onProgress?: ProgressCallback,
  ) {}

  execute(plan: StagePlan): PipelineResult {
    this.validatePlan(plan);
    const stepById = new Map<string, Step>();
    for (const step of [...plan.prepare, ...plan.apply]) stepById.set(step.id, step);

    const prepare = this.runStage('prepare', plan.prepare);
    if (!prepare.success) return { prepare, apply: emptyStage('apply'), error: prepare.error };

    const apply = this.runStage('apply', plan.apply);
    const result: PipelineResult = { prepare, apply };
    if (apply.success) return result;

    result.error = apply.error;
    const rollback = this.rollback(apply.steps, stepById);
    result.rollback = rollback;
    if (!rollback.success) {
      result.error = new Error(`Apply failed: ${apply.error?.message}. Rollback also failed: ${rollback.error?.message}`);
    }
    return result;
  }

  private runStage(stage: Stage, steps: Step[]): StageResult {
    const results: StepResult[] = [];
    const errors: Error[] = [];
    for (const step of steps) {
      this.emit(stage, step.id, 'running');
      const startedAt = new Date();
      try {
        step.run();
        const result: StepResult = { stepId: step.id, status: 'succeeded', startedAt, finishedAt: new Date() };
        results.push(result);
        this.emit(stage, step.id, 'succeeded');
      } catch (error: unknown) {
        const err = asError(error);
        const result: StepResult = { stepId: step.id, status: 'failed', startedAt, finishedAt: new Date(), error: err };
        results.push(result);
        errors.push(err);
        this.emit(stage, step.id, 'failed', err);
        if (this.policy === 'stop-on-error') return { stage, success: false, steps: results, error: err };
      }
    }

    return {
      stage,
      success: errors.length === 0,
      steps: results,
      error: joinErrors(errors),
    };
  }

  private rollback(applyResults: StepResult[], stepById: Map<string, Step>): StageResult {
    const steps: StepResult[] = [];
    for (let index = applyResults.length - 1; index >= 0; index -= 1) {
      const applied = applyResults[index];
      if (applied.status !== 'succeeded') continue;
      const step = stepById.get(applied.stepId);
      if (!step?.rollback) continue;

      this.emit('rollback', step.id, 'running');
      const startedAt = new Date();
      try {
        step.rollback();
        steps.push({ stepId: step.id, status: 'rolled-back', startedAt, finishedAt: new Date() });
        this.emit('rollback', step.id, 'rolled-back');
      } catch (error: unknown) {
        const err = asError(error);
        steps.push({ stepId: step.id, status: 'failed', startedAt, finishedAt: new Date(), error: err });
        this.emit('rollback', step.id, 'failed', err);
        return { stage: 'rollback', success: false, steps, error: err };
      }
    }
    return { stage: 'rollback', success: true, steps };
  }

  private validatePlan(plan: StagePlan): void {
    const seen = new Set<string>();
    for (const step of [...plan.prepare, ...plan.apply]) {
      if (seen.has(step.id)) throw new Error(`Duplicate pipeline step id: ${step.id}`);
      seen.add(step.id);
    }
  }

  private emit(stage: Stage, stepId: string, status: StepResult['status'], error?: Error): void {
    this.onProgress?.({ stage, stepId, status, error });
  }
}

function emptyStage(stage: Stage): StageResult {
  return { stage, success: true, steps: [] };
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function joinErrors(errors: Error[]): Error | undefined {
  if (errors.length === 0) return undefined;
  if (errors.length === 1) return errors[0];
  return new Error(errors.map((error) => error.message).join('\n'));
}
