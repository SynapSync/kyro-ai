/**
 * Unit checks for `kyro update` (friendly one-step updater).
 *
 * Field failure: updating took two manual steps with implicit knowledge
 * (`npx kyro-ai install` + `npm i -g kyro-ai`), nothing reported whether an update
 * existed, and install without @latest could "update" to a stale npx cache.
 *
 * All decision logic is pure (buildUpdatePlan) so this runs with no network.
 * The live registry query is fail-soft by design and covered by inspection, not here.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

const repo = resolve(new URL('..', import.meta.url).pathname);
const require = createRequire(import.meta.url);
const {
  UPDATE_PACKAGE,
  buildUpdatePlan,
  quoteWinArg,
  validateTargetVersion,
} = require(resolve(repo, 'dist/cli/commands/update.js'));
const { parseOptions } = require(resolve(repo, 'dist/cli/options.js'));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function facts(overrides = {}) {
  return {
    current: '4.48.3',
    latest: '4.48.3',
    runtimeVersion: '4.48.3',
    hasWorkspace: true,
    hasLegacyScopeCache: false,
    durableGlobal: true,
    ...overrides,
  };
}

// --- validateTargetVersion: only strict semver becomes an install pin ---
assert(validateTargetVersion('4.48.3') === '4.48.3', 'clean semver passes');
assert(validateTargetVersion('  4.48.3  ') === '4.48.3', 'surrounding whitespace trimmed');
assert(validateTargetVersion('4.48.3-beta.1') === '4.48.3-beta.1', 'prerelease passes');
assert(validateTargetVersion('latest') === null, 'floating tag never becomes a pin');
assert(validateTargetVersion('v4.48.3') === null, 'v-prefix rejected');
assert(validateTargetVersion('4.48') === null, 'partial version rejected');
assert(validateTargetVersion('') === null, 'empty rejected');
assert(validateTargetVersion(null) === null, 'null rejected');
assert(validateTargetVersion(123) === null, 'non-string rejected');
assert(validateTargetVersion('4.48.3; rm -rf ~') === null, 'injection rejected');

// --- quoteWinArg: shell routing on Windows must not break on spaces ---
assert(quoteWinArg('install') === 'install', 'simple arg untouched');
assert(quoteWinArg('a b') === '"a b"', 'spaced arg quoted');
assert(quoteWinArg('a"b') === '"a""b"', 'inner quote doubled');

// --- behind + global lane ---
{
  const plan = buildUpdatePlan(facts({ latest: '4.49.0' }));
  assert(plan.action === 'update-global', `expected update-global, got ${plan.action}`);
  assert(plan.target === '4.49.0', `expected exact pin, got ${plan.target}`);
  assert(plan.behind === true, 'behind flag');
  assert(plan.steps[0] === 'npm install -g kyro-ai@4.49.0', `first step installs global, got ${plan.steps[0]}`);
  assert(plan.steps.length === 2, 'global lane has install + refresh steps');
}
{
  const plan = buildUpdatePlan(facts({ latest: '4.49.0', hasWorkspace: false }));
  assert(plan.action === 'update-global', 'global lane without workspace');
  assert(plan.steps[1].includes('no workspace'), `follow-up names missing workspace, got ${plan.steps[1]}`);
}

// --- behind + npx lane (no durable global kyro) ---
{
  const plan = buildUpdatePlan(facts({ latest: '4.49.0', durableGlobal: false }));
  assert(plan.action === 'update-npx', `expected update-npx, got ${plan.action}`);
  assert(plan.steps.length === 1 && plan.steps[0] === 'npx -y kyro-ai@4.49.0 sync --scope workspace', `single npx shot, got ${plan.steps}`);
}
{
  const plan = buildUpdatePlan(facts({ latest: '4.49.0', durableGlobal: false, hasWorkspace: false }));
  assert(plan.steps[0] === 'npx -y kyro-ai@4.49.0 install --scope workspace --no-init-workspace', `npx install lane, got ${plan.steps}`);
}

// --- up-to-date ---
{
  const plan = buildUpdatePlan(facts());
  assert(plan.action === 'up-to-date', `expected up-to-date, got ${plan.action}`);
  assert(plan.behind === false && plan.steps.length === 0, 'nothing to do');
}

// --- current package also migrates a legacy shared scope cache ---
{
  const plan = buildUpdatePlan(facts({ hasLegacyScopeCache: true }));
  assert(plan.action === 'refresh-workspace', `expected refresh-workspace, got ${plan.action}`);
  assert(plan.target === '4.48.3' && plan.steps[0].includes('sync'), 'current package syncs the workspace');
}
{
  const plan = buildUpdatePlan(facts({ hasLegacyScopeCache: true, latest: '4.49.0' }));
  assert(plan.action === 'update-global', 'new release takes precedence over local migration');
}
{
  const plan = buildUpdatePlan(facts({ hasLegacyScopeCache: true, hasWorkspace: false }));
  assert(plan.action === 'up-to-date', 'no workspace means no cache to migrate');
}
{
  const plan = buildUpdatePlan(facts({ hasLegacyScopeCache: true, runtimeVersion: '4.49.0' }));
  assert(plan.action === 'refresh-workspace' && plan.target === '4.49.0', 'newer runtime is used for migration');
}
{
  const plan = buildUpdatePlan(facts({ hasLegacyScopeCache: true, runtimeVersion: '4.49.0; bad' }));
  assert(plan.target === '4.48.3', 'invalid runtime version cannot become an npx pin');
}
{
  // Published latest older than running CLI (local dev ahead): not "behind".
  const plan = buildUpdatePlan(facts({ current: '9.9.9', latest: '4.48.3', runtimeVersion: '9.9.9' }));
  assert(plan.action === 'up-to-date', `newer-than-registry stays put, got ${plan.action}`);
}

// --- CLI current but runtime stale: refresh locally, no download ---
{
  const plan = buildUpdatePlan(facts({ runtimeVersion: '4.48.2' }));
  assert(plan.action === 'refresh-stale-runtime', `expected refresh-stale-runtime, got ${plan.action}`);
  assert(plan.target === '4.48.3', 'refresh targets the running version');
}
{
  const plan = buildUpdatePlan(facts({ runtimeVersion: '4.48.2', hasWorkspace: false }));
  assert(plan.action === 'refresh-stale-runtime' && plan.steps[0].includes('global runtime'), 'runtime-only refresh without workspace');
}
{
  // Runtime NEWER than CLI (workspace synced from a newer package): leave alone.
  const plan = buildUpdatePlan(facts({ current: '4.48.2', latest: '4.48.2', runtimeVersion: '4.48.3' }));
  assert(plan.action === 'up-to-date', `newer runtime is not stale, got ${plan.action}`);
}

// --- offline: registry unreachable → retry against the floating tag, never a guess pin ---
{
  const plan = buildUpdatePlan(facts({ latest: null }));
  assert(plan.action === 'offline-retry-latest', `expected offline-retry-latest, got ${plan.action}`);
  assert(plan.target === 'latest', 'offline target is the tag, not a fabricated version');
  assert(plan.steps[0] === 'npm install -g kyro-ai@latest', `offline global lane, got ${plan.steps}`);
}
{
  const plan = buildUpdatePlan(facts({ latest: null, durableGlobal: false }));
  assert(plan.steps[0].startsWith('npx -y kyro-ai@latest'), `offline npx lane, got ${plan.steps}`);
}
{
  const plan = buildUpdatePlan(facts({ latest: 'garbage!!' }));
  assert(plan.action === 'offline-retry-latest', `unparsable latest is offline, got ${plan.action}`);
}

// --- wiring: verb registered, flag parsed, help advertised ---
{
  const withCheck = parseOptions(['--check']);
  assert(withCheck.check === true, '--check parses');
  const without = parseOptions([]);
  assert(without.check === false, '--check defaults off');
}
{
  const help = spawnSync(process.execPath, [resolve(repo, 'dist/cli.js'), 'update', '--help'], { encoding: 'utf8' });
  assert(help.status === 0 && help.stdout.includes('kyro update [--check]'), `update --help advertises usage, got ${JSON.stringify(help.stdout)}`);
  const top = spawnSync(process.execPath, [resolve(repo, 'dist/cli.js'), '--help'], { encoding: 'utf8' });
  assert(top.status === 0 && top.stdout.includes('kyro update [options]'), 'top-level help lists update');
}
{
  // update is operator surface (like install/sync/uninstall): deliberately NOT a tool-owned
  // verb, so agents never self-update mid-sprint and the capability handshake is untouched.
  const { TOOL_OWNED_VERBS } = require(resolve(repo, 'dist/cli/core/capabilities.js'));
  assert(!TOOL_OWNED_VERBS.includes('update'), 'update stays out of the tool-owned handshake');
}

assert(UPDATE_PACKAGE === 'kyro-ai', 'package constant');

// --- actual CLI migration, with isolated HOME and a fake read-only npm registry response ---
{
  const root = mkdtempSync(join(tmpdir(), 'kyro-update-migrate-'));
  try {
    const version = require(resolve(repo, 'package.json')).version;
    const projectDir = join(root, '.agents', 'kyro');
    const fakeBin = join(root, 'bin');
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(fakeBin);
    mkdirSync(join(root, 'home'));
    const projectPath = join(projectDir, 'project.json');
    writeFileSync(projectPath, `${JSON.stringify({ schemaVersion: 4, scopes: [{ id: 'legacy', title: 'Legacy', status: 'planning' }] }, null, 2)}\n`);
    writeFileSync(join(projectDir, 'local.json'), `${JSON.stringify({ schemaVersion: 4, activeScope: null, installedAdapters: [] })}\n`);
    const npmPath = join(fakeBin, 'npm');
    writeFileSync(npmPath, `#!/bin/sh\nprintf '%s\\n' '"${version}"'\n`);
    chmodSync(npmPath, 0o755);
    const env = { ...process.env, HOME: join(root, 'home'), PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ''}` };
    const cli = resolve(repo, 'dist/cli.js');
    for (const flag of ['--check', '--dry-run']) {
      const result = spawnSync(process.execPath, [cli, 'update', flag], { cwd: root, env, encoding: 'utf8' });
      assert(result.status === 0, `${flag} failed: ${result.stderr}`);
      assert(result.stdout.includes('legacy scopes[] cache'), `${flag} must report migration`);
      assert(Object.hasOwn(JSON.parse(readFileSync(projectPath, 'utf8')), 'scopes'), `${flag} must not change project.json`);
    }
    const result = spawnSync(process.execPath, [cli, 'update', '--yes'], { cwd: root, env, encoding: 'utf8' });
    assert(result.status === 0, `update --yes failed: ${result.stderr}\n${result.stdout}`);
    assert(!Object.hasOwn(JSON.parse(readFileSync(projectPath, 'utf8')), 'scopes'), 'update --yes removes shared scopes[]');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

console.log('check:update — decision matrix, CLI wiring, and isolated workspace migration passed');
