#!/usr/bin/env node
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repo = resolve(fileURLToPath(import.meta.url), '../..');
const cli = resolve(repo, 'dist/cli.js');
const root = mkdtempSync(join(tmpdir(), 'kyro-windows-install-'));
const home = join(root, '.home');
const workspace = join(root, 'workspace');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function install() {
  return spawnSync(
    process.execPath,
    [cli, 'install', '--scope', 'workspace', '--init-workspace', '--yes'],
    {
      cwd: workspace,
      encoding: 'utf8',
      env: { ...process.env, HOME: home, USERPROFILE: home },
    },
  );
}

function output(result) {
  return `${result.stdout ?? ''}${result.stderr ?? ''}`;
}

try {
  assert(existsSync(cli), `CLI bundle missing: ${cli}`);
  mkdirSync(workspace, { recursive: true });
  for (const attempt of [1, 2]) {
    const result = install();
    assert(result.status === 0, `install attempt ${attempt} failed:\n${output(result)}`);
    const debris = readdirSync(workspace).filter((name) => name.startsWith('.kyro-state-writer.lock'));
    assert(debris.length === 0, `install attempt ${attempt} left lock debris: ${debris.join(', ')}`);
  }
  assert(existsSync(join(workspace, '.agents', 'kyro', 'project.json')), 'workspace project.json was not created');
  assert(existsSync(join(workspace, '.agents', 'kyro', 'local.json')), 'workspace local.json was not created');
  assert(existsSync(join(home, '.agents', 'kyro', 'current', 'dist', 'cli.js')), 'global runtime was not projected');
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('Windows install smoke passed twice without lock debris');
