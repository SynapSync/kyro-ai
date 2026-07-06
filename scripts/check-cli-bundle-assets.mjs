import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Phase 1 smoke check (design.md §3 / tasks.md 1.3): the projected runtime must mirror the
// npm package layout the CLI needs at runtime — dist/cli.js, package.json, config.json — and
// every projected file must be tracked in manifest.json.managedFiles for clean uninstall.

const repo = resolve(new URL('..', import.meta.url).pathname);
const require = createRequire(import.meta.url);
const packageJson = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf-8'));
const version = packageJson.version;

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
    }),
  );

  const home = join(cwd, '.home');
  const versionDir = join(home, '.agents', 'kyro', 'versions', version);
  const manifestPath = join(versionDir, 'manifest.json');
  assert(existsSync(manifestPath), `check-cli-bundle-assets: missing ${manifestPath}`);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

  const projected = ['dist/cli.js', 'package.json', 'config.json'];
  for (const relative of projected) {
    const absolute = join(versionDir, relative);
    assert(existsSync(absolute), `check-cli-bundle-assets: missing projected ${relative}`);
  }

  const managedRelative = ['package.json', 'config.json'];
  for (const relative of managedRelative) {
    const managedPath = `~/.agents/kyro/versions/${version}/${relative}`;
    assert(manifest.managedFiles.includes(managedPath), `check-cli-bundle-assets: manifest.managedFiles missing ${managedPath}`);
  }
  const managedDistCli = `~/.agents/kyro/versions/${version}/dist/cli.js`;
  assert(manifest.managedFiles.includes(managedDistCli), `check-cli-bundle-assets: manifest.managedFiles missing ${managedDistCli}`);
});

console.log('check:cli-bundle-assets — dist/package.json/config.json are projected and managed');
