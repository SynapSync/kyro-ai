import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, relative } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { assertSafeManagedPath, assertSafePathSegment, ensureDurableDirectory, fsyncDirectory, fsyncParentDirectory, withStateWriterLock } from '../pipeline/state-writer-lock';
import { atomicReplace, sha256 } from '../checkpoints/sprint-close';
import { validateSprintFile } from '../artifacts/schema';
import { KyroCoreError } from '../core/errors';
import type { WorkClosure, WorkFile, WorkPromotionJournal, WorkPromotionPreview } from '../types';
import { asWorkFile, demoteTaskForInvalidation, deriveWorkHandoff, validateWorkFile, validatePromotionJournal, validatePromotionSidecar } from './schema';
import {
  buildPromotionJournal,
  buildPromotionSidecar,
  buildPromotionTargetSprint,
  planPromotionPreview,
  promotionRequestDigest,
  promotionSidecarPath,
  promotionOriginPath,
  stagePromotionDestination,
  throwInjectedPromotionFailure,
  workPromotionJournalPath,
  writeStagedPromotionDestination,
} from './promotion';
import type { StagedPromotionDestination } from './promotion';
import { sha256Bytes } from './brief-source';

export const WORK_ROOT = '.agents/kyro/work';
export function workDirectory(id: string): string { assertWorkId(id); return `${WORK_ROOT}/${id}`; }
export function workJsonPath(id: string): string { return `${workDirectory(id)}/work.json`; }
export function workBriefPath(id: string): string { return `${workDirectory(id)}/brief.md`; }
export function workPendingAmendmentPath(id: string): string { return `${workDirectory(id)}/.pending-brief-amendment.json`; }
function byteDigest(value: Buffer | string): string { return createHash('sha256').update(value).digest('hex'); }
function pendingPath(id: string): string { return assertSafeManagedPath(workPendingAmendmentPath(id)); }
function pendingExists(id: string): boolean {
  try { lstatSync(pendingPath(id)); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}
function assertNoPendingAmendment(id: string): void {
  if (pendingExists(id)) throw new KyroCoreError('STATE_DIVERGED', `Work ${id} has a pending brief amendment.`, 'Retry the matching amend-brief command; other mutations are blocked until recovery completes.');
}
export function assertWorkId(id: string): void { if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw new KyroCoreError('INVALID_INPUT', `Work ID is unsafe: ${id}.`, 'Use a lowercase hyphenated slug.'); }

export function readWork(id: string): WorkFile {
  const jsonPath = workJsonPath(id); const absolute = assertSafeManagedPath(jsonPath);
  if (!existsSync(absolute)) throw new KyroCoreError('INVALID_INPUT', `Work ${id} does not exist.`, 'Use kyro work create with a new ID.');
  let value: unknown;
  try { value = JSON.parse(readFileSync(absolute, 'utf8')); } catch (error) { throw new KyroCoreError('INVALID_INPUT', `Work ${id} contains unreadable JSON: ${String(error)}.`, 'Repair requires an explicit future Work repair verb.'); }
  const issues = validateWorkFile(value, jsonPath);
  if (issues.length) throw new KyroCoreError('INVALID_INPUT', `Work ${id} violates its contract at ${issues[0].field}: ${issues[0].message}.`, 'Do not edit work.json manually; restore a known valid artifact.');
  const work = asWorkFile(value)!;
  if (work.id !== id) throw new KyroCoreError('INVALID_INPUT', `Work directory ${id} disagrees with work.json ID ${work.id}.`, 'Do not rename managed Work directories manually.');
  return work;
}

export function assertBriefIntegrity(work: WorkFile): void {
  assertNoPendingAmendment(work.id);
  const relativePath = `${workDirectory(work.id)}/${work.brief.path}`;
  const absolute = assertSafeManagedPath(relativePath);
  if (!existsSync(absolute)) throw new KyroCoreError('INVALID_INPUT', `Work ${work.id} brief is missing.`, 'Restore the CLI-owned brief before continuing.');
  if (byteDigest(readFileSync(absolute)) !== work.brief.digest) throw new KyroCoreError('STATE_DIVERGED', `Work ${work.id} brief digest does not match work.json.`, 'Restore the known CLI-owned brief; do not approve stale material.');
}

export function createWork(work: WorkFile, brief: string | Buffer, dryRun = false): void {
  const issues = validateWorkFile(work, workJsonPath(work.id));
  if (issues.length) throw new KyroCoreError('INVALID_INPUT', `Refusing invalid Work at ${issues[0].field}: ${issues[0].message}.`, 'Correct the command input and retry.');
  // The digest binds the original source bytes: callers pass the verbatim bytes
  // proven lossless by the shared source reader, so publication never depends on
  // decode/re-encode symmetry at the write layer.
  const briefDigest = typeof brief === 'string' ? sha256(brief) : byteDigest(brief);
  if (briefDigest !== work.brief.digest) throw new KyroCoreError('INVALID_INPUT', 'Brief content does not match its declared digest.', 'Regenerate the Work through the CLI.');
  const directory = workDirectory(work.id); const target = assertSafeManagedPath(directory);
  if (existsSync(target)) throw new KyroCoreError('CHECKPOINT_CONFLICT', `Work ${work.id} already exists.`, 'Choose a new Work ID; existing Work is never overwritten by create.');
  if (dryRun) return;
  withStateWriterLock(() => {
    if (existsSync(target)) throw new KyroCoreError('CHECKPOINT_CONFLICT', `Work ${work.id} was created concurrently.`, 'Read it and choose a different ID.');
    const root = assertSafeManagedPath(WORK_ROOT); ensureDurableDirectory(root);
    const temporary = assertSafeManagedPath(`${WORK_ROOT}/.${work.id}.tmp-${randomUUID()}`);
    try {
      mkdirSync(temporary, { recursive: false });
      writeDurableFile(`${temporary}/brief.md`, brief);
      writeDurableFile(`${temporary}/work.json`, `${JSON.stringify(work, null, 2)}\n`);
      fsyncDirectory(temporary);
      renameSync(temporary, target); fsyncParentDirectory(target);
    } catch (error) { if (existsSync(temporary)) rmSync(temporary, { recursive: true, force: true }); throw error; }
  });
}

function writeDurableFile(path: string, content: string | Buffer): void {
  writeFileSync(path, content, { encoding: 'utf8', flag: 'wx' });
  const descriptor = openSync(path, 'r');
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
}

export function updateWork(id: string, expectedRevision: number, build: (current: WorkFile) => WorkFile, dryRun = false): WorkFile {
  return withStateWriterLock(() => {
    assertNoPendingPromotion(id);
    const current = readWork(id); assertBriefIntegrity(current);
    if (current.revision !== expectedRevision) throw new KyroCoreError('STATE_DIVERGED', `Work ${id} revision ${current.revision} does not match expected ${expectedRevision}.`, 'Read Work status and retry from the current revision.');
    const next = build(current);
    if (next.id !== id || next.revision !== current.revision + 1) throw new KyroCoreError('INVALID_INPUT', 'A Work update must preserve its ID and increase revision exactly once.', 'Use a single CLI-owned transition.');
    const issues = validateWorkFile(next, workJsonPath(id)); if (issues.length) throw new KyroCoreError('INVALID_INPUT', `Refusing invalid Work at ${issues[0].field}: ${issues[0].message}.`, 'Correct the transition and retry.');
    if (!dryRun) atomicReplace(workJsonPath(id), `${JSON.stringify(next, null, 2)}\n`);
    return next;
  });
}

interface ClosureHistoryRecord { schemaVersion: 1; kind: 'work-closure-history'; workId: string; closedRevision: number; closure: WorkClosure; }
export function workClosureHistoryPath(id: string, revision: number): string { return `${workDirectory(id)}/closure-history/closure-r${revision}.json`; }

/** Preserve exact closure provenance before publishing a reopened Work. */
export function reopenWork(id: string, expectedRevision: number, reason: string, by: string, dryRun = false): { work: WorkFile; historyPath: string } {
  return withStateWriterLock(() => {
    assertNoPendingPromotion(id);
    const current = readWork(id); assertBriefIntegrity(current);
    if (current.revision !== expectedRevision) throw new KyroCoreError('STATE_DIVERGED', `Work ${id} revision ${current.revision} does not match expected ${expectedRevision}.`, 'Read Work status and retry from the current revision.');
    if (current.state !== 'closed' || !current.closure) throw new KyroCoreError('INVALID_INPUT', `Work ${id} is not closed and cannot be reopened.`, 'Only a closed, non-promoted Work can be reopened.');
    const now = new Date().toISOString();
    const next: WorkFile = { ...current, state: 'active', revision: current.revision + 1, updatedAt: now, closure: null,
      activity: [...current.activity, { seq: current.activity.length + 1, at: now, event: 'work_reopened', taskId: null, by, reason, revision: current.revision + 1 }], handoff: { ...current.handoff } };
    next.handoff = deriveWorkHandoff(next);
    const issues = validateWorkFile(next, workJsonPath(id));
    if (issues.length) throw new KyroCoreError('INVALID_INPUT', `Refusing invalid reopened Work at ${issues[0].field}: ${issues[0].message}.`, 'Restore a valid closed Work before retrying.');
    const historyPath = workClosureHistoryPath(id, current.revision);
    if (dryRun) return { work: next, historyPath };
    const record: ClosureHistoryRecord = { schemaVersion: 1, kind: 'work-closure-history', workId: id, closedRevision: current.revision, closure: current.closure };
    const serialized = `${JSON.stringify(record, null, 2)}\n`;
    const historyDirectory = assertSafeManagedPath(`${workDirectory(id)}/closure-history`);
    ensureDurableDirectory(historyDirectory);
    const historyAbsolute = assertSafeManagedPath(historyPath);
    if (existsSync(historyAbsolute)) {
      if (readFileSync(historyAbsolute, 'utf8') !== serialized) throw new KyroCoreError('STATE_DIVERGED', `Work ${id} closure history conflicts with current closure.`, 'Restore the CLI-owned history artifact before retrying.');
    } else {
      atomicReplace(historyPath, serialized);
    }
    if (process.env.KYRO_WORK_INJECT_FAILURE === 'reopen-after-history') throw new KyroCoreError('INTERNAL', 'Injected Work reopen failure after history publication.', 'Retry the same reopen command; closure history is preserved.');
    atomicReplace(workJsonPath(id), `${JSON.stringify(next, null, 2)}\n`);
    return { work: next, historyPath };
  });
}

export function workIsTrackedPath(path: string): boolean { return relative(WORK_ROOT, path) !== '..'; }

/** Read the durable pending promotion intent, or null when none exists. */
export function readPromotionJournal(id: string): WorkPromotionJournal | null {
  const journalPath = assertSafeManagedPath(workPromotionJournalPath(id));
  try {
    const stat = lstatSync(journalPath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new KyroCoreError('STATE_DIVERGED', `Work ${id} promotion record is not a regular file.`, 'Restore the CLI-owned transaction record before retrying.');
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error instanceof KyroCoreError ? error : error;
  }
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(journalPath, 'utf8'));
  } catch {
    throw new KyroCoreError('STATE_DIVERGED', `Work ${id} promotion record is unreadable.`, 'Restore the CLI-owned transaction record before retrying.');
  }
  const issues = validatePromotionJournal(value, workPromotionJournalPath(id));
  if (issues.length) {
    throw new KyroCoreError('STATE_DIVERGED', `Work ${id} promotion record is invalid at ${issues[0].field}: ${issues[0].message}.`, 'Restore the CLI-owned transaction record before retrying.');
  }
  const journal = value as WorkPromotionJournal;
  if (journal.workId !== id) {
    throw new KyroCoreError('STATE_DIVERGED', `Work ${id} promotion record belongs to ${journal.workId}.`, 'Restore the CLI-owned transaction record before retrying.');
  }
  return journal;
}

