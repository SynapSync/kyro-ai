#!/usr/bin/env node
// Kyro PreToolUse guard — deterministic zero-loss enforcement (Claude Code only).
//
// Two independent protections over a scope's sprint.json, both keyed on the fact that the
// legitimate CLI writers (`kyro plan`, `kyro close-sprint`, ...) write via Node fs, NOT via the
// Write/Edit tools — so a real CLI write never reaches this hook at all.
//
// 1. HAND-CLOSE (original): any Write/Edit that flips a scope's `activeSprint` from non-null to
//    null is a hand-edited close, the exact action that destroyed sprint data before.
//
// 2. HAND-AUTHORED SCOPE (added 4.42.0): creating a scope's sprint.json by hand with a shape that
//    is not a routable v4 document. A scope whose sprint.json has no `handoff` cannot be routed by
//    `context-pack` at all — it is dead on arrival. Observed in the field: a full scope written by
//    hand with no `schemaVersion`, no `handoff`, and `activeSprint` as an integer.
//    The gate is deliberately MINIMAL — only what makes the document routable — because INIT.md
//    authorizes a narrow hand-write fallback when the CLI genuinely cannot run, and recover.md
//    rebuilds sprint.json through Write. Both produce complete v4 documents and pass.
//
// Exit 0 = allow. Exit 2 = block (stderr is fed back to the agent).

import { readFileSync, existsSync } from 'node:fs';
import { basename } from 'node:path';

/** Scope artifacts live under this segment; anything else named sprint.json is not ours. */
const SCOPE_SEGMENT = '.agents/kyro/scopes/';

/**
 * Minimal routability gate for a newly created sprint.json. Returns an array of human-readable
 * problems; empty means the document is routable. Intentionally does NOT check spec/roadmap/
 * conventions/task shape — a stricter gate would produce false positives on the legitimate
 * recovery fallback.
 */
function routabilityProblems(doc) {
  const problems = [];
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    return ['the document is not a JSON object'];
  }
  if (doc.schemaVersion !== 4) {
    problems.push(`\`schemaVersion\` must be the number 4 (got ${JSON.stringify(doc.schemaVersion)})`);
  }
  if (typeof doc.scope !== 'string' || doc.scope.trim() === '') {
    problems.push('`scope` must be a non-empty string');
  }
  const handoff = doc.handoff;
  if (handoff === null || typeof handoff !== 'object' || Array.isArray(handoff)) {
    problems.push('`handoff` must be an object — without it `context-pack` cannot route this scope');
  } else if (typeof handoff.nextAction !== 'string' || handoff.nextAction.trim() === '') {
    problems.push('`handoff.nextAction` must be a non-empty string');
  }
  const active = doc.activeSprint;
  if (active !== null && (typeof active !== 'object' || Array.isArray(active))) {
    problems.push(
      `\`activeSprint\` must be a sprint object or null (got ${JSON.stringify(active)})`,
    );
  }
  return problems;
}

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
// Only guard scope artifacts. An unrelated sprint.json elsewhere on disk is not ours to police.
if (!filePath.replace(/\\/g, '/').includes(SCOPE_SEGMENT)) allow();

// PreToolUse fires before the write, so the file on disk is still the pre-write state.
if (!existsSync(filePath)) {
  // --- Protection 2: creating a scope's sprint.json by hand ---
  // `kyro plan --from` writes via Node fs and never lands here, so a Write reaching this point is
  // a hand-authored scope. Allowed only if it is a routable v4 document.
  if (toolName !== 'Write') allow(); // Edit against a missing file fails on its own.
  const content = toolInput.content;
  if (typeof content !== 'string') allow(); // malformed payload — fail open, as everywhere else here.
  let created;
  try {
    created = JSON.parse(content);
  } catch {
    block(
      [
        'BLOCKED by Kyro: this would create a scope sprint.json that is not valid JSON.',
        '',
        'Materialize the scope with the tool-owned command instead:',
        '  kyro plan --from <lean-plan.json>',
      ].join('\n'),
    );
  }
  const problems = routabilityProblems(created);
  if (problems.length > 0) {
    block(
      [
        'BLOCKED by Kyro: hand-authoring a scope sprint.json with a non-routable shape is not allowed.',
        '',
        `Problems with ${filePath}:`,
        ...problems.map((p) => `  - ${p}`),
        '',
        'A scope written this way cannot be routed: `context-pack` derives nextAction from `handoff`,',
        'so a document missing it is dead on arrival and every later Kyro action fails.',
        '',
        'Materialize the scope with the tool-owned command instead — it validates the shape and',
        'registers the scope in project.json/local.json for you:',
        '  kyro plan --from <lean-plan.json>',
        '',
        'Hand-writing sprint.json is a recovery-only fallback for when the CLI genuinely cannot run,',
        'and even then it must produce a complete v4 document (see assets/modes/INIT.md).',
      ].join('\n'),
    );
  }
  allow(); // routable hand-write (recovery fallback / recover.md rebuild).
}

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
