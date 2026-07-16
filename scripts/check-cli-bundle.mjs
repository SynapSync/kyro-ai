#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, unlinkSync } from 'node:fs';
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

    // 5a. Doctor from projected runtime must not FAIL on npm-package packaging layout.
    const doctor = spawnSync(command, [...invArgs, 'doctor', '--artifacts', '--kyro-scope', 'demo'], {
      cwd: workspace,
      env: runEnv,
      encoding: 'utf-8',
    });
    assert(doctor.status === 0, `check-cli-bundle: projected doctor --artifacts should exit 0: ${doctor.stderr || doctor.stdout}`);
    assert(
      doctor.stdout.includes('projected runtime (package packaging checks skipped)'),
      `check-cli-bundle: doctor should report projected-runtime root mode, got:\n${doctor.stdout}`,
    );
    assert(!doctor.stdout.includes('missing agents/orchestrator.md'), 'check-cli-bundle: doctor must not FAIL on missing root agents/orchestrator.md');
    assert(!doctor.stdout.includes('.claude-plugin/plugin.json missing'), 'check-cli-bundle: doctor must not FAIL on missing .claude-plugin');

    // 5b. Install/sync from projected runtime must fail with exact INVALID_INPUT + npx remedy (no ENOENT).
    assertProjectedPackageOpBlocked(command, invArgs, workspace, runEnv, 'install', ['--scope', 'workspace', '--yes']);
    assertProjectedPackageOpBlocked(command, invArgs, workspace, runEnv, 'sync', ['--scope', 'workspace']);

    // 5c. Token audit from projected runtime fails clearly (package-only), not with packaging ENOENT noise.
    const doctorTokens = spawnSync(command, [...invArgs, 'doctor', '--tokens'], {
      cwd: workspace,
      env: runEnv,
      encoding: 'utf-8',
    });
    assert(doctorTokens.status !== 0, 'check-cli-bundle: projected doctor --tokens should exit non-zero');
    assert(doctorTokens.stdout.includes('token audit'), `check-cli-bundle: doctor --tokens should report token audit check, got:\n${doctorTokens.stdout}`);
    assert(doctorTokens.stdout.includes('full npm package') || doctorTokens.stdout.includes('npx kyro-ai'), `check-cli-bundle: token audit remedy should point at full package, got:\n${doctorTokens.stdout}`);
    assert(!doctorTokens.stdout.includes('ENOENT'), `check-cli-bundle: token audit must not surface ENOENT packaging noise, got:\n${doctorTokens.stdout}`);

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

    // 8. Corrupt projected runtime (missing manifest.json): stay mode-aware — report shape FAIL,
    // never npm-package packaging FAILs, and keep install/sync blocked without scandir ENOENT.
    const manifestPath = join(runtimeRoot, 'manifest.json');
    unlinkSync(manifestPath);
    assert(!existsSync(manifestPath), 'check-cli-bundle: manifest.json should be removed for corrupt-runtime smoke');

    const doctorCorrupt = spawnSync(command, [...invArgs, 'doctor'], {
      cwd: workspace,
      env: runEnv,
      encoding: 'utf-8',
    });
    assert(doctorCorrupt.status !== 0, `check-cli-bundle: doctor on corrupt runtime should exit non-zero: ${doctorCorrupt.stderr || doctorCorrupt.stdout}`);
    assert(
      doctorCorrupt.stdout.includes('projected runtime (package packaging checks skipped)'),
      `check-cli-bundle: corrupt runtime must still classify as projected, got:\n${doctorCorrupt.stdout}`,
    );
    assert(
      doctorCorrupt.stdout.includes('runtime packaging parity') && doctorCorrupt.stdout.includes('manifest.json'),
      `check-cli-bundle: doctor should report missing manifest.json via runtime packaging parity, got:\n${doctorCorrupt.stdout}`,
    );
    assert(!doctorCorrupt.stdout.includes('missing agents/orchestrator.md'), 'check-cli-bundle: corrupt runtime must not FAIL package assets for agents/orchestrator.md');
    assert(!doctorCorrupt.stdout.includes('.claude-plugin/plugin.json missing'), 'check-cli-bundle: corrupt runtime must not FAIL Claude plugin packaging');
    assert(!doctorCorrupt.stdout.includes('ENOENT'), `check-cli-bundle: corrupt runtime doctor must not surface packaging ENOENT, got:\n${doctorCorrupt.stdout}`);

    assertProjectedPackageOpBlocked(command, invArgs, workspace, runEnv, 'install', ['--scope', 'workspace', '--yes']);
    assertProjectedPackageOpBlocked(command, invArgs, workspace, runEnv, 'sync', ['--scope', 'workspace']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  console.log('check:cli-bundle — bundled runtime CLI closes a sprint end-to-end with no PATH binary; doctor/install root-mode guarded (incl. missing-manifest corrupt runtime)');
}

/** Install/sync from projected runtime: exact INVALID_INPUT, npx remedy, no scandir/ENOENT crash. */
function assertProjectedPackageOpBlocked(command, invArgs, workspace, runEnv, operation, args) {
  const result = spawnSync(command, [...invArgs, operation, ...args], {
    cwd: workspace,
    env: runEnv,
    encoding: 'utf-8',
  });
  assert(result.status !== 0, `check-cli-bundle: projected ${operation} should exit non-zero`);
  const out = `${result.stdout || ''}${result.stderr || ''}`;
  assert(out.includes('INVALID_INPUT'), `check-cli-bundle: projected ${operation} must report INVALID_INPUT, got:\n${out}`);
  assert(out.includes('npx kyro-ai'), `check-cli-bundle: projected ${operation} remedy must mention npx kyro-ai, got:\n${out}`);
  assert(out.includes('full kyro-ai npm package') || out.includes('full npm package'), `check-cli-bundle: projected ${operation} must name the full package, got:\n${out}`);
  assert(!out.includes('scandir'), `check-cli-bundle: projected ${operation} must not crash with scandir ENOENT, got:\n${out}`);
  assert(!/ENOENT: no such file or directory, scandir/.test(out), `check-cli-bundle: projected ${operation} must not surface scandir ENOENT, got:\n${out}`);
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
