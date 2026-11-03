#!/usr/bin/env node
// Opt-in close commit: git.commitOnSprintClose preference, path-isolated commit engine, CLI/MCP wiring.
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = resolve(fileURLToPath(import.meta.url), '../..');
const cli = resolve(repo, 'dist/cli.js');
const distUrl = (path) => pathToFileURL(resolve(repo, 'dist/cli', path)).href;
const { validateLocalProjectStateShape } = await import(distUrl('artifacts/schema.js'));
const { commitCloseArtifacts, buildManualCommand } = await import(distUrl('core/close-commit.js'));

const failures = [];
const check = (name, condition, detail = '') => {
  if (!condition) failures.push(`${name}${detail ? `: ${detail}` : ''}`);
};
const fields = (issues) => issues.map((issue) => issue.field);

// --- Preference contract ---------------------------------------------------------------------
const local = (extra) => ({ schemaVersion: 4, activeScope: null, ...extra });
check('preference: absent git validates', validateLocalProjectStateShape(local({}), 'local').length === 0);
check('preference: true validates', validateLocalProjectStateShape(local({ git: { commitOnSprintClose: true } }), 'local').length === 0);
check('preference: false validates', validateLocalProjectStateShape(local({ git: { commitOnSprintClose: false } }), 'local').length === 0);
check('preference: empty git object validates', validateLocalProjectStateShape(local({ git: {} }), 'local').length === 0);
check('preference: non-object git rejected', fields(validateLocalProjectStateShape(local({ git: true }), 'local')).includes('git'));
check('preference: non-boolean flag rejected', fields(validateLocalProjectStateShape(local({ git: { commitOnSprintClose: 'yes' } }), 'local')).includes('git.commitOnSprintClose'));

