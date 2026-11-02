#!/usr/bin/env node
// Sprint git traceability: optional git blocks on activeSprint, close inputs, and ledger entries.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = resolve(fileURLToPath(import.meta.url), '../..');
const cli = resolve(repo, 'dist/cli.js');
const load = (path) => import(pathToFileURL(resolve(repo, 'dist/cli', path)).href);
const { validateSprintFile } = await load('artifacts/schema.js');
const { checkpointSchemaIssues, checkpointIntegrityIssues } = await load('checkpoints/sprint-close.js');
const { readGitHead, hasUncommittedChangesOutsideKyro, captureSprintGitStart, captureSprintGitEnd } = await load('core/git-capture.js');

const failures = [];
const check = (name, condition, detail = '') => {
  if (!condition) failures.push(`${name}${detail ? `: ${detail}` : ''}`);
};
const clone = (value) => JSON.parse(JSON.stringify(value));
const readJson = (path) => JSON.parse(readFileSync(resolve(repo, path), 'utf8'));
const fields = (issues) => issues.map((issue) => issue.field);

const SHA1 = 'a'.repeat(40);
const SHA256 = 'b'.repeat(64);

// --- Contract: activeSprint.git and ledger[].git -------------------------------------------
const baseSprint = readJson('fixtures/evals/close-sprint-happy/state/.agents/kyro/scopes/demo/sprint.json');
check('fixture sprint is valid', validateSprintFile(baseSprint, 'fixture').length === 0, JSON.stringify(validateSprintFile(baseSprint, 'fixture')));

const ledgerEntry = { n: 9, slug: 'x', outcome: 'shipped', closedAt: '2026-10-30', archive: 'archive/sprint-009-x.md' };
const withStart = (git) => {
  const sprint = clone(baseSprint);
  sprint.activeSprint.git = git;
  return validateSprintFile(sprint, 'start');
};
const withLedger = (git) => {
  const sprint = clone(baseSprint);
  sprint.ledger = [{ ...ledgerEntry, git }];
  return validateSprintFile(sprint, 'ledger');
};

check('start: sha1 + branch accepted', withStart({ branch: 'develop', startCommit: SHA1 }).length === 0);
check('start: sha256 + detached accepted', withStart({ branch: null, startCommit: SHA256 }).length === 0);
for (const [label, git, field] of [
  ['short commit', { branch: 'main', startCommit: 'abc123' }, 'activeSprint.git.startCommit'],
  ['uppercase commit', { branch: 'main', startCommit: 'A'.repeat(40) }, 'activeSprint.git.startCommit'],
  ['non-hex commit', { branch: 'main', startCommit: 'z'.repeat(40) }, 'activeSprint.git.startCommit'],
  ['empty branch', { branch: '', startCommit: SHA1 }, 'activeSprint.git.branch'],
  ['missing branch', { startCommit: SHA1 }, 'activeSprint.git.branch'],
  ['non-object', 'abc', 'activeSprint.git'],
]) {
  const issues = withStart(git);
  check(`start: ${label} rejected on ${field}`, fields(issues).includes(field), JSON.stringify(issues));
}

check('ledger: full range accepted', withLedger({ branch: 'develop', startCommit: SHA1, endCommit: SHA1, dirty: false }).length === 0);
check('ledger: null startCommit accepted', withLedger({ branch: null, startCommit: null, endCommit: SHA256, dirty: true }).length === 0);
check('ledger: entry without git accepted', (() => {
  const sprint = clone(baseSprint);
  sprint.ledger = [ledgerEntry];
  return validateSprintFile(sprint, 'ledger').length === 0;
})());
for (const [label, git, field] of [
  ['null endCommit', { branch: 'main', startCommit: SHA1, endCommit: null, dirty: false }, 'ledger[0].git.endCommit'],
  ['bad startCommit', { branch: 'main', startCommit: 'xyz', endCommit: SHA1, dirty: false }, 'ledger[0].git.startCommit'],
  ['string dirty', { branch: 'main', startCommit: SHA1, endCommit: SHA1, dirty: 'no' }, 'ledger[0].git.dirty'],
  ['missing dirty', { branch: 'main', startCommit: SHA1, endCommit: SHA1 }, 'ledger[0].git.dirty'],
]) {
  const issues = withLedger(git);
  check(`ledger: ${label} rejected on ${field}`, fields(issues).includes(field), JSON.stringify(issues));
}

