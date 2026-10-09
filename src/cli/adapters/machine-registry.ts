import { closeSync, existsSync, fstatSync, fsyncSync, constants as fsConstants, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync, type Stats } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { homedir, hostname } from 'node:os';
import { dirname, resolve } from 'node:path';
import { AGENT, MACHINE_ADAPTER_LOCK_PATH, MACHINE_ADAPTER_REGISTRY_PATH } from '../constants';
import { KyroCoreError } from '../core/errors';
import type { Agent, KyroInstalledAdapter, MachineAdapterRegistry, OperationPlan, OperationProjectionResult } from '../types';

const remedy = `Back up ${MACHINE_ADAPTER_REGISTRY_PATH}, remove the invalid file, then run kyro install --init-workspace in each legacy workspace to rebuild the registry.`;
const pathFor = (path: string): string => resolve(homedir(), path.slice(2));
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: string[]): boolean => Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));

/** Strict versioned schema: reject unknown fields, agents, duplicates and invalid timestamps. */
export function validateMachineAdapterRegistry(value: unknown): asserts value is MachineAdapterRegistry {
  if (!record(value) || !exactKeys(value, ['schemaVersion', 'adapters']) || value.schemaVersion !== 1 || !Array.isArray(value.adapters)) {
    throw invalidRegistry('expected schemaVersion=1 and adapters array');
  }
  const seen = new Set<string>();
  for (const entry of value.adapters) {
    if (!record(entry) || !exactKeys(entry, ['agent', 'state', 'projection', 'integrations', 'updatedAt'])
      || typeof entry.agent !== 'string' || !Object.values(AGENT).includes(entry.agent as Agent)
      || seen.has(entry.agent) || !['enabled', 'disabled'].includes(entry.state as string)
      || ![null, 'link', 'copy'].includes(entry.projection as string | null) || typeof entry.integrations !== 'boolean'
      || typeof entry.updatedAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(entry.updatedAt)
      || !Number.isFinite(Date.parse(entry.updatedAt)) || new Date(entry.updatedAt).toISOString() !== entry.updatedAt) {
      throw invalidRegistry('invalid or duplicate adapter entry');
    }
    seen.add(entry.agent);
  }
}

function invalidRegistry(detail: string): KyroCoreError {
  return new KyroCoreError('INVALID_PROJECT_STATE', `MACHINE_ADAPTER_REGISTRY_INVALID: ${MACHINE_ADAPTER_REGISTRY_PATH}: ${detail}.`, remedy);
}

