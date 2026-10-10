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
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
