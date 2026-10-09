/** W1 machine registry contract. Every API and CLI invocation uses a disposable HOME. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const repo = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const root = fs.mkdtempSync(join(tmpdir(), 'kyro-machine-adapters-'));
const home = join(root, 'home');
const original = { cwd: process.cwd(), HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
process.env.HOME = home;
process.env.USERPROFILE = home;
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
function run(cwd, args, success = true) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd, env: process.env, encoding: 'utf8' });
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
  assert(json(registryPath).adapters.every((adapter) => adapter.integrations === true));
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
  console.log('Machine adapter registry checks passed (W1 criteria 1-7).');
} finally {
  process.chdir(original.cwd);
  for (const key of ['HOME', 'USERPROFILE']) if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key];
  fs.rmSync(root, { recursive: true, force: true });
}
