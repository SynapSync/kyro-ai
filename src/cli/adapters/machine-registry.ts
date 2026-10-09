import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { homedir, hostname } from 'node:os';
import { dirname, resolve } from 'node:path';
import { AGENT, MACHINE_ADAPTER_LOCK_PATH, MACHINE_ADAPTER_REGISTRY_PATH } from '../constants';
import { KyroCoreError } from '../core/errors';
import type { Agent, KyroInstalledAdapter, MachineAdapterRegistry, OperationPlan } from '../types';

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
    let fd: number;
    try { fd = openSync(path, 'wx', 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (reclaimDeadMachineLock(path)) continue;
      if (Date.now() >= deadline) throw new KyroCoreError('WRITE_NOT_PERMITTED', `MACHINE_ADAPTER_REGISTRY_LOCKED: ${MACHINE_ADAPTER_LOCK_PATH}.`, 'Wait for the other Kyro process. If its owner has exited, back up and remove the stale .adapters.lock before retrying.');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
      continue;
    }
    try { writeFileSync(fd, token); fsyncSync(fd); } finally { closeSync(fd); }
    break;
  }
  lockToken = token;
  lockDepth = 1;
  try { readMachineAdapterRegistry(); return work(); }
  finally {
    try { assertLock(); unlinkSync(path); }
    finally { lockToken = null; lockDepth = 0; }
  }
}

function reclaimDeadMachineLock(path: string): boolean {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile()) return false;
    const raw = readFileSync(path, 'utf8');
    const owner: unknown = JSON.parse(raw);
    if (!record(owner) || owner.hostname !== hostname() || typeof owner.pid !== 'number'
      || !Number.isSafeInteger(owner.pid) || owner.pid <= 0) return false;
    try { process.kill(owner.pid, 0); return false; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') return false; }
    // A competing reclaimer may already have replaced the dead owner's lock.
    const current = lstatSync(path);
    if (!current.isFile() || current.dev !== stat.dev || current.ino !== stat.ino || readFileSync(path, 'utf8') !== raw) return false;
    unlinkSync(path);
    return true;
  } catch { return false; }
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

export function applyMachineAdapterPlan(plan: OperationPlan[], apply: () => void): void {
  const update = registryPlans.get(plan);
  if (!update) { apply(); return; }
  withMachineAdapterRegistryLock(() => {
    if (registryRaw() !== update.before) throw new KyroCoreError('STATE_DIVERGED', 'Machine adapter registry changed since this plan was built.', 'Rebuild the install/sync plan and retry.');
    writeMachineAdapterRegistry(update.registry);
    try { apply(); }
    catch (error) {
      try {
        if (update.before === null) { assertLock(); unlinkSync(pathFor(MACHINE_ADAPTER_REGISTRY_PATH)); }
        else atomicReplace(update.before);
      } catch (rollbackError) { throw new MachineAdapterRollbackError(error, rollbackError); }
      throw error;
    }
  });
}
