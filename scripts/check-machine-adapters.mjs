/** W1 machine registry and W5 Pi contracts. Every invocation uses a disposable HOME. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const repo = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const root = fs.mkdtempSync(join(tmpdir(), 'kyro-machine-adapters-'));
const home = join(root, 'home');
const original = { cwd: process.cwd(), HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, npm_config_cache: process.env.npm_config_cache, PATH: process.env.PATH };
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.npm_config_cache = join(root, 'npm-cache');
process.env.PATH = join(root, 'bin');
fs.mkdirSync(process.env.PATH);
const timestamp = '2001-01-01T00:00:00.000Z';
const registryPath = join(home, '.agents/kyro/adapters.json');
const lockPath = join(home, '.agents/kyro/.adapters.lock');
const cli = join(repo, 'dist/cli.js');
const json = (path) => JSON.parse(fs.readFileSync(path, 'utf8'));
const writeJson = (path, value) => { fs.mkdirSync(dirname(path), { recursive: true }); fs.writeFileSync(path, JSON.stringify(value) + '\n'); };
const legacy = (agent) => ({ agent, scope: 'workspace', installedAt: timestamp, corePath: '~/.agents/kyro/current' });
const entry = (agent, overrides = {}) => ({ agent, state: 'enabled', projection: null, integrations: true, updatedAt: timestamp, ...overrides });
function workspace(name, agents = []) {
  const cwd = join(root, name);
  writeJson(join(cwd, '.agents/kyro/project.json'), { schemaVersion: 4, artifactRoot: '.agents/kyro/scopes' });
  writeJson(join(cwd, '.agents/kyro/local.json'), { schemaVersion: 4, activeScope: null, installedAdapters: agents.map(legacy) });
  return cwd;
}
function load(cwd) {
  process.chdir(cwd);
  for (const key of Object.keys(require.cache)) if (key.startsWith(join(repo, 'dist'))) delete require.cache[key];
  return {
    machine: require(join(repo, 'dist/cli/adapters/machine-registry.js')),
    state: require(join(repo, 'dist/cli/state.js')),
  };
}
function run(cwd, args, success = true, env = {}) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd, env: { ...process.env, ...env }, encoding: 'utf8' });
  if (success) assert.equal(result.status, 0, `${args.join(' ')}: ${result.stdout}\n${result.stderr}`);
  else assert.notEqual(result.status, 0, `unexpected success: ${args.join(' ')}`);
  return result;
}
function tree(path) {
  const result = [];
  function walk(current, relative) {
    if (!fs.existsSync(current)) return;
    const stat = fs.lstatSync(current);
    const data = stat.isSymbolicLink() ? fs.readlinkSync(current) : stat.isFile() ? createHash('sha256').update(fs.readFileSync(current)).digest('hex') : 'directory';
    result.push([relative, stat.mode, data]);
    if (stat.isDirectory()) for (const name of fs.readdirSync(current).sort()) walk(join(current, name), `${relative}/${name}`);
  }
  walk(path, '');
  return JSON.stringify(result);
}
function child(cwd, args) {
  return new Promise((resolve, reject) => {
    const processChild = spawn(process.execPath, [cli, ...args], { cwd, env: process.env });
    let output = '';
    processChild.stdout.on('data', (chunk) => { output += chunk; });
    processChild.stderr.on('data', (chunk) => { output += chunk; });
    processChild.on('error', reject);
    processChild.on('close', (code) => code === 0 ? resolve(output) : reject(new Error(`concurrent CLI exit ${code}: ${output}`)));
  });
}
try {
  const a = workspace('a', ['codex']);
  const b = workspace('b', ['standard']);
  let { machine, state } = load(a);
  assert.deepEqual(state.readProjectState().installedAdapters.map((adapter) => adapter.agent), ['codex']);
  assert(!fs.existsSync(home));
  run(a, ['sync', '--dry-run']);
  run(a, ['install', '--dry-run', '--init-workspace']);
  const runtimeOnly = join(root, 'runtime-only'); fs.mkdirSync(runtimeOnly);
  run(runtimeOnly, ['install', '--no-init-workspace', '--dry-run']);
  assert(!fs.existsSync(home), 'clean HOME must remain absent after previews');
  console.log('PASS dry-run / absent HOME: install, sync, runtime-only install write nothing');

  run(a, ['sync']);
  run(b, ['sync']);
  assert.deepEqual(json(registryPath).adapters.map((adapter) => adapter.agent), ['codex', 'standard']);
  assert.equal(json(registryPath).adapters.find((adapter) => adapter.agent === 'codex').integrations, true);
  assert.equal(json(registryPath).adapters.find((adapter) => adapter.agent === 'standard').integrations, false, 'canonical standard was auto-added before legacy workspace B and keeps its machine choice');
  assert.equal(json(registryPath).schemaVersion, 1);
  assert(!registryPath.includes('/current/'));
  const manifestPath = join(home, '.agents/kyro/current/manifest.json');
  const adapters = json(manifestPath).adapters;
  run(a, ['sync']);
  assert.deepEqual(json(manifestPath).adapters.map((adapter) => adapter.agent), adapters.map((adapter) => adapter.agent));
  run(runtimeOnly, ['install', '--no-init-workspace']);
  assert.deepEqual(json(manifestPath).adapters, json(registryPath).adapters.map((adapter) => {
    const definition = require(join(repo, 'dist/cli/adapters/registry.js')).getAdapterDefinition(adapter.agent);
    return definition.buildInstalledAdapter('workspace', adapter.updatedAt);
  }));
  console.log('PASS legacy union / integrations / manifest: two workspaces and runtime-only install converge');
  for (const cwd of [a, b]) assert(!Object.hasOwn(json(join(cwd, '.agents/kyro/local.json')), 'installedAdapters'));
  fs.writeFileSync(join(process.env.PATH, 'codex'), '#!/bin/sh\nexit 0\n');
  run(a, ['install', '--init-workspace', '--agent', 'codex']);
  assert(!Object.hasOwn(json(join(a, '.agents/kyro/local.json')), 'installedAdapters'));
  ({ machine, state } = load(a));
  assert.deepEqual(state.readProjectState().installedAdapters.map((adapter) => adapter.agent), ['codex', 'standard']);
  const unmigratedLocal = state.sanitizeLocalForWrite({ schemaVersion: 4, activeScope: null, installedAdapters: [legacy('codex'), legacy('claude')] });
  assert.deepEqual(unmigratedLocal.installedAdapters.map((adapter) => adapter.agent), ['claude'], 'unrelated writers preserve only unmigrated legacy input, never machine-owned entries');
  const mono = join(root, 'monolito'); fs.mkdirSync(mono);
  writeJson(join(mono, '.agents/kyro/kyro.json'), { schemaVersion: 4, artifactRoot: '.agents/kyro/scopes', scopes: [], activeScope: null, runtimePath: '~/.agents/kyro/current', installedAdapters: [legacy('claude')] });
  assert.deepEqual(load(mono).state.readLegacyInstalledAdapters().map((adapter) => adapter.agent), ['claude']);
  console.log('PASS local overlay: install/sync omit installedAdapters; layered and monolito legacy remain readable');

  fs.writeFileSync(join(process.env.PATH, 'claude'), '#!/bin/sh\nexit 0\n');
  const before = tree(home);
  run(a, ['sync', '--dry-run']);
  run(a, ['install', '--init-workspace', '--agent', 'claude', '--dry-run']);
  run(runtimeOnly, ['install', '--no-init-workspace', '--dry-run']);
  assert.equal(tree(home), before);
  console.log('PASS dry-run / populated HOME: full file bytes, directories and modes unchanged');

  ({ machine } = load(a));
  const saved = fs.readFileSync(registryPath, 'utf8');
  const invalidValues = ['{broken', JSON.stringify({ schemaVersion: 2, adapters: [] }), JSON.stringify({ schemaVersion: 1, adapters: [entry('unknown')] }), JSON.stringify({ schemaVersion: 1, adapters: [entry('codex'), entry('codex')] }), JSON.stringify({ schemaVersion: 1, adapters: [entry('codex', { integrations: 'true' })] }), JSON.stringify({ schemaVersion: 1, adapters: [entry('codex', { state: 'broken' })] }), JSON.stringify({ schemaVersion: 1, adapters: [entry('codex', { projection: 'auto' })] }), JSON.stringify({ schemaVersion: 1, adapters: [entry('codex', { updatedAt: '2026-02-30T00:00:00.000Z' })] }), JSON.stringify({ schemaVersion: 1, adapters: [], surprise: true })];
  for (const raw of invalidValues) {
    fs.writeFileSync(registryPath, raw);
    const snapshot = tree(home);
    for (const args of [['sync'], ['install', '--no-init-workspace'], ['sync', '--dry-run']]) {
      const result = run(args[0] === 'install' ? runtimeOnly : a, args, false);
      assert.match(result.stdout + result.stderr, /MACHINE_ADAPTER_REGISTRY_INVALID/);
      assert.match(result.stdout + result.stderr, /Back up.*adapters\.json/);
      assert.equal(fs.readFileSync(registryPath, 'utf8'), raw);
      assert.equal(tree(home), snapshot);
    }
  }
  fs.writeFileSync(registryPath, saved);
  console.log('PASS fail closed: malformed JSON and schema-invalid registries preserve exact bytes with named remedy');

  assert.throws(() => machine.writeMachineAdapterRegistry({ schemaVersion: 1, adapters: [] }), /LOCK_LOST/);
  const rename = fs.renameSync;
  let registryRenames = 0;
  try {
    fs.renameSync = (source, target) => {
      if (target === registryPath) {
        assert(fs.existsSync(lockPath));
        assert.match(source, /adapters\.json\.tmp-/);
        machine.validateMachineAdapterRegistry(json(source));
        registryRenames++;
      }
      return rename(source, target);
    };
    machine.withMachineAdapterRegistryLock(() => machine.writeMachineAdapterRegistry(machine.readMachineAdapterRegistry()));
  } finally { fs.renameSync = rename; }
  assert.equal(registryRenames, 1);
  const atomicBefore = fs.readFileSync(registryPath, 'utf8');
  try {
    fs.renameSync = (source, target) => { if (target === registryPath) throw new Error('injected rename failure'); return rename(source, target); };
    assert.throws(() => machine.withMachineAdapterRegistryLock(() => machine.writeMachineAdapterRegistry({ schemaVersion: 1, adapters: [] })), /injected rename failure/);
  } finally { fs.renameSync = rename; }
  assert.equal(fs.readFileSync(registryPath, 'utf8'), atomicBefore);
  assert(!fs.existsSync(lockPath));
  assert(!fs.readdirSync(dirname(registryPath)).some((name) => name.includes('.tmp-')));
  console.log('PASS atomic writes / lock: validated sibling temp is renamed under lock; failed rename preserves bytes and cleans up');

  const exited = spawnSync(process.execPath, ['-e', ''], { env: process.env });
  assert.equal(exited.status, 0);
  const deadPid = exited.pid;
  assert(Number.isSafeInteger(deadPid) && deadPid > 0);
  assert.throws(() => process.kill(deadPid, 0), (error) => error.code === 'ESRCH');
  writeJson(lockPath, { pid: deadPid, hostname: hostname(), token: 'dead-owner' });
  run(a, ['sync']);
  assert(!fs.existsSync(lockPath));
  machine.withMachineAdapterRegistryLock(() => {
    const owner = json(lockPath);
    assert.equal(owner.pid, process.pid);
    assert.equal(owner.hostname, hostname());
    assert.equal(typeof owner.token, 'string');
  });
  console.log('PASS R2 stale lock: exited local pid reclaimed; sync succeeds and new lock records pid/hostname');

  const reclaimPath = `${lockPath}.reclaim`;
  writeJson(lockPath, { pid: deadPid, hostname: hostname(), token: 'dead-owner' });
  writeJson(reclaimPath, { pid: deadPid, hostname: hostname(), token: 'dead-reclaimer' });
  run(a, ['sync']);
  assert(!fs.existsSync(lockPath) && !fs.existsSync(reclaimPath));
  console.log('PASS F2 stale-reclaim-sentinel: dead sentinel and dead lock reclaimed; sync succeeds and both locks cleaned');

  // Adapted from the auditor's stale-reclaim-interleaving probe. Replace the
  // lock during its final read; the returned bytes still belong to the dead owner.
  const originalRead = fs.readFileSync;
  const originalNow = Date.now;
  for (const racedPath of [lockPath, reclaimPath]) {
    writeJson(lockPath, { pid: deadPid, hostname: hostname(), token: 'dead-owner' });
    if (racedPath === reclaimPath) writeJson(reclaimPath, { pid: deadPid, hostname: hostname(), token: 'dead-reclaimer' });
    let reads = 0, interleaved = false, ticks = 0;
    const liveRaw = JSON.stringify({ pid: process.pid, hostname: hostname(), token: 'live-B' });
    try {
      fs.readFileSync = function (path, ...args) {
        const value = originalRead(path, ...args);
        if (path === racedPath && ++reads === 2) {
          if (racedPath === lockPath) assert(fs.existsSync(reclaimPath), 'final lock check must hold reclaim sentinel');
          fs.unlinkSync(racedPath);
          fs.writeFileSync(racedPath, liveRaw);
          interleaved = true;
        }
        return value;
      };
      Date.now = () => originalNow() + (ticks++ === 0 ? 0 : 10_001);
      assert.throws(() => machine.withMachineAdapterRegistryLock(() => assert.fail('live owner replaced')), /MACHINE_ADAPTER_REGISTRY_LOCKED/);
      assert(interleaved, 'auditor interleaving was not exercised');
      assert.equal(originalRead(racedPath, 'utf8'), liveRaw, 'live owner must survive final-read replacement');
      if (racedPath === reclaimPath) assert.equal(JSON.parse(originalRead(lockPath, 'utf8')).token, 'dead-owner', 'failed sentinel acquisition must not touch machine lock');
    } finally {
      fs.readFileSync = originalRead;
      Date.now = originalNow;
      for (const path of [lockPath, reclaimPath]) if (fs.existsSync(path)) fs.unlinkSync(path);
    }
  }
  console.log('PASS F2 stale-reclaim-interleaving: live lock and live sentinel replacements survive; writer times out without entering callback');

  // A live reclaimer serializes other reclaimers and publishers.
  writeJson(lockPath, { pid: deadPid, hostname: hostname(), token: 'dead-owner' });
  writeJson(reclaimPath, { pid: process.pid, hostname: hostname(), token: 'live-reclaimer' });
  const heldLock = fs.readFileSync(lockPath), heldSentinel = fs.readFileSync(reclaimPath);
  let ticks = 0;
  try {
    Date.now = () => originalNow() + (ticks++ === 0 ? 0 : 10_001);
    assert.throws(() => machine.withMachineAdapterRegistryLock(() => assert.fail('reclaim sentinel bypassed')), /MACHINE_ADAPTER_REGISTRY_LOCKED/);
    assert.deepEqual(fs.readFileSync(lockPath), heldLock);
    assert.deepEqual(fs.readFileSync(reclaimPath), heldSentinel);
  } finally { Date.now = originalNow; fs.unlinkSync(lockPath); fs.unlinkSync(reclaimPath); }
  console.log('PASS F2 exclusive-reclaim-sentinel: live sentinel blocks reclamation/publication and preserves both files');

  for (const owner of [
    { pid: process.pid, hostname: hostname(), token: 'live-owner' },
    { pid: deadPid, hostname: `${hostname()}-foreign`, token: 'foreign-owner' },
  ]) {
    writeJson(lockPath, owner);
    const bytes = fs.readFileSync(lockPath);
    const started = Date.now();
    const result = run(a, ['sync'], false);
    assert.match(result.stdout + result.stderr, /MACHINE_ADAPTER_REGISTRY_LOCKED/);
    assert(Date.now() - started >= 10_000, 'live/foreign lock must retain the ten-second timeout');
    assert.deepEqual(fs.readFileSync(lockPath), bytes);
    fs.unlinkSync(lockPath);
  }
  console.log('PASS R2 protected owners: live pid and foreign hostname retain lock bytes and fail locked after 10 s');

  // Accelerate only these additional rejection probes, keeping the CLI timeout tests real.
  const now = Date.now;
  const kill = process.kill;
  try {
    for (const pid of [0, -1, 1.5, '123', null, Number.MAX_SAFE_INTEGER + 1]) {
      writeJson(lockPath, { pid, hostname: hostname() });
      const bytes = fs.readFileSync(lockPath);
      let ticks = 0;
      let probes = 0;
      Date.now = () => now() + (ticks++ === 0 ? 0 : 10_001);
      process.kill = () => { probes++; throw new Error('invalid pid must never be probed'); };
      assert.throws(() => machine.withMachineAdapterRegistryLock(() => assert.fail('invalid owner reclaimed')), /MACHINE_ADAPTER_REGISTRY_LOCKED/);
      assert.equal(probes, 0);
      assert.deepEqual(fs.readFileSync(lockPath), bytes);
      fs.unlinkSync(lockPath);
    }
    writeJson(lockPath, { pid: process.pid, hostname: hostname() });
    const bytes = fs.readFileSync(lockPath);
    let ticks = 0;
    let probes = 0;
    Date.now = () => now() + (ticks++ === 0 ? 0 : 10_001);
    process.kill = () => { probes++; throw Object.assign(new Error('injected EPERM'), { code: 'EPERM' }); };
    assert.throws(() => machine.withMachineAdapterRegistryLock(() => assert.fail('EPERM owner reclaimed')), /MACHINE_ADAPTER_REGISTRY_LOCKED/);
    assert.equal(probes, 1);
    assert.deepEqual(fs.readFileSync(lockPath), bytes);
    fs.unlinkSync(lockPath);
  } finally { Date.now = now; process.kill = kill; }
  console.log('PASS R2 invalid pid / EPERM: untrusted pid never probed; permission-denied owner never reclaimed');

  fs.writeFileSync(registryPath, atomicBefore);
  // Successful restore preserves exact bytes and rethrows the original object.
  const rollbackBefore = fs.readFileSync(registryPath, 'utf8');
  const applyError = new Error('injected original apply failure');
  const rollbackPlan = [];
  machine.registerMachineAdapterPlan(rollbackPlan, { schemaVersion: 1, adapters: [] });
  assert.throws(() => machine.applyMachineAdapterPlan(rollbackPlan, () => { throw applyError; }), (error) => error === applyError);
  assert.equal(fs.readFileSync(registryPath, 'utf8'), rollbackBefore);
  const restorePlan = [];
  machine.registerMachineAdapterPlan(restorePlan, { schemaVersion: 1, adapters: [] });
  let replacements = 0;
  try {
    fs.renameSync = (source, target) => {
      if (target === registryPath && ++replacements === 2) throw new Error('injected registry restore failure');
      return rename(source, target);
    };
    assert.throws(() => machine.applyMachineAdapterPlan(restorePlan, () => { throw applyError; }), (error) => {
      assert.match(String(error), /injected original apply failure/);
      assert.match(String(error), /restore: Error: injected registry restore failure/);
      assert.equal(error.cause, applyError);
      return true;
    });
    assert.equal(replacements, 2);
    assert.deepEqual(json(registryPath), { schemaVersion: 1, adapters: [] });
    assert(!fs.existsSync(lockPath));
  } finally { fs.renameSync = rename; fs.writeFileSync(registryPath, rollbackBefore); }

  // The absent-registry rollback uses unlink rather than atomic replacement.
  fs.unlinkSync(registryPath);
  const absentRestorePlan = [];
  machine.registerMachineAdapterPlan(absentRestorePlan, { schemaVersion: 1, adapters: [] });
  assert.throws(() => machine.applyMachineAdapterPlan(absentRestorePlan, () => { throw applyError; }), (error) => error === applyError);
  assert(!fs.existsSync(registryPath));
  const absentPlan = [];
  machine.registerMachineAdapterPlan(absentPlan, { schemaVersion: 1, adapters: [] });
  const unlink = fs.unlinkSync;
  try {
    fs.unlinkSync = (path) => { if (path === registryPath) throw new Error('injected registry unlink failure'); return unlink(path); };
    assert.throws(() => machine.applyMachineAdapterPlan(absentPlan, () => { throw applyError; }), (error) => {
      assert.match(String(error), /injected original apply failure/);
      assert.match(String(error), /restore: Error: injected registry unlink failure/);
      assert.equal(error.cause, applyError);
      return true;
    });
    assert.deepEqual(json(registryPath), { schemaVersion: 1, adapters: [] });
    assert(!fs.existsSync(lockPath));
  } finally { fs.unlinkSync = unlink; fs.writeFileSync(registryPath, rollbackBefore); }
  console.log('PASS R3 registry rollback: successful restore preserves bytes/original error; rename and unlink restore failures name both errors with original cause');

  const planBuilder = require(join(repo, 'dist/cli/install-plan.js'));
  const { applyPlan } = require(join(repo, 'dist/cli/fs.js'));
  const plan = planBuilder.buildRuntimeInstallPlan('workspace');
  plan.push({ action: 'copy', source: 'missing-w1-source', path: '~/.agents/w1-failure' });
  const open = fs.openSync;
  let sawWorkspaceFirst = false;
  try {
    fs.openSync = (path, ...args) => {
      if (path === lockPath && args[0] === 'wx') {
        assert(fs.existsSync(join(a, '.kyro-state-writer.lock')), 'direct applyPlan must take workspace lock before machine lock');
        sawWorkspaceFirst = true;
      }
      return open(path, ...args);
    };
    assert.throws(() => applyPlan(plan), /missing-w1-source/);
  } finally { fs.openSync = open; }
  assert(sawWorkspaceFirst, 'direct applyPlan did not exercise lock ordering');
  assert.equal(fs.readFileSync(registryPath, 'utf8'), atomicBefore);
  console.log('PASS pipeline rollback / lock order: workspace lock precedes machine lock; projection failure restores previous registry bytes');

  machine.withMachineAdapterRegistryLock(() => machine.writeMachineAdapterRegistry({ schemaVersion: 1, adapters: [entry('codex', { state: 'disabled', projection: 'copy', integrations: false }), entry('standard')] }));
  const disabledLegacy = workspace('disabled-legacy', ['codex']);
  run(disabledLegacy, ['sync']);
  assert.deepEqual(json(registryPath).adapters.find((adapter) => adapter.agent === 'codex'), entry('codex', { state: 'disabled', projection: 'copy', integrations: false }));
  assert(!json(manifestPath).adapters.some((adapter) => adapter.agent === 'codex'));
  assert(!load(disabledLegacy).state.readProjectState().installedAdapters.some((adapter) => adapter.agent === 'codex'));
  console.log('PASS sticky disabled / projection / integrations: legacy migration preserves machine choices');

  const c = workspace('concurrent-c', ['claude']);
  const d = workspace('concurrent-d', ['opencode']);
  await Promise.all([child(c, ['sync']), child(d, ['sync'])]);
  assert.deepEqual(json(registryPath).adapters.map((adapter) => adapter.agent), ['claude', 'codex', 'opencode', 'standard']);
  assert.deepEqual(json(manifestPath).adapters.map((adapter) => adapter.agent), ['claude', 'opencode', 'standard']);
  assert(!fs.existsSync(lockPath));
  console.log('PASS concurrency: simultaneous workspace syncs preserve union and final manifest under one machine lock');
  const projectionWorkspace = workspace('effective-projection');
  run(projectionWorkspace, ['install', '--init-workspace'], true, { KYRO_LINK_MODE: 'copy' });
  const claudeSkill = join(home, '.claude/skills/kyro-work');
  assert(fs.lstatSync(claudeSkill).isDirectory());
  assert.equal(json(registryPath).adapters.find((adapter) => adapter.agent === 'claude').projection, 'copy');
  run(projectionWorkspace, ['sync']);
  assert(fs.lstatSync(claudeSkill).isSymbolicLink());
  assert.equal(json(registryPath).adapters.find((adapter) => adapter.agent === 'claude').projection, 'link');
  console.log('PASS F3 effective-projection: forced-copy install persists claude=copy; later linked sync persists claude=link');
  console.log('Machine adapter registry checks passed (W1 criteria 1-7).');

  // W5 uses a separate HOME/PATH so Pi detection cannot alter W1's registry assertions.
  const piHome = join(root, 'pi-home');
  const piBin = join(root, 'pi-bin');
  const piCwd = join(root, 'pi-runtime-only');
  fs.mkdirSync(piBin);
  fs.mkdirSync(piCwd);
  process.env.HOME = process.env.USERPROFILE = piHome;
  process.env.PATH = piBin;
  load(piCwd);
  const { piAdapter } = require(join(repo, 'dist/cli/adapters/pi.js'));
  const { getInstallableAdapters, getAdapterDefinition } = require(join(repo, 'dist/cli/adapters/registry.js'));
  const { parseAgent, assertInstallableAgents } = require(join(repo, 'dist/cli/options.js'));
  const { AGENT } = require(join(repo, 'dist/cli/constants.js'));
  assert.equal(AGENT.PI, 'pi');
  assert.equal(parseAgent('PI'), 'pi');
  assertInstallableAgents(['pi']);
  assert.equal(getAdapterDefinition('pi'), piAdapter);
  assert(getInstallableAdapters().includes(piAdapter));
  assert.equal(piAdapter.status, 'implemented');
  const detectPi = () => piAdapter.detect({ homeDir: piHome, envPath: piBin });
  assert.equal(detectPi().installed, false);
  fs.mkdirSync(join(piHome, '.pi'), { recursive: true });
  assert.equal(detectPi().installed, false, '.pi alone must not count as .pi/agent');
  fs.writeFileSync(join(piHome, '.pi/agent'), 'foreign file');
  assert.equal(detectPi().installed, false, '.pi/agent must be a directory');
  fs.unlinkSync(join(piHome, '.pi/agent'));
  fs.mkdirSync(join(piHome, '.pi/agent'));
  assert.equal(detectPi().installed, true);
  assert.equal(detectPi().configFound, true);
  assert.equal(detectPi().binaryPath, null);
  fs.rmSync(join(piHome, '.pi'), { recursive: true });
  const piBinary = join(piBin, process.platform === 'win32' ? 'pi.cmd' : 'pi');
  fs.writeFileSync(piBinary, process.platform === 'win32' ? '@exit /b 0\r\n' : '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  assert.equal(detectPi().installed, true);
  assert.equal(detectPi().binaryPath, piBinary);
  assert.equal(detectPi().configFound, false);
  console.log('PASS W5 detection / registry / parseAgent: Pi implemented; binary or .pi/agent directory accepted; absent/file/root-only rejected');

  const piBefore = tree(piHome);
  run(piCwd, ['install', '--no-init-workspace', '--agent', 'pi', '--dry-run']);
  assert.equal(tree(piHome), piBefore);
  const piInstall = run(piCwd, ['install', '--no-init-workspace']);
  assert.match(piInstall.stdout, /Adapter pi: added; projection=none/);
  assert(!fs.existsSync(join(piHome, '.pi')), 'binary detection must not create a Pi config directory');
  const piRegistry = json(join(piHome, '.agents/kyro/adapters.json'));
  assert.deepEqual(piRegistry.adapters.map((adapter) => adapter.agent), ['pi', 'standard']);
  assert.equal(piRegistry.adapters.find((adapter) => adapter.agent === 'pi').projection, null);
  const piManifest = json(join(piHome, '.agents/kyro/current/manifest.json'));
  assert.equal(piManifest.adapters.find((adapter) => adapter.agent === 'pi').skillsPath, '~/.agents/skills');
  writeJson(join(piHome, '.pi/agent/settings.json'), { enableSkillCommands: false, skills: ['user-owned'] });
  const piConfigBefore = tree(join(piHome, '.pi'));
  run(piCwd, ['install', '--no-init-workspace', '--agent', 'pi', '--integrations']);
  assert.equal(tree(join(piHome, '.pi')), piConfigBefore);
  const noWritesBefore = tree(piHome);
  const piOperations = [{ action: 'write', path: 'sentinel', content: 'untouched' }];
  const unchangedOperations = structuredClone(piOperations);
  piAdapter.buildProjection(piOperations, { integrations: true, includeWorkspace: true });
  piAdapter.buildRemoval(piOperations);
  piAdapter.buildMcpProjection(piOperations);
  piAdapter.buildMcpRemoval(piOperations);
  assert.deepEqual(piOperations, unchangedOperations);
  assert.deepEqual(piAdapter.buildManagedFiles(), []);
  assert.deepEqual(piAdapter.buildManagedBlocks(), []);
  assert.equal(piAdapter.systemPromptStrategy(), 'none');
  assert.equal(piAdapter.mcpStrategy(), 'none');
  assert.equal(tree(piHome), noWritesBefore);
  console.log('PASS W5 canonical-only / no projection: install discovers Pi natively; no .pi creation; config preserved even with integrations; all adapter operations are no-ops');

  const assertPiNote = (check) => {
    assert.match(check.detail, /\/skill:kyro-work/);
    assert.match(check.detail, /enableSkillCommands/);
    assert.match(check.detail, /manually entered skill commands still work/);
  };
  const healthyPi = piAdapter.doctor(piManifest);
  assert.equal(healthyPi.status, 'pass');
  assertPiNote(healthyPi);
  assert.equal(piAdapter.doctor({ ...piManifest, adapters: [] }).status, 'pass', 'canonical health must not depend on workspace adapter membership');
  for (const manifest of [null, { ...piManifest, packageVersion: '' }]) {
    const check = piAdapter.doctor(manifest);
    assert.equal(check.status, 'fail');
    assert(check.remedy);
    assertPiNote(check);
  }
  const { buildCommandSkillManagedFiles } = require(join(repo, 'dist/cli/adapters/command-skills.js'));
  for (const managed of buildCommandSkillManagedFiles()) {
    const path = managed.replace('~', piHome);
    const body = fs.readFileSync(path, 'utf8');
    for (const fault of ['missing', 'stale', 'unpinned', 'unreadable']) {
      try {
        if (fault === 'missing' || fault === 'unreadable') fs.unlinkSync(path);
        if (fault === 'unreadable') fs.mkdirSync(path);
        if (fault === 'stale') fs.writeFileSync(path, body.replace(/runtimeVersion: "[^"\n]+"/, 'runtimeVersion: "0.0.0-w5-stale"'));
        if (fault === 'unpinned') fs.writeFileSync(path, body.replace(/^.*runtimeVersion:.*\n/m, ''));
        const check = piAdapter.doctor(piManifest);
        assert.equal(check.status, 'fail', `${managed}: ${fault}`);
        assert(check.detail.includes(managed), `${managed}: failed check must name the skill`);
        assert.match(check.remedy, /kyro sync/);
        assertPiNote(check);
      } finally {
        if (fault === 'unreadable') fs.rmdirSync(path);
        fs.writeFileSync(path, body);
      }
    }
  }
  assert.equal(piAdapter.doctor(piManifest).status, 'pass');
  assert.equal(tree(piHome), noWritesBefore, 'doctor and fault probes must restore the original HOME bytes');
  console.log('PASS W5 doctor health: every canonical command and full skill checked; current passes; missing/stale/unpinned/unreadable or unknown runtime fails with remedy');

  const piWorkspace = join(root, 'pi-workspace');
  fs.mkdirSync(piWorkspace);
  run(piWorkspace, ['install', '--init-workspace', '--agent', 'pi']);
  const piDoctor = run(piWorkspace, ['doctor']);
  assert.match(piDoctor.stdout, /\[PASS\] Pi adapter:.*\/skill:kyro-work.*enableSkillCommands/);
  console.log('PASS W5 doctor invocation / setting: CLI reports /skill:kyro-work and enableSkillCommands; manual invocation remains available');
  console.log('Pi adapter checks passed (W5 criteria 1-4).');
} finally {
  process.chdir(original.cwd);
  for (const key of ['HOME', 'USERPROFILE', 'npm_config_cache', 'PATH']) if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key];
  fs.rmSync(root, { recursive: true, force: true });
}
