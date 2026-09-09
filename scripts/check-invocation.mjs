/**
 * Unit checks for durable CLI invocation resolution.
 *
 * Field failure: `npx kyro-ai install` put `…/.npm/_npx/…/bin/kyro` on PATH for the install
 * process only; install persisted `kyroInvocation: "kyro"`; agents then got command-not-found
 * and fell back to hand-writing sprint.json.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repo = resolve(new URL('..', import.meta.url).pathname);
const require = createRequire(import.meta.url);
const {
  buildInvocation,
  execKyroInvocationSync,
  getPersistedKyroInvocation,
  isBareKyroInvocation,
  isDurableKyroOnPath,
  isEphemeralPackageManagerPath,
  resolveInvocationSpawn,
  resolveKyroInvocation,
  splitInvocation,
} = require(resolve(repo, 'dist/cli/invocation.js'));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// --- isEphemeralPackageManagerPath ---
const ephemeralSamples = [
  '/home/u/.npm/_npx/7f732cbd68a49bd9/node_modules/.bin/kyro',
  '/Users/u/.npm/_npx/abc/node_modules/.bin/kyro',
  'C:\\Users\\u\\AppData\\Local\\npm-cache\\_npx\\abc\\node_modules\\.bin\\kyro.cmd',
  '/home/u/.yarn/berry/npx/123/node_modules/.bin/kyro',
  '/home/u/.yarn/dlx/xyz/node_modules/.bin/kyro',
  '/home/u/.local/share/pnpm/dlx/abc/node_modules/.bin/kyro',
  '/home/u/.pnpm-store/v3/tmp/dlx-123/node_modules/.bin/kyro',
];
for (const sample of ephemeralSamples) {
  assert(isEphemeralPackageManagerPath(sample) === true, `expected ephemeral: ${sample}`);
}

const durableSamples = [
  '/home/u/.nvm/versions/node/v24.18.0/bin/kyro',
  '/usr/local/bin/kyro',
  '/home/u/.local/bin/kyro',
  '/home/u/.npm-global/bin/kyro',
  'C:\\Users\\u\\AppData\\Roaming\\npm\\kyro.cmd',
];
for (const sample of durableSamples) {
  assert(isEphemeralPackageManagerPath(sample) === false, `expected durable: ${sample}`);
}

// --- buildInvocation ---
// POSIX: durable global install persists bare `kyro` (direct spawn works — real exe + shebang).
// Windows: npm installs .cmd/.ps1 shims; Node spawn without shell ignores PATHEXT (ENOENT)
// and direct .cmd spawn is blocked since CVE-2024-27980 (EINVAL). The installer must persist
// the node form on win32 even for durable installs, or doctor self-spawn can never succeed.
const durablePosix = buildInvocation(true, '~/.agents/kyro/current', 'linux');
assert(durablePosix.raw === 'kyro', `durable POSIX should prefer bare kyro, got ${durablePosix.raw}`);
assert(durablePosix.command === 'kyro' && durablePosix.args.length === 0, 'durable command shape');

const durableWin = buildInvocation(true, '~/.agents/kyro/current', 'win32');
assert(
  durableWin.raw === 'node ~/.agents/kyro/current/dist/cli.js',
  `durable Windows must use node form (shims cannot self-spawn), got ${durableWin.raw}`,
);
assert(durableWin.command === 'node', 'windows durable command');

const durable = buildInvocation(true, '~/.agents/kyro/current');
if (process.platform === 'win32') {
  assert(durable.raw !== 'kyro', `live durable on Windows must not be bare kyro, got ${durable.raw}`);
} else {
  assert(durable.raw === 'kyro', `durable should prefer bare kyro, got ${durable.raw}`);
}

const fallback = buildInvocation(false, '~/.agents/kyro/current');
assert(
  fallback.raw === 'node ~/.agents/kyro/current/dist/cli.js',
  `ephemeral/missing should use node fallback, got ${fallback.raw}`,
);
assert(fallback.command === 'node', 'fallback command');
assert(fallback.args.join(' ') === '~/.agents/kyro/current/dist/cli.js', 'fallback args');

const fallbackWin = buildInvocation(false, '~/.agents/kyro/current', 'win32');
assert(
  fallbackWin.raw === 'node ~/.agents/kyro/current/dist/cli.js',
  `windows fallback must use node form, got ${fallbackWin.raw}`,
);

// Simulate the npx install decision: ephemeral path → treat as not durable → node form
const npxPath = '/home/u/.npm/_npx/deadbeef/node_modules/.bin/kyro';
const fromNpx = buildInvocation(!isEphemeralPackageManagerPath(npxPath), '~/.agents/kyro/current');
assert(
  fromNpx.raw === 'node ~/.agents/kyro/current/dist/cli.js',
  `npx-visible kyro must not persist bare "kyro", got ${fromNpx.raw}`,
);

// Live PATH probe: ephemeral bin on PATH must NOT count as durable (npx install regression).
if (process.platform !== 'win32') {
  const probeRoot = mkdtempSync(join(tmpdir(), 'kyro-inv-npx-'));
  const binDir = join(probeRoot, '.npm', '_npx', 'deadbeef', 'node_modules', '.bin');
  try {
    mkdirSync(binDir, { recursive: true });
    const fakeKyro = join(binDir, 'kyro');
    writeFileSync(fakeKyro, '#!/bin/sh\necho fake-npx-kyro\n', 'utf8');
    chmodSync(fakeKyro, 0o755);
    const previousPath = process.env.PATH;
    process.env.PATH = `${binDir}:/usr/bin:/bin`;
    try {
      assert(isDurableKyroOnPath() === false, 'ephemeral npx kyro on PATH must not be durable');
      const resolved = resolveKyroInvocation();
      assert(
        resolved.raw.startsWith('node ') && resolved.raw.endsWith('/dist/cli.js'),
        `resolveKyroInvocation under fake npx PATH must use node fallback, got ${resolved.raw}`,
      );
    } finally {
      process.env.PATH = previousPath;
    }
  } finally {
    rmSync(probeRoot, { recursive: true, force: true });
  }
}

// getPersistedKyroInvocation: without a projected manifest, falls back to live resolve
// (same decision as resolveKyroInvocation). Project kyro.json is never consulted.
{
  const persisted = getPersistedKyroInvocation();
  const live = resolveKyroInvocation().raw;
  assert(
    typeof persisted === 'string' && persisted.length > 0,
    'getPersistedKyroInvocation must return a non-empty string',
  );
  // When no global manifest is installed in this process HOME, both paths should agree.
  // (If a developer machine has a real ~/.agents/kyro/current/manifest.json, prefer-manifest
  // is still valid as long as the string is a known shape.)
  assert(
    persisted === 'kyro' || /^node .+\/dist\/cli\.js$/.test(persisted) || persisted === live,
    `getPersistedKyroInvocation unexpected shape: ${persisted}`,
  );
}

// --- win32 self-spawn mapping (doctor false-FAIL regression) ---
// Simulated with explicit platform args so POSIX CI covers the Windows path.
assert(isBareKyroInvocation('kyro') === true, 'bare kyro is bare');
assert(isBareKyroInvocation('kyro.cmd') === true, 'kyro.cmd is bare');
assert(isBareKyroInvocation('"kyro"') === true, 'quoted kyro is bare');
assert(isBareKyroInvocation('node ~/.agents/kyro/current/dist/cli.js') === false, 'node form is not bare');
assert(isBareKyroInvocation('C:\\Users\\u\\AppData\\Roaming\\npm\\kyro.cmd') === true, 'absolute shim is bare');
assert(JSON.stringify(splitInvocation('node "~/a b/c.js" --x')) === JSON.stringify(['node', '~/a b/c.js', '--x']), 'split respects quotes');

{
  const winBare = resolveInvocationSpawn('kyro', 'win32');
  assert(winBare.command === process.execPath, `win32 bare kyro must map to process.execPath, got ${winBare.command}`);
  assert(winBare.args.length === 1 && /[/\\]dist[/\\]cli\.js$/.test(winBare.args[0]), `win32 bare kyro must map to projected cli.js, got ${winBare.args.join(' ')}`);
  assert(winBare.fallbackUsed === true, 'win32 bare kyro must flag fallbackUsed');
}
{
  const posixBare = resolveInvocationSpawn('kyro', 'linux');
  assert(posixBare.command === 'kyro' && posixBare.args.length === 0, `posix bare kyro must stay direct, got ${posixBare.command}`);
  assert(posixBare.fallbackUsed === false, 'posix bare kyro must not flag fallback');
}
{
  const nodeForm = resolveInvocationSpawn('node ~/.agents/kyro/current/dist/cli.js', 'linux');
  assert(nodeForm.command === process.execPath, `node form must map to process.execPath, got ${nodeForm.command}`);
  assert(nodeForm.args.length === 1 && nodeForm.fallbackUsed === false, 'node form args/fallback');
}
{
  // Live smoke: the node form must self-spawn (proves exec wrapper works). Uses the repo's own
  // dist/cli.js — hermetic on fresh machines/CI where no global runtime is installed yet.
  const repoCli = resolve(repo, 'dist/cli.js');
  const out = execKyroInvocationSync(`node "${repoCli}"`, ['--version'], { encoding: 'utf8', timeout: 5000 });
  assert(typeof out === 'string' && /\d+\.\d+\.\d+/.test(out.trim()), `node-form self-spawn must print a version, got ${JSON.stringify(out)}`);
}

// Projected skill stubs pin runtimeVersion and print a CLI line (post-mortem #2 F1/F2).
{
  const { buildCommandSkill, parseSkillRuntimeVersion } = require(resolve(repo, 'dist/cli/adapters/command-skills.js'));
  const { readPackageVersion } = require(resolve(repo, 'dist/cli/help.js'));
  const skill = buildCommandSkill('forge');
  const version = readPackageVersion();
  assert(skill.includes(`runtimeVersion: "${version}"`), `skill stub must pin runtimeVersion ${version}`);
  assert(parseSkillRuntimeVersion(skill) === version, 'parseSkillRuntimeVersion must read pin');
  assert(skill.includes('CLI: `'), 'skill stub must print CLI entrypoint line');
  assert(skill.includes('prefer this projected runtime over any host plugin cache path'), 'skill stub must warn against plugin cache paths');
  assert(parseSkillRuntimeVersion('---\nname: x\n---\n') === null, 'missing pin parses as null');
  assert(parseSkillRuntimeVersion('runtimeVersion: "9.9.9"') === '9.9.9', 'parse bare pin line');
}

console.log('check:invocation — durable vs ephemeral invocation resolution passed');