/**
 * Verify a promoted Work against its reciprocal target link instead of
 * trusting work.json activity alone. Missing, corrupt, or mismatched link
 * material (or a dangling pending intent) fails closed with a concrete
 * remedy; a healthy report requires both directions to agree.
 */
export function assertPromotionReciprocal(work: WorkFile): void {
  const pending = readPromotionJournal(work.id);
  if (pending) {
    throw new KyroCoreError('STATE_DIVERGED', `Work ${work.id} has a pending promotion to Forge scope "${pending.toScope}".`, `Retry: kyro work promote --work ${work.id} --to-scope ${pending.toScope} --expect-revision ${pending.expectedRevision} --by ${pending.actor} --yes.`);
  }
  if (work.state !== 'promoted') return;
  const promotion = work.promotion;
  if (!promotion) throw new KyroCoreError('INVALID_INPUT', `Work ${work.id} is promoted but carries no promotion record.`, 'Restore the CLI-published work.json; never hand-edit managed state.');
  const sidecarRelative = promotionSidecarPath(promotion.targetScope);
  const sidecarAbsolute = assertSafeManagedPath(sidecarRelative);
  if (!existsSync(sidecarAbsolute)) {
    throw new KyroCoreError('STATE_DIVERGED', `Work ${work.id} reciprocal target link is missing: ${sidecarRelative}.`, 'Restore the CLI-published reciprocal link; a promoted Work is never healthy on work.json activity alone.');
  }
  let sidecar: unknown;
  try {
    sidecar = JSON.parse(readFileSync(sidecarAbsolute, 'utf8'));
  } catch {
    throw new KyroCoreError('STATE_DIVERGED', `Work ${work.id} reciprocal target link is unreadable: ${sidecarRelative}.`, 'Restore the CLI-published reciprocal link.');
  }
  const sidecarIssues = validatePromotionSidecar(sidecar, sidecarRelative);
  if (sidecarIssues.length) {
    throw new KyroCoreError('STATE_DIVERGED', `Work ${work.id} reciprocal target link is invalid at ${sidecarIssues[0].field}: ${sidecarIssues[0].message}.`, 'Restore the CLI-published reciprocal link.');
  }
  const link = sidecar as WorkPromotionSidecarRecord;
  const targetRelative = promotion.targetPath;
  const targetAbsolute = assertSafeManagedPath(targetRelative);
  if (!existsSync(targetAbsolute)) {
    throw new KyroCoreError('STATE_DIVERGED', `Work ${work.id} promotion target is missing: ${targetRelative}.`, 'Restore the CLI-published Forge scope; a promoted Work is never healthy without its destination.');
  }
  const originRelative = promotionOriginPath(promotion.targetScope);
  const originAbsolute = assertSafeManagedPath(originRelative);
  if (!existsSync(originAbsolute) || sha256Bytes(readFileSync(originAbsolute)) !== link.targetDigest) {
    throw new KyroCoreError('STATE_DIVERGED', `Work ${work.id} promotion origin is missing or its digest disagrees with the reciprocal link.`, 'Restore the CLI-published initial Sprint snapshot and reciprocal link.');
  }
  let target: unknown;
  try { target = JSON.parse(readFileSync(targetAbsolute, 'utf8')); }
  catch { throw new KyroCoreError('STATE_DIVERGED', `Work ${work.id} current Forge sprint is unreadable.`, 'Restore a valid Forge sprint through its own recovery flow.'); }
  const targetIssues = validateSprintFile(target, targetRelative);
  if (targetIssues.length || (target as { scope?: unknown }).scope !== promotion.targetScope) {
    throw new KyroCoreError('STATE_DIVERGED', `Work ${work.id} current Forge sprint has invalid shape or scope identity.`, 'Repair the Forge sprint through its own CLI flow.');
  }
  const agreements: Array<[string, string, string]> = [
    ['source Work identity', link.sourceWorkId, work.id],
    ['source path', link.sourcePath, workJsonPath(work.id)],
    ['target scope', link.targetScope, promotion.targetScope],
    ['target path', link.targetPath, promotion.targetPath],
    ['source digest', link.sourceDigest, promotion.sourceDigest],
    ['source brief digest', link.sourceBriefDigest, work.brief.digest],
    ['actor', link.actor, promotion.by],
    ['promoted timestamp', link.promotedAt, promotion.promotedAt],
    ['prepared timestamp', link.preparedAt, promotion.promotedAt],
    ['request digest', link.requestDigest, promotionRequestDigest(work.id, {
      toScope: promotion.targetScope,
      actor: promotion.by,
      expectedRevision: promotion.sourceRevision - 1,
    })],
  ];
  for (const [label, left, right] of agreements) {
    if (left !== right) throw new KyroCoreError('STATE_DIVERGED', `Work ${work.id} reciprocal link disagrees on ${label}.`, 'Restore the CLI-published Work and reciprocal link.');
  }
  if (link.sourceRevision !== work.revision || link.sourceRevision !== promotion.sourceRevision
    || JSON.stringify(link.promotedTaskIds) !== JSON.stringify(promotion.promotedTaskIds)) {
    throw new KyroCoreError('STATE_DIVERGED', `Work ${work.id} reciprocal link disagrees on revision or transferred tasks.`, 'Restore the CLI-published Work and reciprocal link.');
  }
}

