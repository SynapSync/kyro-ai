import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  rmdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { removeManagedBlock, upsertManagedBlock } from '../injectors/managed-block';
import { mergeJsonObjectContent, removeJsonPathContent } from '../injectors/json-merge';
import type { OperationPlan } from '../types';
import { PipelineOrchestrator } from './orchestrator';
import type { PipelineResult, StagePlan, Step } from './types';
import { assertStateWriterLeaseHealthy, withStateWriterLock } from './state-writer-lock';

interface OperationExecutionContext {
  packageRoot: string;
  resolveManagedPath(path: string): string;
}

type TargetSnapshot =
  | { kind: 'missing' }
  | { kind: 'file'; content: Buffer; mode: number }
  | { kind: 'directory'; backupPath: string }
  | { kind: 'symlink'; link: string };

export function applyOperationPlan(plan: OperationPlan[], context: OperationExecutionContext): void {
  withStateWriterLock(() => {
    const result = new PipelineOrchestrator('stop-on-error').execute(operationPlanToStagePlan(plan, context));
    if (result.error) throw formatPipelineError(result);
  });
}

export function operationPlanToStagePlan(plan: OperationPlan[], context: OperationExecutionContext): StagePlan {
  return {
    prepare: [],
    apply: plan.map((operation, index) => new OperationStep(index, operation, context)),
  };
}

class OperationStep implements Step {
  readonly id: string;
  readonly description: string;
  private snapshot: TargetSnapshot | null = null;

  constructor(
    index: number,
    private readonly operation: OperationPlan,
    private readonly context: OperationExecutionContext,
  ) {
    this.id = `${index}:${operation.action}:${operation.path}`;
    this.description = `${operation.action} ${operation.path}`;
  }

  run(): void {
    assertStateWriterLeaseHealthy();
    const target = this.context.resolveManagedPath(this.operation.path);
    this.snapshot = snapshotTarget(target);
    assertStateWriterLeaseHealthy();
    applyOperation(this.operation, target, this.context);
  }

  rollback(): void {
    if (!this.snapshot) return;
    assertStateWriterLeaseHealthy();
    restoreTarget(this.context.resolveManagedPath(this.operation.path), this.snapshot);
  }
}

function applyOperation(operation: OperationPlan, target: string, context: OperationExecutionContext): void {
  if (operation.action === 'mkdir') {
    assertStateWriterLeaseHealthy();
    mkdirSync(target, { recursive: true });
  } else if (operation.action === 'write') {
    assertStateWriterLeaseHealthy();
    mkdirSync(dirname(target), { recursive: true });
    assertStateWriterLeaseHealthy();
    writeFileSync(target, operation.content ?? '', 'utf-8');
  } else if (operation.action === 'copy') {
    if (!operation.source) throw new Error(`Copy operation missing source for ${operation.path}`);
    assertStateWriterLeaseHealthy();
    mkdirSync(dirname(target), { recursive: true });
    const src = resolve(context.packageRoot, operation.source);
    if (operation.substitutions) {
      let text = readFileSync(src, 'utf-8');
      for (const [token, value] of Object.entries(operation.substitutions)) {
        text = text.split(token).join(value);
      }
      assertStateWriterLeaseHealthy();
      writeFileSync(target, text, 'utf-8');
    } else {
      assertStateWriterLeaseHealthy();
      copyFileSync(src, target);
    }
  } else if (operation.action === 'remove') {
    assertStateWriterLeaseHealthy();
    rmSync(target, { recursive: true, force: true });
  } else if (operation.action === 'rmdir-if-empty') {
    if (existsSync(target) && lstatSync(target).isDirectory() && readdirSync(target).length === 0) {
      assertStateWriterLeaseHealthy();
      rmdirSync(target);
    }
  } else if (operation.action === 'upsert-block') {
    if (!operation.blockName) throw new Error(`Block operation missing blockName for ${operation.path}`);
    assertStateWriterLeaseHealthy();
    mkdirSync(dirname(target), { recursive: true });
    const existing = existsSync(target) ? readFileSync(target, 'utf-8') : '';
    assertStateWriterLeaseHealthy();
    writeFileSync(target, upsertManagedBlock(existing, operation.blockName, operation.content ?? '', operation.commentStyle), 'utf-8');
  } else if (operation.action === 'remove-block') {
    if (!operation.blockName) throw new Error(`Block operation missing blockName for ${operation.path}`);
    if (existsSync(target)) {
      const existing = readFileSync(target, 'utf-8');
      assertStateWriterLeaseHealthy();
      writeFileSync(target, removeManagedBlock(existing, operation.blockName, operation.commentStyle), 'utf-8');
    }
  } else if (operation.action === 'merge-json') {
    assertStateWriterLeaseHealthy();
    mkdirSync(dirname(target), { recursive: true });
    const existing = existsSync(target) ? readFileSync(target, 'utf-8') : '';
    assertStateWriterLeaseHealthy();
    writeFileSync(target, mergeJsonObjectContent(existing, operation.content ?? '{}'), 'utf-8');
  } else if (operation.action === 'remove-json-key') {
    if (!operation.jsonPath) throw new Error(`JSON remove operation missing jsonPath for ${operation.path}`);
    if (existsSync(target)) {
      const existing = readFileSync(target, 'utf-8');
      assertStateWriterLeaseHealthy();
      writeFileSync(target, removeJsonPathContent(existing, operation.jsonPath), 'utf-8');
    }
  }
}

function snapshotTarget(target: string): TargetSnapshot {
  if (!existsSync(target)) return { kind: 'missing' };

  const stat = lstatSync(target);
  if (stat.isSymbolicLink()) {
    return { kind: 'symlink', link: readlinkSync(target) };
  }
  if (stat.isDirectory()) {
    const backupRoot = mkdtempSync(join(tmpdir(), 'kyro-pipeline-'));
    const backupPath = join(backupRoot, 'target');
    cpSync(target, backupPath, { recursive: true, verbatimSymlinks: true });
    return { kind: 'directory', backupPath };
  }
  return { kind: 'file', content: readFileSync(target), mode: stat.mode };
}

function restoreTarget(target: string, snapshot: TargetSnapshot): void {
  assertStateWriterLeaseHealthy();
  rmSync(target, { recursive: true, force: true });
  if (snapshot.kind === 'missing') return;

  assertStateWriterLeaseHealthy();
  mkdirSync(dirname(target), { recursive: true });
  if (snapshot.kind === 'file') {
    assertStateWriterLeaseHealthy();
    writeFileSync(target, snapshot.content);
    assertStateWriterLeaseHealthy();
    chmodSync(target, snapshot.mode);
  } else if (snapshot.kind === 'directory') {
    assertStateWriterLeaseHealthy();
    cpSync(snapshot.backupPath, target, { recursive: true, verbatimSymlinks: true });
    assertStateWriterLeaseHealthy();
    rmSync(dirname(snapshot.backupPath), { recursive: true, force: true });
  } else if (snapshot.kind === 'symlink') {
    assertStateWriterLeaseHealthy();
    symlinkSync(snapshot.link, target);
  }
}

function formatPipelineError(result: PipelineResult): Error {
  const message = result.rollback && !result.rollback.success
    ? `Apply failed and rollback failed: ${result.error?.message ?? 'unknown error'}`
    : `Apply failed and rollback completed: ${result.error?.message ?? 'unknown error'}`;
  return new Error(message);
}
