#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// End-to-end proof (design.md §10.2 / tasks.md 7.1): the bundled runtime CLI must run a
// CLI-owned, irreversible workflow step (close-sprint) with NO `kyro` binary on PATH — using
// only the projected `node {runtimeRoot}/dist/cli.js` invocation. This is the exact failure the
// whole change fixes: agents installed via `npx kyro-ai install` had the markdown runtime but no
// executable and blocked at close-sprint.

const repo = resolve(fileURLToPath(import.meta.url), '../..');
const cli = resolve(repo, 'dist/cli.js');
const version = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf-8')).version;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/** Expand a leading `~` to `home` (the projected invocation persists a literal `~`). */
function expandHome(segment, home) {
  return segment === '~' || segment.startsWith('~/') ? home + segment.slice(1) : segment;
}

function main() {
  assert(existsSync(cli), `check-cli-bundle: dist/cli.js missing — run npm run build first`);

  const root = join(tmpdir(), `kyro-cli-bundle-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const home = join(root, '.home');
  const workspace = join(root, 'workspace');
  // A PATH with no `kyro` binary so `isKyroOnPath()` is deterministically false → the node
  // fallback invocation is exercised (proves PATH-less resolution end-to-end).
  const noKyroBin = join(root, '.no-kyro-bin');
  mkdirSync(home, { recursive: true });
  mkdirSync(workspace, { recursive: true });
  mkdirSync(noKyroBin, { recursive: true });
  // Seed a scope with an activeSprint ready to close.
  cpSync(resolve(repo, 'fixtures/evals/close-sprint-happy/state'), workspace, { recursive: true });

  // Install pins the fallback: a PATH with neither `kyro` nor `node` makes `isKyroOnPath()` false.
  const inheritedEnv = {
    NODE_ENV: process.env.NODE_ENV ?? '',
    ...(process.env.OPENSSL_CONF ? { OPENSSL_CONF: process.env.OPENSSL_CONF } : {}),
  };
  const installEnv = { ...inheritedEnv, HOME: home, PATH: noKyroBin };
  // The workflow run needs `node` resolvable (as a real agent's shell has), but crucially NO
  // `kyro` binary — so the projected `node {runtimeRoot}/dist/cli.js` invocation is what runs.
  const runEnv = { ...inheritedEnv, HOME: home, PATH: `${dirname(process.execPath)}:${noKyroBin}` };

  try {
    // 1. Install from the built package with a PATH stripped of `kyro`.
    const install = spawnSync(process.execPath, [cli, 'install', '--scope', 'workspace', '--init-workspace', '--yes'], {
      cwd: workspace,
      env: installEnv,
      encoding: 'utf-8',
    });
    assert(install.status === 0, `check-cli-bundle: install should exit 0: ${install.stderr || install.stdout}`);

    // 2. kyroInvocation must be the node fallback form in BOTH manifest and kyro.json.
    const runtimeRoot = join(home, '.agents', 'kyro', 'current');
    const manifest = JSON.parse(readFileSync(join(runtimeRoot, 'manifest.json'), 'utf-8'));
    const state = JSON.parse(readFileSync(join(workspace, '.agents', 'kyro', 'kyro.json'), 'utf-8'));
    const fallbackShape = /^node .+\/dist\/cli\.js$/;
    assert(fallbackShape.test(manifest.kyroInvocation), `check-cli-bundle: manifest.kyroInvocation should be the node fallback form, got "${manifest.kyroInvocation}"`);
    assert(state.kyroInvocation === manifest.kyroInvocation, 'check-cli-bundle: kyro.json.kyroInvocation must match manifest.json.kyroInvocation');

    // 3. Projected-tree parity: the runtime mirrors the npm layout the CLI reads at runtime.
    for (const relative of ['dist/cli.js', 'package.json', 'config.json', 'skills/sprint-forge/SKILL.md']) {
      assert(existsSync(join(runtimeRoot, relative)), `check-cli-bundle: missing projected ${relative}`);
    }
    assert(!existsSync(join(home, '.agents', 'kyro', 'versions')), 'check-cli-bundle: legacy versions root should not remain after install');
    // 4. No projected file leaks the raw placeholder.
    assertNoPlaceholderLeak(runtimeRoot);

    // 5. Resolve the persisted invocation verbatim (expanding `~` → tempHOME) and run close-sprint.
    const [command, ...invArgs] = manifest.kyroInvocation.trim().split(/\s+/).map((segment) => expandHome(segment, home));
    assert(existsSync(invArgs[0]), `check-cli-bundle: resolved cli path does not exist: ${invArgs[0]}`);

    const scopePath = join(workspace, '.agents', 'kyro', 'scopes', 'demo');
    const sprintBefore = JSON.parse(readFileSync(join(scopePath, 'sprint.json'), 'utf-8'));
    assert(sprintBefore.activeSprint !== null, 'check-cli-bundle: fixture should start with an activeSprint');
    const ledgerBefore = Array.isArray(sprintBefore.ledger) ? sprintBefore.ledger.length : 0;

    const close = spawnSync(command, [...invArgs, 'close-sprint', '--kyro-scope', 'demo', '--outcome', 'shipped', '--yes'], {
      cwd: workspace,
      env: runEnv,
      encoding: 'utf-8',
    });
    assert(close.status === 0, `check-cli-bundle: close-sprint via projected CLI should exit 0: ${close.stderr || close.stdout}`);

    // 6. Contract: archive .json + .md written, activeSprint cleared, ledger appended.
    const archiveDir = join(scopePath, 'archive');
    const archived = existsSync(archiveDir) ? readdirSync(archiveDir) : [];
    assert(archived.some((f) => f.endsWith('.json')), `check-cli-bundle: no archive .json snapshot written (${archived.join(', ') || 'empty'})`);
    assert(archived.some((f) => f.endsWith('.md')), `check-cli-bundle: no archive .md narrative written (${archived.join(', ') || 'empty'})`);

    const sprintAfter = JSON.parse(readFileSync(join(scopePath, 'sprint.json'), 'utf-8'));
    assert(sprintAfter.activeSprint === null, 'check-cli-bundle: activeSprint should be cleared after close');
    assert(Array.isArray(sprintAfter.ledger) && sprintAfter.ledger.length === ledgerBefore + 1, 'check-cli-bundle: ledger should gain exactly one entry');

    // 7. Smoke `--version` — the same indirection doctor exercises; proves §3 PACKAGE_ROOT parity.
    const versionSmoke = spawnSync(command, [...invArgs, '--version'], { cwd: workspace, env: runEnv, encoding: 'utf-8' });
    assert(versionSmoke.status === 0, `check-cli-bundle: projected CLI --version should exit 0: ${versionSmoke.stderr || versionSmoke.stdout}`);
    assert(versionSmoke.stdout.includes(version), `check-cli-bundle: --version should print ${version}, got "${versionSmoke.stdout.trim()}"`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  console.log('check:cli-bundle — bundled runtime CLI closes a sprint end-to-end with no PATH binary');
}

function assertNoPlaceholderLeak(runtimeRoot) {
  const stack = [runtimeRoot];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (/\.(md|json|toml)$/.test(entry.name)) {
        assert(!readFileSync(full, 'utf-8').includes('{{KYRO_CLI}}'), `check-cli-bundle: projected file leaks raw placeholder: ${full.replace(`${runtimeRoot}/`, '')}`);
      }
    }
  }
}

main();
