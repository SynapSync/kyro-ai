#!/usr/bin/env node
// Kyro PreToolUse guard — host-specific reinforcement for Claude Code only.
//
// Kyro's portable safety boundary is the fail-closed CLI contract. This hook adds defense in depth:
// any Write/Edit targeting CLI-owned state is a manual mutation because legitimate Kyro commands
// write through the runtime filesystem APIs and never reach PreToolUse.
//
// Exit 0 = allow. Exit 2 = block (stderr is fed back to the agent).

import { readFileSync } from 'node:fs';

const KYRO_STATE_SEGMENT = '/.agents/kyro/';
const SCOPE_SEGMENT = '/.agents/kyro/scopes/';

function allow() {
  process.exit(0);
}

function block(path) {
  process.stderr.write(
    [
      'BLOCKED by Kyro: ' + path + ' is CLI-owned state and cannot be written with Write/Edit.',
      '',
      'Use the Kyro verb that owns this transition. If the runtime or verb is unavailable, stop',
      'without mutation, report the observed kyro --version output (or not installed), and run:',
      '  npx kyro-ai@latest sync --scope workspace --yes',
      '',
      'This Claude Code hook is defense in depth; Kyro correctness does not depend on hooks being',
      'available in every agent host.',
    ].join('\n'),
  );
  process.exit(2);
}

let payload;
try {
  payload = JSON.parse(readFileSync(0, 'utf-8'));
} catch {
  allow();
}

const toolName = payload?.tool_name;
if (toolName !== 'Write' && toolName !== 'Edit') allow();

const filePath = payload?.tool_input?.file_path;
if (typeof filePath !== 'string') allow();

const normalized = '/' + filePath.replace(/\\/g, '/').replace(/^\/+/, '');
if (!normalized.includes(KYRO_STATE_SEGMENT)) allow();

const relativeToKyro = normalized.slice(normalized.indexOf(KYRO_STATE_SEGMENT) + KYRO_STATE_SEGMENT.length);
if (relativeToKyro === 'project.json' || relativeToKyro === 'local.json') block(filePath);

if (normalized.includes(SCOPE_SEGMENT)) {
  if (relativeToKyro.endsWith('/sprint.json')) block(filePath);
  if (relativeToKyro.includes('/archive/')) block(filePath);
  if (relativeToKyro.endsWith('.checkpoint.json')) block(filePath);
}

allow();