// --- Temporary workspaces ----------------------------------------------------------------------
const tempRoot = mkdtempSync(join(tmpdir(), 'kyro-close-commit-'));
const emptyHooks = join(tempRoot, 'no-hooks');
mkdirSync(emptyHooks);
const gitIn = (cwd, ...args) => {
  const result = spawnSync('git', ['-c', 'user.name=Kyro Check', '-c', 'user.email=check@kyro.invalid', '-c', 'commit.gpgsign=false', '-c', `core.hooksPath=${emptyHooks}`, ...args], { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${result.stderr}`);
  return result.stdout.trim();
};
const cliEnv = (root, extra = {}) => {
  const emptyConfig = join(root, '.home', 'gitconfig-empty');
  return { ...process.env, HOME: join(root, '.home'), GIT_CONFIG_GLOBAL: emptyConfig, GIT_CONFIG_SYSTEM: emptyConfig, GIT_CONFIG_NOSYSTEM: '1', ...extra };
};
const runCli = (root, ...args) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', env: cliEnv(root) });
const leanInit = { scope: 'demo', title: 'Demo', objective: 'Demo objective.', successCriteria: ['Demo works.'], roadmap: { plannedSprintCount: 2, sprints: [{ n: 1, slug: 's1', title: 'Sprint one' }, { n: 2, slug: 's2', title: 'Sprint two' }] } };
const workspace = (name, { git = true } = {}) => {
  const root = join(tempRoot, name);
  mkdirSync(join(root, '.home'), { recursive: true });
  mkdirSync(join(root, '.agents/kyro'), { recursive: true });
  writeFileSync(join(root, '.home', 'gitconfig-empty'), '');
  writeFileSync(join(root, '.agents/kyro/kyro.json'), `${JSON.stringify({ schemaVersion: 4, artifactRoot: '.agents/kyro/scopes', scopes: [], activeScope: null, runtimePath: '~/.agents/kyro/current', installedAdapters: [] }, null, 2)}\n`);
  writeFileSync(join(root, '.gitignore'), '.home/\n');
  if (git) {
    gitIn(root, 'init', '-q');
    gitIn(root, 'checkout', '-q', '-b', 'main');
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src/app.txt'), 'v1\n');
    gitIn(root, 'add', '.gitignore', 'src/app.txt');
    gitIn(root, 'commit', '-q', '-m', 'initial');
  }
  writeFileSync(join(root, '.home', 'init.json'), JSON.stringify(leanInit));
  const init = runCli(root, 'plan', '--from', join(root, '.home', 'init.json'));
  if (init.status !== 0) throw new Error(`plan init failed: ${init.stdout}${init.stderr}`);
  return root;
};
const localPath = (root) => join(root, '.agents/kyro/local.json');
const readLocal = (root) => JSON.parse(readFileSync(localPath(root), 'utf8'));
const setPreference = (root, value) => {
  const current = readLocal(root);
  if (value === undefined) delete current.git;
  else current.git = { commitOnSprintClose: value };
  writeFileSync(localPath(root), `${JSON.stringify(current, null, 2)}\n`);
};
const resolvePreference = (root) => {
  const script = `import(${JSON.stringify(distUrl('state.js'))}).then((m) => console.log(m.resolveCommitOnSprintClose()))`;
  return spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: root, encoding: 'utf8', env: cliEnv(root) }).stdout.trim();
};

try {
  // --- Preference resolution and preservation (S9) --------------------------------------------
  const prefs = workspace('preference');
  check('preference: resolver false when absent', resolvePreference(prefs) === 'false');
  setPreference(prefs, false);
  check('preference: resolver false when false', resolvePreference(prefs) === 'false');
  setPreference(prefs, true);
  check('preference: resolver true only when explicitly true', resolvePreference(prefs) === 'true');
  const setActive = runCli(prefs, 'scope', 'set-active', 'demo', '--yes');
  check('preference: scope set-active applies', setActive.status === 0, `${setActive.stdout}${setActive.stderr}`);
  check('preference: git block survives a local.json rewrite', readLocal(prefs).git?.commitOnSprintClose === true, JSON.stringify(readLocal(prefs)));

  // Same rewrite path also used to drop execution.delegationEnabled (pre-existing); both must survive.
  const both = readLocal(prefs);
  both.execution = { delegationEnabled: true };
  writeFileSync(localPath(prefs), `${JSON.stringify(both, null, 2)}\n`);
  check('preference: second set-active applies', runCli(prefs, 'scope', 'set-active', 'demo', '--yes').status === 0);
  const after = readLocal(prefs);
  check('preference: execution.delegationEnabled and git survive together', after.execution?.delegationEnabled === true && after.git?.commitOnSprintClose === true, JSON.stringify(after));

  // --- Commit engine (S11–S14) -----------------------------------------------------------------
  // The engine runs git with the caller's config; give this process an isolated identity.
  const engineConfig = join(tempRoot, 'engine-gitconfig');
  writeFileSync(engineConfig, `[user]\n\tname = Kyro Check\n\temail = check@kyro.invalid\n[commit]\n\tgpgsign = false\n[core]\n\thooksPath = ${emptyHooks.split('\\').join('/')}\n`);
  process.env.GIT_CONFIG_GLOBAL = engineConfig;
  process.env.GIT_CONFIG_NOSYSTEM = '1';

  const closePaths = [
    '.agents/kyro/scopes/demo/archive/sprint-001-s1.checkpoint.json',
    '.agents/kyro/scopes/demo/archive/sprint-001-s1.json',
    '.agents/kyro/scopes/demo/archive/sprint-001-s1.md',
    '.agents/kyro/scopes/demo/sprint.json',
    '.agents/kyro/project.json',
  ];
  const engineRepo = (name) => {
    const dir = join(tempRoot, name);
    mkdirSync(join(dir, '.agents/kyro/scopes/demo/archive'), { recursive: true });
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src/app.txt'), 'v1\n');
    writeFileSync(join(dir, '.agents/kyro/scopes/demo/sprint.json'), '{"v":1}\n');
    writeFileSync(join(dir, '.agents/kyro/project.json'), '{"p":1}\n');
    gitIn(dir, 'init', '-q');
    gitIn(dir, 'checkout', '-q', '-b', 'main');
    gitIn(dir, 'add', '.');
    gitIn(dir, 'commit', '-q', '-m', 'initial');
    return dir;
  };
  const writeClose = (dir) => {
    writeFileSync(join(dir, closePaths[0]), '{"checkpoint":1}\n');
    writeFileSync(join(dir, closePaths[1]), '{"snapshot":1}\n');
    writeFileSync(join(dir, closePaths[2]), '# Sprint 1\n');
    writeFileSync(join(dir, closePaths[3]), '{"v":2}\n');
  };
  const request = (dir) => ({ cwd: dir, paths: closePaths, scope: 'demo', sprintN: 1, title: 'Sprint one' });
  const head = (dir) => gitIn(dir, 'rev-parse', 'HEAD');

  // S11: only the changed close paths; unrelated staged and unstaged changes untouched.
  const iso = engineRepo('engine-isolation');
  writeClose(iso);
  writeFileSync(join(iso, 'src/staged.txt'), 'staged\n');
  gitIn(iso, 'add', 'src/staged.txt');
  writeFileSync(join(iso, 'src/app.txt'), 'unstaged change\n');
  const isoResult = commitCloseArtifacts(request(iso));
  check('engine: commits', isoResult.status === 'committed' && isoResult.sha === head(iso), JSON.stringify(isoResult));
  const committed = gitIn(iso, 'show', '--name-only', '--format=', 'HEAD').split('\n').filter(Boolean).sort();
  check('engine: commit contains exactly the changed close paths', JSON.stringify(committed) === JSON.stringify(closePaths.slice(0, 4).sort()), JSON.stringify(committed));
  check('engine: unrelated staged file stays staged and uncommitted', gitIn(iso, 'diff', '--cached', '--name-only') === 'src/staged.txt');
  check('engine: unrelated unstaged change stays unstaged', gitIn(iso, 'diff', '--name-only') === 'src/app.txt');

  // S12: message, trailers, and grep.
  check('engine: subject format', gitIn(iso, 'log', '-1', '--format=%s') === 'chore(kyro): close demo sprint 1 — Sprint one', gitIn(iso, 'log', '-1', '--format=%s'));
  const body = gitIn(iso, 'log', '-1', '--format=%B');
  const trailers = spawnSync('git', ['interpret-trailers', '--parse'], { input: body, encoding: 'utf8' }).stdout;
  check('engine: trailers parse', trailers.includes('Kyro-Scope: demo') && trailers.includes('Kyro-Sprint: 1'), trailers);
  check('engine: git log --grep finds the close commit', gitIn(iso, 'log', '--grep', 'Kyro-Sprint: 1', '--format=%H') === isoResult.sha);

  // S14: nothing to commit on a second run.
  const again = commitCloseArtifacts(request(iso));
  check('engine: nothing to commit is skipped', again.status === 'skipped' && again.reason === 'nothing to commit', JSON.stringify(again));

  // S14: guards create no commit.
  const plainDir = join(tempRoot, 'engine-plain');
  mkdirSync(plainDir);
  const plainResult = commitCloseArtifacts({ ...request(plainDir) });
  check('engine: non-repository skipped', plainResult.status === 'skipped' && plainResult.reason.startsWith('not a git repository'), JSON.stringify(plainResult));
  const unbornDir = join(tempRoot, 'engine-unborn');
  mkdirSync(unbornDir);
  gitIn(unbornDir, 'init', '-q');
  check('engine: unborn skipped', commitCloseArtifacts(request(unbornDir)).reason === 'no commits yet');
  const detached = engineRepo('engine-detached');
  gitIn(detached, 'checkout', '-q', '--detach');
  writeClose(detached);
  const detachedHead = head(detached);
  const detachedResult = commitCloseArtifacts(request(detached));
  check('engine: detached HEAD skipped without commit', detachedResult.reason === 'detached HEAD' && head(detached) === detachedHead, JSON.stringify(detachedResult));
  check('engine: detached HEAD skip carries a manual command', typeof detachedResult.manualCommand === 'string' && detachedResult.manualCommand.includes('git commit --only'), JSON.stringify(detachedResult));
  const rebasing = engineRepo('engine-rebase');
  writeClose(rebasing);
  mkdirSync(join(rebasing, '.git/rebase-merge'));
  const rebasingHead = head(rebasing);
  const rebaseResult = commitCloseArtifacts(request(rebasing));
  check('engine: in-progress skip carries a manual command', typeof rebaseResult.manualCommand === 'string', JSON.stringify(rebaseResult));
  check('engine: rebase in progress skipped without commit', rebaseResult.status === 'skipped' && rebaseResult.reason.includes('rebase') && head(rebasing) === rebasingHead, JSON.stringify(rebaseResult));
  const ignored = engineRepo('engine-ignored');
  writeFileSync(join(ignored, '.gitignore'), '.agents/kyro/scopes/demo/archive/\n');
  gitIn(ignored, 'add', '.gitignore');
  gitIn(ignored, 'commit', '-q', '-m', 'ignore archive');
  writeClose(ignored);
  const ignoredHead = head(ignored);
  const ignoredResult = commitCloseArtifacts(request(ignored));
  check('engine: ignored close path skipped with manual command', ignoredResult.status === 'skipped' && ignoredResult.reason.startsWith('Kyro state is ignored by git') && typeof ignoredResult.manualCommand === 'string' && head(ignored) === ignoredHead, JSON.stringify(ignoredResult));

  // S13/S14: hooks are honored — a rejecting hook fails without a commit, a passing hook runs.
  const hookDir = (name, body) => {
    const dir = join(tempRoot, name);
    mkdirSync(dir);
    writeFileSync(join(dir, 'pre-commit'), `#!/bin/sh\n${body}\n`);
    chmodSync(join(dir, 'pre-commit'), 0o755);
    return dir;
  };
  const rejecting = engineRepo('engine-hook-reject');
  gitIn(rejecting, 'config', 'core.hooksPath', hookDir('hooks-reject', 'echo "blocked by policy" >&2\nexit 1').split('\\').join('/'));
  writeClose(rejecting);
  const rejectingHead = head(rejecting);
  const rejected = commitCloseArtifacts(request(rejecting));
  check('engine: rejecting hook returns failed with manual command and no commit', rejected.status === 'failed' && rejected.reason.includes('blocked by policy') && rejected.manualCommand?.includes('git commit --only') && head(rejecting) === rejectingHead, JSON.stringify(rejected));
  const passing = engineRepo('engine-hook-pass');
  const marker = join(tempRoot, 'hook-ran.txt').split('\\').join('/');
  gitIn(passing, 'config', 'core.hooksPath', hookDir('hooks-pass', `echo ran > "${marker}"\nexit 0`).split('\\').join('/'));
  writeClose(passing);
  const passed = commitCloseArtifacts(request(passing));
  check('engine: passing hook runs and the commit succeeds', passed.status === 'committed' && existsSync(marker), JSON.stringify(passed));

  // --- CLI and MCP wiring (S10, S15) ------------------------------------------------------------
  const identityEnv = { GIT_AUTHOR_NAME: 'Kyro Check', GIT_AUTHOR_EMAIL: 'check@kyro.invalid', GIT_COMMITTER_NAME: 'Kyro Check', GIT_COMMITTER_EMAIL: 'check@kyro.invalid' };
  const runIn = (root, args) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', env: cliEnv(root, identityEnv) });
  const leanSprint = { sprint: { n: 1, slug: 's1', title: 'Sprint one', objective: 'Objective.' }, phases: [{ id: 'P1', title: 'Phase', objective: 'Phase objective.', tasks: [{ id: 'T1.1', title: 'Task', description: 'Do it.', files_to_touch: ['src/app.txt'], context: 'None.', acceptance_criteria: ['It is done.'], depends_on: [], scenario_refs: [] }] }], definitionOfDone: ['Done.'] };
  const readyToClose = (name, preference) => {
    const root = workspace(name);
    writeFileSync(join(root, '.home', 'sprint-1.json'), JSON.stringify(leanSprint));
    for (const args of [
      ['plan', '--from', join(root, '.home', 'sprint-1.json'), '--kyro-scope', 'demo'],
      ['record-evidence', 'T1.1', '--kyro-scope', 'demo', '--summary', 'Done.', '--validation', 'manual: ok'],
      ['review', 'T1.1', '--kyro-scope', 'demo', '--verdict', 'pass', '--yes'],
    ]) {
      const result = runIn(root, args);
      if (result.status !== 0) throw new Error(`${args[0]} failed: ${result.stdout}${result.stderr}`);
    }
    // Commit the planned state so the close commit only carries close-written changes.
    gitIn(root, 'add', '-A');
    gitIn(root, 'commit', '-q', '-m', 'planned');
    if (preference !== undefined) setPreference(root, preference);
    return root;
  };
  const jsonData = (result) => {
    try { return JSON.parse(result.stdout).data; } catch { return null; }
  };
  const mcpClose = async (root, confirm, extraEnv = {}) => {
    const child = spawn(process.execPath, [cli, 'mcp', 'serve'], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'], env: cliEnv(root, { ...identityEnv, ...extraEnv }) });
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    const queue = [];
    const waiters = [];
    lines.on('line', (line) => (waiters.length ? waiters.shift()(line) : queue.push(line)));
    const next = () => (queue.length ? Promise.resolve(queue.shift()) : new Promise((done) => waiters.push(done)));
    let id = 1;
    const send = async (method, params) => {
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: id++, method, ...(params === undefined ? {} : { params }) })}\n`);
      return JSON.parse(await next());
    };
    try {
      await send('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'check-sprint-close-commit', version: '1' } });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
      const response = await send('tools/call', { name: 'close_sprint', arguments: { scope: 'demo', outcome: 'shipped', ...(confirm ? { confirm: true } : {}) } });
      return response.result ?? { isError: true, structuredContent: response.error };
    } finally {
      child.stdin.end();
      child.kill('SIGTERM');
      lines.close();
    }
  };

  // Preference true: CLI close commits exactly the close files and reports structured results.
  const cliOn = readyToClose('wire-cli-on', true);
  const cliOnHead = head(cliOn);
  const cliOnRun = runIn(cliOn, ['close-sprint', '--kyro-scope', 'demo', '--yes', '--json']);
  const cliOnData = jsonData(cliOnRun);
  check('cli: close with preference true commits', cliOnRun.status === 0 && cliOnData?.commit?.status === 'committed' && head(cliOn) !== cliOnHead, `${cliOnRun.stdout.slice(0, 800)}${cliOnRun.stderr}`);
  check('cli: close commit is findable by trailer', gitIn(cliOn, 'log', '--grep', 'Kyro-Sprint: 1', '--format=%H') === head(cliOn));
  check('cli: structured git report and warnings', cliOnData?.git?.recorded === true && cliOnData?.git?.endCommit === cliOnHead && Array.isArray(cliOnData?.warnings), JSON.stringify(cliOnData));
  const pendingAfterCommit = gitIn(cliOn, 'status', '--porcelain', '--untracked-files=all', '--', '.agents/kyro/scopes', '.agents/kyro/project.json');
  check('cli: no close-written file is left uncommitted', pendingAfterCommit === '', pendingAfterCommit);
  const cliText = readyToClose('wire-cli-text', true);
  const cliTextRun = runIn(cliText, ['close-sprint', '--kyro-scope', 'demo', '--yes']);
  check('cli: text output reports the close commit', cliTextRun.status === 0 && cliTextRun.stdout.includes('Close commit: '), cliTextRun.stdout);

  // Preference absent or false: no commit, commit null.
  for (const [label, value] of [['absent', undefined], ['false', false]]) {
    const root = readyToClose(`wire-cli-${label}`, value);
    const before = head(root);
    const run = runIn(root, ['close-sprint', '--kyro-scope', 'demo', '--yes', '--json']);
    check(`cli: preference ${label} creates no commit`, run.status === 0 && head(root) === before && jsonData(run)?.commit === null, run.stdout.slice(0, 400));
  }

  // S10: dry run and unconfirmed MCP never commit.
  const dry = readyToClose('wire-dry', true);
  const dryHead = head(dry);
  check('cli: --dry-run creates no commit', runIn(dry, ['close-sprint', '--kyro-scope', 'demo', '--dry-run']).status === 0 && head(dry) === dryHead);
  const unconfirmed = await mcpClose(dry, false);
  check('mcp: unconfirmed close creates no commit', !unconfirmed.isError && head(dry) === dryHead && unconfirmed.structuredContent?.commit === undefined, JSON.stringify(unconfirmed).slice(0, 400));

  // S15: MCP confirmed close matches the CLI result shape.
  const mcpOn = readyToClose('wire-mcp-on', true);
  const mcpOnHead = head(mcpOn);
  const mcpResult = await mcpClose(mcpOn, true);
  const mcpData = mcpResult.structuredContent;
  check('mcp: confirmed close commits', !mcpResult.isError && mcpData?.commit?.status === 'committed' && head(mcpOn) !== mcpOnHead, JSON.stringify(mcpResult).slice(0, 800));
  check('mcp: git report and warnings match the CLI shape',
    JSON.stringify(Object.keys(mcpData?.git ?? {}).sort()) === JSON.stringify(Object.keys(cliOnData?.git ?? {}).sort())
      && JSON.stringify(Object.keys(mcpData?.commit ?? {}).sort()) === JSON.stringify(Object.keys(cliOnData?.commit ?? {}).sort())
      && JSON.stringify(mcpData?.commit?.paths) === JSON.stringify(cliOnData?.commit?.paths)
      && Array.isArray(mcpData?.warnings),
    `${JSON.stringify(mcpData?.git)} ${JSON.stringify(mcpData?.commit)}`);
  check('mcp: internal post-close context is not leaked', mcpResult.structuredContent && !Object.keys(mcpResult.structuredContent).some((key) => key.toLowerCase().includes('postclose')));

  // --- ADR-0001 compatibility advisory (S17) ---------------------------------------------------
  const isAdvisory = (warning) => typeof warning === 'string' && warning.includes('team.minPackageVersion') && warning.includes('6.5.0');
  const withFloor = (root, floor) => {
    const projectPath = join(root, '.agents/kyro/project.json');
    const project = JSON.parse(readFileSync(projectPath, 'utf8'));
    if (floor === undefined) delete project.team;
    else project.team = { ...(project.team ?? {}), minPackageVersion: floor };
    writeFileSync(projectPath, `${JSON.stringify(project, null, 2)}\n`);
    gitIn(root, 'add', '.agents/kyro/project.json');
    gitIn(root, 'commit', '-q', '--allow-empty', '-m', 'team floor');
    return projectPath;
  };
  for (const [label, floor, expected] of [['unset', undefined, true], ['6.4.1', '6.4.1', true], ['6.5.0', '6.5.0', false], ['6.6.0', '6.6.0', false]]) {
    const root = readyToClose(`advisory-${label}`, undefined);
    const projectPath = withFloor(root, floor);
    const before = readFileSync(projectPath);
    const run = runIn(root, ['close-sprint', '--kyro-scope', 'demo', '--yes', '--json']);
    const warnings = jsonData(run)?.warnings ?? [];
    check(`advisory: floor ${label} ${expected ? 'warns' : 'does not warn'}`, run.status === 0 && warnings.some(isAdvisory) === expected, JSON.stringify(warnings));
    // Layered closes never write project.json (the scope entry is derived); the advisory must never touch the team floor.
    const after = JSON.parse(readFileSync(projectPath, 'utf8'));
    check(`advisory: floor ${label} leaves team policy unchanged`, JSON.stringify(after.team) === JSON.stringify(JSON.parse(before.toString()).team), JSON.stringify(after.team));
  }
  const textAdvisory = readyToClose('advisory-text', undefined);
  const textRun = runIn(textAdvisory, ['close-sprint', '--kyro-scope', 'demo', '--yes']);
  check('advisory: text output shows the advisory', textRun.stdout.includes('team.minPackageVersion'), textRun.stdout);
  check('advisory: MCP close carries the same advisory', (mcpData?.warnings ?? []).some(isAdvisory), JSON.stringify(mcpData?.warnings));

  // No close.git (non-repository workspace): no advisory.
  const plainClose = workspace('advisory-no-git', { git: false });
  writeFileSync(join(plainClose, '.home', 'sprint-1.json'), JSON.stringify(leanSprint));
  for (const args of [
    ['plan', '--from', join(plainClose, '.home', 'sprint-1.json'), '--kyro-scope', 'demo'],
    ['record-evidence', 'T1.1', '--kyro-scope', 'demo', '--summary', 'Done.', '--validation', 'manual: ok'],
    ['review', 'T1.1', '--kyro-scope', 'demo', '--verdict', 'pass', '--yes'],
  ]) runIn(plainClose, args);
  const plainRun = runIn(plainClose, ['close-sprint', '--kyro-scope', 'demo', '--yes', '--json']);
  check('advisory: no git data means no advisory', plainRun.status === 0 && !(jsonData(plainRun)?.warnings ?? []).some(isAdvisory) && jsonData(plainRun)?.git?.recorded === false, plainRun.stdout.slice(0, 500));

  // --- QA remediation: exact write set (M1) and monorepo subdirectory workspaces (M2) -----------
  const dirtyProject = readyToClose('m1-dirty-project-json', true);
  const projectFile = join(dirtyProject, '.agents/kyro/project.json');
  const project = JSON.parse(readFileSync(projectFile, 'utf8'));
  project.team = { minPackageVersion: '9.9.9-user-uncommitted' };
  writeFileSync(projectFile, `${JSON.stringify(project, null, 2)}\n`);
  const m1Run = runIn(dirtyProject, ['close-sprint', '--kyro-scope', 'demo', '--yes', '--json']);
  const m1Data = jsonData(m1Run);
  const m1Committed = gitIn(dirtyProject, 'show', '--name-only', '--format=', 'HEAD').split('\n').filter(Boolean);
  check('M1: close commits without project.json', m1Data?.commit?.status === 'committed' && !m1Committed.includes('.agents/kyro/project.json') && !(m1Data?.commit?.paths ?? []).includes('.agents/kyro/project.json'), JSON.stringify(m1Committed));
  check('M1: user project.json edit stays unstaged and uncommitted', gitIn(dirtyProject, 'diff', '--name-only').split('\n').includes('.agents/kyro/project.json') && gitIn(dirtyProject, 'diff', '--cached', '--name-only') === '', gitIn(dirtyProject, 'status', '--porcelain'));

  const monoRoot = join(tempRoot, 'm2-monorepo');
  mkdirSync(monoRoot);
  gitIn(monoRoot, 'init', '-q');
  gitIn(monoRoot, 'checkout', '-q', '-b', 'main');
  writeFileSync(join(monoRoot, 'README.md'), '# mono\n');
  gitIn(monoRoot, 'add', 'README.md');
  gitIn(monoRoot, 'commit', '-q', '-m', 'root');
  const monoApp = workspace('m2-monorepo/packages/app', { git: false });
  writeFileSync(join(monoApp, '.home', 'sprint-1.json'), JSON.stringify(leanSprint));
  for (const args of [
    ['plan', '--from', join(monoApp, '.home', 'sprint-1.json'), '--kyro-scope', 'demo'],
    ['record-evidence', 'T1.1', '--kyro-scope', 'demo', '--summary', 'Done.', '--validation', 'manual: ok'],
    ['review', 'T1.1', '--kyro-scope', 'demo', '--verdict', 'pass', '--yes'],
  ]) {
    const result = runIn(monoApp, args);
    if (result.status !== 0) throw new Error(`${args[0]} failed in monorepo: ${result.stdout}${result.stderr}`);
  }
  gitIn(monoRoot, 'add', '-A');
  gitIn(monoRoot, 'commit', '-q', '-m', 'planned app');
  setPreference(monoApp, true);
  const m2Head = gitIn(monoRoot, 'rev-parse', 'HEAD');
  const m2Run = runIn(monoApp, ['close-sprint', '--kyro-scope', 'demo', '--yes', '--json']);
  const m2Data = jsonData(m2Run);
  const m2Committed = gitIn(monoRoot, 'show', '--name-only', '--format=', 'HEAD').split('\n').filter(Boolean);
  check('M2: subdirectory workspace close commits', m2Data?.commit?.status === 'committed' && gitIn(monoRoot, 'rev-parse', 'HEAD') !== m2Head, JSON.stringify(m2Data?.commit));
  check('M2: committed paths are the prefixed close files', m2Committed.length === 4 && m2Committed.every((path) => path.startsWith('packages/app/.agents/kyro/scopes/demo/')), JSON.stringify(m2Committed));

  // --- QA remediation: manual command safety and portability, guarded post-close (m1–m4) --------
  const hostileTitle = `it's $(touch PWNED) \`id\` "q" ; echo hi`;
  const manualRepo = engineRepo('m4-manual-command');
  gitIn(manualRepo, 'config', 'core.hooksPath', hookDir('hooks-reject-manual', 'exit 1').split('\\').join('/'));
  writeClose(manualRepo);
  const manualFailed = commitCloseArtifacts({ ...request(manualRepo), title: hostileTitle });
  check('manual: failed result carries a command', manualFailed.status === 'failed' && typeof manualFailed.manualCommand === 'string', JSON.stringify(manualFailed));
  check('manual: command passes trailers with --trailer and no embedded newline', manualFailed.manualCommand.includes('--trailer') && !manualFailed.manualCommand.includes('\n'), manualFailed.manualCommand);
  gitIn(manualRepo, 'config', 'core.hooksPath', emptyHooks.split('\\').join('/'));
  const windows = process.platform === 'win32';
  const shell = windows
    ? (spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', 'exit 0']).status === 0 ? 'pwsh' : 'powershell.exe')
    : 'bash';
  const shellArgs = windows ? ['-NoProfile', '-NonInteractive', '-Command'] : ['-c'];
  const manualRun = spawnSync(shell, [...shellArgs, manualFailed.manualCommand], { cwd: manualRepo, encoding: 'utf8', env: { ...process.env, ...identityEnv } });
  check(`manual: command succeeds in ${shell}`, manualRun.status === 0, `${manualRun.stdout}${manualRun.stderr}${manualRun.error ?? ''}`);
  check('manual: hostile title is not executed', !existsSync(join(manualRepo, 'PWNED')));
  check('manual: subject is exact', gitIn(manualRepo, 'log', '-1', '--format=%s') === `chore(kyro): close demo sprint 1 — ${hostileTitle}`, gitIn(manualRepo, 'log', '-1', '--format=%s'));
  const manualTrailers = spawnSync('git', ['interpret-trailers', '--parse'], { input: gitIn(manualRepo, 'log', '-1', '--format=%B'), encoding: 'utf8' }).stdout;
  check('manual: trailers parse', manualTrailers.includes('Kyro-Scope: demo') && manualTrailers.includes('Kyro-Sprint: 1'), manualTrailers);
  const powershell = buildManualCommand(['a b.json'], 'demo', 1, "it's", 'win32');
  check('manual: Windows form uses PowerShell quoting and no &&', powershell.includes("'it''s'") === false && powershell.includes("it''s") && powershell.includes('; if ($?) {') && !powershell.includes('&&'), powershell);

  // A NUL in cwd makes spawnSync throw before git runs; recovery still normalizes paths.
  const exceptionPaths = [closePaths[0].split('/').join('\\'), closePaths[0]];
  const engineException = commitCloseArtifacts({ ...request(`${manualRepo}\0`), paths: exceptionPaths, title: hostileTitle });
  check('engine: unexpected exception retains a normalized recovery command', engineException.status === 'failed'
    && engineException.reason.startsWith('unexpected error:')
    && engineException.manualCommand === buildManualCommand([closePaths[0]], 'demo', 1, hostileTitle), JSON.stringify(engineException));

  // m2: an error after the close is applied is a warning, not a failed command.
  const postFail = readyToClose('m2-post-close-fail', true);
  const postFailRun = spawnSync(process.execPath, [cli, 'close-sprint', '--kyro-scope', 'demo', '--yes', '--json'], { cwd: postFail, encoding: 'utf8', env: cliEnv(postFail, { ...identityEnv, KYRO_TEST_POST_CLOSE_FAIL: 'commit' }) });
  const postFailData = jsonData(postFailRun);
  const postFailSprint = JSON.parse(readFileSync(join(postFail, '.agents/kyro/scopes/demo/sprint.json'), 'utf8'));
  check('post-close: CLI exits 0 with a warning when a post-close step fails', postFailRun.status === 0 && (postFailData?.warnings ?? []).some((w) => w.startsWith('Post-close commit failed')) && postFailData?.commit?.status === 'failed', `${postFailRun.stdout.slice(0, 600)}${postFailRun.stderr}`);
  check('post-close: failed commit step retains a recovery command', typeof postFailData?.commit?.manualCommand === 'string'
    && postFailData.commit.manualCommand.trim().length > 0
    && postFailData.commit.manualCommand.includes('git commit --only'), JSON.stringify(postFailData?.commit));
  check('post-close: sprint stays closed', postFailSprint.activeSprint === null && postFailSprint.ledger.length === 1);
  const postFailMcpRoot = readyToClose('m2-post-close-fail-mcp', true);
  const postFailMcp = await mcpClose(postFailMcpRoot, true, { KYRO_TEST_POST_CLOSE_FAIL: 'advisory' });
  check('post-close: MCP returns a non-error result with the warning', !postFailMcp.isError && (postFailMcp.structuredContent?.warnings ?? []).some((w) => w.startsWith('Post-close advisory failed')), JSON.stringify(postFailMcp).slice(0, 600));
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`Sprint close commit check failed (${failures.length}):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log('Sprint close commit check passed (preference, engine, wiring, advisory, write set, hardening).');
