import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Phase 1 smoke check (design.md §3 / tasks.md 1.3): the projected runtime must mirror the
// npm package layout the CLI needs at runtime — dist/cli.js, package.json, config.json — and
// every projected file must be tracked in manifest.json.managedFiles for clean uninstall.

const repo = resolve(new URL('..', import.meta.url).pathname);
const require = createRequire(import.meta.url);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function withWorkspace(prefix, callback) {
  const cwd = mkdtempSync(join(tmpdir(), prefix));
  const previousCwd = process.cwd();
  const previousHome = process.env.HOME;
  try {
    process.chdir(cwd);
    process.env.HOME = join(cwd, '.home');
    return callback(cwd);
  } finally {
    process.chdir(previousCwd);
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    rmSync(cwd, { recursive: true, force: true });
  }
}

function captureLogs(callback) {
  const originalLog = console.log;
  try {
    console.log = () => {};
    callback();
  } finally {
    console.log = originalLog;
  }
}

withWorkspace('kyro-cli-bundle-assets-', (cwd) => {
  const { install } = require(join(repo, 'dist/cli/commands/install.js'));
  captureLogs(() =>
    install({
      agents: [],
      scope: 'workspace',
      dryRun: false,
      yes: true,
      help: false,
      tokens: false,
      artifacts: false,
      adapters: false,
      kyroScope: null,
      json: false,
      purgeAdapterAssets: false,
      prune: false,
      initWorkspace: true,
      noInitWorkspace: false,
      trace: false,
      task: null,
      verbosity: 'detailed',
      verbose: false,
      evalCases: [],
      evalTags: [],
      evalList: false,
      keepSandbox: false,
    }),
  );

  const home = join(cwd, '.home');
  const runtimeDir = join(home, '.agents', 'kyro', 'current');
  const manifestPath = join(runtimeDir, 'manifest.json');
  assert(existsSync(manifestPath), `check-cli-bundle-assets: missing ${manifestPath}`);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

  const projected = ['dist/cli.js', 'package.json', 'config.json'];
  for (const relative of projected) {
    const absolute = join(runtimeDir, relative);
    assert(existsSync(absolute), `check-cli-bundle-assets: missing projected ${relative}`);
  }
  assert(!existsSync(join(home, '.agents', 'kyro', 'versions')), 'check-cli-bundle-assets: legacy versions root should not remain after install');

  const managedRelative = ['package.json', 'config.json'];
  for (const relative of managedRelative) {
    const managedPath = `~/.agents/kyro/current/${relative}`;
    assert(manifest.managedFiles.includes(managedPath), `check-cli-bundle-assets: manifest.managedFiles missing ${managedPath}`);
  }
  const managedDistCli = `~/.agents/kyro/current/dist/cli.js`;
  assert(manifest.managedFiles.includes(managedDistCli), `check-cli-bundle-assets: manifest.managedFiles missing ${managedDistCli}`);

  // Phase 2 (design.md §4 / tasks.md 2.x): kyroInvocation must be persisted to both
  // manifest.json and kyro.json, and must be either the bare `kyro` command or the
  // `node {current}/dist/cli.js` fallback form.
  const isValidInvocation = (value) => value === 'kyro' || /^node .+\/dist\/cli\.js$/.test(value);
  assert(typeof manifest.kyroInvocation === 'string', 'check-cli-bundle-assets: manifest.json missing kyroInvocation');
  assert(isValidInvocation(manifest.kyroInvocation), `check-cli-bundle-assets: unexpected manifest.kyroInvocation shape "${manifest.kyroInvocation}"`);

  const statePath = join(cwd, '.agents', 'kyro', 'kyro.json');
  assert(existsSync(statePath), `check-cli-bundle-assets: missing ${statePath}`);
  const state = JSON.parse(readFileSync(statePath, 'utf-8'));
  assert(typeof state.kyroInvocation === 'string', 'check-cli-bundle-assets: kyro.json missing kyroInvocation');
  assert(state.kyroInvocation === manifest.kyroInvocation, 'check-cli-bundle-assets: kyro.json.kyroInvocation does not match manifest.json.kyroInvocation');

  const strayRuntimeFile = join(runtimeDir, 'stray-old-binary.js');
  const legacyVersionDir = join(home, '.agents', 'kyro', 'versions', '0.0.0');
  writeFileSync(strayRuntimeFile, '// stale untracked runtime file', 'utf-8');
  mkdirSync(legacyVersionDir, { recursive: true });
  writeFileSync(join(legacyVersionDir, 'dist-cli.js'), '// stale versioned binary', 'utf-8');

  captureLogs(() =>
    install({
      agents: [],
      scope: 'workspace',
      dryRun: false,
      yes: true,
      help: false,
      tokens: false,
      artifacts: false,
      adapters: false,
      kyroScope: null,
      json: false,
      purgeAdapterAssets: false,
      prune: false,
      initWorkspace: false,
      noInitWorkspace: false,
      trace: false,
      task: null,
      verbosity: 'detailed',
      verbose: false,
      evalCases: [],
      evalTags: [],
      evalList: false,
      keepSandbox: false,
    }),
  );
  assert(!existsSync(strayRuntimeFile), 'check-cli-bundle-assets: reinstall should replace active runtime instead of accumulating stray files');
  assert(!existsSync(legacyVersionDir), 'check-cli-bundle-assets: reinstall should remove legacy versioned runtime directories');
  assert(existsSync(manifestPath), 'check-cli-bundle-assets: manifest should still exist after reinstall');
});

console.log('check:cli-bundle-assets — dist/package.json/config.json are projected and managed');
