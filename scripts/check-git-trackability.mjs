#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(fileURLToPath(import.meta.url), '../..');
const modulePath = resolve(repo, 'dist/cli/core/git-trackability.js');
const isolation = mkdtempSync(join(tmpdir(), 'kyro-git-config-'));
process.env.GIT_CONFIG_GLOBAL = join(isolation, 'empty-config');
process.env.GIT_CONFIG_NOSYSTEM = '1';
const hooks = join(isolation, 'hooks'); mkdirSync(hooks);
function git(cwd, args) { return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim(); }
function localCheck(cwd, fn, env = {}) {
  return JSON.parse(execFileSync(process.execPath, ['-e', `const m=require(${JSON.stringify(modulePath)}); console.log(JSON.stringify(m.${fn}() ?? null))`], { cwd, encoding: 'utf8', env: { ...process.env, ...env } }));
}
function cli(cwd, args, required = true) {
  const result = spawnSync(process.execPath, [join(repo, 'dist/cli.js'), ...args], {
    cwd, encoding: 'utf8', timeout: 30000, env: { ...process.env, HOME: join(isolation, 'home') },
  });
  if (required) assert(result.status === 0, `${args.join(' ')} failed: ${result.error ?? ''} ${result.stdout} ${result.stderr}`);
  return result.stdout + result.stderr;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function diagnose(cwd) {
  const output = execFileSync(process.execPath, ['-e', `const m=require(${JSON.stringify(modulePath)}); console.log(JSON.stringify(m.diagnoseKyroGitTrackability()))`], { cwd, encoding: 'utf-8' });
  return JSON.parse(output);
}

function workspace() {
  const root = mkdtempSync(join(tmpdir(), 'kyro-git-trackability-'));
  git(root, ['init', '-q']);
  git(root, ['config', 'core.hooksPath', hooks]);
  git(root, ['config', 'commit.gpgsign', 'false']);
  git(root, ['config', 'user.name', 'Kyro Test']);
  git(root, ['config', 'user.email', 'kyro-test@example.invalid']);
  return root;
}

{
  const root = workspace();
  try {
    writeFileSync(join(root, '.gitignore'), '/.agents/*\n!/.agents/kyro/\n/.agents/kyro/*\n!/.agents/kyro/.gitignore\n!/.agents/kyro/project.json\n!/.agents/kyro/scopes/\n');
    const result = diagnose(root);
    assert(result.status === 'pass', 'correct negations must pass: ' + JSON.stringify(result));
  } finally { rmSync(root, { recursive: true, force: true }); }
}

{
  const root = workspace();
  try {
    writeFileSync(join(root, '.gitignore'), '.agents/\n');
    const result = diagnose(root);
    assert(result.status === 'fail' && result.detail.includes('project.json') && result.detail.includes('scopes/**'), 'blanket ignore must fail shared state: ' + JSON.stringify(result));
    assert(result.remedy.includes('!/.agents/kyro/project.json') && result.remedy.includes('!/.agents/kyro/scopes/'), 'failure remedy must give exact negations');
  } finally { rmSync(root, { recursive: true, force: true }); }
}

{
  const root = workspace();
  try {
    writeFileSync(join(root, '.gitignore'), '/.agents/*\n!/.agents/kyro/\n/.agents/kyro/*\n!/.agents/kyro/project.json\n!/.agents/kyro/scopes/\n');
    const result = diagnose(root);
    assert(result.status === 'warn' && result.detail.includes('.agents/kyro/.gitignore'), 'nested ignore alone must warn: ' + JSON.stringify(result));
    assert(result.remedy.includes('!/.agents/kyro/.gitignore'), 'nested warning remedy must be exact');
  } finally { rmSync(root, { recursive: true, force: true }); }
}

{
  const root = mkdtempSync(join(tmpdir(), 'kyro-non-git-'));
  try {
    const result = diagnose(root);
    assert(result.status === 'pass' && result.detail.includes('not a Git repository'), 'non-Git workspace must be skipped: ' + JSON.stringify(result));
  } finally { rmSync(root, { recursive: true, force: true }); }
}

for (const nested of [false, true]) {
  const root = workspace();
  try {
    const cwd = nested ? join(root, 'packages/app') : root;
    mkdirSync(cwd, { recursive: true });
    const pattern = `${nested ? '/packages/app' : ''}/.kyro-state-writer.lock*`;
    const exclude = resolve(cwd, git(cwd, ['rev-parse', '--git-path', 'info/exclude']));
    // Keep a tracked root ignore file and another tracked file as witnesses.
    writeFileSync(join(root, '.gitignore'), '# consumer rules stay intact\n');
    writeFileSync(join(root, 'tracked.txt'), 'unchanged\n');
    git(root, ['add', '.gitignore', 'tracked.txt']); git(root, ['commit', '-qm', 'Fixture baseline']);
    writeFileSync(exclude, '# preserve this rule\n*.json\n');
    const before = localCheck(cwd, 'diagnoseStateWriterLockIgnore');
    assert(before.status === 'warn' && before.remedy.includes(pattern) && before.remedy.includes(exclude), 'missing lock remedy must be exact');
    assert(/WARN.*State writer lock ignore/.test(cli(cwd, ['doctor'], false)), 'doctor must expose missing lock WARN');
    const originalExclude = readFileSync(exclude, 'utf8');
    cli(cwd, ['install', '--init-workspace', '--dry-run']);
    assert(readFileSync(exclude, 'utf8') === originalExclude, 'dry run wrote exclude');
    for (const args of [['install', '--init-workspace'], ['install', '--init-workspace'], ['sync'], ['sync']]) cli(cwd, args);
    const content = readFileSync(exclude, 'utf8');
    assert(content.split(/\r?\n/).filter((line) => line === pattern).length === 1, 'install/sync must add exactly one lock entry');
    assert(content.startsWith(originalExclude), 'existing exclude rules changed');
    for (const lock of ['.kyro-state-writer.lock', '.kyro-state-writer.lock.reclaim-leftover']) {
      mkdirSync(join(cwd, lock)); writeFileSync(join(cwd, lock, 'owner.json'), '{}');
    }
    const status = git(root, ['--no-optional-locks', 'status', '--porcelain', '--untracked-files=all']);
    assert(!status.includes('.kyro-state-writer.lock'), 'lock/reclaim directory leaked into status');
    assert(git(root, ['diff', 'HEAD', '--']) === '', 'install/sync changed tracked files');
    assert(git(root, ['ls-files', '--', '.agents/kyro']) === '', 'install/sync staged shared state');
    const after = localCheck(cwd, 'diagnoseStateWriterLockIgnore');
    assert(after.status === 'pass', 'lock check must pass after install');
    assert(/PASS.*State writer lock ignore/.test(cli(cwd, ['doctor'], false)), 'doctor must expose passing lock check');
    console.log(`  ok ${nested ? 'nested workspace' : 'repository root'}: install/sync idempotency, held/reclaim locks, tracked files, doctor WARN → PASS`);
  } finally { rmSync(root, { recursive: true, force: true }); }
}
{
  const root = mkdtempSync(join(tmpdir(), 'kyro-lock-non-git-'));
  try {
    localCheck(root, 'ensureStateWriterLockIgnored');
    assert(readdirSync(root).length === 0, 'non-Git helper wrote files');
    assert(localCheck(root, 'diagnoseStateWriterLockIgnore').status === 'pass', 'non-Git diagnosis must skip');
    console.log('  ok outside Git: no files written');
  } finally { rmSync(root, { recursive: true, force: true }); }
}
{
  const root = workspace();
  try {
    const exclude = resolve(root, git(root, ['rev-parse', '--git-path', 'info/exclude']));
    rmSync(exclude); mkdirSync(exclude); // Portable write/read failure, even when tests run as root.
    cli(root, ['install', '--init-workspace']); cli(root, ['sync']);
    assert(localCheck(root, 'diagnoseStateWriterLockIgnore').status === 'warn', 'failed exclude update should remain diagnosable');
    console.log('  ok exclude failure never fails install/sync');
  } finally { rmSync(root, { recursive: true, force: true }); }
}
{
  const root = workspace();
  try {
    writeFileSync(join(root, 'tracked.txt'), 'baseline');
    git(root, ['add', 'tracked.txt']); git(root, ['commit', '-qm', 'Fixture baseline']);
    const linked = join(root, 'linked');
    git(root, ['worktree', 'add', '-q', '-b', 'fixture-linked', linked]);
    const cwd = join(linked, ' [app]*'); mkdirSync(cwd);
    localCheck(cwd, 'ensureStateWriterLockIgnored');
    localCheck(cwd, 'ensureStateWriterLockIgnored');
    assert(localCheck(cwd, 'diagnoseStateWriterLockIgnore').status === 'pass', 'linked worktree/metacharacter workspace ignore must work');
    const exclude = resolve(cwd, git(cwd, ['rev-parse', '--git-path', 'info/exclude']));
    assert(readFileSync(exclude, 'utf8').split(/\r?\n/).filter((line) => line.includes('.kyro-state-writer.lock')).length === 1, 'linked worktree exclude duplicated');
    console.log('  ok linked worktree metadata and literal workspace path metacharacters');
  } finally { rmSync(root, { recursive: true, force: true }); }
}
// M1: Never let Git metadata redirect writes into tracked consumer files.
{
  const root = workspace();
  try {
    const tracked = join(root, '.gitignore');
    const bytes = '# tracked consumer ignore rules\n';
    writeFileSync(tracked, bytes);
    git(root, ['add', '.gitignore']); git(root, ['commit', '-qm', 'Fixture tracked ignore']);
    const exclude = resolve(root, git(root, ['rev-parse', '--git-path', 'info/exclude']));
    rmSync(exclude); symlinkSync(tracked, exclude);
    localCheck(root, 'ensureStateWriterLockIgnored');
    cli(root, ['install', '--init-workspace']); cli(root, ['sync']);
    assert(readFileSync(tracked, 'utf8') === bytes, 'symlinked exclude changed tracked target');
    assert(git(root, ['diff', 'HEAD', '--']) === '', 'symlinked exclude changed tracked files');
    const diagnosis = localCheck(root, 'diagnoseStateWriterLockIgnore');
    assert(diagnosis.status === 'warn' && diagnosis.detail.includes('unsafe exclude target'), 'unsafe exclude must WARN');
    assert(/WARN.*State writer lock ignore: unsafe exclude target/.test(cli(root, ['doctor'], false)), 'doctor must WARN for redirected exclude');
    console.log('  ok M1 symlinked exclude: tracked target byte-identical; install/sync nonfatal; doctor WARN');
    // A symlinked parent directory must not bypass the file-level no-follow check.
    rmSync(exclude); rmSync(join(root, '.git/info'), { recursive: true });
    const redirected = join(root, 'redirected'); mkdirSync(redirected);
    writeFileSync(join(redirected, 'exclude'), bytes);
    symlinkSync(redirected, join(root, '.git/info'), 'dir');
    localCheck(root, 'ensureStateWriterLockIgnored');
    assert(readFileSync(join(redirected, 'exclude'), 'utf8') === bytes, 'redirected info directory was written');
    assert(localCheck(root, 'diagnoseStateWriterLockIgnore').status === 'warn', 'redirected info directory must WARN');
    console.log('  ok M1 symlinked info directory: redirected target unchanged; doctor WARN');
  } finally { rmSync(root, { recursive: true, force: true }); }
}
// Exercise the portable identity check even on hosts that support O_NOFOLLOW.
for (const stripNoFollow of [false, true]) {
  const root = workspace();
  try {
    const tracked = join(root, 'tracked.txt'); writeFileSync(tracked, 'protected bytes');
    const exclude = resolve(root, git(root, ['rev-parse', '--git-path', 'info/exclude']));
    const code = `const fs=require('node:fs'); const m=require(${JSON.stringify(modulePath)});
      const original=fs.openSync; let swapped=false;
      fs.openSync=function(path,flags,...rest) {
        if(path===${JSON.stringify(exclude)}) {
          swapped=true; fs.unlinkSync(path); fs.symlinkSync(${JSON.stringify(tracked)},path);
          ${stripNoFollow ? 'flags &= ~(fs.constants.O_NOFOLLOW ?? 0);' : ''}
        }
        return original.call(this,path,flags,...rest);
      };
      m.ensureStateWriterLockIgnored(); if(!swapped) throw new Error('swap seam not reached');`;
    execFileSync(process.execPath, ['-e', code], { cwd: root });
    assert(readFileSync(tracked, 'utf8') === 'protected bytes', 'open-time swap wrote redirected bytes');
    assert(localCheck(root, 'diagnoseStateWriterLockIgnore').status === 'warn', 'swapped exclude must WARN');
  } finally { rmSync(root, { recursive: true, force: true }); }
}
console.log('  ok M1 open-time symlink swaps: no writes with native no-follow or portable identity fallback');
// M2: A workspace name is data, never multiple exclude rules.
for (const separator of ['\n', '\r', '\u0085', '\u2028', '\u2029']) {
  const root = workspace();
  try {
    const cwd = join(root, `a${separator}secret.txt${separator}b`); mkdirSync(cwd);
    const exclude = resolve(cwd, git(cwd, ['rev-parse', '--git-path', 'info/exclude']));
    const before = readFileSync(exclude);
    writeFileSync(join(root, 'secret.txt'), 'must stay visible');
    localCheck(cwd, 'ensureStateWriterLockIgnored');
    assert(readFileSync(exclude).equals(before), 'line separator path changed exclude bytes');
    const diagnosis = localCheck(cwd, 'diagnoseStateWriterLockIgnore');
    assert(diagnosis.status === 'warn' && diagnosis.detail.startsWith('unsupported workspace path'), 'unsupported path must WARN');
    assert(!diagnosis.remedy.includes(cwd) && !diagnosis.remedy.includes('.kyro-state-writer.lock*'), 'unsupported path printed an unsafe exact-line remedy');
    assert(git(root, ['--no-optional-locks', 'status', '--porcelain', '--untracked-files=all']).includes('?? secret.txt'), 'unrelated root file became ignored');
  } finally { rmSync(root, { recursive: true, force: true }); }
}
console.log('  ok M2 line-separator workspace paths: exclude byte-identical; unrelated secret.txt visible; unsupported workspace path WARN');
// m1: An unavailable executable is an unknown discovery, never a non-repository PASS.
{
  const root = workspace();
  try {
    const emptyPath = join(isolation, 'no-git'); mkdirSync(emptyPath);
    const exclude = resolve(root, git(root, ['rev-parse', '--git-path', 'info/exclude']));
    const before = readFileSync(exclude);
    const env = { PATH: emptyPath };
    localCheck(root, 'ensureStateWriterLockIgnored', env);
    assert(readFileSync(exclude).equals(before), 'failed discovery wrote exclude');
    for (const name of ['diagnoseStateWriterLockIgnore', 'diagnoseKyroGitTrackability']) {
      const diagnosis = localCheck(root, name, env);
      assert(diagnosis.status === 'warn' && diagnosis.detail.includes('discovery failed') && diagnosis.remedy.includes('PATH'), 'missing git must WARN with remedy');
    }
    console.log('  ok m1 unavailable Git: discovery WARN with PATH remedy; no writes');
  } finally { rmSync(root, { recursive: true, force: true }); }
}
{
  const root = workspace();
  try {
    const exclude = resolve(root, git(root, ['rev-parse', '--git-path', 'info/exclude']));
    rmSync(exclude);
    localCheck(root, 'ensureStateWriterLockIgnored');
    assert(readFileSync(exclude, 'utf8') === '/.kyro-state-writer.lock*\n', 'missing exclude was not created safely');
    assert(localCheck(root, 'diagnoseStateWriterLockIgnore').status === 'pass', 'created exclude must PASS');
    console.log('  ok absent exclude: safe creation inside Git metadata');
  } finally { rmSync(root, { recursive: true, force: true }); }
}
{
  const root = workspace();
  try {
    const code = `const cp=require('node:child_process'); const original=cp.execFileSync; const seen=[];
      cp.execFileSync=function(file,args,options) { if(file==='git') seen.push(options.timeout); return original.call(this,file,args,options); };
      const m=require(${JSON.stringify(modulePath)}); m.ensureStateWriterLockIgnored(); m.diagnoseStateWriterLockIgnore();
      if(!seen.length || seen.some(value=>value!==10000)) throw new Error('unbounded Git call');
      cp.execFileSync=function() { throw Object.assign(new Error('test timeout'),{code:'ETIMEDOUT',signal:'SIGTERM',status:null}); };
      m.ensureStateWriterLockIgnored();
      if(m.diagnoseStateWriterLockIgnore().status!=='warn') throw new Error('timeout masked');`;
    execFileSync(process.execPath, ['-e', code], { cwd: root });
    console.log('  ok Git calls use 10 s timeout; timed-out discovery WARNs and stays nonfatal');
  } finally { rmSync(root, { recursive: true, force: true }); }
}
rmSync(isolation, { recursive: true, force: true });
console.log('check:git-trackability — Git and non-Git trackability contracts passed');