/** Other mutations fail closed while a promotion intent exists; only a matching retry proceeds. */
export function assertNoPendingPromotion(id: string): void {
  if (readPromotionJournal(id) !== null) {
    throw new KyroCoreError('STATE_DIVERGED', `Work ${id} has a pending promotion.`, 'Retry the matching promote command; other mutations are blocked until recovery completes.');
  }
}

function clearPromotionJournal(id: string): void {
  const journalPath = assertSafeManagedPath(workPromotionJournalPath(id));
  unlinkSync(journalPath);
  fsyncParentDirectory(journalPath);
}

export interface PromoteWorkInput {
  toScope: string;
  actor: string;
}

export interface PromoteWorkResult {
  work: WorkFile;
  preview: WorkPromotionPreview;
  targetDigest: string;
  requestDigest: string;
  recovered: boolean;
}

/**
 * Commit a Work-to-Forge promotion as one recoverable cross-artifact
 * transaction: durably record intent, stage target files, publish the final
 * Work revision, publish the complete destination, verify reciprocal digests,
 * then durably clear intent. The Work never appears promoted until the target
 * is published and linked; every injected boundary is resumable by an exact
 * retry, and any mismatch fails closed without a false promoted state.
 */
export function promoteWork(
  id: string,
  expectedRevision: number,
  input: PromoteWorkInput,
  dryRun = false,
): PromoteWorkResult {
  return withStateWriterLock(() => {
    const pending = readPromotionJournal(id);
    const workPath = workJsonPath(id);
    const workBytes = readFileSync(assertSafeManagedPath(workPath));
    const current = readWork(id);
    const requestDigest = promotionRequestDigest(id, { toScope: input.toScope, actor: input.actor, expectedRevision });
    if (pending && (pending.expectedRevision !== expectedRevision || pending.toScope !== input.toScope || pending.actor !== input.actor || pending.requestDigest !== requestDigest)) {
      throw new KyroCoreError('STATE_DIVERGED', `Work ${id} pending promotion does not match this retry.`, 'Retry with the original target scope, actor, and expected revision.');
    }
    const observedWorkDigest = sha256Bytes(workBytes);
    const briefAbsolute = assertSafeManagedPath(`${workDirectory(id)}/${current.brief.path}`);
    if (!pending) {
      if (current.revision !== expectedRevision) throw new KyroCoreError('STATE_DIVERGED', `Work ${id} revision ${current.revision} does not match expected ${expectedRevision}.`, 'Read Work status and retry from the current revision.');
      assertBriefIntegrity(current);
    } else {
      if (!existsSync(briefAbsolute)) throw new KyroCoreError('STATE_DIVERGED', `Work ${id} brief is missing.`, 'Restore the CLI-owned brief before retrying.');
      if (sha256Bytes(readFileSync(briefAbsolute)) !== pending.sourceBriefDigest) {
        throw new KyroCoreError('STATE_DIVERGED', `Work ${id} brief changed during promotion.`, 'Restore the CLI-owned brief; out-of-band changes are not recoverable.');
      }
      if (observedWorkDigest !== pending.oldWorkDigest && observedWorkDigest !== pending.newWorkDigest) {
        throw new KyroCoreError('STATE_DIVERGED', `Work ${id} promotion files do not match a recoverable publication boundary.`, 'Restore the CLI-owned files before retrying; do not accept an external edit.');
      }
      if (observedWorkDigest === pending.oldWorkDigest && current.revision !== expectedRevision) {
        throw new KyroCoreError('STATE_DIVERGED', `Work ${id} promotion record disagrees with current Work.`, 'Restore the CLI-owned files.');
      }
      if (observedWorkDigest === pending.newWorkDigest) {
        if (current.revision !== expectedRevision + 1) throw new KyroCoreError('STATE_DIVERGED', `Work ${id} promotion record disagrees with current Work.`, 'Restore the CLI-owned files.');
        assertPromotionMatchesJournal(current, pending);
      }
    }

    const preparedAt = pending?.preparedAt ?? new Date().toISOString();
    const prePublication = !pending || observedWorkDigest === pending.oldWorkDigest;
    // After Work publication the planner would (correctly) refuse the promoted
    // state, so resume rebuilds the identical preview from the live promotion
    // record instead of re-planning.
    const preview = prePublication
      ? planPromotionPreview(current, { toScope: input.toScope, actor: input.actor, expectedRevision })
      : previewFromPromotedWork(current, pending!);
    if (preview.requestDigest !== (pending?.requestDigest ?? requestDigest)) {
      throw new KyroCoreError('STATE_DIVERGED', `Work ${id} pending promotion no longer produces its declared request digest.`, 'Restore the CLI-owned transaction before retrying.');
    }

    // Promotion never touches task definitions, titles, or the brief, so the
    // staged target is fully determined by the live Work plus the preview and
    // its digest is known before any write, binding the journal to it.
    const stagedTargetDigest = sha256Bytes(Buffer.from(`${JSON.stringify(buildPromotionTargetSprint(current, preview, { allowExistingScope: !prePublication }), null, 2)}\n`, 'utf8'));
    let next: WorkFile;
    let nextJson: string;
    let newWorkDigest: string;
    if (prePublication) {
      const transferredIds = preview.transferred.map((transfer) => transfer.sourceId);
      const built: WorkFile = {
        ...current,
        state: 'promoted',
        revision: current.revision + 1,
        updatedAt: preparedAt,
        promotion: {
          targetScope: input.toScope,
          targetPath: `.agents/kyro/scopes/${input.toScope}/sprint.json`,
          sourceRevision: current.revision + 1,
          sourceDigest: pending?.oldWorkDigest ?? observedWorkDigest,
          promotedTaskIds: transferredIds,
          promotedAt: preparedAt,
          by: input.actor,
        },
        activity: [
          ...current.activity,
          { seq: current.activity.length + 1, at: preparedAt, event: 'promotion_prepared', taskId: null, by: input.actor, reason: `Promotion to Forge scope ${input.toScope} prepared.`, revision: current.revision + 1 },
          { seq: current.activity.length + 2, at: preparedAt, event: 'work_promoted', taskId: null, by: input.actor, reason: `Promoted ${transferredIds.length} unfinished task(s) to Forge scope ${input.toScope}.`, revision: current.revision + 1 },
        ],
        handoff: { ...current.handoff },
      };
      built.handoff = deriveWorkHandoff(built);
      const nextIssues = validateWorkFile(built, workJsonPath(id));
      if (nextIssues.length) throw new KyroCoreError('INVALID_INPUT', `Refusing invalid promoted Work at ${nextIssues[0].field}: ${nextIssues[0].message}.`, 'Correct the Work before retrying.');
      next = built;
      nextJson = `${JSON.stringify(next, null, 2)}\n`;
      newWorkDigest = sha256Bytes(Buffer.from(nextJson, 'utf8'));
    } else {
      // Resume after Work publication: the live document is already final.
      next = current;
      nextJson = workBytes.toString('utf8');
      newWorkDigest = observedWorkDigest;
    }
    if (dryRun) {
      return { work: next, preview, targetDigest: stagedTargetDigest, requestDigest: preview.requestDigest, recovered: pending !== null };
    }
    if (!pending) {
      const journal: WorkPromotionJournal = buildPromotionJournal(preview, {
        oldWorkDigest: observedWorkDigest,
        newWorkDigest,
        stagedTargetDigest,
        preparedAt,
      });
      throwInjectedPromotionFailure('promote-before-journal');
      atomicReplace(workPromotionJournalPath(id), `${JSON.stringify(journal, null, 2)}\n`);
    } else if (pending.newWorkDigest !== newWorkDigest || pending.stagedTargetDigest !== stagedTargetDigest) {
      throw new KyroCoreError('STATE_DIVERGED', `Work ${id} pending promotion no longer produces its declared digests.`, 'Restore the CLI-owned transaction before retrying.');
    }
    throwInjectedPromotionFailure('promote-after-journal');
    // Resume after publication skips the pre-publication availability probe
    // (the destination is legitimately published by now) but still rebuilds
    // the staged bytes deterministically and compares them to the journal.
    const targetAlreadyPublished = existsSync(assertSafeManagedPath(`.agents/kyro/scopes/${input.toScope}`));
    const staged = prePublication
      ? stagePromotionDestination(current, preview, { sourceDigest: pending?.oldWorkDigest ?? observedWorkDigest, promotedAt: preparedAt })
      : writeStagedPromotionDestination(current, preview, { sourceDigest: pending!.oldWorkDigest, promotedAt: preparedAt }, { allowExistingScope: true, stage: !targetAlreadyPublished });
    if (staged.targetDigest !== (pending?.stagedTargetDigest ?? stagedTargetDigest)) {
      throw new KyroCoreError('STATE_DIVERGED', `Work ${id} staged target no longer matches its declared digest.`, 'Restore the CLI-owned transaction before retrying.');
    }
    if (!prePublication && !targetAlreadyPublished) {
      assertStagedMatchesJournal(id, preview, pending!);
    }
    atomicReplace(workPath, nextJson);
    throwInjectedPromotionFailure('promote-after-work');
    publishPromotionTarget(input.toScope, staged);
    throwInjectedPromotionFailure('promote-after-target');
    verifyPromotionReciprocal(id, input.toScope, pending ?? buildPromotionJournal(preview, {
      oldWorkDigest: observedWorkDigest,
      newWorkDigest,
      stagedTargetDigest: staged.targetDigest,
      preparedAt,
    }));
    throwInjectedPromotionFailure('promote-before-cleanup');
    clearPromotionJournal(id);
    return { work: next, preview, targetDigest: staged.targetDigest, requestDigest: preview.requestDigest, recovered: pending !== null };
  });
}

