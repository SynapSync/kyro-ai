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
import { describeWriteFailure } from '../core/errors';
import { assertNotRetiredSprintOverwrite } from '../core/retirement-guard';
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
    for (const operation of plan) {
      if (operation.action !== 'mkdir' && operation.action !== 'rmdir-if-empty') {
        assertNotRetiredSprintOverwrite(context.resolveManagedPath(operation.path));
      }
    }
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

class SnapshotCreateError extends Error {
  readonly target: string;
  override readonly cause: Error;

  constructor(target: string, cause: Error) {
    super(`Snapshot create failed for ${target}: ${cause.message}`);
    this.name = 'SnapshotCreateError';
    this.target = target;
    this.cause = cause;
  }
}

class OperationStep implements Step {
  readonly id: string;
  readonly description: string;
  private snapshot: TargetSnapshot | null = null;
  private backupRoots: string[] = [];

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
    if (this.operation.action !== 'mkdir' && this.operation.action !== 'rmdir-if-empty') {
      assertNotRetiredSprintOverwrite(target);
    }
    this.snapshot = snapshotIfNeeded(this.operation, target);
    this.registerDirectoryBackup(this.snapshot);
    assertStateWriterLeaseHealthy();
    applyOperation(this.operation, target, this.context);
  }

  rollback(): void {
    if (!this.snapshot) return;
    assertStateWriterLeaseHealthy();
    restoreTarget(this.context.resolveManagedPath(this.operation.path), this.snapshot);
  }

  confirm(): void {
    for (const root of this.backupRoots) {
      try {
        assertStateWriterLeaseHealthy();
        rmSync(root, { recursive: true, force: true });
      } catch {
        /* best-effort dispose; a leftover remains diagnostic */
      }
    }
    this.backupRoots = [];
  }

  private registerDirectoryBackup(snapshot: TargetSnapshot | null): void {
    if (snapshot?.kind === 'directory') this.backupRoots.push(dirname(snapshot.backupPath));
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

/**
 * HARN-01 (R1): skip the recursive directory backup only for operations that
 * provably do not mutate the target. Any ambiguous or unreadable state keeps
 * the snapshot (conservative: never trade rollback for savings on doubt).
 * Mutating operations always snapshot, so rollback (R2) is unchanged; skipped
 * steps leave `snapshot` null and `rollback()` is a no-op for them.
 */
function operationNeedsSnapshot(operation: OperationPlan, target: string): boolean {
  if (operation.action === 'mkdir') {
    // `mkdir -p` over an existing directory is a proven no-op.
    // Missing targets, files, symlinks, or unreadable state stay conservative.
    try {
      return !lstatSync(target).isDirectory();
    } catch {
      return true;
    }
  }
  if (operation.action === 'rmdir-if-empty') {
    // Only an existing *empty* directory will actually be removed.
    try {
      if (!lstatSync(target).isDirectory()) return false;
    } catch {
      return true;
    }
    try {
      return readdirSync(target).length === 0;
    } catch {
      return true;
    }
  }
  return true;
}

function snapshotIfNeeded(operation: OperationPlan, target: string): TargetSnapshot | null {
  if (!operationNeedsSnapshot(operation, target)) return null;
  return snapshotTarget(target);
}

function snapshotTarget(target: string): TargetSnapshot {
  if (!existsSync(target)) return { kind: 'missing' };

  const stat = lstatSync(target);
  if (stat.isSymbolicLink()) {
    return { kind: 'symlink', link: readlinkSync(target) };
  }
  if (stat.isDirectory()) {
    return snapshotDirectory(target);
  }
  return { kind: 'file', content: readFileSync(target), mode: stat.mode };
}

function snapshotDirectory(target: string): TargetSnapshot {
  let backupRoot: string | undefined;
  try {
    backupRoot = mkdtempSync(join(tmpdir(), 'kyro-pipeline-'));
    const backupPath = join(backupRoot, 'target');
    cpSync(target, backupPath, { recursive: true, verbatimSymlinks: true });
    return { kind: 'directory', backupPath };
  } catch (error) {
    if (backupRoot) {
      try {
        rmSync(backupRoot, { recursive: true, force: true });
      } catch {
        /* keep incomplete backup as diagnostic evidence if dispose fails */
      }
    }
    throw new SnapshotCreateError(target, error instanceof Error ? error : new Error(String(error)));
  }
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
    // Backup is retained until confirm() after total success or clean rollback
    // so a later rollback failure still has diagnostic evidence.
  } else if (snapshot.kind === 'symlink') {
    assertStateWriterLeaseHealthy();
    symlinkSync(snapshot.link, target);
  }
}

function formatPipelineError(result: PipelineResult): Error {
  const snapshotError = result.error instanceof SnapshotCreateError ? result.error : null;
  const writeFailure = describeWriteFailure(snapshotError?.cause ?? result.error);
  if (writeFailure) return writeFailure;
  const rollbackAttempted = (result.rollback?.steps.length ?? 0) > 0;
  if (snapshotError && !rollbackAttempted) return snapshotError;
  const message = result.rollback && !result.rollback.success
    ? `Apply failed and rollback failed: ${result.error?.message ?? 'unknown error'}`
    : `Apply failed and rollback completed: ${result.error?.message ?? 'unknown error'}`;
  return new Error(message);
}