// --- Contract: checkpoint close.git ----------------------------------------------------------
const checkpointPath = '.agents/kyro/scopes/adaptive-sprint-lifecycle/archive/sprint-001-lifecycle-contract.checkpoint.json';
const checkpoint = readJson(checkpointPath);
const baselineSchema = checkpointSchemaIssues(checkpoint, 'cp');
const withClose = (git) => {
  const value = clone(checkpoint);
  if (git === undefined) delete value.close.git;
  else value.close.git = git;
  return checkpointSchemaIssues(value, 'cp');
};
check('checkpoint: legacy close without git adds no schema issue', withClose(undefined).length === baselineSchema.length);
check('checkpoint: valid close.git adds no schema issue', withClose({ branch: 'develop', endCommit: SHA1, dirty: false }).length === baselineSchema.length);
for (const [label, git] of [
  ['bad endCommit', { branch: 'develop', endCommit: 'nope', dirty: false }],
  ['missing dirty', { branch: 'develop', endCommit: SHA1 }],
  ['empty branch', { branch: '', endCommit: SHA1, dirty: true }],
]) {
  const issues = withClose(git);
  check(`checkpoint: ${label} rejected`, issues.length > baselineSchema.length && issues.some((issue) => issue.includes('close.git')), JSON.stringify(issues));
}