/** Rebuild the identical preview from a published promotion for resume. */
function previewFromPromotedWork(current: WorkFile, pending: WorkPromotionJournal): WorkPromotionPreview {
  assertPromotionMatchesJournal(current, pending);
  const promotedIds = current.promotion!.promotedTaskIds;
  const promotedSet = new Set(promotedIds);
  const byId = new Map(current.tasks.map((task) => [task.id, task]));
  const transferred = promotedIds.map((sourceId, index) => {
    const task = byId.get(sourceId);
    if (!task) throw new KyroCoreError('STATE_DIVERGED', `Work ${current.id} promotion record disagrees with current Work.`, 'Restore the CLI-owned files.');
    return {
      sourceId,
      targetId: `T1.${index + 1}`,
      title: task.title,
      acceptanceCriteria: [...task.acceptanceCriteria],
      filesToTouch: [...task.filesToTouch],
      dependsOn: task.dependsOn.filter((dependency) => promotedSet.has(dependency)).map((dependency) => `T1.${promotedIds.indexOf(dependency) + 1}`),
      sourceStatus: task.status,
      approvalReset: `Work ${task.status} does not carry approval: the Forge task starts pending with no evidence, no verdict, and no pass.`,
    };
  });
  const omitted = (statuses: string[], note: string) =>
    current.tasks.filter((task) => statuses.includes(task.status)).map((task) => ({ sourceId: task.id, status: task.status, note }));
  return {
    schemaVersion: 1,
    kind: 'work-promotion-preview',
    sourceWorkId: current.id,
    sourceRevision: pending.expectedRevision,
    sourceBriefDigest: pending.sourceBriefDigest,
    toScope: pending.toScope,
    targetPath: `.agents/kyro/scopes/${pending.toScope}/sprint.json`,
    actor: pending.actor,
    expectedRevision: pending.expectedRevision,
    requestDigest: pending.requestDigest,
    transferred,
    omittedVerified: omitted(['verified'], 'Verified Work history is excluded; only unfinished tasks transfer.'),
    omittedDisposed: omitted(['cancelled', 'superseded'], 'Disposed Work history is excluded; only unfinished tasks transfer.'),
    dependencyAdjudications: transferred.flatMap((transfer) => {
      const task = byId.get(transfer.sourceId)!;
      return task.dependsOn.filter((dependency) => !promotedSet.has(dependency) && byId.get(dependency)?.status === 'verified').map((dependency) => ({
        task: transfer.targetId,
        dependsOn: dependency,
        resolution: 'omitted_verified_source' as const,
        detail: `Source edge ${transfer.sourceId} -> ${dependency} adjudicated explicitly: ${dependency} is verified Work history, so the Forge task starts without that prerequisite and its criteria must stand alone.`,
      }));
    }),
    workVerdictsImportedAsForgePass: false,
    forgeTasksStartPending: true,
  };
}