function registryRaw(): string | null {
  const path = pathFor(MACHINE_ADAPTER_REGISTRY_PATH);
  try {
    if (!lstatSync(path).isFile()) throw invalidRegistry('must be a regular file (symlinks are refused)');
    return readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** Pure preview read. Atomic rename makes unlocked readers see an entire old or new file. */
export function readMachineAdapterRegistry(): MachineAdapterRegistry {
  const raw = registryRaw();
  if (raw === null) return { schemaVersion: 1, adapters: [] };
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw invalidRegistry('invalid JSON'); }
  validateMachineAdapterRegistry(value);
  return value;
}

let lockDepth = 0;
let lockToken: string | null = null;

/** Exclusive machine lock, independent of cwd/current/. Never reclaim a possibly live writer. */
export function withMachineAdapterRegistryLock<T>(work: () => T): T {
  if (lockDepth > 0) {
    lockDepth++;
    try { assertLock(); return work(); } finally { lockDepth--; }
  }
  // Validate before creating directories/lock, preserving invalid registries untouched.
  readMachineAdapterRegistry();
  const path = pathFor(MACHINE_ADAPTER_LOCK_PATH);
  mkdirSync(dirname(path), { recursive: true });
  const token = JSON.stringify({ pid: process.pid, hostname: hostname(), token: randomUUID() });
  const deadline = Date.now() + 10_000;
  while (true) {
    const release = acquireReclaimSentinel(path);
    if (release) {
      try {
        let fd: number;
        try { fd = openSync(path, 'wx', 0o600); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
          if (reclaimDeadMachineLock(path)) continue;
          fd = -1;
        }
        if (fd !== -1) {
          try { writeFileSync(fd, token); fsyncSync(fd); } finally { closeSync(fd); }
          break;
        }
      } finally { release(); }
    }
    if (Date.now() >= deadline) throw new KyroCoreError('WRITE_NOT_PERMITTED', `MACHINE_ADAPTER_REGISTRY_LOCKED: ${MACHINE_ADAPTER_LOCK_PATH}.`, 'Wait for the other Kyro process. If its owner has exited, back up and remove the stale .adapters.lock before retrying.');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
  }
  lockToken = token;
  lockDepth = 1;
  try { readMachineAdapterRegistry(); return work(); }
  finally {
    try { assertLock(); unlinkSync(path); }
    finally { lockToken = null; lockDepth = 0; }
  }
}

interface LockIdentity { stat: Stats; raw: string }
interface DeadLockIdentity extends LockIdentity { fd: number }

function deadLockIdentity(path: string): DeadLockIdentity | null {
  let fd: number | undefined;
  try {
    if (!lstatSync(path).isFile()) return null;
    fd = openSync(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const stat = fstatSync(fd);
    if (!stat.isFile()) return null;
    const raw = readFileSync(path, 'utf8');
    const owner: unknown = JSON.parse(raw);
    if (!record(owner) || owner.hostname !== hostname() || typeof owner.pid !== 'number'
      || !Number.isSafeInteger(owner.pid) || owner.pid <= 0) return null;
    try { process.kill(owner.pid, 0); return null; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') return null; }
    // Keep the old inode pinned until the final check/unlink, preventing inode
    // reuse from making a replacement look identical after the pathname read.
    const identity = { stat, raw, fd };
    fd = undefined;
    return identity;
  } catch { return null; }
  finally { if (fd !== undefined) closeSync(fd); }
}

function sameLockIdentity(path: string, identity: LockIdentity): boolean {
  try {
    // Stat AFTER the read as well: a replacement during readFileSync must not
    // be mistaken for the old inode merely because the read returned old bytes.
    const raw = readFileSync(path, 'utf8');
    const current = lstatSync(path);
    return current.isFile() && current.dev === identity.stat.dev && current.ino === identity.stat.ino && raw === identity.raw;
  } catch { return false; }
}

/** Serialize both reclamation and publication; a writer cannot publish in the unlink window. */
function acquireReclaimSentinel(lockPath: string): (() => void) | null {
  const path = `${lockPath}.reclaim`;
  let fd: number;
  try { fd = openSync(path, 'wx', 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    // A crashed reclaimer must not permanently prevent future machine writes.
    const dead = deadLockIdentity(path);
    if (dead) {
      try {
        if (sameLockIdentity(path, dead)) {
          try { unlinkSync(path); } catch { /* another contender already removed it */ }
        }
      } finally { closeSync(dead.fd); }
    }
    return null;
  }
  const raw = JSON.stringify({ pid: process.pid, hostname: hostname(), token: randomUUID() });
  let identity: LockIdentity;
  try {
    writeFileSync(fd, raw);
    fsyncSync(fd);
    identity = { stat: fstatSync(fd), raw };
  } catch (error) { closeSync(fd); throw error; }
  return () => {
    try { if (sameLockIdentity(path, identity)) unlinkSync(path); }
    finally { closeSync(fd); }
  };
}

/** Called only while holding the exclusive reclaim sentinel. */
function reclaimDeadMachineLock(path: string): boolean {
  const dead = deadLockIdentity(path);
  if (!dead) return false;
  try {
    if (!sameLockIdentity(path, dead)) return false;
    unlinkSync(path);
    return true;
  } catch { return false; }
  finally { closeSync(dead.fd); }
}

function assertLock(): void {
  const path = pathFor(MACHINE_ADAPTER_LOCK_PATH);
  if (!lockToken || !existsSync(path) || !lstatSync(path).isFile() || readFileSync(path, 'utf8') !== lockToken) {
    throw new KyroCoreError('WRITE_NOT_PERMITTED', 'MACHINE_ADAPTER_REGISTRY_LOCK_LOST: refusing to write.', 'Inspect .adapters.lock and retry after the other writer has finished.');
  }
}

/** Caller must own the machine lock; fsync the sibling temporary file before atomic replacement. */
export function writeMachineAdapterRegistry(registry: MachineAdapterRegistry): void {
  assertLock();
  // Never overwrite corrupt state, even if the supplied replacement is valid.
  readMachineAdapterRegistry();
  validateMachineAdapterRegistry(registry);
  atomicReplace(`${JSON.stringify(registry, null, 2)}\n`);
}

function atomicReplace(raw: string): void {
  assertLock();
  const target = pathFor(MACHINE_ADAPTER_REGISTRY_PATH);
  const temp = `${target}.tmp-${process.pid}-${randomUUID()}`;
  try {
    const fd = openSync(temp, 'wx', 0o600);
    try { writeFileSync(fd, raw); fsyncSync(fd); } finally { closeSync(fd); }
    assertLock();
    renameSync(temp, target);
  } finally { if (existsSync(temp)) unlinkSync(temp); }
}

/** Legacy union only adds missing entries: a machine opt-out/integration choice always wins. */
export function mergeMachineAdapters(registry: MachineAdapterRegistry, legacy: KyroInstalledAdapter[], selected: Agent[], now: string): MachineAdapterRegistry {
  validateMachineAdapterRegistry(registry);
  const entries = new Map(registry.adapters.map((entry) => [entry.agent, { ...entry }]));
  for (const adapter of legacy) {
    if (!entries.has(adapter.agent)) entries.set(adapter.agent, { agent: adapter.agent, state: 'enabled', projection: null, integrations: true, updatedAt: adapter.installedAt });
  }
  for (const agent of selected) {
    const previous = entries.get(agent);
    if (!previous) entries.set(agent, { agent, state: 'enabled', projection: null, integrations: true, updatedAt: now });
    else if (previous.state === 'enabled') previous.updatedAt = now;
  }
  const result: MachineAdapterRegistry = { schemaVersion: 1, adapters: [...entries.values()].sort((a, b) => a.agent.localeCompare(b.agent)) };
  validateMachineAdapterRegistry(result);
  return result;
}

interface RegistryPlan { before: string | null; registry: MachineAdapterRegistry }
const registryPlans = new WeakMap<OperationPlan[], RegistryPlan>();

class MachineAdapterRollbackError extends Error {
  constructor(applyError: unknown, rollbackError: unknown) {
    super(`Machine adapter apply failed and rollback failed for ${MACHINE_ADAPTER_REGISTRY_PATH}: ${String(applyError)}; restore: ${String(rollbackError)}`, { cause: applyError });
    this.name = 'MachineAdapterRollbackError';
  }
}

/** Keep previews pure; persistence belongs to applyPlan, under the same machine lock. */
export function registerMachineAdapterPlan(plan: OperationPlan[], registry: MachineAdapterRegistry): void {
  registryPlans.set(plan, { before: registryRaw(), registry });
}

export function applyMachineAdapterPlan(plan: OperationPlan[], apply: () => OperationProjectionResult[] | void): void {
  const update = registryPlans.get(plan);
  if (!update) { apply(); return; }
  withMachineAdapterRegistryLock(() => {
    if (registryRaw() !== update.before) throw new KyroCoreError('STATE_DIVERGED', 'Machine adapter registry changed since this plan was built.', 'Rebuild the install/sync plan and retry.');
    writeMachineAdapterRegistry(update.registry);
    try {
      const results = apply();
      if (results?.length) {
        const registry: MachineAdapterRegistry = { schemaVersion: 1, adapters: update.registry.adapters.map((entry) => ({ ...entry })) };
        for (const entry of registry.adapters) {
          const root = entry.agent === AGENT.CLAUDE ? '~/.claude/skills/' : entry.agent === AGENT.OPENCODE ? '~/.config/opencode/skills/' : null;
          const applied = root ? results.filter((result) => result.path.startsWith(root)) : [];
          // If any path needed fallback, record copy conservatively for the adapter.
          if (applied.length) entry.projection = applied.some((result) => result.projection === 'copy') ? 'copy' : 'link';
        }
        writeMachineAdapterRegistry(registry);
      }
    }
    catch (error) {
      try {
        if (update.before === null) { assertLock(); unlinkSync(pathFor(MACHINE_ADAPTER_REGISTRY_PATH)); }
        else atomicReplace(update.before);
      } catch (rollbackError) { throw new MachineAdapterRollbackError(error, rollbackError); }
      throw error;
    }
  });
}