// --- Contract: every real scope and checkpoint in this repository still validates ------------
const scopesRoot = resolve(repo, '.agents/kyro/scopes');
let scopeCount = 0;
let checkpointCount = 0;
for (const scope of readdirSync(scopesRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
  let sprint;
  try {
    sprint = JSON.parse(readFileSync(resolve(scopesRoot, scope.name, 'sprint.json'), 'utf8'));
  } catch {
    continue;
  }
  scopeCount += 1;
  const issues = validateSprintFile(sprint, scope.name).filter((issue) => issue.field.includes('git'));
  check(`repo scope ${scope.name}: no git issues`, issues.length === 0, JSON.stringify(issues));
  let archive = [];
  try {
    archive = readdirSync(resolve(scopesRoot, scope.name, 'archive')).filter((name) => name.endsWith('.checkpoint.json'));
  } catch {
    archive = [];
  }
  for (const name of archive) {
    checkpointCount += 1;
    const value = JSON.parse(readFileSync(resolve(scopesRoot, scope.name, 'archive', name), 'utf8'));
    const issues = checkpointSchemaIssues(value, name).filter((issue) => issue.includes('git'));
    check(`repo checkpoint ${scope.name}/${name}: no git issues`, issues.length === 0, JSON.stringify(issues));
    const previous = process.cwd();
    process.chdir(repo);
    try {
      const relative = `.agents/kyro/scopes/${scope.name}/archive/${name}`;
      const integrity = checkpointIntegrityIssues(value, relative);
      check(`repo checkpoint ${scope.name}/${name}: legacy re-derivation still verifies`, integrity.length === 0, JSON.stringify(integrity));
    } finally {
      process.chdir(previous);
    }
  }
}

// --- Read-only git capture (temporary repositories) -----------------------------------------
const tempRoot = mkdtempSync(join(tmpdir(), 'kyro-sprint-git-'));
const emptyHooks = join(tempRoot, 'no-hooks');
mkdirSync(emptyHooks);
const gitIn = (cwd, ...args) => {
  const result = spawnSync('git', ['-c', 'user.name=Kyro Check', '-c', 'user.email=check@kyro.invalid', '-c', 'commit.gpgsign=false', '-c', `core.hooksPath=${emptyHooks}`, ...args], { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${result.stderr}`);
  return result.stdout.trim();
};
const newRepo = (name) => {
  const dir = join(tempRoot, name);
  mkdirSync(dir, { recursive: true });
  gitIn(dir, 'init', '-q');
  gitIn(dir, 'checkout', '-q', '-b', 'main');
  return dir;
};
const commitFile = (dir, file, content) => {
  mkdirSync(join(dir, file, '..'), { recursive: true });
  writeFileSync(join(dir, file), content);
  gitIn(dir, 'add', '--', file);
  gitIn(dir, 'commit', '-q', '-m', `add ${file}`);
};

try {
  const nonRepo = join(tempRoot, 'plain');
  mkdirSync(nonRepo);
  check('capture: non-repository returns null head', readGitHead(nonRepo) === null);
  check('capture: non-repository returns null start/end', captureSprintGitStart(nonRepo) === null && captureSprintGitEnd(nonRepo) === null);
  check('capture: missing cwd does not throw', readGitHead(join(tempRoot, 'does-not-exist')) === null && hasUncommittedChangesOutsideKyro(join(tempRoot, 'does-not-exist')) === null);

  const unborn = newRepo('unborn');
  check('capture: unborn HEAD returns null', readGitHead(unborn) === null && captureSprintGitEnd(unborn) === null);

  const repoDir = newRepo('normal');
  writeFileSync(join(repoDir, '.gitignore'), 'tmp/\n');
  commitFile(repoDir, 'src/app.txt', 'v1\n');
  commitFile(repoDir, '.agents/kyro/scopes/demo/sprint.json', '{}\n');
  gitIn(repoDir, 'add', '.gitignore');
  gitIn(repoDir, 'commit', '-q', '-m', 'ignore');
  const head = gitIn(repoDir, 'rev-parse', 'HEAD');
  const start = captureSprintGitStart(repoDir);
  check('capture: branch and HEAD on a normal branch', start?.branch === 'main' && start?.startCommit === head, JSON.stringify(start));
  check('capture: clean tree is not dirty', captureSprintGitEnd(repoDir)?.dirty === false);

  writeFileSync(join(repoDir, '.agents/kyro/scopes/demo/sprint.json'), '{"changed":true}\n');
  writeFileSync(join(repoDir, '.agents/kyro/scopes/demo/new.json'), '{}\n');
  mkdirSync(join(repoDir, 'tmp'));
  writeFileSync(join(repoDir, 'tmp/ignored.log'), 'x\n');
  mkdirSync(join(repoDir, '.kyro-state-writer.lock'));
  writeFileSync(join(repoDir, '.kyro-state-writer.lock/owner.json'), '{}\n');
  check('capture: only .agents/kyro, the state-writer lock, and ignored changes are not dirty', hasUncommittedChangesOutsideKyro(repoDir) === false);
  rmSync(join(repoDir, '.kyro-state-writer.lock'), { recursive: true });

  writeFileSync(join(repoDir, 'src/app.txt'), 'v2\n');
  check('capture: modified tracked file is dirty', captureSprintGitEnd(repoDir)?.dirty === true);
  gitIn(repoDir, 'checkout', '-q', '--', 'src/app.txt');
  writeFileSync(join(repoDir, 'src/new-file.txt'), 'new\n');
  check('capture: untracked non-ignored file is dirty', hasUncommittedChangesOutsideKyro(repoDir) === true);
  rmSync(join(repoDir, 'src/new-file.txt'));

  mkdirSync(join(repoDir, '.kyro-state-writer.lock.reclaim-1234'));
  writeFileSync(join(repoDir, '.kyro-state-writer.lock.reclaim-1234/owner.json'), '{}\n');
  check('capture: leftover lock reclaim directories are not dirty', hasUncommittedChangesOutsideKyro(repoDir) === false);
  rmSync(join(repoDir, '.kyro-state-writer.lock.reclaim-1234'), { recursive: true });

  // A stat-only change makes a plain `git status` rewrite .git/index; capture must not.
  const future = new Date(Date.now() + 120_000);
  utimesSync(join(repoDir, 'src/app.txt'), future, future);
  const indexBefore = statSync(join(repoDir, '.git/index')).mtimeMs;
  captureSprintGitEnd(repoDir);
  check('capture: leaves .git/index untouched', statSync(join(repoDir, '.git/index')).mtimeMs === indexBefore);

  gitIn(repoDir, 'checkout', '-q', '--detach');
  const detached = captureSprintGitEnd(repoDir);
  check('capture: detached HEAD has null branch', detached?.branch === null && detached?.endCommit === head, JSON.stringify(detached));

  // Kyro workspace in a subdirectory of the repository: only that workspace's .agents/kyro/ is excluded.
  const mono = newRepo('mono');
  commitFile(mono, 'pkg/src/a.txt', 'a\n');
  commitFile(mono, 'pkg/.agents/kyro/scopes/s/sprint.json', '{}\n');
  writeFileSync(join(mono, 'pkg/.agents/kyro/scopes/s/sprint.json'), '{"x":1}\n');
  const monoWorkspace = join(mono, 'pkg');
  check('capture: subdirectory workspace excludes its own .agents/kyro', hasUncommittedChangesOutsideKyro(monoWorkspace) === false);
  writeFileSync(join(mono, 'other.txt'), 'x\n');
  check('capture: subdirectory workspace still sees repo changes elsewhere', hasUncommittedChangesOutsideKyro(monoWorkspace) === true);

  // --- Plan capture: startCommit recorded when a sprint is planned ----------------------------
  const workspace = (name, { git }) => {
    const root = join(tempRoot, name);
    mkdirSync(join(root, '.home'), { recursive: true });
    mkdirSync(join(root, '.agents/kyro'), { recursive: true });
    writeFileSync(join(root, '.home', 'gitconfig-empty'), '');
    writeFileSync(join(root, '.agents/kyro/kyro.json'), `${JSON.stringify({ schemaVersion: 4, artifactRoot: '.agents/kyro/scopes', scopes: [], activeScope: null, runtimePath: '~/.agents/kyro/current', installedAdapters: [] }, null, 2)}\n`);
    writeFileSync(join(root, '.gitignore'), '.home/\n');
    if (git) {
      gitIn(root, 'init', '-q');
      gitIn(root, 'checkout', '-q', '-b', 'main');
      gitIn(root, 'add', '.gitignore');
      commitFile(root, 'src/app.txt', 'v1\n');
    }
    return root;
  };
  const runCli = (root, ...args) => {
    const emptyConfig = join(root, '.home', 'gitconfig-empty');
    return spawnSync(process.execPath, [cli, ...args], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, HOME: join(root, '.home'), GIT_CONFIG_GLOBAL: emptyConfig, GIT_CONFIG_SYSTEM: emptyConfig, GIT_CONFIG_NOSYSTEM: '1' },
    });
  };
  const leanInit = { scope: 'demo', title: 'Demo', objective: 'Demo objective.', successCriteria: ['Demo works.'], roadmap: { plannedSprintCount: 2, sprints: [{ n: 1, slug: 's1', title: 'Sprint one' }, { n: 2, slug: 's2', title: 'Sprint two' }] } };
  const leanSprint = (n) => ({
    sprint: { n, slug: `s${n}`, title: n === 1 ? 'Sprint one' : 'Sprint two', objective: `Objective ${n}.` },
    phases: [{ id: 'P1', title: 'Phase', objective: 'Phase objective.', tasks: [{ id: `T${n}.1`, title: 'Task', description: 'Do it.', files_to_touch: ['src/app.txt'], context: 'None.', acceptance_criteria: ['It is done.'], depends_on: [], scenario_refs: [] }] }],
    definitionOfDone: ['Done.'],
  });
  let lastPlanOutput = '';
  const planSprint = (root, n, initPlan = leanInit) => {
    if (n === 1) {
      writeFileSync(join(root, '.home', 'init.json'), JSON.stringify(initPlan));
      const init = runCli(root, 'plan', '--from', join(root, '.home', 'init.json'));
      if (init.status !== 0) throw new Error(`plan init failed: ${init.stdout}${init.stderr}`);
    }
    writeFileSync(join(root, '.home', `sprint-${n}.json`), JSON.stringify(leanSprint(n)));
    const result = runCli(root, 'plan', '--from', join(root, '.home', `sprint-${n}.json`), '--kyro-scope', 'demo');
    if (result.status !== 0) throw new Error(`plan sprint ${n} failed: ${result.stdout}${result.stderr}`);
    lastPlanOutput = result.stdout;
    return JSON.parse(readFileSync(join(root, '.agents/kyro/scopes/demo/sprint.json'), 'utf8'));
  };

  const planned = workspace('plan-git', { git: true });
  const planHead = gitIn(planned, 'rev-parse', 'HEAD');
  const plannedSprint = planSprint(planned, 1);
  check('plan: activeSprint.git records branch and HEAD', plannedSprint.activeSprint?.git?.branch === 'main' && plannedSprint.activeSprint?.git?.startCommit === planHead, JSON.stringify(plannedSprint.activeSprint?.git));
  check('plan: planned sprint with git validates', validateSprintFile(plannedSprint, 'planned').length === 0);
  check('plan: output reports the recorded git start', lastPlanOutput.includes(`Git start: main @ ${planHead.slice(0, 12)}`), lastPlanOutput);

  const plainWorkspace = workspace('plan-plain', { git: false });
  const plainSprint = planSprint(plainWorkspace, 1);
  check('plan: non-repository planning succeeds without git block', plainSprint.activeSprint && !('git' in plainSprint.activeSprint));
  check('plan: non-repository output says not recorded with the reason', lastPlanOutput.includes('Git start: not recorded (not a git repository'), lastPlanOutput);

  const unbornPlan = workspace('plan-unborn', { git: false });
  gitIn(unbornPlan, 'init', '-q');
  const unbornSprint = planSprint(unbornPlan, 1);
  check('plan: repository without commits plans without git block', unbornSprint.activeSprint && !('git' in unbornSprint.activeSprint));
  check('plan: repository without commits reports no commits yet', lastPlanOutput.includes('Git start: not recorded (no commits yet)'), lastPlanOutput);

  const jsonPlan = workspace('plan-json', { git: true });
  const jsonHead = gitIn(jsonPlan, 'rev-parse', 'HEAD');
  writeFileSync(join(jsonPlan, '.home', 'init.json'), JSON.stringify(leanInit));
  runCli(jsonPlan, 'plan', '--from', join(jsonPlan, '.home', 'init.json'));
  writeFileSync(join(jsonPlan, '.home', 'sprint-1.json'), JSON.stringify(leanSprint(1)));
  const jsonRun = runCli(jsonPlan, 'plan', '--from', join(jsonPlan, '.home', 'sprint-1.json'), '--kyro-scope', 'demo', '--json');
  let jsonData = null;
  try { jsonData = JSON.parse(jsonRun.stdout).data; } catch { jsonData = null; }
  check('plan --json: structured git outcome is exposed', jsonData?.git?.recorded === true && jsonData?.git?.startCommit === jsonHead && jsonData?.git?.branch === 'main', jsonRun.stdout.slice(0, 600));
  const jsonPlain = workspace('plan-json-plain', { git: false });
  writeFileSync(join(jsonPlain, '.home', 'init.json'), JSON.stringify(leanInit));
  runCli(jsonPlain, 'plan', '--from', join(jsonPlain, '.home', 'init.json'));
  writeFileSync(join(jsonPlain, '.home', 'sprint-1.json'), JSON.stringify(leanSprint(1)));
  const jsonPlainRun = runCli(jsonPlain, 'plan', '--from', join(jsonPlain, '.home', 'sprint-1.json'), '--kyro-scope', 'demo', '--dry-run', '--json');
  let jsonPlainData = null;
  try { jsonPlainData = JSON.parse(jsonPlainRun.stdout).data; } catch { jsonPlainData = null; }
  check('plan --json: not-recorded outcome carries the reason', jsonPlainData?.git?.recorded === false && typeof jsonPlainData?.git?.reason === 'string', jsonPlainRun.stdout.slice(0, 600));

  // --- Close capture: endCommit frozen in close inputs, ledger range derived ------------------
  const finishTask = (root, id) => {
    const evidence = runCli(root, 'record-evidence', id, '--kyro-scope', 'demo', '--summary', 'Done.', '--validation', 'manual: ok');
    if (evidence.status !== 0) throw new Error(`record-evidence failed: ${evidence.stdout}${evidence.stderr}`);
    const review = runCli(root, 'review', id, '--kyro-scope', 'demo', '--verdict', 'pass', '--yes');
    if (review.status !== 0) throw new Error(`review failed: ${review.stdout}${review.stderr}`);
  };
  const closeSprint = (root, env = {}) => spawnSync(process.execPath, [cli, 'close-sprint', '--kyro-scope', 'demo', '--yes'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, HOME: join(root, '.home'), GIT_CONFIG_GLOBAL: join(root, '.home', 'gitconfig-empty'), GIT_CONFIG_SYSTEM: join(root, '.home', 'gitconfig-empty'), GIT_CONFIG_NOSYSTEM: '1', ...env },
  });
  const readScope = (root) => JSON.parse(readFileSync(join(root, '.agents/kyro/scopes/demo/sprint.json'), 'utf8'));
  const checkpointIssuesIn = (root, ledgerEntry) => {
    if (!ledgerEntry?.checkpoint) return ['no closed ledger entry with a checkpoint'];
    const previous = process.cwd();
    process.chdir(root);
    try {
      const relative = `.agents/kyro/scopes/demo/${ledgerEntry.checkpoint}`;
      return checkpointIntegrityIssues(JSON.parse(readFileSync(relative, 'utf8')), relative);
    } finally {
      process.chdir(previous);
    }
  };

  // S3: normal close records the full range and the checkpoint re-derives identically.
  const closed = workspace('close-git', { git: true });
  const closedStart = gitIn(closed, 'rev-parse', 'HEAD');
  planSprint(closed, 1);
  commitFile(closed, 'src/feature.txt', 'feature\n');
  const closedEnd = gitIn(closed, 'rev-parse', 'HEAD');
  finishTask(closed, 'T1.1');
  const closeRun = closeSprint(closed);
  check('close: succeeds in a git repository', closeRun.status === 0, `${closeRun.stdout}${closeRun.stderr}`);
  check('close: prints the git range', closeRun.stdout.includes('Git range: main'), closeRun.stdout);
  const closedLedger = readScope(closed).ledger[0];
  check('close: ledger records branch, startCommit, endCommit before close, dirty false',
    closedLedger?.git?.branch === 'main' && closedLedger?.git?.startCommit === closedStart && closedLedger?.git?.endCommit === closedEnd && closedLedger?.git?.dirty === false,
    JSON.stringify(closedLedger?.git));
  check('close: closed scope validates', validateSprintFile(readScope(closed), 'closed').length === 0);
  check('close: new checkpoint re-derives with no integrity issues', checkpointIssuesIn(closed, closedLedger).length === 0, JSON.stringify(checkpointIssuesIn(closed, closedLedger)));
  const closedNarrative = readFileSync(join(closed, '.agents/kyro/scopes/demo', closedLedger.archive), 'utf8');
  check('close: narrative renders the git range', closedNarrative.includes('## Git range') && closedNarrative.includes(closedEnd) && closedNarrative.includes(closedStart));

  // S4: interrupted close + new commit; the retry keeps the original endCommit.
  const retried = workspace('close-retry', { git: true });
  planSprint(retried, 1);
  commitFile(retried, 'src/feature.txt', 'feature\n');
  const retriedEnd = gitIn(retried, 'rev-parse', 'HEAD');
  finishTask(retried, 'T1.1');
  const interrupted = closeSprint(retried, { KYRO_TEST_CLOSE_FAIL_AFTER: 'checkpoint' });
  check('retry: injected interruption fails the first close', interrupted.status === 1 && interrupted.stderr.includes('Injected close failure after checkpoint'), `${interrupted.stdout}${interrupted.stderr}`);
  commitFile(retried, 'src/after-interruption.txt', 'later\n');
  const retryRun = closeSprint(retried);
  check('retry: resumes without CHECKPOINT_CONFLICT', retryRun.status === 0 && !`${retryRun.stdout}${retryRun.stderr}`.includes('CHECKPOINT_CONFLICT'), `${retryRun.stdout}${retryRun.stderr}`);
  const retriedLedger = readScope(retried).ledger[0];
  check('retry: original endCommit is kept', retriedLedger?.git?.endCommit === retriedEnd, JSON.stringify(retriedLedger?.git));
  check('retry: checkpoint re-derives with no integrity issues', checkpointIssuesIn(retried, retriedLedger).length === 0);

  // S6: uncommitted code at close marks the range dirty and warns.
  const dirtyRoot = workspace('close-dirty', { git: true });
  planSprint(dirtyRoot, 1);
  writeFileSync(join(dirtyRoot, 'src/app.txt'), 'uncommitted\n');
  finishTask(dirtyRoot, 'T1.1');
  const dirtyRun = closeSprint(dirtyRoot);
  check('dirty: close warns about uncommitted changes', dirtyRun.status === 0 && dirtyRun.stdout.includes('Uncommitted changes outside .agents/kyro/'), dirtyRun.stdout);
  check('dirty: ledger dirty is true', readScope(dirtyRoot).ledger[0]?.git?.dirty === true);

  // Sprint planned without git capture, closed inside a repository: startCommit null.
  const lateGit = workspace('close-late-git', { git: false });
  planSprint(lateGit, 1);
  gitIn(lateGit, 'init', '-q');
  gitIn(lateGit, 'checkout', '-q', '-b', 'main');
  gitIn(lateGit, 'add', '.gitignore');
  commitFile(lateGit, 'src/app.txt', 'v1\n');
  finishTask(lateGit, 'T1.1');
  check('late git: close succeeds', closeSprint(lateGit).status === 0);
  const lateLedger = readScope(lateGit).ledger[0];
  check('late git: startCommit is null and endCommit recorded', lateLedger?.git?.startCommit === null && lateLedger?.git?.endCommit === gitIn(lateGit, 'rev-parse', 'HEAD'), JSON.stringify(lateLedger?.git));
  check('late git: checkpoint re-derives with no integrity issues', checkpointIssuesIn(lateGit, lateLedger).length === 0);

  // Valid HEAD but failing git status: the close reports the status failure, not a missing repository.
  const brokenStatus = workspace('close-status-failure', { git: true });
  planSprint(brokenStatus, 1);
  finishTask(brokenStatus, 'T1.1');
  writeFileSync(join(brokenStatus, '.git/index'), 'not an index');
  const brokenRun = closeSprint(brokenStatus);
  check('status failure: close succeeds', brokenRun.status === 0, `${brokenRun.stdout}${brokenRun.stderr}`);
  check('status failure: close reports the status failure', brokenRun.stdout.includes('Git range: not recorded (git status failed or timed out)'), brokenRun.stdout);
  check('status failure: ledger has no git key', !('git' in (readScope(brokenStatus).ledger[0] ?? { git: true })));

  // S5: non-repository close succeeds without git data and says so.
  finishTask(plainWorkspace, 'T1.1');
  const plainClose = closeSprint(plainWorkspace);
  check('no repo: close succeeds and reports no git range', plainClose.status === 0 && plainClose.stdout.includes('Git range: not recorded'), `${plainClose.stdout}${plainClose.stderr}`);
  const plainLedger = readScope(plainWorkspace).ledger[0];
  check('no repo: ledger has no git key', plainLedger && !('git' in plainLedger));
  check('no repo: checkpoint re-derives with no integrity issues', checkpointIssuesIn(plainWorkspace, plainLedger).length === 0);

  // --- Preservation: writers keep activeSprint.git and ledger[].git (S8) ---------------------
  const preserve = workspace('preserve', { git: true });
  const oneSprintInit = { ...leanInit, roadmap: { plannedSprintCount: 1, sprints: [{ n: 1, slug: 's1', title: 'Sprint one' }] } };
  const startGit = planSprint(preserve, 1, oneSprintInit).activeSprint.git;
  const sameStart = (label) => check(`preserve: activeSprint.git unchanged after ${label}`, JSON.stringify(readScope(preserve).activeSprint?.git) === JSON.stringify(startGit), JSON.stringify(readScope(preserve).activeSprint?.git));
  check('preserve: baseline start git exists', Boolean(startGit?.startCommit));

  writeFileSync(join(preserve, '.home', 'update.json'), JSON.stringify({ sprint: { n: 1, slug: 's1' }, reason: 'Rename for preservation test.', tasks: [{ id: 'T1.1', title: 'Task renamed' }] }));
  const updatePreview = runCli(preserve, 'plan', '--update-active', '--from', join(preserve, '.home', 'update.json'), '--kyro-scope', 'demo', '--dry-run', '--json');
  const updateDigest = JSON.parse(updatePreview.stdout).data.digest;
  const updateApply = runCli(preserve, 'plan', '--update-active', '--from', join(preserve, '.home', 'update.json'), '--kyro-scope', 'demo', '--digest', updateDigest, '--yes', '--json');
  check('preserve: active-plan update applies', updateApply.status === 0, `${updateApply.stdout}${updateApply.stderr}`);
  sameStart('active-plan update');

  const evidenceRun = runCli(preserve, 'record-evidence', 'T1.1', '--kyro-scope', 'demo', '--summary', 'Done.', '--validation', 'manual: ok');
  check('preserve: record-evidence applies', evidenceRun.status === 0, `${evidenceRun.stdout}${evidenceRun.stderr}`);
  sameStart('record-evidence');
  const reviewRun = runCli(preserve, 'review', 'T1.1', '--kyro-scope', 'demo', '--verdict', 'pass', '--yes');
  check('preserve: review applies', reviewRun.status === 0, `${reviewRun.stdout}${reviewRun.stderr}`);
  sameStart('review');
  const repairRun = runCli(preserve, 'repair', '--kyro-scope', 'demo', '--yes');
  check('preserve: repair applies', repairRun.status === 0, `${repairRun.stdout}${repairRun.stderr}`);
  sameStart('repair');

  check('preserve: close succeeds', closeSprint(preserve).status === 0);
  const closedGit = readScope(preserve).ledger[0]?.git;
  check('preserve: ledger git carries the planned startCommit', closedGit?.startCommit === startGit.startCommit, JSON.stringify(closedGit));
  const sameLedger = (label) => check(`preserve: ledger[0].git unchanged after ${label}`, JSON.stringify(readScope(preserve).ledger[0]?.git) === JSON.stringify(closedGit), JSON.stringify(readScope(preserve).ledger[0]?.git));
  const completeRun = runCli(preserve, 'scope', 'complete', '--kyro-scope', 'demo', '--yes');
  check('preserve: scope complete applies', completeRun.status === 0, `${completeRun.stdout}${completeRun.stderr}`);
  sameLedger('scope complete');
  const reopenRun = runCli(preserve, 'scope', 'reopen', '--kyro-scope', 'demo', '--reason', 'Preservation test.', '--yes');
  check('preserve: scope reopen applies', reopenRun.status === 0, `${reopenRun.stdout}${reopenRun.stderr}`);
  sameLedger('scope reopen');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`Sprint git traceability check failed (${failures.length}):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`Sprint git traceability check passed (contract, capture, plan, close, preservation; ${scopeCount} repo scopes, ${checkpointCount} checkpoints).`);