function assertPromotionMatchesJournal(current: WorkFile, pending: WorkPromotionJournal): void {
  const promotion = current.promotion;
  const matches = current.state === 'promoted'
    && promotion?.targetScope === pending.toScope
    && promotion?.sourceRevision === pending.expectedRevision + 1
    && promotion?.sourceDigest === pending.oldWorkDigest
    && promotion?.by === pending.actor
    && Array.isArray(promotion?.promotedTaskIds)
    && promotion.promotedTaskIds.length > 0
    && current.revision === pending.expectedRevision + 1;
  if (!matches) {
    throw new KyroCoreError('STATE_DIVERGED', `Work ${current.id} completed promotion disagrees with its intent record.`, 'Restore the CLI-owned files.');
  }
}

function assertStagedMatchesJournal(id: string, preview: WorkPromotionPreview, pending: WorkPromotionJournal): void {
  const sidecar = buildPromotionSidecar(preview, {
    sourceDigest: pending.oldWorkDigest,
    targetDigest: pending.stagedTargetDigest,
    promotedAt: pending.preparedAt,
  });
  const sidecarBytes = `${JSON.stringify(sidecar, null, 2)}\n`;
  const stageRoot = `.agents/kyro/work/${id}/.promotion-stage/${pending.toScope}`;
  const stagedSidecarPath = assertSafeManagedPath(`${stageRoot}/promotion-source.json`);
  const stagedOriginPath = assertSafeManagedPath(`${stageRoot}/promotion-initial-sprint.json`);
  if (!existsSync(stagedSidecarPath) || readFileSync(stagedSidecarPath, 'utf8') !== sidecarBytes
    || !existsSync(stagedOriginPath) || sha256Bytes(readFileSync(stagedOriginPath)) !== pending.stagedTargetDigest) {
    throw new KyroCoreError('STATE_DIVERGED', `Work ${id} staged target no longer matches its declared intent.`, 'Restore the CLI-owned transaction before retrying.');
  }
}

