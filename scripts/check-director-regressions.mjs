/** Adversarial write regressions, executed only by the team runner. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function checkDirectorRegressions() {
  const repo = fileURLToPath(new URL('..', import.meta.url));
  const root = fs.mkdtempSync(join(tmpdir(), 'kyro-director-regressions-'));
  const fixture = (name) => {
    const cwd = join(root, name), home = join(cwd, 'home'), bin = join(cwd, 'bin');
    fs.mkdirSync(home, { recursive: true }); fs.mkdirSync(bin);
    return { cwd, home, env: { ...process.env, HOME: home, USERPROFILE: home, PATH: bin, KYRO_LINK_MODE: 'copy' } };
  };
  const put = (path, content) => { fs.mkdirSync(dirname(path), { recursive: true }); fs.writeFileSync(path, content); };
  const cli = (f, args) => spawnSync(process.execPath, [join(repo, 'dist/cli.js'), ...args], { cwd: f.cwd, env: f.env, encoding: 'utf8' });
  const probe = (f, source) => {
    const result = spawnSync(process.execPath, ['-e', source], { cwd: f.cwd, env: f.env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  };
  try {
    for (const kind of ['symlink', 'foreign-file']) {
      const f = fixture(`canonical-${kind}`);
      fs.mkdirSync(join(f.home, '.claude'));
      const foreign = join(f.cwd, 'foreign.txt');
      const bytes = Buffer.from([0, 255, 13, 10, 65, 66, 67]); put(foreign, bytes);
      const target = join(f.home, '.agents/skills/kyro-work/SKILL.md');
      fs.mkdirSync(dirname(target), { recursive: true });
      if (kind === 'symlink') fs.symlinkSync(foreign, target); else put(target, bytes);
      const result = cli(f, ['install', '--no-init-workspace']);
      assert.notEqual(result.status, 0, 'canonical-skill-ownership: install must fail closed');
      assert((result.stdout + result.stderr).includes(target), 'canonical-skill-ownership: error must identify the path');
      assert.deepEqual(fs.readFileSync(foreign), bytes, 'canonical-skill-ownership: foreign bytes changed');
      assert.deepEqual(fs.readFileSync(target), bytes, 'canonical-skill-ownership: target bytes changed');
      assert.equal(fs.lstatSync(target).isSymbolicLink(), kind === 'symlink');
    }
    console.log('PASS canonical-skill-ownership');
    for (const ancestor of ['.agents/kyro', '.agents']) {
      const f = fixture(`registry-ancestor-${ancestor.replaceAll('/', '-')}`);
      const external = join(f.cwd, 'foreign-directory'); fs.mkdirSync(external);
      const bytes = Buffer.from([255, 0, 65, 13, 10]); put(join(external, 'user.bin'), bytes);
      const target = join(f.home, ancestor); fs.mkdirSync(dirname(target), { recursive: true });
      fs.symlinkSync(external, target, 'dir');
      const result = cli(f, ['install', '--no-init-workspace']);
      assert.notEqual(result.status, 0, 'registry-parent-symlink: install must fail closed');
      assert((result.stdout + result.stderr).includes(target), 'registry-parent-symlink: error must identify the ancestor');
      assert.deepEqual(fs.readdirSync(external), ['user.bin'], 'registry-parent-symlink: wrote outside machine root');
      assert.deepEqual(fs.readFileSync(join(external, 'user.bin')), bytes);
      assert.equal(fs.readlinkSync(target), external);
    }
    console.log('PASS registry-parent-symlink');
    for (const existed of [false, true]) {
      const f = fixture(`registry-publish-${existed}`);
      probe(f, `
        const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
        const machine = require(${JSON.stringify(join(repo, 'dist/cli/adapters/machine-registry.js'))});
        const { applyPlan } = require(${JSON.stringify(join(repo, 'dist/cli/fs.js'))});
        const registry = path.join(process.env.HOME, '.agents/kyro/adapters.json');
        const before = '{"adapters": [], "schemaVersion": 1}\\n';
        fs.mkdirSync(path.dirname(registry), { recursive: true });
        if (${existed}) fs.writeFileSync(registry, before);
        const source = path.join(process.env.HOME, '.agents/skills/kyro-work');
        fs.mkdirSync(source, { recursive: true }); fs.writeFileSync(path.join(source, 'SKILL.md'), 'NEW PROJECTION');
        const target = path.join(process.env.HOME, '.claude/skills/kyro-work');
        const old = Buffer.from([255, 0, 13, 10, 66]);
        if (${existed}) { fs.mkdirSync(target, { recursive: true }); fs.writeFileSync(path.join(target, 'SKILL.md'), old); }
        const extra = path.join(process.env.HOME, 'published-file');
        const plan = [{ action: 'link', source: '~/.agents/skills/kyro-work', path: '~/.claude/skills/kyro-work' }, { action: 'write', path: extra, content: 'NEW FILE' }];
        machine.registerMachineAdapterPlan(plan, { schemaVersion: 1, adapters: [{ agent: 'claude', state: 'enabled', projection: null, integrations: false, updatedAt: '2026-10-09T00:00:00.000Z' }] });
        const rename = fs.renameSync; let writes = 0, injected = false;
        fs.renameSync = (from, to) => {
          if (to === registry && ++writes === 2) {
            assert.equal(fs.readFileSync(path.join(target, 'SKILL.md'), 'utf8'), 'NEW PROJECTION');
            assert.equal(fs.readFileSync(extra, 'utf8'), 'NEW FILE');
            injected = true; throw new Error('injected final registry EIO');
          }
          return rename(from, to);
        };
        try { assert.throws(() => applyPlan(plan), /injected final registry EIO/); } finally { fs.renameSync = rename; }
        assert(injected, 'registry-publish-rollback: final publication not exercised');
        if (${existed}) {
          assert.equal(fs.readFileSync(registry, 'utf8'), before, 'registry-publish-rollback: registry bytes changed');
          assert.deepEqual(fs.readFileSync(path.join(target, 'SKILL.md')), old, 'registry-publish-rollback: old projection bytes changed');
        } else {
          assert(!fs.existsSync(registry));
          assert(!fs.existsSync(target), 'registry-publish-rollback: orphan projection');
        }
        assert(!fs.existsSync(extra), 'registry-publish-rollback: orphan file');
      `);
    }
    console.log('PASS registry-publish-rollback');
    for (const existed of [true, false]) {
      const f = fixture(`native-write-${existed}`);
      probe(f, `
        const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
        const { applyPlan } = require(${JSON.stringify(join(repo, 'dist/cli/fs.js'))});
        const target = path.join(process.env.HOME, '.config/opencode/commands/kyro/work.md');
        const before = Buffer.from([255, 0, 13, 10, 65, 66, 67]);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        if (${existed}) { fs.writeFileSync(target, before); fs.chmodSync(target, 0o640); }
        const mode = ${existed} ? fs.statSync(target).mode : null;
        const open = fs.openSync, write = fs.writeFileSync; let commandFd, injected = false;
        fs.openSync = (p, ...args) => { const fd = open(p, ...args); if (p === target && typeof args[0] === 'number') commandFd = fd; return fd; };
        fs.writeFileSync = (p, ...args) => {
          if (p === commandFd && !injected) {
            assert.equal(fs.fstatSync(p).size, 0, 'native-write-rollback: truncation not exercised');
            injected = true; write(p, 'PARTIAL COMMAND'); throw new Error('injected command write EIO');
          }
          return write(p, ...args);
        };
        try { assert.throws(() => applyPlan([{ action: 'write', path: '~/.config/opencode/commands/kyro/work.md', content: 'REPLACEMENT', guard: 'opencode-command', allowExistingManagedSkill: ${existed} }]), /injected command write EIO/); }
        finally { fs.openSync = open; fs.writeFileSync = write; }
        assert(injected, 'native-write-rollback: write failure not exercised');
        if (${existed}) {
          assert.deepEqual(fs.readFileSync(target), before, 'native-write-rollback: original bytes lost');
          assert.equal(fs.statSync(target).mode, mode);
        } else assert(!fs.existsSync(target), 'native-write-rollback: failed new file remains');
      `);
    }
    console.log('PASS native-write-rollback');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
