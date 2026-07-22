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

    // 2. kyroInvocation SoT is the global manifest (node fallback when no durable kyro on PATH).
    // Project kyro.json must not carry a (drift-prone) copy.
    const runtimeRoot = join(home, '.agents', 'kyro', 'current');
    const manifest = JSON.parse(readFileSync(join(runtimeRoot, 'manifest.json'), 'utf-8'));
    const state = JSON.parse(readFileSync(join(workspace, '.agents', 'kyro', 'kyro.json'), 'utf-8'));
    const fallbackShape = /^node .+\/dist\/cli\.js$/;
    assert(fallbackShape.test(manifest.kyroInvocation), `check-cli-bundle: manifest.kyroInvocation should be the node fallback form, got "${manifest.kyroInvocation}"`);
    assert(!Object.hasOwn(state, 'kyroInvocation'), 'check-cli-bundle: kyro.json must not store kyroInvocation (global manifest is SoT)');

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
    assertPackageOpBlocked(command, invArgs, workspace, runEnv, 'install', ['--scope', 'workspace', '--yes']);
    assertPackageOpBlocked(command, invArgs, workspace, runEnv, 'sync', ['--scope', 'workspace']);

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

    // 8. Conflicting full/projected markers are unknown and fail closed.
    const conflictingAgentsRoot = join(runtimeRoot, 'agents');
    mkdirSync(conflictingAgentsRoot, { recursive: true });
    cpSync(resolve(repo, 'agents/orchestrator.md'), join(conflictingAgentsRoot, 'orchestrator.md'));
    assertUnknownRootBlocked(command, invArgs, workspace, runEnv, 'conflicting full/projected markers');
    rmSync(conflictingAgentsRoot, { recursive: true, force: true });

    // 9. Either core marker may disappear independently without losing projected identity.
    const coreOrchestratorPath = join(runtimeRoot, 'core', 'agents', 'orchestrator.md');
    const coreOrchestratorBackup = `${coreOrchestratorPath}.qa-backup`;
    cpSync(coreOrchestratorPath, coreOrchestratorBackup);
    unlinkSync(coreOrchestratorPath);
    assertProjectedRuntimeCorrupt(command, invArgs, workspace, runEnv, ['core/agents/orchestrator.md']);
    assertPackageOpBlocked(command, invArgs, workspace, runEnv, 'install', ['--scope', 'workspace', '--yes']);
    assertPackageOpBlocked(command, invArgs, workspace, runEnv, 'sync', ['--scope', 'workspace']);
    cpSync(coreOrchestratorBackup, coreOrchestratorPath);
    unlinkSync(coreOrchestratorBackup);

    const coreWorkflowPath = join(runtimeRoot, 'core', 'WORKFLOW.yaml');
    const coreWorkflowBackup = `${coreWorkflowPath}.qa-backup`;
    cpSync(coreWorkflowPath, coreWorkflowBackup);
    unlinkSync(coreWorkflowPath);
    assertProjectedRuntimeCorrupt(command, invArgs, workspace, runEnv, ['core/WORKFLOW.yaml']);
    assertPackageOpBlocked(command, invArgs, workspace, runEnv, 'install', ['--scope', 'workspace', '--yes']);
    assertPackageOpBlocked(command, invArgs, workspace, runEnv, 'sync', ['--scope', 'workspace']);
    cpSync(coreWorkflowBackup, coreWorkflowPath);
    unlinkSync(coreWorkflowBackup);

    // 10. Corrupt projected runtime (missing manifest.json): stay mode-aware — report shape FAIL,
    // never npm-package packaging FAILs, and keep install/sync blocked without scandir ENOENT.
    const manifestPath = join(runtimeRoot, 'manifest.json');
    unlinkSync(manifestPath);
    assert(!existsSync(manifestPath), 'check-cli-bundle: manifest.json should be removed for corrupt-runtime smoke');
    assertProjectedRuntimeCorrupt(command, invArgs, workspace, runEnv, ['manifest.json']);
    assertPackageOpBlocked(command, invArgs, workspace, runEnv, 'install', ['--scope', 'workspace', '--yes']);
    assertPackageOpBlocked(command, invArgs, workspace, runEnv, 'sync', ['--scope', 'workspace']);

    // 11. Losing both core identity markers must remain projected while KYRO.md survives.
    unlinkSync(coreOrchestratorPath);
    unlinkSync(coreWorkflowPath);
    assertProjectedRuntimeCorrupt(command, invArgs, workspace, runEnv, [
      'manifest.json',
      'core/agents/orchestrator.md',
      'core/WORKFLOW.yaml',
    ]);
    assertPackageOpBlocked(command, invArgs, workspace, runEnv, 'install', ['--scope', 'workspace', '--yes']);
    assertPackageOpBlocked(command, invArgs, workspace, runEnv, 'sync', ['--scope', 'workspace']);

    // 12. Losing every projected identity marker becomes unknown, never full-package.
    unlinkSync(join(runtimeRoot, 'KYRO.md'));
    assertUnknownRootBlocked(command, invArgs, workspace, runEnv, 'marker-less corrupt runtime');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  console.log('check:cli-bundle — runtime CLI workflows pass; package operations fail closed for projected, corrupt, conflicting, and unknown roots');
}