/** A single directory rename makes the complete target visible to Forge at once. */
function publishPromotionTarget(toScope: string, staged: StagedPromotionDestination): void {
  const target = assertSafeManagedPath(`.agents/kyro/scopes/${toScope}`);
  if (existsSync(target)) {
    const expected: Array<[string, string]> = [
      ['sprint.json', staged.sprintBytes],
      ['promotion-source.json', staged.sidecarBytes],
      ['promotion-initial-sprint.json', staged.sprintBytes],
    ];
    if (expected.some(([name, bytes]) => !existsSync(assertSafeManagedPath(`.agents/kyro/scopes/${toScope}/${name}`))
      || readFileSync(assertSafeManagedPath(`.agents/kyro/scopes/${toScope}/${name}`), 'utf8') !== bytes)) {
      throw new KyroCoreError('CHECKPOINT_CONFLICT', `Promotion target scope "${toScope}" differs from its pending intent.`, 'Restore the exact CLI-published destination; conflicting bytes are never overwritten.');
    }
    return;
  }
  const source = dirname(assertSafeManagedPath(staged.stagedSprintPath));
  ensureDurableDirectory(assertSafeManagedPath('.agents/kyro/scopes'));
  throwInjectedPromotionFailure('promote-before-target-rename');
  renameSync(source, target);
  fsyncParentDirectory(source);
  fsyncParentDirectory(target);
  throwInjectedPromotionFailure('promote-after-target-rename');
}

/** Verify both directions agree after publication: identities, revisions, digests, transferred IDs. */
function verifyPromotionReciprocal(id: string, toScope: string, journal: WorkPromotionJournal): void {
  const work = readWork(id);
  const promotion = work.promotion;
  if (work.state !== 'promoted' || !promotion || promotion.targetScope !== toScope || promotion.sourceRevision !== work.revision) {
    throw new KyroCoreError('STATE_DIVERGED', `Work ${id} promotion did not publish its final revision.`, 'Retry the same promote command from the current revision.');
  }
  const sidecarPath = assertSafeManagedPath(promotionSidecarPath(toScope));
  if (!existsSync(sidecarPath)) throw new KyroCoreError('STATE_DIVERGED', `Promotion target link is missing: ${promotionSidecarPath(toScope)}.`, 'Retry the same promote command from the current revision.');
  let sidecar: unknown;
  try {
    sidecar = JSON.parse(readFileSync(sidecarPath, 'utf8'));
  } catch {
    throw new KyroCoreError('STATE_DIVERGED', 'Promotion target link is unreadable.', 'Retry the same promote command from the current revision.');
  }
  const sidecarIssues = validatePromotionSidecar(sidecar, promotionSidecarPath(toScope));
  if (sidecarIssues.length) {
    throw new KyroCoreError('STATE_DIVERGED', `Promotion target link is invalid at ${sidecarIssues[0].field}: ${sidecarIssues[0].message}.`, 'Retry the same promote command from the current revision.');
  }
  const link = sidecar as WorkPromotionSidecarRecord;
  const targetSprintPath = assertSafeManagedPath(`.agents/kyro/scopes/${toScope}/sprint.json`);
  if (!existsSync(targetSprintPath)) throw new KyroCoreError('STATE_DIVERGED', 'Promotion target scope is missing its sprint.json.', 'Retry the same promote command from the current revision.');
  const targetDigest = sha256Bytes(readFileSync(targetSprintPath));
  const originPath = assertSafeManagedPath(promotionOriginPath(toScope));
  if (!existsSync(originPath) || sha256Bytes(readFileSync(originPath)) !== journal.stagedTargetDigest) {
    throw new KyroCoreError('STATE_DIVERGED', 'Promotion origin snapshot is missing or altered.', 'Retry the matching promotion only after restoring its CLI-published origin.');
  }
  const agreements: Array<[string, string, string]> = [
    ['target digest', link.targetDigest, targetDigest],
    ['staged target digest', link.targetDigest, journal.stagedTargetDigest],
    ['source digest', link.sourceDigest, journal.oldWorkDigest],
    ['work source digest', promotion.sourceDigest, journal.oldWorkDigest],
    ['request digest', link.requestDigest, journal.requestDigest],
    ['source brief digest', link.sourceBriefDigest, journal.sourceBriefDigest],
  ];
  for (const [label, left, right] of agreements) {
    if (left !== right) throw new KyroCoreError('STATE_DIVERGED', `Promotion reciprocal verification failed on ${label}.`, 'Retry the same promote command; conflicting edits fail closed.');
  }
  if (link.sourceWorkId !== id || link.sourceRevision !== work.revision || link.targetScope !== toScope
    || link.promotedAt !== promotion.promotedAt || link.actor !== promotion.by
    || JSON.stringify(link.promotedTaskIds) !== JSON.stringify(promotion.promotedTaskIds)) {
    throw new KyroCoreError('STATE_DIVERGED', 'Promotion reciprocal verification failed on linked identities.', 'Retry the same promote command; conflicting edits fail closed.');
  }
}

