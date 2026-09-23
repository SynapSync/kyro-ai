#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32') {
  console.log('Windows tarball smoke requires a native Windows runner');
  process.exit(0);
}

const repo = resolve(fileURLToPath(import.meta.url), '../..');
const expectedVersion = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version;
const root = mkdtempSync(join(tmpdir(), 'kyro-windows-tarball-'));
const home = join(root, 'home');
const prefix = join(root, 'npm-global');
const workspace = join(root, 'workspace');
const runtime = join(home, '.agents', 'kyro', 'current');
const baseEnv = { ...process.env, HOME: home, USERPROFILE: home, npm_config_prefix: prefix };

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function output(result) {
  return `${result.stdout ?? ''}${result.stderr ?? ''}`;
}

function run(command, args, cwd, env = baseEnv) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', shell: true });
  assert(result.status === 0, `${command} ${args.join(' ')} failed:\n${output(result)}`);
  return result;
}

try {
  mkdirSync(home, { recursive: true });
  mkdirSync(prefix, { recursive: true });
  mkdirSync(workspace, { recursive: true });

  const packed = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--pack-destination', root, '--json'], repo).stdout)[0];
  assert(packed.version === expectedVersion, 'packed version differs from package.json');
  const tarball = join(root, packed.filename);
  assert(existsSync(tarball), 'npm pack did not produce a tarball');
  run('npm', ['install', '-g', `"${tarball}"`, '--ignore-scripts', '--offline', '--no-audit', '--no-fund'], workspace);

  // Each command starts a new shell with the isolated npm prefix on PATH.
  const shellEnv = { ...baseEnv, PATH: `${prefix}${delimiter}${process.env.PATH ?? ''}` };
  const shim = join(prefix, 'kyro.cmd');
  assert(existsSync(shim), `npm global install did not create ${shim}`);
  assert(run('kyro', ['--version'], workspace, shellEnv).stdout.trim() === expectedVersion, 'fresh shell found the wrong kyro command');

  for (const attempt of [1, 2]) {
    run('kyro', [attempt === 1 ? 'install' : 'sync', '--scope', 'workspace', ...(attempt === 1 ? ['--init-workspace', '--yes'] : [])], workspace, shellEnv);
    const debris = readdirSync(workspace).filter((name) => name.startsWith('.kyro-state-writer.lock'));
    assert(debris.length === 0, `install/sync attempt ${attempt} left lock debris: ${debris.join(', ')}`);
  }

  const packageRoot = join(prefix, 'node_modules', 'kyro-ai');
  const installedVersion = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')).version;
  const manifest = JSON.parse(readFileSync(join(runtime, 'manifest.json'), 'utf8'));
  assert(installedVersion === expectedVersion && manifest.packageVersion === expectedVersion, 'package, command and runtime versions differ');
  assert(existsSync(join(packageRoot, 'agents', 'orchestrator.md')), 'packed orchestrator missing');
  assert(existsSync(join(packageRoot, 'internal', 'skills', 'sprint-forge', 'SKILL.md')), 'packed skill missing');
  assert(existsSync(join(workspace, '.agents', 'kyro', 'project.json')), 'workspace project.json missing');
  assert(existsSync(join(workspace, '.agents', 'kyro', 'local.json')), 'workspace local.json missing');
  assert(existsSync(join(runtime, 'dist', 'cli.js')), 'projected runtime CLI missing');
  assert(/^node\s+/.test(manifest.kyroInvocation) && !/\bkyro(?:\.cmd)?\s*$/.test(manifest.kyroInvocation), 'Windows agent invocation must use Node, not the cmd shim');
  assert(!manifest.kyroInvocation.includes('_npx'), 'Windows agent invocation persisted an ephemeral npx path');
  const projected = run('node', [`"${join(runtime, 'dist', 'cli.js')}"`, '--version'], workspace, shellEnv);
  assert(projected.stdout.trim() === expectedVersion, 'persisted runtime entrypoint has wrong version');
  run('kyro', ['doctor', '--artifacts'], workspace, shellEnv);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('Windows tarball npm-global install, fresh shim, sync, and projected invocation passed');
