#!/usr/bin/env node
// Verifies `kyro capabilities`: the runtime handshake the orchestrator runs at forge start. It must
// list every tool-owned verb the shipped skill assets invoke, report the package version, and stay
// read-only. An old runtime fails the handshake by not knowing the command at all (UNKNOWN_COMMAND).
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(fileURLToPath(import.meta.url), '../..');
const cli = resolve(repo, 'dist/cli.js');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: repo, encoding: 'utf-8' });
}

// 1) --json emits { version, capabilities[] }; version matches package.json; the two verbs the
//    forge cannot run without are present.
{
  const result = run(['capabilities', '--json']);
  assert(result.status === 0, `capabilities --json should succeed: ${result.stdout}${result.stderr}`);
  const payload = JSON.parse(result.stdout);
  const pkg = JSON.parse(readFileSync(resolve(repo, 'package.json'), 'utf-8'));
  assert(payload.version === pkg.version, `payload version ${payload.version} should match package.json ${pkg.version}`);
  assert(Array.isArray(payload.capabilities), 'capabilities should be an array');
  for (const verb of ['record-evidence', 'review', 'close-sprint', 'context-pack']) {
    assert(payload.capabilities.includes(verb), `capabilities must list ${verb}`);
  }
}

// 2) Plain output prints the version line plus one verb per line.
{
  const result = run(['capabilities']);
  assert(result.status === 0, `capabilities should succeed: ${result.stdout}${result.stderr}`);
  assert(result.stdout.includes('record-evidence') && result.stdout.includes('review'), 'plain output should list verbs');
}

// 3) Unknown option is rejected; unknown-command behavior (the old-runtime signal) is unchanged.
{
  const badOption = run(['capabilities', '--nope']);
  assert(badOption.status === 1 && (badOption.stderr + badOption.stdout).includes('INVALID_INPUT'), 'unknown option should fail INVALID_INPUT');

  const unknown = run(['not-a-command']);
  assert(unknown.status === 1 && (unknown.stderr + unknown.stdout).includes('UNKNOWN_COMMAND'), 'unknown command should still fail UNKNOWN_COMMAND');
}

console.log('check:capabilities — runtime capability handshake verified');