interface WorkPromotionSidecarRecord {
  sourceWorkId: string;
  sourcePath: string;
  sourceRevision: number;
  sourceDigest: string;
  sourceBriefDigest: string;
  targetScope: string;
  targetPath: string;
  targetDigest: string;
  promotedTaskIds: string[];
  actor: string;
  preparedAt: string;
  promotedAt: string;
  requestDigest: string;
}

export interface AmendWorkBriefInput {
  briefBytes: Buffer;
  title: string;
  objective: string;
  reason: string;
  by: string;
}

interface PendingBriefAmendment {
  schemaVersion: 1;
  workId: string;
  expectedRevision: number;
  oldBriefDigest: string;
  newBriefDigest: string;
  oldWorkDigest: string;
  newWorkDigest: string;
  by: string;
  reason: string;
  preparedAt: string;
}

function readPendingAmendment(id: string): PendingBriefAmendment | null {
  const path = pendingPath(id);
  if (!pendingExists(id)) return null;
  if (!lstatSync(path).isFile()) throw new KyroCoreError('STATE_DIVERGED', `Work ${id} amendment record is not a regular file.`, 'Restore the CLI-owned transaction record before retrying.');
  let value: unknown;
  try { value = JSON.parse(readFileSync(path, 'utf8')); } catch { throw new KyroCoreError('STATE_DIVERGED', `Work ${id} amendment record is unreadable.`, 'Restore the CLI-owned transaction record before retrying.'); }
  const record = value as PendingBriefAmendment;
  const fields = ['schemaVersion','workId','expectedRevision','oldBriefDigest','newBriefDigest','oldWorkDigest','newWorkDigest','by','reason','preparedAt'];
  if (!record || typeof record !== 'object' || Array.isArray(record) || Object.keys(record).length !== fields.length || fields.some((field) => !(field in record)) ||
      record.schemaVersion !== 1 || record.workId !== id || !Number.isSafeInteger(record.expectedRevision) || record.expectedRevision < 1 ||
      ![record.oldBriefDigest,record.newBriefDigest,record.oldWorkDigest,record.newWorkDigest].every((digest) => typeof digest === 'string' && /^[a-f0-9]{64}$/.test(digest)) ||
      typeof record.by !== 'string' || !record.by.trim() || typeof record.reason !== 'string' || !record.reason.trim() ||
      typeof record.preparedAt !== 'string' || !Number.isFinite(Date.parse(record.preparedAt))) {
    throw new KyroCoreError('STATE_DIVERGED', `Work ${id} amendment record is invalid.`, 'Restore the CLI-owned transaction record before retrying.');
  }
  return record;
}

function clearPendingAmendment(id: string): void { const path = pendingPath(id); unlinkSync(path); fsyncParentDirectory(path); }

export interface AmendWorkBriefResult {
  work: WorkFile;
  previousDigest: string;
  briefDigest: string;
  invalidatedTaskIds: string[];
  recoveredBrief: boolean;
}

/**
 * Publish a brief amendment as one recoverable transaction: the new brief
 * bytes and the work.json update (new digest, invalidated approvals) are
 * applied under the writer lock with a durable intent record. A crash at any
 * boundary leaves either a blocked read or a completed publication whose
 * matching retry can remove the record. External edits never imply recovery.
 */
