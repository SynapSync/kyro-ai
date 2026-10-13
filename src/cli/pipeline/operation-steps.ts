import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  fstatSync,
  ftruncateSync,
  openSync,
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
  statSync,
  symlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { removeManagedBlock, upsertManagedBlock } from '../injectors/managed-block';
import { mergeJsonObjectContent, removeJsonPathContent } from '../injectors/json-merge';
import { describeWriteFailure } from '../core/errors';
import { assertNotRetiredSprintOverwrite } from '../core/retirement-guard';
import type { OperationPlan, OperationProjectionResult } from '../types';
import { PipelineOrchestrator } from './orchestrator';
import type { PipelineResult, StagePlan, Step } from './types';
import { assertStateWriterLeaseHealthy, withStateWriterLock } from './state-writer-lock';
import { assertSafeCanonicalSkillWrite } from '../adapters/command-skills';
import { assertSafeClaudeSkillWrite } from '../adapters/claude';
import { assertSafeOpenCodeCommandWrite, assertSafeOpenCodeSkillWrite } from '../adapters/opencode';

interface OperationExecutionContext {
  packageRoot: string;
  resolveManagedPath(path: string): string;
}

type TargetSnapshot =
  | { kind: 'missing' }
  | { kind: 'file'; content: Buffer; mode: number }
  | { kind: 'directory'; backupPath: string }
  | { kind: 'symlink'; link: string; type?: 'dir' };