/** Install/sync from any non-full-package root: exact INVALID_INPUT, npx remedy, no ENOENT. */
function assertPackageOpBlocked(command, invArgs, workspace, runEnv, operation, args) {
  const result = spawnSync(command, [...invArgs, operation, ...args], {
    cwd: workspace,
    env: runEnv,
    encoding: 'utf-8',
  });
  assert(result.status !== 0, `check-cli-bundle: non-full-package ${operation} should exit non-zero`);
  const out = `${result.stdout || ''}${result.stderr || ''}`;
  assert(out.includes('INVALID_INPUT'), `check-cli-bundle: blocked ${operation} must report INVALID_INPUT, got:\n${out}`);
  assert(out.includes('npx kyro-ai'), `check-cli-bundle: blocked ${operation} remedy must mention npx kyro-ai, got:\n${out}`);
  assert(out.includes('full kyro-ai npm package') || out.includes('full npm package'), `check-cli-bundle: blocked ${operation} must name the full package, got:\n${out}`);
  assert(!out.includes('scandir'), `check-cli-bundle: blocked ${operation} must not crash with scandir ENOENT, got:\n${out}`);
  assert(!/ENOENT: no such file or directory, scandir/.test(out), `check-cli-bundle: blocked ${operation} must not surface scandir ENOENT, got:\n${out}`);
}

function assertProjectedRuntimeCorrupt(command, invArgs, workspace, runEnv, expectedMissing) {
  const result = spawnSync(command, [...invArgs, 'doctor'], { cwd: workspace, env: runEnv, encoding: 'utf-8' });
  assert(result.status !== 0, `check-cli-bundle: corrupt projected doctor should exit non-zero: ${result.stderr || result.stdout}`);
  assert(result.stdout.includes('projected runtime (package packaging checks skipped)'), `check-cli-bundle: corrupt runtime must remain projected, got:\n${result.stdout}`);
  assert(result.stdout.includes('runtime packaging parity'), `check-cli-bundle: corrupt runtime must fail shape parity, got:\n${result.stdout}`);
  for (const relative of expectedMissing) {
    assert(result.stdout.includes(relative), `check-cli-bundle: corrupt runtime should report missing ${relative}, got:\n${result.stdout}`);
  }
  assertNoPackageNoise(result.stdout, 'corrupt projected runtime');
}

function assertUnknownRootBlocked(command, invArgs, workspace, runEnv, scenario) {
  const doctor = spawnSync(command, [...invArgs, 'doctor'], { cwd: workspace, env: runEnv, encoding: 'utf-8' });
  assert(doctor.status !== 0, `check-cli-bundle: ${scenario} doctor should exit non-zero`);
  assert(doctor.stdout.includes('unrecognized or corrupt layout (package packaging checks skipped)'), `check-cli-bundle: ${scenario} must report unknown root, got:\n${doctor.stdout}`);
  assertNoPackageNoise(doctor.stdout, scenario);

  const tokens = spawnSync(command, [...invArgs, 'doctor', '--tokens'], { cwd: workspace, env: runEnv, encoding: 'utf-8' });
  assert(tokens.status !== 0, `check-cli-bundle: ${scenario} token audit should exit non-zero`);
  assert(tokens.stdout.includes('current CLI root mode is unknown'), `check-cli-bundle: ${scenario} token audit must reject unknown root, got:\n${tokens.stdout}`);
  assertNoPackageNoise(tokens.stdout, `${scenario} token audit`);

  assertPackageOpBlocked(command, invArgs, workspace, runEnv, 'install', ['--scope', 'workspace', '--yes']);
  assertPackageOpBlocked(command, invArgs, workspace, runEnv, 'sync', ['--scope', 'workspace']);
}

function assertNoPackageNoise(stdout, scenario) {
  assert(!stdout.includes('missing agents/orchestrator.md'), `check-cli-bundle: ${scenario} must not run root package asset checks`);
  assert(!stdout.includes('.claude-plugin/plugin.json missing'), `check-cli-bundle: ${scenario} must not run Claude plugin packaging checks`);
  assert(!stdout.includes('ENOENT'), `check-cli-bundle: ${scenario} must not surface packaging ENOENT, got:\n${stdout}`);
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