export function amendWorkBrief(
  id: string,
  expectedRevision: number,
  input: AmendWorkBriefInput,
  dryRun = false,
): AmendWorkBriefResult {
  return withStateWriterLock(() => {
    assertNoPendingPromotion(id);
    const pending = readPendingAmendment(id);
    const workPath = workJsonPath(id);
    const workBytes = readFileSync(assertSafeManagedPath(workPath));
    const current = readWork(id);
    const newDigest = byteDigest(input.briefBytes);
    if (pending && (pending.expectedRevision !== expectedRevision || pending.newBriefDigest !== newDigest || pending.by !== input.by || pending.reason !== input.reason))
      throw new KyroCoreError('STATE_DIVERGED', `Work ${id} pending amendment does not match this retry.`, 'Retry with the original source, actor, reason, and expected revision.');
    if (!pending && current.revision !== expectedRevision) throw new KyroCoreError('STATE_DIVERGED', `Work ${id} revision ${current.revision} does not match expected ${expectedRevision}.`, 'Read Work status and retry from the current revision.');
    if (current.state !== 'draft' && current.state !== 'active') throw new KyroCoreError('INVALID_INPUT', `Work ${id} is ${current.state} and its brief cannot be amended.`, 'Only draft or active Work accepts a brief amendment.');
    if (!pending && newDigest === current.brief.digest) throw new KyroCoreError('INVALID_INPUT', 'The amendment source matches the current brief digest; no brief change was provided.', 'Provide a changed brief or keep the current contract.');
    const briefPath = workBriefPath(id);
    const absolute = assertSafeManagedPath(briefPath);
    if (!existsSync(absolute)) throw new KyroCoreError('INVALID_INPUT', `Work ${id} brief is missing.`, 'Restore the CLI-owned brief before continuing.');
    const observedBriefDigest = byteDigest(readFileSync(absolute));
    const observedWorkDigest = byteDigest(workBytes);
    if (!pending && observedBriefDigest !== current.brief.digest)
      throw new KyroCoreError('STATE_DIVERGED', `Work ${id} brief digest does not match work.json.`, 'Restore the known CLI-owned brief; out-of-band changes are not recoverable amendments.');
    if (pending && (observedBriefDigest !== pending.oldBriefDigest && observedBriefDigest !== pending.newBriefDigest ||
      observedWorkDigest !== pending.oldWorkDigest && observedWorkDigest !== pending.newWorkDigest ||
      observedWorkDigest === pending.oldWorkDigest && current.revision !== expectedRevision ||
      observedWorkDigest === pending.newWorkDigest && current.revision !== expectedRevision + 1 ||
      observedBriefDigest === pending.oldBriefDigest && observedWorkDigest === pending.newWorkDigest))
      throw new KyroCoreError('STATE_DIVERGED', `Work ${id} amendment files do not match a recoverable publication boundary.`, 'Restore the CLI-owned files before retrying; do not accept an external edit.');
    const recoveredBrief = Boolean(pending && observedBriefDigest === pending.newBriefDigest);
    const now = pending?.preparedAt ?? new Date().toISOString();
    if (pending && observedWorkDigest === pending.newWorkDigest) {
      if (current.brief.digest !== pending.newBriefDigest) throw new KyroCoreError('STATE_DIVERGED', `Work ${id} completed amendment has an inconsistent brief digest.`, 'Restore the CLI-owned files.');
      if (dryRun) return { work: current, previousDigest: pending.oldBriefDigest, briefDigest: newDigest, invalidatedTaskIds: [], recoveredBrief: true };
      clearPendingAmendment(id);
      return { work: current, previousDigest: pending.oldBriefDigest, briefDigest: newDigest, invalidatedTaskIds: [], recoveredBrief: true };
    }
    if (pending && (current.brief.digest !== pending.oldBriefDigest || pending.oldWorkDigest !== observedWorkDigest))
      throw new KyroCoreError('STATE_DIVERGED', `Work ${id} amendment record disagrees with current Work.`, 'Restore the CLI-owned files.');
    const invalidatedTaskIds = current.tasks
      .filter((task) => task.evidence !== null || task.verdict !== null || task.status === 'awaiting_review' || task.status === 'verified')
      .map((task) => task.id);
    const tasks = current.tasks.map((task) => demoteTaskForInvalidation(task));
    const next: WorkFile = {
      ...current,
      title: input.title,
      objective: input.objective,
      brief: { ...current.brief, digest: newDigest },
      revision: current.revision + 1,
      updatedAt: now,
      tasks,
      activity: [...current.activity, { seq: current.activity.length + 1, at: now, event: 'brief_amended', taskId: null, by: input.by, reason: input.reason, revision: current.revision + 1 }],
      handoff: { ...current.handoff },
    };
    next.handoff = deriveWorkHandoff(next);
    const issues = validateWorkFile(next, workJsonPath(id));
    if (issues.length) throw new KyroCoreError('INVALID_INPUT', `Refusing invalid Work at ${issues[0].field}: ${issues[0].message}.`, 'Correct the brief input and retry.');
    if (dryRun) return { work: next, previousDigest: current.brief.digest, briefDigest: newDigest, invalidatedTaskIds, recoveredBrief };
    const nextJson = `${JSON.stringify(next, null, 2)}\n`;
    if (pending && byteDigest(nextJson) !== pending.newWorkDigest) throw new KyroCoreError('STATE_DIVERGED', `Work ${id} pending amendment no longer produces its declared Work digest.`, 'Restore the CLI-owned transaction before retrying.');
    if (!pending) {
      const record: PendingBriefAmendment = { schemaVersion: 1, workId: id, expectedRevision, oldBriefDigest: current.brief.digest, newBriefDigest: newDigest, oldWorkDigest: observedWorkDigest, newWorkDigest: byteDigest(nextJson), by: input.by, reason: input.reason, preparedAt: now };
      atomicReplace(workPendingAmendmentPath(id), `${JSON.stringify(record, null, 2)}\n`);
    }
    throwInjectedAmendFailure('amend-brief-after-journal');
    throwInjectedAmendFailure('amend-brief-before-write');
    if (!recoveredBrief) atomicReplace(briefPath, input.briefBytes.toString('utf8'));
    throwInjectedAmendFailure('amend-brief-after-brief');
    atomicReplace(workPath, nextJson);
    throwInjectedAmendFailure('amend-brief-after-work');
    clearPendingAmendment(id);
    return { work: next, previousDigest: current.brief.digest, briefDigest: newDigest, invalidatedTaskIds, recoveredBrief };
  });
}

function throwInjectedAmendFailure(boundary: string): void {
  if (process.env.KYRO_WORK_INJECT_FAILURE === boundary) throw new KyroCoreError('INTERNAL', `Injected Work publication failure at ${boundary}.`, 'Retry the same amend-brief command from the current revision.');
}
