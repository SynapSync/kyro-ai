import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
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

  // T3.6: verify the isolated projected runtime, rather than this checkout or the user's global
  // install, drives the complete remediated/recertified/diverged/unsupported vocabulary harness.
  const verification = spawnSync(process.execPath, [join(repo, 'scripts/check-verification-states.mjs')], {
    cwd: repo,
    encoding: 'utf-8',
    env: {
      ...process.env,
      HOME: home,
      KYRO_CLI_UNDER_TEST: join(runtimeDir, 'dist/cli.js'),
    },
  });
  const verificationOutput = `${verification.stdout ?? ''}${verification.stderr ?? ''}`;
  assert(verification.status === 0, `check-cli-bundle-assets: projected runtime verification failed:\n${verificationOutput}`);
  assert(verificationOutput.includes('315 assertions passed'), `check-cli-bundle-assets: projected runtime did not report verification coverage:\n${verificationOutput}`);

  // The debt contract must hold in the *installed* runtime, not only in this checkout: the original
  // incident survived a green source build. The projected runtime classifies the same faithful corpus
  // and must reach the same outcomes (original-incident-gate, shared-debt-vectors).
  const contract = spawnSync(process.execPath, [join(repo, 'scripts/check-debt-contract.mjs')], {
    cwd: repo,
    encoding: 'utf-8',
    env: { ...process.env, HOME: home, KYRO_DIST_UNDER_TEST: join(runtimeDir, 'dist') },
  });
  const contractOutput = `${contract.stdout ?? ''}${contract.stderr ?? ''}`;
  assert(contract.status === 0, `check-cli-bundle-assets: projected runtime debt contract failed:\n${contractOutput}`);
  assert(
    contractOutput.includes('239 assertions passed over 14 corpus cases'),
    `check-cli-bundle-assets: projected runtime did not classify the full corpus:\n${contractOutput}`,
  );

  // Preparation must also hold in the installed runtime, and must hold as READ-ONLY there: a
  // projected build that silently wrote a manifest or mutated a scope would pass every source test.
  {
    const scopeDir = join(cwd, '.agents', 'kyro', 'scopes', 'canonicalize-probe');
    mkdirSync(scopeDir, { recursive: true });
    const sprint = {
      schemaVersion: 4,
      scope: 'canonicalize-probe',
      title: 'Canonicalize probe',
      status: 'completed',
      objective: 'Probe read-only preparation in the projected runtime.',
      successCriteria: [],
      spec: { requirements: [], nonGoals: [], openQuestions: [] },
      clarifications: [],
      conventions: [],
      adrs: [],
      roadmap: [],
      ledger: [],
      previousSprint: null,
      activeSprint: null,
      debt: [{
        id: 'D1',
        title: 'AnalyzeMeal retry path is unreachable in production',
        status: 'resolved',
        detail: 'Historical prose.',
        origin: 'food-analysis FR-FA-013 revision',
        resolution: 'Decide explicitly.',
        addedSprint: 1,
        note: 'RESOLVED AS A DECISION.',
      }],
      handoff: { nextAction: 'done', nextTaskId: null, note: 'Probe.' },
    };
    writeFileSync(join(scopeDir, 'sprint.json'), `${JSON.stringify(sprint, null, 2)}\n`, 'utf-8');
    const scopeBefore = readFileSync(join(scopeDir, 'sprint.json'), 'utf-8');

    const prepare = (args) => {
      const result = spawnSync(process.execPath, [join(runtimeDir, 'dist/cli.js'), 'remediate', 'canonicalize-prepare',
        '--debt', 'D1', '--kyro-scope', 'canonicalize-probe', '--json', ...args], {
        cwd,
        encoding: 'utf-8',
        env: { ...process.env, HOME: home },
      });
      const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
      assert(result.status === 0, `check-cli-bundle-assets: projected runtime preparation failed:\n${output}`);
      return JSON.parse(result.stdout);
    };

    const undecided = prepare([]);
    assert(undecided.status === 'INPUT_REQUIRED', `check-cli-bundle-assets: projected runtime must ask for decisions, got ${undecided.status}`);
    assert(undecided.manifest === null, 'check-cli-bundle-assets: projected runtime produced a manifest without decisions');

    const ready = prepare(['--origin', '1', '--priority', 'high', '--target-sprint', 'null']);
    assert(ready.status === 'READY', `check-cli-bundle-assets: projected runtime must reach READY, got ${ready.status}`);
    assert(ready.manifest.schemaVersion === 3 && ready.manifest.operations[0].kind === 'debt.canonicalize',
      'check-cli-bundle-assets: projected runtime must emit a protocol v3 canonicalization');
    assert(readFileSync(join(scopeDir, 'sprint.json'), 'utf-8') === scopeBefore,
      'check-cli-bundle-assets: projected runtime preparation must not modify the scope');
    assert(!existsSync(join(cwd, 'manifest.json')), 'check-cli-bundle-assets: projected runtime preparation must not write a manifest');
    rmSync(join(cwd, '.agents', 'kyro', 'scopes', 'canonicalize-probe'), { recursive: true, force: true });
  }

  // kyroInvocation SoT is the global runtime manifest only (not project kyro.json).
  // Shape: bare `kyro` (durable PATH) or `node {current}/dist/cli.js` fallback.
  const isValidInvocation = (value) => value === 'kyro' || /^node .+\/dist\/cli\.js$/.test(value);
  assert(typeof manifest.kyroInvocation === 'string', 'check-cli-bundle-assets: manifest.json missing kyroInvocation');
  assert(isValidInvocation(manifest.kyroInvocation), `check-cli-bundle-assets: unexpected manifest.kyroInvocation shape "${manifest.kyroInvocation}"`);

  const sharedPath = join(cwd, '.agents', 'kyro', 'project.json');
  const localPath = join(cwd, '.agents', 'kyro', 'local.json');
  const monoPath = join(cwd, '.agents', 'kyro', 'kyro.json');
  assert(existsSync(sharedPath), `check-cli-bundle-assets: missing ${sharedPath}`);
  assert(existsSync(localPath), `check-cli-bundle-assets: missing ${localPath}`);
  assert(!existsSync(monoPath), 'check-cli-bundle-assets: live monolito kyro.json must not remain after install');
  const shared = JSON.parse(readFileSync(sharedPath, 'utf-8'));
  const local = JSON.parse(readFileSync(localPath, 'utf-8'));
  assert(!Object.hasOwn(shared, 'kyroInvocation'), 'check-cli-bundle-assets: project.json must not store kyroInvocation (global manifest is SoT)');
  assert(!Object.hasOwn(local, 'kyroInvocation'), 'check-cli-bundle-assets: local.json must not store kyroInvocation (global manifest is SoT)');
  assert(!Object.hasOwn(shared, 'activeScope'), 'check-cli-bundle-assets: project.json must not store activeScope');

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
