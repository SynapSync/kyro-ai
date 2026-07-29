#!/usr/bin/env node
// Verifies `kyro capabilities`: the runtime handshake the orchestrator runs at forge start. It must
// list every tool-owned verb the shipped skill assets invoke, report the package version, and stay
// read-only. An old runtime fails the handshake by not knowing the command at all (UNKNOWN_COMMAND).
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(fileURLToPath(import.meta.url), '../..');
const cli = resolve(repo, 'dist/cli.js');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: repo, encoding: 'utf-8' });
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
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
  for (const verb of ['record-evidence', 'review', 'close-sprint', 'context-pack', 'status']) {
    assert(payload.capabilities.includes(verb), `capabilities must list ${verb}`);
  }
}

// 1b) Drift, assets → payload: every verb the shipped assets invoke as `{{KYRO_CLI}} <verb>` must be
//     advertised. This is the invariant that broke in the field — assets reached for `status full`
//     while the payload never listed `status`, so a strict agent aborts on a verb the CLI has.
//     `capabilities` is the one exemption: the handshake cannot verify itself (if it is missing the
//     command does not run at all, and that failure IS the staleness signal).
{
  const payload = JSON.parse(run(['capabilities', '--json']).stdout);
  const referenced = new Set();
  for (const dir of ['skills', 'agents', 'commands']) {
    for (const file of walk(resolve(repo, dir))) {
      if (!file.endsWith('.md')) continue;
      const body = readFileSync(file, 'utf-8');
      for (const match of body.matchAll(/\{\{KYRO_CLI\}\} ([a-z][a-z-]*)/g)) referenced.add(match[1]);
    }
  }
  assert(referenced.size > 0, 'expected to find {{KYRO_CLI}} verb references in the shipped assets');
  assert(referenced.has('capabilities'), 'assets should invoke the capabilities handshake');

  const undeclared = [...referenced].filter((verb) => verb !== 'capabilities' && !payload.capabilities.includes(verb));
  assert(
    undeclared.length === 0,
    `assets invoke verb(s) absent from the capabilities payload: ${undeclared.join(', ')}. `
      + 'Add them to TOOL_OWNED_VERBS in src/cli/core/capabilities.ts, or stop referencing them in the assets.',
  );
}

// 1c) Drift, payload → dispatch: every advertised verb must actually be dispatchable. Catches a verb
//     that was renamed or removed in app.ts while the payload kept promising it — the handshake
//     would pass and the forge would then die mid-sprint on UNKNOWN_COMMAND.
{
  const payload = JSON.parse(run(['capabilities', '--json']).stdout);
  for (const verb of payload.capabilities) {
    const result = run([verb, '--help']);
    const combined = result.stdout + result.stderr;
    assert(!combined.includes('UNKNOWN_COMMAND'), `advertised verb ${verb} is not dispatchable: ${combined}`);
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
