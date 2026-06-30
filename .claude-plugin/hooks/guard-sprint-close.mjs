#!/usr/bin/env node
// Kyro PreToolUse guard — deterministic zero-loss enforcement (Claude Code only).
//
// The ONLY legitimate way to clear `activeSprint` is `kyro close-sprint`, which snapshots the
// sprint to archive/ before clearing it and writes via Node fs (NOT the Write/Edit tools — so it
// never reaches this hook). Therefore any Write/Edit that flips a scope's sprint.json
// `activeSprint` from non-null to null is a hand-edited close, the exact action that destroyed
// Sprint data before. Block it and point the agent at the command.
//
// Exit 0 = allow. Exit 2 = block (stderr is fed back to the agent).

import { readFileSync, existsSync } from 'node:fs';
import { basename } from 'node:path';

function allow() {
  process.exit(0);
}

function block(message) {
  process.stderr.write(message);
  process.exit(2);
}

let raw = '';
try {
  raw = readFileSync(0, 'utf-8');
} catch {
  allow();
}

let payload;
try {
  payload = JSON.parse(raw);
} catch {
  allow();
}

const toolName = payload?.tool_name;
const toolInput = payload?.tool_input ?? {};
if (toolName !== 'Write' && toolName !== 'Edit') allow();

const filePath = toolInput.file_path;
if (typeof filePath !== 'string' || basename(filePath) !== 'sprint.json') allow();

// Read the current sprint.json from disk (PreToolUse fires before the write).
if (!existsSync(filePath)) allow(); // creating a new file — nothing to protect.
let current;
try {
  current = JSON.parse(readFileSync(filePath, 'utf-8'));
} catch {
  allow(); // unparseable on disk — let repair/recover handle it.
}
if (!current || current.activeSprint == null) allow(); // already null — no close to guard.

// Compute the resulting content after the tool runs.
let resultingText;
if (toolName === 'Write') {
  resultingText = typeof toolInput.content === 'string' ? toolInput.content : '';
} else {
  const original = readFileSync(filePath, 'utf-8');
  const oldStr = toolInput.old_string ?? '';
  const newStr = toolInput.new_string ?? '';
  resultingText = toolInput.replace_all
    ? original.split(oldStr).join(newStr)
    : original.replace(oldStr, newStr);
}

let resulting;
try {
  resulting = JSON.parse(resultingText);
} catch {
  allow(); // resulting JSON unparseable — a different guard/validator will catch it.
}

// The only transition we block: activeSprint non-null -> null via a manual edit.
if (resulting && resulting.activeSprint === null) {
  block(
    [
      'BLOCKED by Kyro: hand-editing sprint.json to clear `activeSprint` is not allowed.',
      'Clearing a sprint by hand skips the zero-loss snapshot and has destroyed sprint data before.',
      '',
      'Close the sprint with the deterministic command instead:',
      `  kyro close-sprint --kyro-scope ${current.scope ?? '<scope>'} --outcome <shipped|partial|...>`,
      '',
      'It snapshots activeSprint to archive/ BEFORE clearing it, appends the ledger entry, and',
      'updates the handoff atomically. Do additive conventions/debt edits first, then run it.',
    ].join('\n'),
  );
}

allow();
