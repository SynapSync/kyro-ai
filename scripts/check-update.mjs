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
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(fileURLToPath(new URL('..', import.meta.url)));
const packageVersion = JSON.parse(readFileSync(resolve(repo, 'package.json'), 'utf8')).version;
const require = createRequire(import.meta.url);
const {
  UPDATE_PACKAGE,
  assessUpdateConsistency,
  buildUpdatePlan,
  quoteWinArg,
  refreshFromCli,
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
    ownership: 'npm-owned',
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

// --- final consistency gate: no partial outcome can report completed ---
const consistent = {
  target: '4.49.0', packageVersion: '4.49.0', ownership: 'npm-owned',
  commandVersion: '4.49.0', runtimeVersion: '4.49.0',
};
assert(assessUpdateConsistency(consistent) === 'consistent', 'matching package, command, and runtime succeed');
assert(assessUpdateConsistency({ ...consistent, packageVersion: null }) === 'package-missing', 'missing package fails');
assert(assessUpdateConsistency({ ...consistent, packageVersion: '4.48.3' }) === 'package-version', 'wrong package version fails');
assert(assessUpdateConsistency({ ...consistent, ownership: 'foreign' }) === 'command-ownership', 'PATH shadowing fails');
assert(assessUpdateConsistency({ ...consistent, commandVersion: '4.48.3' }) === 'command-version', 'stale visible command fails');
assert(assessUpdateConsistency({ ...consistent, runtimeVersion: '4.48.3' }) === 'runtime-version', 'stale runtime fails');

// The fresh package child receives sync for a workspace, runtime-only install otherwise.
{
  const fixture = mkdtempSync(join(tmpdir(), 'kyro-update-child-'));
  try {
    const cli = join(fixture, 'cli.js');
    const argsFile = join(fixture, 'args.json');
    writeFileSync(cli, `require('node:fs').writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify(process.argv.slice(2)));`);
    refreshFromCli(cli, true, false);
    assert(JSON.stringify(JSON.parse(readFileSync(argsFile, 'utf8'))) === JSON.stringify(['sync', '--scope', 'workspace']), 'workspace refresh uses sync');
    refreshFromCli(cli, false, false);
    assert(JSON.stringify(JSON.parse(readFileSync(argsFile, 'utf8'))) === JSON.stringify(['install', '--scope', 'workspace', '--no-init-workspace']), 'no workspace only refreshes runtime');
    writeFileSync(cli, 'process.exit(7);');
    let failed = false;
    try { refreshFromCli(cli, true, false); } catch (error) { failed = String(error).includes('Workspace refresh failed'); }
    assert(failed, 'failed sync propagates a partial-update error');
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

// Previews from a machine with only a projected/runtime CLI are read-only and never install.
// On Windows the shell may resolve a real npm.cmd outside this stub PATH; the Windows shim
// behavior is covered by check:invocation, while this process fixture runs on POSIX.
if (process.platform !== 'win32') {
  const fixture = mkdtempSync(join(tmpdir(), 'kyro-update-preview-'));
  try {
    const home = join(fixture, 'home');
    const bin = join(fixture, 'bin');
    mkdirSync(home); mkdirSync(bin);
    symlinkSync(process.execPath, join(bin, 'node'));
    const log = join(fixture, 'npm.log');
    const npmStub = join(bin, 'npm');
    writeFileSync(npmStub, `#!/bin/sh\nprintf '%s\\n' "$*" >> "${log}"\nif [ "$1" = view ]; then printf '"4.49.0"\\n'; fi\n`);
    chmodSync(npmStub, 0o755);
    const env = { HOME: home, PATH: `${bin}:/usr/bin:/bin` };
    for (const flag of ['--check', '--dry-run']) {
      const preview = spawnSync(process.execPath, [resolve(repo, 'dist/cli.js'), 'update', flag], { cwd: fixture, env, encoding: 'utf8' });
      assert(preview.status === 0 && preview.stdout.includes('No global kyro command'), `preview ${flag} diagnoses migration: ${preview.stderr || preview.stdout}`);
      assert(!existsSync(join(fixture, '.agents')), `preview ${flag} must not write workspace state`);
    }
    const calls = readFileSync(log, 'utf8');
    assert(!calls.includes('install'), `previews must never install: ${calls}`);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

// A valid npm-owned shim does not prove that the package itself is complete.
// Both preview and normal update must diagnose a missing package.json before saying "latest".
if (process.platform !== 'win32') {
  const fixture = mkdtempSync(join(tmpdir(), 'kyro-update-incomplete-'));
  try {
    const home = join(fixture, 'home');
    const prefix = join(fixture, 'prefix');
    const bin = join(prefix, 'bin');
    const packageRoot = join(prefix, 'lib', 'node_modules', 'kyro-ai');
    const cli = join(packageRoot, 'dist', 'cli.js');
    mkdirSync(home); mkdirSync(bin, { recursive: true });
    symlinkSync(process.execPath, join(bin, 'node'));
    mkdirSync(join(packageRoot, 'dist'), { recursive: true });
    mkdirSync(join(packageRoot, 'agents'), { recursive: true });
    writeFileSync(cli, '#!/usr/bin/env node\n');
    chmodSync(cli, 0o755);
    writeFileSync(join(packageRoot, 'agents', 'orchestrator.md'), 'fixture\n');
    symlinkSync(cli, join(bin, 'kyro'));
    const log = join(fixture, 'npm.log');
    const npmStub = join(bin, 'npm');
    writeFileSync(npmStub, `#!/bin/sh\nprintf '%s\\n' "$*" >> "${log}"\ncase "$1" in\n  prefix) printf '%s\\n' '${prefix}' ;;\n  root) printf '%s\\n' '${join(prefix, 'lib', 'node_modules')}' ;;\n  view) printf '"${packageVersion}"\\n' ;;\nesac\n`);
    chmodSync(npmStub, 0o755);
    const env = { HOME: home, PATH: `${bin}:/usr/bin:/bin` };
    for (const flag of ['--check', '--yes']) {
      const result = spawnSync(process.execPath, [resolve(repo, 'dist/cli.js'), 'update', flag], { cwd: fixture, env, encoding: 'utf8' });
      const output = result.stdout + result.stderr;
      assert(result.status !== 0 && /incomplete/i.test(output), `update ${flag} must diagnose incomplete npm package: ${output}`);
      assert(!output.includes('latest release'), `update ${flag} must not announce latest: ${output}`);
    }
    assert(!readFileSync(log, 'utf8').includes('install'), 'incomplete package must not trigger install');
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

// A complete npm package can still expose a stale command through its owned shim.
// Every up-to-date invocation must reject that mismatch before reporting "latest".
if (process.platform !== 'win32') {
  const fixture = mkdtempSync(join(tmpdir(), 'kyro-update-stale-command-'));
  try {
    const home = join(fixture, 'home');
    const prefix = join(fixture, 'prefix');
    const bin = join(prefix, 'bin');
    const packageRoot = join(prefix, 'lib', 'node_modules', 'kyro-ai');
    const cli = join(packageRoot, 'dist', 'cli.js');
    mkdirSync(home); mkdirSync(bin, { recursive: true });
    symlinkSync(process.execPath, join(bin, 'node'));
    mkdirSync(join(packageRoot, 'dist'), { recursive: true });
    mkdirSync(join(packageRoot, 'agents'), { recursive: true });
    writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({ name: 'kyro-ai', version: packageVersion }));
    writeFileSync(join(packageRoot, 'agents', 'orchestrator.md'), 'fixture\n');
    writeFileSync(cli, '#!/usr/bin/env node\nconsole.log("4.0.0");\n');
    chmodSync(cli, 0o755);
    symlinkSync(cli, join(bin, 'kyro'));
    const log = join(fixture, 'npm.log');
    const npmStub = join(bin, 'npm');
    writeFileSync(npmStub, `#!/bin/sh\nprintf '%s\\n' "$*" >> "${log}"\ncase "$1" in\n  prefix) printf '%s\\n' '${prefix}' ;;\n  root) printf '%s\\n' '${join(prefix, 'lib', 'node_modules')}' ;;\n  view) printf '"${packageVersion}"\\n' ;;\nesac\n`);
    chmodSync(npmStub, 0o755);
    const env = { HOME: home, PATH: `${bin}:/usr/bin:/bin` };
    for (const flag of ['--check', '--dry-run', '--yes']) {
      const result = spawnSync(process.execPath, [resolve(repo, 'dist/cli.js'), 'update', flag], { cwd: fixture, env, encoding: 'utf8' });
      const output = result.stdout + result.stderr;
      assert(result.status !== 0 && output.includes('4.0.0') && output.includes(packageVersion), `update ${flag} must diagnose stale visible command: ${output}`);
      assert(!output.includes('latest release') && !output.includes('Updated kyro'), `update ${flag} must not announce success: ${output}`);
      assert(!existsSync(join(fixture, '.agents')), `update ${flag} must not write workspace state`);
    }
    assert(!readFileSync(log, 'utf8').includes('install'), 'stale visible command must not trigger install');
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

// Exercise every early-success route with the package and visible command aligned.
// The runtime is the only changing fact, so a newer runtime is the QA counterexample.
if (process.platform !== 'win32') {
  const fixture = mkdtempSync(join(tmpdir(), 'kyro-update-runtime-matrix-'));
  try {
    const home = join(fixture, 'home');
    const prefix = join(fixture, 'prefix');
    const bin = join(prefix, 'bin');
    const packageRoot = join(prefix, 'lib', 'node_modules', 'kyro-ai');
    const cli = join(packageRoot, 'dist', 'cli.js');
    const manifest = join(home, '.agents', 'kyro', 'current', 'manifest.json');
    const syncLog = join(fixture, 'sync.log');
    mkdirSync(join(packageRoot, 'dist'), { recursive: true });
    mkdirSync(join(packageRoot, 'agents'), { recursive: true });
    mkdirSync(bin, { recursive: true });
    symlinkSync(process.execPath, join(bin, 'node'));
    mkdirSync(join(home, '.agents', 'kyro', 'current'), { recursive: true });
    writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({ name: 'kyro-ai', version: packageVersion }));
    writeFileSync(join(packageRoot, 'agents', 'orchestrator.md'), 'fixture\n');
    writeFileSync(cli, `#!/usr/bin/env node\nif (process.argv.includes('--version')) console.log(${JSON.stringify(packageVersion)}); else { require('node:fs').writeFileSync(${JSON.stringify(manifest)}, JSON.stringify({ packageVersion: ${JSON.stringify(packageVersion)} })); require('node:fs').appendFileSync(${JSON.stringify(syncLog)}, 'sync\\n'); }\n`);
    chmodSync(cli, 0o755);
    symlinkSync(cli, join(bin, 'kyro'));
    const npmLog = join(fixture, 'npm.log');
    const npmStub = join(bin, 'npm');
    writeFileSync(npmStub, `#!/bin/sh\nprintf '%s\\n' "$*" >> "${npmLog}"\ncase "$1" in\n  prefix) printf '%s\\n' '${prefix}' ;;\n  root) printf '%s\\n' '${join(prefix, 'lib', 'node_modules')}' ;;\n  view) printf '"${packageVersion}"\\n' ;;\nesac\n`);
    chmodSync(npmStub, 0o755);
    const env = { HOME: home, PATH: `${bin}:/usr/bin:/bin` };
    for (const [runtimeVersion, expected] of [[null, 'refresh'], ['4.0.0', 'refresh'], [packageVersion, 'latest'], ['6.0.0', 'blocked']]) {
      if (runtimeVersion === null) rmSync(manifest, { force: true });
      else writeFileSync(manifest, JSON.stringify({ packageVersion: runtimeVersion }));
      for (const flag of ['--check', '--dry-run', '--yes']) {
        const before = existsSync(manifest) ? readFileSync(manifest, 'utf8') : null;
        const result = spawnSync(process.execPath, [resolve(repo, 'dist/cli.js'), 'update', flag], { cwd: fixture, env, encoding: 'utf8' });
        const output = result.stdout + result.stderr;
        if (expected === 'blocked') {
          assert(output.includes('6.0.0') && !output.includes('latest release'), `${flag} must diagnose newer runtime: ${output}`);
          assert(result.status === (flag === '--yes' ? 1 : 0), `${flag} returned unexpected status for newer runtime: ${result.status}`);
        } else if (expected === 'refresh') {
          assert(result.status === 0 && output.includes('refresh'), `${flag} must refresh or preview missing/older runtime: ${output}`);
        } else {
          assert(result.status === 0 && output.includes('latest release'), `${flag} may report latest only for equal versions: ${output}`);
        }
        if (flag !== '--yes' || expected === 'blocked' || expected === 'latest') {
          assert((existsSync(manifest) ? readFileSync(manifest, 'utf8') : null) === before, `${flag} changed runtime manifest`);
        }
      }
    }
    assert(!readFileSync(npmLog, 'utf8').includes('install'), 'runtime matrix must not install packages');
    assert(readFileSync(syncLog, 'utf8').trim().split('\n').length === 2, 'only missing and older runtime were refreshed');
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

// A failed npm install must keep progress visible and distinguish permissions from network errors.
if (process.platform !== 'win32') {
  const fixture = mkdtempSync(join(tmpdir(), 'kyro-update-install-failure-'));
  try {
    const home = join(fixture, 'home');
    const prefix = join(fixture, 'prefix');
    const bin = join(prefix, 'bin');
    const packageRoot = join(prefix, 'lib', 'node_modules', 'kyro-ai');
    const cli = join(packageRoot, 'dist', 'cli.js');
    const npmStub = join(bin, 'npm');
    const newerVersion = `${Number(packageVersion.split('.')[0]) + 1}.0.0`;
    mkdirSync(home);
    mkdirSync(bin, { recursive: true });
    mkdirSync(join(packageRoot, 'dist'), { recursive: true });
    mkdirSync(join(packageRoot, 'agents'), { recursive: true });
    symlinkSync(process.execPath, join(bin, 'node'));
    writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({ name: 'kyro-ai', version: packageVersion }));
    writeFileSync(join(packageRoot, 'agents', 'orchestrator.md'), 'fixture\n');
    writeFileSync(cli, `#!/usr/bin/env node\nconsole.log(${JSON.stringify(packageVersion)});\n`);
    chmodSync(cli, 0o755);
    symlinkSync(cli, join(bin, 'kyro'));
    const env = { HOME: home, PATH: `${bin}:/usr/bin:/bin` };
    for (const [errorCode, expectedRemedy] of [['EACCES', 'permission'], ['ENETUNREACH', 'network']]) {
      writeFileSync(npmStub, `#!/bin/sh\ncase "$1" in\n  prefix) printf '%s\\n' '${prefix}' ;;\n  root) printf '%s\\n' '${join(prefix, 'lib', 'node_modules')}' ;;\n  view) printf '"${newerVersion}"\\n' ;;\n  install) printf 'install-started\\n'; printf 'npm ERR! code ${errorCode}\\n' >&2; exit 1 ;;\nesac\n`);
      chmodSync(npmStub, 0o755);
      const result = spawnSync(process.execPath, [resolve(repo, 'dist/cli.js'), 'update', '--yes'], { cwd: fixture, env, encoding: 'utf8' });
      const output = result.stdout + result.stderr;
      assert(result.status !== 0, `${errorCode} install must fail`);
      assert(output.includes('install-started') && output.includes(errorCode), `${errorCode} npm progress must remain visible: ${output}`);
      assert(output.toLowerCase().includes(expectedRemedy), `${errorCode} must give a ${expectedRemedy} remedy: ${output}`);
      assert(!output.includes('Updated kyro'), `${errorCode} must not report update success`);
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

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

// --- no global or foreign command: actionable diagnosis, no install ---
{
  const plan = buildUpdatePlan(facts({ latest: '4.49.0', ownership: 'missing' }));
  assert(plan.action === 'migrate-global', `expected migration, got ${plan.action}`);
  assert(plan.steps[0] === 'npm install -g kyro-ai', `npm migration, got ${plan.steps}`);
}
{
  const plan = buildUpdatePlan(facts({ latest: '4.49.0', ownership: 'foreign' }));
  assert(plan.action === 'blocked-ownership' && plan.steps.length === 0, 'foreign command blocks update');
  assert(plan.summary.includes('PATH'), 'foreign command has actionable PATH remedy');
}
{
  const plan = buildUpdatePlan(facts({ latest: '4.49.0', ownership: 'ambiguous' }));
  assert(plan.action === 'blocked-ownership' && plan.steps.length === 0, 'ambiguous command blocks update');
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
  assert(plan.action === 'blocked-runtime-ahead', 'newer runtime blocks an unsafe downgrade during migration');
}
{
  const plan = buildUpdatePlan(facts({ hasLegacyScopeCache: true, runtimeVersion: '4.49.0; bad' }));
  assert(plan.action === 'blocked-runtime-mismatch', 'invalid runtime version blocks migration');
}
{
  // Published latest older than running CLI (local dev ahead): not "behind".
  const plan = buildUpdatePlan(facts({ current: '9.9.9', latest: '4.48.3', runtimeVersion: '9.9.9' }));
  assert(plan.action === 'ahead-of-registry', `newer-than-registry stays put without a latest claim, got ${plan.action}`);
}

// --- CLI current but runtime stale: refresh locally, no download ---
{
  const plan = buildUpdatePlan(facts({ runtimeVersion: '4.48.2' }));
  assert(plan.action === 'refresh-stale-runtime', `expected refresh-stale-runtime, got ${plan.action}`);
  assert(plan.target === '4.48.3', 'refresh targets the running version');
}
{
  // Runtime newer than the verified package must never be called up to date.
  const plan = buildUpdatePlan(facts({ current: '4.48.2', latest: '4.48.2', runtimeVersion: '4.48.3' }));
  assert(plan.action === 'blocked-runtime-ahead', `newer runtime must be diagnosed, got ${plan.action}`);
}

for (const [runtimeVersion, expectedSame, expectedNewer] of [
  [null, 'refresh-stale-runtime', 'update-global'],
  ['4.48.2', 'refresh-stale-runtime', 'update-global'],
  ['4.48.3', 'up-to-date', 'update-global'],
  ['4.49.0', 'blocked-runtime-ahead', 'update-global'],
  ['4.50.0', 'blocked-runtime-ahead', 'blocked-runtime-ahead'],
  ['garbage', 'blocked-runtime-mismatch', 'blocked-runtime-mismatch'],
  ['4.48.3+different', 'blocked-runtime-mismatch', 'update-global'],
]) {
  assert(buildUpdatePlan(facts({ runtimeVersion })).action === expectedSame, `same registry, runtime ${runtimeVersion}`);
  assert(buildUpdatePlan(facts({ latest: '4.49.0', runtimeVersion })).action === expectedNewer, `newer registry, runtime ${runtimeVersion}`);
}
assert(buildUpdatePlan(facts({ latest: '4.48.3+different' })).action === 'ahead-of-registry', 'registry metadata divergence cannot claim latest');

// --- offline: registry unreachable is a distinct diagnosis, never a floating install ---
{
  const plan = buildUpdatePlan(facts({ latest: null }));
  assert(plan.action === 'registry-unavailable', `expected registry-unavailable, got ${plan.action}`);
  assert(plan.steps.length === 0, 'offline check does not assume a target');
}
{
  const plan = buildUpdatePlan(facts({ latest: null, ownership: 'missing' }));
  assert(plan.action === 'migrate-global' && plan.steps[0].startsWith('npm install'), 'offline missing global still diagnoses migration');
}
{
  const plan = buildUpdatePlan(facts({ latest: 'garbage!!' }));
  assert(plan.action === 'registry-unavailable', `unparsable latest is unavailable, got ${plan.action}`);
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

// --- actual CLI migration from a verified npm global package, with isolated HOME ---
if (process.platform !== 'win32') {
  const root = mkdtempSync(join(tmpdir(), 'kyro-update-migrate-'));
  try {
    const prefix = join(root, 'prefix');
    const fakeBin = join(prefix, 'bin');
    const packageRoot = join(prefix, 'lib', 'node_modules', 'kyro-ai');
    const packageCli = join(packageRoot, 'dist', 'cli.js');
    const projectDir = join(root, '.agents', 'kyro');
    const home = join(root, 'home');
    mkdirSync(join(packageRoot, 'dist'), { recursive: true });
    mkdirSync(join(packageRoot, 'agents'), { recursive: true });
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(fakeBin, { recursive: true });
    mkdirSync(home);
    symlinkSync(process.execPath, join(fakeBin, 'node'));
    writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({ name: 'kyro-ai', version: packageVersion }));
    writeFileSync(join(packageRoot, 'agents', 'orchestrator.md'), 'fixture\n');
    writeFileSync(packageCli, `#!/usr/bin/env node\nrequire(${JSON.stringify(resolve(repo, 'dist/cli.js'))});\n`);
    chmodSync(packageCli, 0o755);
    symlinkSync(packageCli, join(fakeBin, 'kyro'));
    const npmPath = join(fakeBin, 'npm');
    writeFileSync(npmPath, `#!/bin/sh\ncase "$1" in\n  prefix) printf '%s\\n' '${prefix}' ;;\n  root) printf '%s\\n' '${join(prefix, 'lib', 'node_modules')}' ;;\n  view) printf '"${packageVersion}"\\n' ;;\n  *) exit 90 ;;\nesac\n`);
    chmodSync(npmPath, 0o755);
    const projectPath = join(projectDir, 'project.json');
    writeFileSync(projectPath, `${JSON.stringify({ schemaVersion: 4, scopes: [{ id: 'legacy', title: 'Legacy', status: 'planning' }] }, null, 2)}\n`);
    writeFileSync(join(projectDir, 'local.json'), `${JSON.stringify({ schemaVersion: 4, activeScope: null, installedAdapters: [] })}\n`);
    const env = {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      APPDATA: join(home, 'appdata'),
      LOCALAPPDATA: join(home, 'localappdata'),
      PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ''}`,
    };
    const cli = resolve(repo, 'dist/cli.js');
    for (const flag of ['--check', '--dry-run']) {
      const blocked = spawnSync(process.execPath, [cli, 'update', flag], { cwd: root, env, encoding: 'utf8' });
      assert(blocked.status !== 0 && blocked.stderr.includes('unresolved legacy entries legacy'),
        `${flag} must report blocked migration: ${blocked.stderr}\n${blocked.stdout}`);
      assert(Object.hasOwn(JSON.parse(readFileSync(projectPath, 'utf8')), 'scopes'), `${flag} must not change project.json`);
    }
    const blocked = spawnSync(process.execPath, [cli, 'update', '--yes'], { cwd: root, env, encoding: 'utf8' });
    assert(blocked.status !== 0 && blocked.stderr.includes('unresolved legacy entries legacy'),
      `update must refuse to discard orphaned legacy scope: ${blocked.stderr}\n${blocked.stdout}`);
    assert(Object.hasOwn(JSON.parse(readFileSync(projectPath, 'utf8')), 'scopes'), 'refused update preserves shared scopes[]');
    const scopeDir = join(projectDir, 'scopes', 'legacy');
    mkdirSync(scopeDir, { recursive: true });
    writeFileSync(join(scopeDir, 'sprint.json'), `${JSON.stringify({
      schemaVersion: 4,
      scope: 'legacy',
      title: 'Legacy',
      status: 'planning',
      objective: 'Keep legacy scope.',
      successCriteria: ['Scope survives migration.'],
      clarifications: [],
      conventions: [],
      adrs: [],
      roadmap: { plannedSprintCount: 1, sizingRationale: 'One sprint.', sprints: [{ n: 1, slug: 's1', title: 'Sprint 1', state: 'planned' }] },
      ledger: [],
      previousSprint: null,
      activeSprint: null,
      debt: [{ id: 'legacy-debt', title: 'Legacy debt', origin: 1, priority: 'medium', status: 'resolved', targetSprint: 1, resolvedSprint: 1, note: 'historical' }],
      handoff: { nextAction: 'plan_sprint', nextTaskId: null, blockers: [], note: '', lastUpdated: '2026-09-22' },
    }, null, 2)}\n`);
    const manifestDir = join(home, '.agents', 'kyro', 'current');
    mkdirSync(manifestDir, { recursive: true });
    writeFileSync(join(manifestDir, 'manifest.json'), JSON.stringify({
      schemaVersion: 1, packageName: 'kyro-ai', packageVersion,
      installedAt: '2026-09-23T00:00:00.000Z', installScope: 'workspace',
      managedFiles: [], managedBlocks: [], adapters: [], kyroInvocation: 'kyro',
    }));
    for (const flag of ['--check', '--dry-run']) {
      const preview = spawnSync(process.execPath, [cli, 'update', flag], { cwd: root, env, encoding: 'utf8' });
      assert(preview.status === 0 && preview.stdout.includes('legacy scopes[] cache'),
        `${flag} previews safe migration: ${preview.stderr}\n${preview.stdout}`);
      assert(Object.hasOwn(JSON.parse(readFileSync(projectPath, 'utf8')), 'scopes'), `${flag} remains read-only`);
    }
    const result = spawnSync(process.execPath, [cli, 'update', '--yes'], { cwd: root, env, encoding: 'utf8' });
    assert(result.status === 0, `update --yes failed: ${result.stderr}\n${result.stdout}`);
    assert(!Object.hasOwn(JSON.parse(readFileSync(projectPath, 'utf8')), 'scopes'), 'update --yes removes shared scopes[]');
    const migratedSprint = JSON.parse(readFileSync(join(scopeDir, 'sprint.json'), 'utf8'));
    assert(!Object.hasOwn(migratedSprint.debt[0], 'resolvedSprint'), 'safe legacy debt field is migrated automatically');
    assert(existsSync(join(projectDir, 'legacy-migrations', 'legacy.sprint.json')), 'migration backup is preserved');
    const second = spawnSync(process.execPath, [cli, 'update', '--yes'], { cwd: root, env, encoding: 'utf8' });
    assert(second.status === 0, `second update must remain idempotent: ${second.stderr}\n${second.stdout}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

console.log('check:update — decision matrix, CLI wiring, and isolated workspace migration passed');
