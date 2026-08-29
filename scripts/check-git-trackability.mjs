#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(fileURLToPath(import.meta.url), '../..');
const modulePath = resolve(repo, 'dist/cli/core/git-trackability.js');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function diagnose(cwd) {
  const output = execFileSync(process.execPath, ['-e', `const m=require(${JSON.stringify(modulePath)}); console.log(JSON.stringify(m.diagnoseKyroGitTrackability()))`], { cwd, encoding: 'utf-8' });
  return JSON.parse(output);
}

function workspace() {
  const root = mkdtempSync(join(tmpdir(), 'kyro-git-trackability-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
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

console.log('check:git-trackability — Git and non-Git trackability contracts passed');
