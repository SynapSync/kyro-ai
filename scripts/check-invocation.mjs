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
  isDurableKyroOnPath,
  isEphemeralPackageManagerPath,
  resolveKyroInvocation,
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
const durable = buildInvocation(true, '~/.agents/kyro/current');
assert(durable.raw === 'kyro', `durable should prefer bare kyro, got ${durable.raw}`);
assert(durable.command === 'kyro' && durable.args.length === 0, 'durable command shape');

const fallback = buildInvocation(false, '~/.agents/kyro/current');
assert(
  fallback.raw === 'node ~/.agents/kyro/current/dist/cli.js',
  `ephemeral/missing should use node fallback, got ${fallback.raw}`,
);
assert(fallback.command === 'node', 'fallback command');
assert(fallback.args.join(' ') === '~/.agents/kyro/current/dist/cli.js', 'fallback args');

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

console.log('check:invocation — durable vs ephemeral invocation resolution passed');