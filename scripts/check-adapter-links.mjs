#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const fs = require('node:fs');
const repo = resolve(fileURLToPath(import.meta.url), '../..');
const root = fs.mkdtempSync(join(tmpdir(), 'kyro-adapter-links-'));
const savedCwd = process.cwd();
const savedEnv = Object.fromEntries(['HOME', 'USERPROFILE', 'KYRO_LINK_MODE'].map((key) => [key, process.env[key]]));
const realSymlink = fs.symlinkSync;
const realCopy = fs.cpSync;

function capture(callback) {
  const logs = [];
  const original = console.log;
  const originalWrite = process.stdout.write;
  try {
    console.log = (...args) => logs.push(args.join(' '));
    process.stdout.write = (chunk, ...args) => {
      logs.push(String(chunk));
      const callback = args.find((arg) => typeof arg === 'function');
      if (callback) callback();
      return true;
    };
    const result = callback();
    return { result, output: logs.join('\n') };
  } finally { console.log = original; process.stdout.write = originalWrite; }
}

try {
  process.chdir(root);
  process.env.HOME = join(root, 'home');
  process.env.USERPROFILE = process.env.HOME;
  delete process.env.KYRO_LINK_MODE;
  fs.mkdirSync(process.env.HOME);
  const { applyOperationPlan } = require(join(repo, 'dist/cli/pipeline/operation-steps.js'));
  const { applyPlan, resolveManagedPath } = require(join(repo, 'dist/cli/fs.js'));
  const { claudeAdapter, assertSafeClaudeSkillWrite } = require(join(repo, 'dist/cli/adapters/claude.js'));
  const { buildCommandSkill, parseSkillRuntimeVersion } = require(join(repo, 'dist/cli/adapters/command-skills.js'));
  const version = require(join(repo, 'package.json')).version;
  const context = { packageRoot: repo, resolveManagedPath };
  const source = '~/.agents/skills/kyro-work';
  const path = '~/.claude/skills/kyro-work';
  const canonical = resolveManagedPath(source);
  const target = resolveManagedPath(path);
  const skillFile = join(target, 'SKILL.md');
  const link = (overrides = {}) => ({ action: 'link', source, path, guard: 'claude-skill', ...overrides });
  const tail = { action: 'copy', source: 'nonexistent-w2-source', path: join(root, 'tail-failure') };
  const reset = () => fs.rmSync(target, { recursive: true, force: true });
  const assertLink = () => {
    assert(fs.lstatSync(target).isSymbolicLink());
    assert.equal(fs.realpathSync(target), canonical);
  };
  const assertCopy = () => {
    assert(fs.lstatSync(target).isDirectory());
    assert.equal(parseSkillRuntimeVersion(fs.readFileSync(skillFile, 'utf8')), version);
    assert.deepEqual(fs.readFileSync(skillFile), fs.readFileSync(join(canonical, 'SKILL.md')));
  };
  const refuse = (operation = link({ allowExistingManagedSkill: true })) => {
    assert.throws(() => applyOperationPlan([operation], context), (error) => {
      assert(String(error).includes(path) || String(error).includes(target), `missing offending path: ${error}`);
      return true;
    });
  };
  fs.mkdirSync(canonical, { recursive: true });
  fs.writeFileSync(join(canonical, 'SKILL.md'), buildCommandSkill('work'));
  fs.mkdirSync(dirname(target), { recursive: true });
  const sibling = join(dirname(target), 'user-skill', 'SKILL.md');
  fs.mkdirSync(dirname(sibling));
  fs.writeFileSync(sibling, Buffer.from([0, 255, 12, 10]));
  const siblingBytes = fs.readFileSync(sibling);

  // On Windows a privilege-free runner may not permit real symlinks. All copy,
  // collision and failure paths still run; report native link evidence honestly.
  let nativeLinks = true;
  try { realSymlink(canonical, target, 'dir'); reset(); }
  catch (error) {
    if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP'].includes(error.code)) throw error;
    nativeLinks = false;
    console.log(`SKIP native symlink scenarios: ${error.code}; copy fallback scenarios still required`);
  }

  if (nativeLinks) {
    const fresh = capture(() => applyPlan([link()]));
    assertLink();
    assert.equal(fresh.result[0].projection, 'link');
    assert.equal(fresh.output, '', 'applyPlan must return link projections without writing stdout');
    assertSafeClaudeSkillWrite(path, false);
    assertSafeClaudeSkillWrite(`${path}/SKILL.md`, false);
    reset();
    assert.throws(() => applyOperationPlan([link(), tail], context), /Apply failed/);
    assert(!fs.existsSync(target));
    console.log('PASS C1: directory symlink, canonical target, report, and later-failure rollback');

    // Model an old manifest that owned only the copied Claude SKILL.md file.
    fs.mkdirSync(target);
    const oldBody = buildCommandSkill('work').replace(`runtimeVersion: "${version}"`, 'runtimeVersion: "0.0.0"');
    fs.writeFileSync(skillFile, oldBody);
    const manifestFile = resolveManagedPath('~/.agents/kyro/current/manifest.json');
    fs.mkdirSync(dirname(manifestFile), { recursive: true });
    fs.writeFileSync(manifestFile, JSON.stringify({ schemaVersion: 1, packageName: 'kyro-ai', packageVersion: '0.0.0', adapters: [{ agent: 'claude' }], managedFiles: [`${path}/SKILL.md`] }));
    const plan = [];
    claudeAdapter.buildProjection(plan);
    const migrated = plan.find((operation) => operation.path === path);
    assert.equal(migrated?.action, 'link');
    assert.equal(migrated?.allowExistingManagedSkill, true);
    assert.throws(() => applyOperationPlan([migrated, tail], context));
    assert(fs.lstatSync(target).isDirectory());
    assert.equal(fs.readFileSync(skillFile, 'utf8'), oldBody);
    applyOperationPlan([migrated], context);
    assertLink();
    assert.deepEqual(fs.readFileSync(sibling), siblingBytes);
    console.log('PASS C3: legacy manifest-owned copy replaced, copy rollback and sibling bytes preserved');

    // Resolved relative links are accepted; other canonical names, foreign
    // directories and dangling links fail even with a previous ownership bit.
    reset();
    realSymlink(relative(dirname(target), canonical), target, 'dir');
    const previousLink = fs.readlinkSync(target);
    assertSafeClaudeSkillWrite(path, false);
    assert.throws(() => applyOperationPlan([link(), tail], context));
    assert.equal(fs.readlinkSync(target), previousLink);
    const foreignDir = join(root, 'foreign-dir');
    fs.mkdirSync(foreignDir);
    fs.writeFileSync(join(foreignDir, 'SKILL.md'), 'foreign bytes');
    const otherCanonical = resolveManagedPath('~/.agents/skills/kyro-forge');
    fs.mkdirSync(otherCanonical, { recursive: true });
    fs.writeFileSync(join(otherCanonical, 'SKILL.md'), buildCommandSkill('forge'));
    for (const destination of [foreignDir, otherCanonical, join(root, 'dangling')]) {
      reset();
      realSymlink(destination, target, 'dir');
      const before = fs.readlinkSync(target);
      refuse();
      assert.equal(fs.readlinkSync(target), before);
    }
    assert.equal(fs.readFileSync(join(foreignDir, 'SKILL.md'), 'utf8'), 'foreign bytes');
    console.log('PASS C4/C5: exact same-name resolved target only; foreign/wrong-name/dangling links unchanged');
    reset();

    // Snapshot a dangling generic directory link using lstat, not existsSync.
    realSymlink(join(root, 'missing-directory'), target, 'dir');
    const dangling = fs.readlinkSync(target);
    assert.throws(() => applyOperationPlan([{ action: 'link', source, path }, tail], context));
    assert.equal(fs.readlinkSync(target), dangling);
    reset();
    console.log('PASS C1: dangling symlink snapshot restored without following target');
  }

  process.env.KYRO_LINK_MODE = 'copy';
  const forced = capture(() => applyPlan([link()]));
  assertCopy();
  assert.equal(forced.result[0].projection, 'copy');
  assert.equal(forced.output, '', 'applyPlan must return forced-copy projections without writing stdout');
  reset();
  assert.throws(() => applyOperationPlan([link(), tail], context));
  assert(!fs.existsSync(target));
  delete process.env.KYRO_LINK_MODE;
  for (const code of ['EPERM', 'EACCES', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP']) {
    let attempts = 0;
    fs.symlinkSync = (...args) => {
      attempts++;
      throw Object.assign(new Error(`injected ${code}`), { code });
    };
    const fallback = capture(() => applyPlan([link()]));
    assertCopy();
    assert.equal(attempts, 1);
    assert.equal(fallback.result[0].projection, 'copy');
    assert.equal(fallback.output, '', 'applyPlan must return fallback projections without writing stdout');
    reset();
  }
  fs.symlinkSync = realSymlink;
  console.log('PASS C2: forced copy and EPERM/EACCES/ENOSYS/ENOTSUP/EOPNOTSUPP fallback, pinned bytes and copy report');

  // Failed publication restores its own target, including partial copy errors
  // and errors that must never be hidden by fallback.
  fs.mkdirSync(target);
  const original = buildCommandSkill('work');
  fs.writeFileSync(skillFile, original);
  process.env.KYRO_LINK_MODE = 'copy';
  fs.cpSync = (src, dest, options) => {
    if (resolve(String(dest)) === target) {
      fs.mkdirSync(target, { recursive: true });
      fs.writeFileSync(skillFile, 'partial');
      throw Object.assign(new Error('injected copy EIO'), { code: 'EIO' });
    }
    return realCopy(src, dest, options);
  };
  // Restore uses cpSync too; allow the snapshot backup on the second attempt.
  let publicationAttempts = 0;
  const failingCopy = fs.cpSync;
  fs.cpSync = (...args) => {
    if (resolve(String(args[1])) === target && publicationAttempts++ === 0) return failingCopy(...args);
    return realCopy(...args);
  };
  assert.throws(() => applyOperationPlan([link({ allowExistingManagedSkill: true })], context), /injected copy EIO/);
  fs.cpSync = realCopy;
  assert.equal(fs.readFileSync(skillFile, 'utf8'), original);
  delete process.env.KYRO_LINK_MODE;
  fs.symlinkSync = () => { throw Object.assign(new Error('injected symlink EIO'), { code: 'EIO' }); };
  assert.throws(() => applyOperationPlan([link({ allowExistingManagedSkill: true })], context), /injected symlink EIO/);
  fs.symlinkSync = realSymlink;
  assert.equal(fs.readFileSync(skillFile, 'utf8'), original);
  reset();
  console.log('PASS C1/C2: partial copy and non-fallback error restore previous directory');

  // If self-restoration fails too, keep the snapshot as diagnostic evidence
  // and never describe that failure as a completed rollback.
  fs.mkdirSync(target);
  fs.writeFileSync(skillFile, original);
  const backups = new Set();
  const realMkdtemp = fs.mkdtempSync;
  fs.mkdtempSync = (...args) => {
    const dir = realMkdtemp(...args);
    if (String(args[0]).includes('kyro-pipeline-')) backups.add(dir);
    return dir;
  };
  process.env.KYRO_LINK_MODE = 'copy';
  fs.cpSync = (...args) => {
    if (resolve(String(args[1])) === target) throw new Error('injected publication and restore failure');
    return realCopy(...args);
  };
  try {
    assert.throws(() => applyOperationPlan([link({ allowExistingManagedSkill: true })], context), (error) => {
      assert(String(error).includes('rollback failed'));
      assert(!String(error).includes('rollback completed'));
      return true;
    });
    assert.equal(backups.size, 1);
    for (const backup of backups) assert.equal(fs.readFileSync(join(backup, 'target', 'SKILL.md'), 'utf8'), original);
  } finally {
    fs.cpSync = realCopy;
    fs.mkdtempSync = realMkdtemp;
    delete process.env.KYRO_LINK_MODE;
    for (const backup of backups) fs.rmSync(backup, { recursive: true, force: true });
    reset();
  }
  console.log('PASS C1: self-rollback failure reported with backup retained');

  fs.writeFileSync(target, Buffer.from([1, 2, 255]));
  const foreignFile = fs.readFileSync(target);
  refuse();
  assert.deepEqual(fs.readFileSync(target), foreignFile);
  reset();
  for (const owned of [false, true]) {
    fs.mkdirSync(target);
    fs.writeFileSync(skillFile, owned ? 'foreign body' : buildCommandSkill('work'));
    const before = fs.readFileSync(skillFile);
    refuse(link({ allowExistingManagedSkill: owned }));
    assert.deepEqual(fs.readFileSync(skillFile), before);
    reset();
  }
  // Even a manifest-owned stub cannot authorize deleting user-added content.
  fs.mkdirSync(target);
  fs.writeFileSync(skillFile, buildCommandSkill('work'));
  fs.writeFileSync(join(target, 'user-note'), 'preserve me');
  refuse();
  assert.equal(fs.readFileSync(join(target, 'user-note'), 'utf8'), 'preserve me');
  reset();
  assert.deepEqual(fs.readFileSync(sibling), siblingBytes);
  console.log('PASS C5: foreign file/dir, forged metadata without manifest and user-added bytes preserved');

  // A successful Claude projection lists directories ahead of legacy files,
  // so purge snapshots/removes the link rather than traversing it.
  const managed = claudeAdapter.buildManagedFiles();
  assert(managed.indexOf(path) < managed.indexOf(`${path}/SKILL.md`));
  if (nativeLinks) {
    applyOperationPlan([link()], context);
    const canonicalBefore = fs.readFileSync(join(canonical, 'SKILL.md'));
    applyOperationPlan(managed.filter((file) => file.startsWith('~/.claude/')).map((path) => ({ action: 'remove', path })), context);
    assert(!fs.existsSync(target));
    assert.deepEqual(fs.readFileSync(join(canonical, 'SKILL.md')), canonicalBefore);
    console.log('PASS C6: file-level legacy purge unlinks directory before canonical traversal');

    // Re-sync must accept Kyro's own projection through a symlinked HOME.
    const realHome = process.env.HOME;
    const linkedHome = join(root, 'linked-home');
    realSymlink(realHome, linkedHome, 'dir');
    const cwd = join(root, 'linked-home-workspace');
    fs.mkdirSync(cwd);
    process.env.HOME = linkedHome;
    process.env.USERPROFILE = linkedHome;
    try {
      for (const args of [['install', '--init-workspace', '--agent', 'claude'], ['sync']]) {
        const result = spawnSync(process.execPath, [join(repo, 'dist/cli.js'), ...args], { cwd, env: process.env, encoding: 'utf8' });
        assert.equal(result.status, 0, `${args.join(' ')}: ${result.stdout}\n${result.stderr}`);
        assert.equal(fs.realpathSync(resolveManagedPath(path)), fs.realpathSync(resolveManagedPath(source)));
        assert(result.stdout.split('\n').includes(`- ${path}: projection=link <= ${source}`), `${args[0]} must retain the projection line: ${result.stdout}`);
      }
      reset();
      realSymlink(join(root, 'foreign-dir'), resolveManagedPath(path), 'dir');
      const foreignLink = fs.readlinkSync(resolveManagedPath(path));
      const result = spawnSync(process.execPath, [join(repo, 'dist/cli.js'), 'sync'], { cwd, env: process.env, encoding: 'utf8' });
      assert.notEqual(result.status, 0);
      assert((result.stdout + result.stderr).includes(resolveManagedPath(path)), 'refusal must name the offending path');
      assert.equal(fs.readlinkSync(resolveManagedPath(path)), foreignLink);
      console.log('PASS R1/R4 symlink HOME / CLI stdout: install and re-sync accept canonical links and print projection lines; foreign link refused with path');
    } finally {
      process.env.HOME = realHome;
      process.env.USERPROFILE = realHome;
    }
  }
  console.log('PASS R4 applyPlan stdout: link, forced-copy and fallback return projections with no stdout writes');
  console.log('RESULT: PASS adapter link contract (isolated HOME and USERPROFILE)');
} finally {
  fs.symlinkSync = realSymlink;
  fs.cpSync = realCopy;
  process.chdir(savedCwd);
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(root, { recursive: true, force: true });
}
