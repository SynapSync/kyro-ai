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
import { resolve } from 'node:path';

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
console.log('check:update — decision matrix, flag parsing, and verb wiring passed');