export function applyOperationPlan(plan: OperationPlan[], context: OperationExecutionContext, publish?: (results: OperationProjectionResult[]) => void): OperationProjectionResult[] {
  return withStateWriterLock(() => {
    // Check native ownership before canonical publication, including legacy migrations.
    for (const operation of plan) {
      if (operation.guard === 'claude-skill') assertSafeClaudeSkillWrite(operation.path, operation.allowExistingManagedSkill === true);
      if (operation.guard === 'opencode-skill') assertSafeOpenCodeSkillWrite(operation.path, operation.allowExistingManagedSkill === true);
      if (operation.guard === 'opencode-command') assertSafeOpenCodeCommandWrite(operation.path, operation.allowExistingManagedSkill === true);
    }
    for (const operation of plan) {
      if (operation.guard === 'canonical-skill') assertSafeCanonicalSkillWrite(operation.path, operation.allowExistingManagedSkill === true);
      if (operation.action !== 'mkdir' && operation.action !== 'rmdir-if-empty') {
        assertNotRetiredSprintOverwrite(context.resolveManagedPath(operation.path));
      }
    }
    const stagePlan = operationPlanToStagePlan(plan, context);
    if (publish) stagePlan.apply.push({
      id: 'publish-machine-adapter-registry',
      description: 'Publish machine adapter projection modes',
      run: () => publish(stagePlan.apply.flatMap((step) => step instanceof OperationStep && step.projection ? [step.projection] : [])),
    });
    const result = new PipelineOrchestrator('stop-on-error').execute(stagePlan);
    if (result.error) throw formatPipelineError(result);
    return stagePlan.apply.flatMap((step) => step instanceof OperationStep && step.projection ? [step.projection] : []);
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

class LinkRollbackError extends Error {
  constructor(target: string, applyError: unknown, rollbackError: unknown) {
    super(`Link apply failed and rollback failed for ${target}: ${String(applyError)}; restore: ${String(rollbackError)}`);
    this.name = 'LinkRollbackError';
  }
}

class WriteRollbackError extends Error {
  constructor(target: string, applyError: unknown, rollbackError: unknown) {
    super(`Write apply failed and rollback failed for ${target}: ${String(applyError)}; restore: ${String(rollbackError)}`);
    this.name = 'WriteRollbackError';
  }
}

class OperationStep implements Step {
  readonly id: string;
  readonly description: string;
  private snapshot: TargetSnapshot | null = null;
  private backupRoots: string[] = [];
  private retainBackups = false;
  projection: OperationProjectionResult | undefined;

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
    if (this.operation.guard === 'canonical-skill') assertSafeCanonicalSkillWrite(this.operation.path, this.operation.allowExistingManagedSkill === true);
    if (this.operation.guard === 'opencode-skill') assertSafeOpenCodeSkillWrite(this.operation.path, this.operation.allowExistingManagedSkill === true);
    if (this.operation.guard === 'opencode-command') assertSafeOpenCodeCommandWrite(this.operation.path, this.operation.allowExistingManagedSkill === true);
    if (this.operation.guard === 'claude-skill') assertSafeClaudeSkillWrite(this.operation.path, this.operation.allowExistingManagedSkill === true);
    if (this.operation.action !== 'mkdir' && this.operation.action !== 'rmdir-if-empty') {
      assertNotRetiredSprintOverwrite(target);
    }
    this.snapshot = snapshotIfNeeded(this.operation, target);
    this.registerDirectoryBackup(this.snapshot);
    assertStateWriterLeaseHealthy();
    if (this.operation.action === 'link') {
      // The orchestrator rolls back successful steps only. A failed link/copy
      // publication must restore its own snapshot before propagating failure.
      try {
        this.projection = applyDirectoryLink(this.operation, target, this.context);
      } catch (error) {
        try {
          if (this.snapshot) restoreTarget(target, this.snapshot);
        } catch (rollbackError) {
          this.retainBackups = true;
          throw new LinkRollbackError(target, error, rollbackError);
        }
        throw error;
      }
    } else {
      applyOperation(this.operation, target, this.context);
    }
  }

  rollback(): void {
    if (!this.snapshot) return;
    assertStateWriterLeaseHealthy();
    restoreTarget(this.context.resolveManagedPath(this.operation.path), this.snapshot);
  }

  confirm(): void {
    if (this.retainBackups) return;
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

function applyDirectoryLink(operation: OperationPlan, target: string, context: OperationExecutionContext): OperationProjectionResult {
  if (operation.guard === 'opencode-skill') assertSafeOpenCodeSkillWrite(operation.path, operation.allowExistingManagedSkill === true);
  if (operation.guard === 'opencode-command') assertSafeOpenCodeCommandWrite(operation.path, operation.allowExistingManagedSkill === true);
  if (operation.guard === 'claude-skill') assertSafeClaudeSkillWrite(operation.path, operation.allowExistingManagedSkill === true);
  if (!operation.source) throw new Error(`Link operation missing source for ${operation.path}`);
  const source = context.resolveManagedPath(operation.source);
  if (isWithin(source, target) || isWithin(target, source) || !lstatSync(source).isDirectory()) {
    throw new Error(`Link source must be a disjoint real directory for ${operation.path}: ${source}`);
  }
  assertStateWriterLeaseHealthy();
  mkdirSync(dirname(target), { recursive: true });
  assertStateWriterLeaseHealthy();
  rmSync(target, { recursive: true, force: true });
  if (process.env.KYRO_LINK_MODE !== 'copy' && operation.projection !== 'copy') {
    try {
      assertStateWriterLeaseHealthy();
      symlinkSync(source, target, 'dir');
      return { path: operation.path, source: operation.source, projection: 'link' };
    } catch (error: unknown) {
      if (!isLinkUnsupported(error)) throw error;
    }
  }
  assertStateWriterLeaseHealthy();
  cpSync(source, target, { recursive: true, verbatimSymlinks: true });
  return { path: operation.path, source: operation.source, projection: 'copy' };
}

function isWithin(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

function isLinkUnsupported(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    && ['EPERM', 'EACCES', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP'].includes(String(error.code));
}

function applyOperation(operation: OperationPlan, target: string, context: OperationExecutionContext): void {
  if (operation.guard === 'opencode-skill') assertSafeOpenCodeSkillWrite(operation.path, operation.allowExistingManagedSkill === true);
  if (operation.guard === 'opencode-command') assertSafeOpenCodeCommandWrite(operation.path, operation.allowExistingManagedSkill === true);
  if (operation.guard === 'claude-skill') assertSafeClaudeSkillWrite(operation.path, operation.allowExistingManagedSkill === true);
  if (operation.action === 'mkdir') {
    assertStateWriterLeaseHealthy();
    mkdirSync(target, { recursive: true });
  } else if (operation.action === 'write') {
    assertStateWriterLeaseHealthy();
    mkdirSync(dirname(target), { recursive: true });
    assertStateWriterLeaseHealthy();
    if (operation.guard === 'opencode-command' || operation.guard === 'canonical-skill') writeOpenCodeCommand(operation, target);
    else writeFileSync(target, operation.content ?? '', 'utf-8');
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

/** Open without truncation or symlink traversal, then verify before writing. */
function writeOpenCodeCommand(operation: OperationPlan, target: string): void {
  if (operation.guard === 'canonical-skill') assertSafeCanonicalSkillWrite(operation.path, operation.allowExistingManagedSkill === true);
  else assertSafeOpenCodeCommandWrite(operation.path, operation.allowExistingManagedSkill === true);
  let previous: ReturnType<typeof lstatSync> | null = null;
  try { previous = lstatSync(target); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const flags = fsConstants.O_WRONLY | (fsConstants.O_NOFOLLOW ?? 0)
    | (previous ? 0 : fsConstants.O_CREAT | fsConstants.O_EXCL);
  const fd = openSync(target, flags, 0o666);
  let fdOpen = true;
  try {
    const opened = fstatSync(fd);
    const current = lstatSync(target);
    if (!opened.isFile() || !current.isFile() || opened.ino !== current.ino || opened.dev !== current.dev
      || (previous && (opened.ino !== previous.ino || opened.dev !== previous.dev))) {
      throw new Error(`Unsafe OpenCode command target changed before write: ${target}.`);
    }
    const original = previous ? readFileSync(target) : null;
    assertStateWriterLeaseHealthy();
    try {
      ftruncateSync(fd);
      writeFileSync(fd, operation.content ?? '', 'utf8');
    } catch (error) {
      // A failed step is not rolled back by the orchestrator. Restore through
      // the pinned descriptor, with explicit offsets after a partial write.
      try {
        assertStateWriterLeaseHealthy();
        if (original !== null) {
          let offset = 0;
          while (offset < original.length) {
            const written = writeSync(fd, original, offset, original.length - offset, offset);
            if (!written) throw new Error(`Unable to restore bytes for ${target}.`);
            offset += written;
          }
          ftruncateSync(fd, original.length);
        } else {
          closeSync(fd);
          fdOpen = false;
          const current = lstatSync(target);
          if (!current.isFile() || current.ino !== opened.ino || current.dev !== opened.dev) {
            throw new Error(`Unsafe command target changed before rollback: ${target}.`);
          }
          rmSync(target);
        }
      } catch (rollbackError) { throw new WriteRollbackError(target, error, rollbackError); }
      throw error;
    }
  } finally { if (fdOpen) closeSync(fd); }
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
  return snapshotTarget(target, operation.action === 'link');
}

function snapshotTarget(target: string, directoryLink = false): TargetSnapshot {
  let stat: ReturnType<typeof lstatSync>;
  try {
    stat = lstatSync(target);
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return { kind: 'missing' };
    throw error;
  }
  if (stat.isSymbolicLink()) {
    try { directoryLink ||= statSync(target).isDirectory(); } catch { /* preserve dangling link text */ }
    return { kind: 'symlink', link: readlinkSync(target), ...(directoryLink ? { type: 'dir' as const } : {}) };
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
    symlinkSync(snapshot.link, target, snapshot.type);
  }
}

function formatPipelineError(result: PipelineResult): Error {
  if (result.error instanceof LinkRollbackError || result.error instanceof WriteRollbackError) return result.error;
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
