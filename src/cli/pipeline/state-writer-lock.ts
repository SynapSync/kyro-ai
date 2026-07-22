import {
  closeSync,
  existsSync,
  fsyncSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { constants as fsConstants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { WORKSPACE_ROOT } from '../constants';
import { KyroCoreError } from '../core/errors';

const STATE_WRITER_LOCK = '.kyro-state-writer.lock';
const OWNER_FILE = 'owner.json';
const HEARTBEAT_FILE = 'heartbeat.json';
const RECLAIM_PREFIX = `${STATE_WRITER_LOCK}.reclaim-`;
const LOCK_WAIT_MS = 10_000;
const LOCK_POLL_MS = 25;
const DEFAULT_LEASE_MS = 5_000;
const PARTIAL_LOCK_GRACE_MS = 2_000;
/** Reclaim claims must outlive publish→select under slow fsync/CI; test heartbeats may be ≤200ms. */
const MIN_RECLAIM_CLAIM_MS = 2_000;
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const PORTABLE_DIRECTORY_SYNC_ERRORS = new Set(['EINVAL', 'ENOTSUP', 'EISDIR', 'EBADF']);

interface LockOwner { pid: number; token: string; createdAt: number }
interface LockHeartbeat { token: string; renewedAt: number; leaseUntil: number }
interface ReclaimClaim { token: string; targetDev: string; targetIno: string; createdAt: number; leaseUntil: number }
interface LockIdentity { dev: number | bigint; ino: number | bigint }
interface LeaseKeeper { worker: Worker; state: Int32Array }
interface LocalLease { lockPath: string; identity: LockIdentity; ownerRaw: string; keeper: LeaseKeeper }

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const CLAIM_NAME = new RegExp(`^${RECLAIM_PREFIX}(${UUID})$`, 'i');
const HEARTBEAT_TEMP_NAME = new RegExp(`^${HEARTBEAT_FILE}\\.tmp-(?:\\d+-)?${UUID}$`, 'i');

export function assertSafePathSegment(value: string, label: string): void {
  if (!SAFE_SEGMENT.test(value) || value === '.' || value === '..') {
    throw new KyroCoreError('INVALID_INPUT', `${label} contains an unsafe path segment: ${value}.`, 'Use letters, numbers, dots, underscores, or hyphens without path separators.');
  }
}

/** Reject workspace escapes and every existing symlink in the managed path ancestry. */
export function assertSafeManagedPath(path: string): string {
  const workspace = resolve(WORKSPACE_ROOT);
  const target = resolve(workspace, path);
  const rel = relative(workspace, target);
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new KyroCoreError('INVALID_INPUT', `Managed path escapes the workspace: ${path}.`, 'Use a path below the current workspace.');
  }
  const realWorkspace = realpathSync(workspace);
  let existingAncestor = target;
  while (!existsSync(existingAncestor)) existingAncestor = dirname(existingAncestor);
  const realAncestor = realpathSync(existingAncestor);
  const realRel = relative(realWorkspace, realAncestor);
  if (realRel === '..' || realRel.startsWith(`..${sep}`) || isAbsolute(realRel)) {
    throw new KyroCoreError('INVALID_INPUT', `Managed path resolves outside the workspace: ${path}.`, 'Use real directories below the current workspace.');
  }
  let current = workspace;
  for (const part of rel.split(sep)) {
    current = resolve(current, part);
    if (!existsSync(current)) continue;
    if (lstatSync(current).isSymbolicLink()) {
      throw new KyroCoreError('INVALID_INPUT', `Managed path traverses a symbolic link: ${current}.`, 'Replace the symlink with a real workspace directory before mutating Kyro state.');
    }
  }
  return target;
}

export function fsyncParentDirectory(target: string): void { fsyncDirectory(dirname(target)); }

export function fsyncDirectory(directory: string): void {
  let fd: number | null = null;
  try {
    fd = openSync(directory, 'r');
    fsyncSync(fd);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!code || !PORTABLE_DIRECTORY_SYNC_ERRORS.has(code)) throw error;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

export function ensureDurableDirectory(directory: string): void {
  const missing: string[] = [];
  let current = directory;
  while (!existsSync(current)) {
    missing.push(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  mkdirSync(directory, { recursive: true });
  for (const created of missing.reverse()) {
    fsyncDirectory(created);
    fsyncParentDirectory(created);
  }
}

export function withStateWriterLock<T>(work: () => T): T {
  const release = acquireStateWriterLock();
  let primary: unknown = null;
  try { assertStateWriterLeaseHealthy(); const result = work(); assertStateWriterLeaseHealthy(); return result; }
  catch (error) { primary = error; throw error; }
  finally {
    try { release(); }
    catch (releaseError) {
      if (primary) throw new AggregateError([primary, releaseError], 'State writer failed and lock cleanup also failed');
      throw releaseError;
    }
  }
}

export async function withStateWriterLockAsync<T>(work: () => Promise<T> | T): Promise<T> {
  const release = acquireStateWriterLock();
  let primary: unknown = null;
  try { assertStateWriterLeaseHealthy(); const result = await work(); assertStateWriterLeaseHealthy(); return result; }
  catch (error) { primary = error; throw error; }
  finally {
    try { release(); }
    catch (releaseError) {
      if (primary) throw new AggregateError([primary, releaseError], 'State writer failed and lock cleanup also failed');
      throw releaseError;
    }
  }
}

let localLockDepth = 0;
let localRelease: (() => void) | null = null;
let localLease: LocalLease | null = null;

/** Fence every protected mutation if the renewable token lease is no longer ours. */
export function assertStateWriterLeaseHealthy(): void {
  const lease = localLease;
  if (!lease || localLockDepth <= 0) throw leaseLost('No state-writer lease is held by this process.');
  if (Atomics.load(lease.keeper.state, 5) !== 0) throw leaseLost('Heartbeat worker is exiting unexpectedly.');
  if (lease.keeper.worker.threadId === -1 && Atomics.load(lease.keeper.state, 4) === 0) throw leaseLost('Heartbeat worker terminated unexpectedly.');
  if (Atomics.load(lease.keeper.state, 3) !== 0) throw leaseLost('Heartbeat renewal failed.');
  let current: LockIdentity;
  try { current = lockIdentity(lease.lockPath); }
  catch { throw leaseLost('Lock directory is missing or was replaced.'); }
  const ownerRaw = readRegularFileNoFollow(`${lease.lockPath}/${OWNER_FILE}`);
  const heartbeat = parseHeartbeat(readRegularFileNoFollow(`${lease.lockPath}/${HEARTBEAT_FILE}`));
  const owner = parseOwner(lease.ownerRaw);
  if (!sameIdentity(current, lease.identity) || ownerRaw !== lease.ownerRaw || !owner || !heartbeat || heartbeat.token !== owner.token || heartbeat.leaseUntil <= Date.now()) {
    throw leaseLost('Token, inode, or heartbeat lease no longer matches the writer.');
  }
}

/** Trace/read-only helpers can fence when called inside a mutation without requiring a lease otherwise. */
export function assertStateWriterLeaseHealthyIfHeld(): void {
  if (localLockDepth > 0 || localLease) assertStateWriterLeaseHealthy();
}

function acquireStateWriterLock(): () => void {
  if (localLockDepth > 0) {
    assertStateWriterLeaseHealthy();
    localLockDepth += 1;
    return releaseLocalLock;
  }
  const lockPath = assertSafeManagedPath(STATE_WRITER_LOCK);
  ensureDurableDirectory(dirname(lockPath));
  const deadline = Date.now() + LOCK_WAIT_MS;
  const leaseMs = configuredLeaseMs();
  let identity: LockIdentity;
  let ownerRaw: string;
  let keeper: LeaseKeeper;
  while (true) {
    const token = randomUUID();
    try {
      mkdirSync(lockPath);
      identity = lockIdentity(lockPath);
      try {
        if (process.env.KYRO_TEST_LOCK_INIT_FAIL === '1') throw new Error('Injected state-writer lock initialization failure.');
        ownerRaw = `${JSON.stringify({ pid: process.pid, token, createdAt: Date.now() })}\n`;
        writeSyncedExclusive(`${lockPath}/${OWNER_FILE}`, ownerRaw);
        writeHeartbeat(lockPath, token, leaseMs);
        fsyncDirectory(lockPath);
        fsyncParentDirectory(lockPath);
        keeper = startLeaseKeeper(lockPath, identity, ownerRaw, token, leaseMs);
      } catch (error) {
        cleanupJustCreatedLock(lockPath, identity);
        throw error;
      }
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      signalTestLockWaiting();
      tryReclaimStaleLock(lockPath, leaseMs);
      if (Date.now() >= deadline) {
        throw new KyroCoreError('CHECKPOINT_CONFLICT', 'Timed out waiting for the Kyro state-writer lock.', 'Wait for the active lease to finish. Kyro reclaims only expired, token-verified ownership.');
      }
      sleep(LOCK_POLL_MS);
    }
  }

  localLockDepth = 1;
  localLease = { lockPath, identity, ownerRaw, keeper };
  localRelease = () => releaseOwnedLock(lockPath, identity, ownerRaw, keeper);
  signalTestLockAcquired();
  waitForTestReleaseGate();
  assertStateWriterLeaseHealthy();
  return releaseLocalLock;
}

function releaseLocalLock(): void {
  if (localLockDepth <= 0) return;
  localLockDepth -= 1;
  if (localLockDepth > 0) return;
  const release = localRelease;
  localRelease = null;
  try { release?.(); }
  finally { localLease = null; }
}

function tryReclaimStaleLock(lockPath: string, leaseMs: number): void {
  let observedIdentity: LockIdentity;
  let observedOwner: string | null;
  let observedHeartbeat: string | null;
  let lockAge: number;
  try {
    const stat = lstatSync(lockPath);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return;
    observedIdentity = { dev: stat.dev, ino: stat.ino };
    lockAge = Date.now() - stat.mtimeMs;
    observedOwner = readRegularFileNoFollow(`${lockPath}/${OWNER_FILE}`);
    observedHeartbeat = readRegularFileNoFollow(`${lockPath}/${HEARTBEAT_FILE}`);
  } catch { return; }
  const owner = parseOwner(observedOwner);
  const heartbeat = parseHeartbeat(observedHeartbeat);
  if (isLiveLease(owner, heartbeat)) return;
  if ((!owner || !heartbeat) && lockAge < Math.min(PARTIAL_LOCK_GRACE_MS, leaseMs)) return;

  cleanupExpiredClaims(dirname(lockPath), observedIdentity);
  const claim = publishReclaimClaim(dirname(lockPath), observedIdentity, leaseMs);
  if (!claim) return;
  try {
    if (process.env.KYRO_TEST_LOCK_CRASH_AFTER_RECLAIM_CLAIM === '1') process.exit(86);
    const winner = selectReclaimWinner(dirname(lockPath), observedIdentity);
    if (!winner || winner.token !== claim.metadata.token) return;
    if (!sameIdentity(lockIdentity(lockPath), observedIdentity)) return;
    if (readRegularFileNoFollow(`${lockPath}/${OWNER_FILE}`) !== observedOwner || readRegularFileNoFollow(`${lockPath}/${HEARTBEAT_FILE}`) !== observedHeartbeat) return;
    if (isLiveLease(parseOwner(observedOwner), parseHeartbeat(observedHeartbeat))) return;

    if (observedHeartbeat !== null) unlinkSync(`${lockPath}/${HEARTBEAT_FILE}`);
    else unlinkSymlinkEntry(`${lockPath}/${HEARTBEAT_FILE}`);
    if (observedOwner !== null) unlinkSync(`${lockPath}/${OWNER_FILE}`);
    else unlinkSymlinkEntry(`${lockPath}/${OWNER_FILE}`);
    removeHeartbeatTemporaries(lockPath);
    fsyncDirectory(lockPath);
    rmdirSync(lockPath);
    fsyncParentDirectory(lockPath);
  } catch { /* State changed or another claimant won; never remove unverified ownership. */ }
  finally {
    cleanupOwnedClaim(claim.path, claim.identity, claim.raw);
    // A claim may expire between the pre-publication sweep and winner selection. Sweep again so
    // a crashed former winner cannot remain as harmless-but-permanent metadata debris.
    cleanupExpiredClaims(dirname(lockPath), observedIdentity);
  }
}

function publishReclaimClaim(parent: string, target: LockIdentity, leaseMs: number): { path: string; identity: LockIdentity; raw: string; metadata: ReclaimClaim } | null {
  const token = randomUUID();
  const path = `${parent}/${RECLAIM_PREFIX}${token}`;
  try {
    mkdirSync(path);
    const identity = lockIdentity(path);
    // Claim TTL is independent of short test heartbeats: fsync + winner selection must finish
    // while the claim is still selectable (see selectReclaimWinner leaseUntil check).
    const claimTtlMs = Math.max(leaseMs, MIN_RECLAIM_CLAIM_MS);
    const createdAt = Date.now();
    const metadata: ReclaimClaim = {
      token,
      targetDev: String(target.dev),
      targetIno: String(target.ino),
      createdAt,
      leaseUntil: createdAt + claimTtlMs,
    };
    const raw = `${JSON.stringify(metadata)}\n`;
    writeSyncedExclusive(`${path}/${OWNER_FILE}`, raw);
    fsyncDirectory(path);
    fsyncDirectory(parent);
    return { path, identity, raw, metadata };
  } catch {
    try { rmdirSync(path); fsyncDirectory(parent); } catch { /* partial unique claim is recoverable */ }
    return null;
  }
}

function selectReclaimWinner(parent: string, target: LockIdentity): ReclaimClaim | null {
  const now = Date.now();
  const candidates = listClaimPaths(parent).flatMap((path) => {
    const parsed = parseClaimForPath(path, readRegularFileNoFollow(`${path}/${OWNER_FILE}`));
    return parsed && parsed.leaseUntil > now && parsed.targetDev === String(target.dev) && parsed.targetIno === String(target.ino) ? [parsed] : [];
  });
  candidates.sort((left, right) => left.createdAt - right.createdAt || left.token.localeCompare(right.token));
  return candidates[0] ?? null;
}

function cleanupExpiredClaims(parent: string, target: LockIdentity): void {
  const now = Date.now();
  for (const path of listClaimPaths(parent)) {
    let identity: LockIdentity;
    let age: number;
    try { const stat = lstatSync(path); if (!stat.isDirectory() || stat.isSymbolicLink()) continue; identity = { dev: stat.dev, ino: stat.ino }; age = now - stat.mtimeMs; }
    catch { continue; }
    const raw = readRegularFileNoFollow(`${path}/${OWNER_FILE}`);
    const claim = parseClaimForPath(path, raw);
    const expired = claim ? claim.leaseUntil <= now || claim.targetDev !== String(target.dev) || claim.targetIno !== String(target.ino) : age >= PARTIAL_LOCK_GRACE_MS;
    if (expired) cleanupOwnedClaim(path, identity, raw);
  }
}

function cleanupOwnedClaim(path: string, identity: LockIdentity, ownerRaw: string | null): void {
  try {
    if (!sameIdentity(lockIdentity(path), identity) || readRegularFileNoFollow(`${path}/${OWNER_FILE}`) !== ownerRaw) return;
    if (ownerRaw !== null) unlinkSync(`${path}/${OWNER_FILE}`);
    else unlinkSymlinkEntry(`${path}/${OWNER_FILE}`);
    fsyncDirectory(path);
    rmdirSync(path);
    fsyncParentDirectory(path);
  } catch { /* A unique claim that changed ownership is never deleted. */ }
}

function releaseOwnedLock(lockPath: string, identity: LockIdentity, ownerRaw: string, keeper: LeaseKeeper): void {
  stopLeaseKeeper(keeper);
  let currentIdentity: LockIdentity;
  try { currentIdentity = lockIdentity(lockPath); }
  catch { throw leaseLost('Lock directory is missing at release.'); }
  const owner = parseOwner(ownerRaw);
  const heartbeatRaw = readRegularFileNoFollow(`${lockPath}/${HEARTBEAT_FILE}`);
  const heartbeat = parseHeartbeat(heartbeatRaw);
  if (!sameIdentity(currentIdentity, identity) || readOwnerRaw(lockPath) !== ownerRaw || !owner || !heartbeat || heartbeat.token !== owner.token) {
    throw new KyroCoreError('CHECKPOINT_CONFLICT', 'State-writer lease ownership changed before release.', 'Do not remove the lock; let its verified token owner release it or wait for lease expiry.');
  }
  unlinkSync(`${lockPath}/${HEARTBEAT_FILE}`);
  unlinkSync(`${lockPath}/${OWNER_FILE}`);
  fsyncDirectory(lockPath);
  rmdirSync(lockPath);
  fsyncParentDirectory(lockPath);
}

function cleanupJustCreatedLock(lockPath: string, identity: LockIdentity): void {
  try {
    if (!sameIdentity(lockIdentity(lockPath), identity)) return;
    for (const name of [HEARTBEAT_FILE, OWNER_FILE]) {
      try { unlinkSync(`${lockPath}/${name}`); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    removeHeartbeatTemporaries(lockPath);
    fsyncDirectory(lockPath);
    rmdirSync(lockPath);
    fsyncParentDirectory(lockPath);
  } catch { /* Preserve primary initialization failure; the partial lease remains recoverable. */ }
}

function writeHeartbeat(lockPath: string, token: string, leaseMs: number): void {
  const now = Date.now();
  atomicWriteHeartbeat(`${lockPath}/${HEARTBEAT_FILE}`, `${JSON.stringify({ token, renewedAt: now, leaseUntil: now + leaseMs })}\n`);
}

function atomicWriteHeartbeat(path: string, content: string): void {
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  let failure: unknown = null;
  try {
    const flags = fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | (fsConstants.O_NOFOLLOW ?? 0);
    const fd = openSync(temporary, flags, 0o600);
    try { writeFileSync(fd, content, 'utf8'); fsyncSync(fd); }
    finally { closeSync(fd); }
    renameSync(temporary, path);
    fsyncParentDirectory(path);
  } catch (error) { failure = error; }
  try { unlinkSync(temporary); fsyncParentDirectory(temporary); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      if (failure) throw new AggregateError([failure, error], 'Heartbeat publication and cleanup failed');
      throw error;
    }
  }
  if (failure) throw failure;
}

function startLeaseKeeper(lockPath: string, identity: LockIdentity, ownerRaw: string, token: string, leaseMs: number): LeaseKeeper {
  const state = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 6));
  const heartbeatPath = `${lockPath}/${HEARTBEAT_FILE}`;
  const source = `
    const { workerData } = require('node:worker_threads');
    const fs = require('node:fs');
    const crypto = require('node:crypto');
    const pathApi = require('node:path');
    const state = new Int32Array(workerData.state);
    const failStop = () => {
      Atomics.store(state, 3, 1); Atomics.notify(state, 3);
      try { process.kill(workerData.ownerPid, 'SIGKILL'); } catch { process.abort(); }
    };
    process.on('uncaughtException', failStop);
    process.on('unhandledRejection', failStop);
    const syncDir = (directory) => { let fd; try { fd = fs.openSync(directory, 'r'); fs.fsyncSync(fd); } catch (error) { if (!['EINVAL','ENOTSUP','EISDIR','EBADF'].includes(error.code)) throw error; } finally { if (fd !== undefined) fs.closeSync(fd); } };
    const verifyDirectory = () => {
      const stat = fs.lstatSync(workerData.lockPath, { bigint: true });
      if (!stat.isDirectory() || stat.isSymbolicLink() || String(stat.dev) !== workerData.dev || String(stat.ino) !== workerData.ino) throw new Error('Lease directory ownership changed');
    };
    const readNoFollow = (path) => {
      const before = fs.lstatSync(path, { bigint: true });
      if (!before.isFile() || before.isSymbolicLink()) throw new Error('Lease metadata is not a regular file');
      const fd = fs.openSync(path, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
      try {
        const opened = fs.fstatSync(fd, { bigint: true });
        if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) throw new Error('Lease metadata changed while opening');
        return fs.readFileSync(fd, 'utf8');
      } finally { fs.closeSync(fd); }
    };
    const verifyOwnership = () => {
      verifyDirectory();
      if (readNoFollow(workerData.ownerPath) !== workerData.ownerRaw) throw new Error('Lease owner record changed');
      const owner = JSON.parse(workerData.ownerRaw);
      if (owner.token !== workerData.token) throw new Error('Lease owner token changed');
      const heartbeat = JSON.parse(readNoFollow(workerData.path));
      if (heartbeat.token !== workerData.token || heartbeat.leaseUntil <= Date.now()) throw new Error('Lease heartbeat expired or changed');
    };
    const renew = () => {
      verifyOwnership();
      const now = Date.now();
      const content = JSON.stringify({ token: workerData.token, renewedAt: now, leaseUntil: now + workerData.leaseMs }) + '\\n';
      const renewalCount = Atomics.load(state, 1);
      const tempToken = workerData.testTempToken && renewalCount >= 1 ? workerData.testTempToken : crypto.randomUUID();
      const temporary = workerData.path + '.tmp-' + tempToken;
      const flags = fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | (fs.constants.O_NOFOLLOW || 0);
      const fd = fs.openSync(temporary, flags, 0o600);
      let tempIdentity;
      try {
        tempIdentity = fs.fstatSync(fd, { bigint: true });
        if (!tempIdentity.isFile()) throw new Error('Heartbeat temporary is not a regular file');
        fs.writeFileSync(fd, content, 'utf8'); fs.fsyncSync(fd);
      } finally { fs.closeSync(fd); }
      verifyOwnership();
      const visibleTemp = fs.lstatSync(temporary, { bigint: true });
      if (!visibleTemp.isFile() || visibleTemp.isSymbolicLink() || visibleTemp.dev !== tempIdentity.dev || visibleTemp.ino !== tempIdentity.ino) throw new Error('Heartbeat temporary ownership changed');
      // Re-verify immediately before the atomic publish; never write into a successor lock.
      verifyOwnership();
      fs.renameSync(temporary, workerData.path);
      syncDir(pathApi.dirname(workerData.path));
    };
    while (Atomics.load(state, 0) === 0) {
      if (workerData.pauseFile && Atomics.load(state, 1) >= 1) {
        while (Atomics.load(state, 0) === 0 && !fs.existsSync(workerData.pauseFile)) Atomics.wait(state, 0, 0, 25);
        if (Atomics.load(state, 0) !== 0) break;
      }
      try {
        if (workerData.failAfter !== null && Atomics.load(state, 1) >= workerData.failAfter) throw new Error('Injected heartbeat renewal failure');
        renew(); Atomics.add(state, 1, 1); Atomics.notify(state, 1);
      }
      catch {
        // Record failure first, then fail-stop the owning process. The main thread may be blocked
        // and must never resume protected work after another writer can reclaim the expired lease.
        failStop();
        break;
      }
      if (workerData.unexpectedAfter !== null && Atomics.load(state, 1) >= workerData.unexpectedAfter) throw new Error('Injected unexpected heartbeat worker termination');
      if (workerData.rawExitAfter !== null && Atomics.load(state, 1) >= workerData.rawExitAfter) {
        Atomics.store(state, 5, 1); Atomics.notify(state, 5);
        if (workerData.rawExitReadyFile) fs.writeFileSync(workerData.rawExitReadyFile, 'ready\\n', 'utf8');
        process.exit(71);
      }
      Atomics.wait(state, 0, 0, workerData.intervalMs);
    }
    Atomics.store(state, 2, 1); Atomics.notify(state, 2);
  `;
  const failAfter = Number.parseInt(process.env.KYRO_TEST_LOCK_HEARTBEAT_FAIL_AFTER ?? '', 10);
  const unexpectedAfter = Number.parseInt(process.env.KYRO_TEST_LOCK_HEARTBEAT_UNEXPECTED_AFTER ?? '', 10);
  const rawExitAfter = Number.parseInt(process.env.KYRO_TEST_LOCK_HEARTBEAT_RAW_EXIT_AFTER ?? '', 10);
  const worker = new Worker(source, { eval: true, workerData: {
    state: state.buffer,
    path: heartbeatPath,
    lockPath,
    ownerPath: `${lockPath}/${OWNER_FILE}`,
    ownerRaw,
    dev: String(identity.dev),
    ino: String(identity.ino),
    token,
    leaseMs,
    intervalMs: Math.max(25, Math.floor(leaseMs / 3)),
    ownerPid: process.pid,
    failAfter: Number.isFinite(failAfter) && failAfter >= 1 ? failAfter : null,
    unexpectedAfter: Number.isFinite(unexpectedAfter) && unexpectedAfter >= 1 ? unexpectedAfter : null,
    rawExitAfter: Number.isFinite(rawExitAfter) && rawExitAfter >= 1 ? rawExitAfter : null,
    rawExitReadyFile: process.env.KYRO_TEST_LOCK_HEARTBEAT_RAW_EXIT_READY_FILE ?? null,
    pauseFile: process.env.KYRO_TEST_LOCK_HEARTBEAT_PAUSE_FILE ?? null,
    testTempToken: process.env.KYRO_TEST_LOCK_HEARTBEAT_TEMP_TOKEN ?? null,
  } });
  const fenceParent = (): void => {
    if (Atomics.load(state, 4) !== 0) return;
    Atomics.store(state, 3, 1);
    try { process.kill(process.pid, 'SIGKILL'); } catch { process.abort(); }
  };
  worker.on('error', fenceParent);
  worker.on('exit', () => fenceParent());
  worker.unref();
  const deadline = Date.now() + Math.min(2_000, leaseMs);
  while (Atomics.load(state, 1) === 0 && Atomics.load(state, 3) === 0 && Date.now() < deadline) Atomics.wait(state, 1, 0, LOCK_POLL_MS);
  if (Atomics.load(state, 3) !== 0 || Atomics.load(state, 1) === 0) {
    Atomics.store(state, 4, 1);
    Atomics.store(state, 0, 1); Atomics.notify(state, 0);
    const stopDeadline = Date.now() + 500;
    while (Atomics.load(state, 2) === 0 && Date.now() < stopDeadline) Atomics.wait(state, 2, 0, LOCK_POLL_MS);
    void worker.terminate();
    throw new Error('State-writer lease heartbeat failed to start.');
  }
  return { worker, state };
}

function removeHeartbeatTemporaries(lockPath: string): void {
  let removed = false;
  for (const name of readdirSync(lockPath).filter((entry) => HEARTBEAT_TEMP_NAME.test(entry))) {
    const path = `${lockPath}/${name}`;
    let stat;
    try { stat = lstatSync(path); } catch { continue; }
    if (stat.isSymbolicLink()) {
      try { unlinkSync(path); removed = true; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      continue;
    }
    if (!stat.isFile()) continue;
    try { unlinkSync(path); removed = true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  if (removed) fsyncDirectory(lockPath);
}

function stopLeaseKeeper(keeper: LeaseKeeper): void {
  Atomics.store(keeper.state, 4, 1);
  Atomics.store(keeper.state, 0, 1);
  Atomics.notify(keeper.state, 0);
  const deadline = Date.now() + 2_000;
  while (Atomics.load(keeper.state, 2) === 0 && Date.now() < deadline) Atomics.wait(keeper.state, 2, 0, LOCK_POLL_MS);
  if (Atomics.load(keeper.state, 2) === 0) throw new Error('State-writer lease heartbeat did not stop safely.');
  void keeper.worker.terminate();
}

/** Unlink only the directory entry itself after lstat proves it is a symlink; never read/follow it. */
function unlinkSymlinkEntry(path: string): void {
  try { if (lstatSync(path).isSymbolicLink()) unlinkSync(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}

function lockIdentity(path: string): LockIdentity {
  const stat = lstatSync(path, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Lock path is not a real directory: ${path}`);
  return { dev: stat.dev, ino: stat.ino };
}

function sameIdentity(left: LockIdentity, right: LockIdentity): boolean {
  return String(left.dev) === String(right.dev) && String(left.ino) === String(right.ino);
}

function listClaimPaths(parent: string): string[] {
  try {
    return readdirSync(parent).filter((name) => CLAIM_NAME.test(name)).flatMap((name) => {
      const path = `${parent}/${name}`;
      try { const stat = lstatSync(path); return stat.isDirectory() && !stat.isSymbolicLink() ? [path] : []; }
      catch { return []; }
    });
  }
  catch { return []; }
}

function readRegularFileNoFollow(path: string): string | null {
  let fd: number | null = null;
  try {
    const before = lstatSync(path, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink()) return null;
    fd = openSync(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(fd, { bigint: true });
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) return null;
    return readFileSync(fd, 'utf8');
  } catch { return null; }
  finally { if (fd !== null) closeSync(fd); }
}

function readOwnerRaw(lockPath: string): string | null { return readRegularFileNoFollow(`${lockPath}/${OWNER_FILE}`); }

function parseOwner(raw: string | null): LockOwner | null {
  const value = parseRecord(raw);
  return value && Number.isInteger(value.pid) && Number(value.pid) > 0 && typeof value.token === 'string' && value.token.length > 0 && typeof value.createdAt === 'number'
    ? value as unknown as LockOwner : null;
}

function parseHeartbeat(raw: string | null): LockHeartbeat | null {
  const value = parseRecord(raw);
  return value && typeof value.token === 'string' && typeof value.renewedAt === 'number' && typeof value.leaseUntil === 'number'
    ? value as unknown as LockHeartbeat : null;
}

function parseClaim(raw: string | null): ReclaimClaim | null {
  const value = parseRecord(raw);
  return value && typeof value.token === 'string' && typeof value.targetDev === 'string' && typeof value.targetIno === 'string'
    && typeof value.createdAt === 'number' && typeof value.leaseUntil === 'number' ? value as unknown as ReclaimClaim : null;
}

function parseClaimForPath(path: string, raw: string | null): ReclaimClaim | null {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const token = CLAIM_NAME.exec(name)?.[1];
  const claim = parseClaim(raw);
  return token && claim?.token.toLowerCase() === token.toLowerCase() ? claim : null;
}

function parseRecord(raw: string | null): Record<string, unknown> | null {
  if (raw === null) return null;
  try { const value = JSON.parse(raw); return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null; }
  catch { return null; }
}

function isLiveLease(owner: LockOwner | null, heartbeat: LockHeartbeat | null): boolean {
  return owner !== null && heartbeat !== null && owner.token === heartbeat.token && heartbeat.leaseUntil > Date.now();
}

function leaseLost(detail: string): KyroCoreError {
  return new KyroCoreError('CHECKPOINT_CONFLICT', `State-writer lease lost: ${detail}`, 'Stop immediately. Retry only after the active lease is released or safely expires.');
}

function configuredLeaseMs(): number {
  const configured = Number.parseInt(process.env.KYRO_TEST_LOCK_LEASE_MS ?? '', 10);
  return Number.isFinite(configured) && configured >= 100 ? configured : DEFAULT_LEASE_MS;
}

function writeSyncedExclusive(path: string, content: string): void {
  const flags = fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | (fsConstants.O_NOFOLLOW ?? 0);
  const fd = openSync(path, flags, 0o600);
  try { writeFileSync(fd, content, 'utf8'); fsyncSync(fd); }
  finally { closeSync(fd); }
}

function signalTestLockAcquired(): void {
  const path = process.env.KYRO_TEST_LOCK_READY_FILE;
  if (path) writeFileSync(path, `${process.pid}\n`, 'utf8');
}

function signalTestLockWaiting(): void {
  const path = process.env.KYRO_TEST_LOCK_WAITING_FILE;
  if (path && !existsSync(path)) writeFileSync(path, `${process.pid}\n`, 'utf8');
}

function waitForTestReleaseGate(): void {
  const path = process.env.KYRO_TEST_LOCK_RELEASE_GATE;
  while (path && !existsSync(path)) sleep(LOCK_POLL_MS);
}

function sleep(milliseconds: number): void {
  const signal = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(signal, 0, 0, milliseconds);
}
