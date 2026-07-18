#!/usr/bin/env node
// Kyro PreToolUse guard — bounds unbounded search output (Claude Code only).
//
// A broad `rg`/`grep -r` with NO output cap can pull tens of thousands of tokens into
// context in a single call — the dominant token cost measured in real Kyro runs. Every
// legitimate form is cheap to make bounded: cap the results (-m/-l/-c), scope to a
// path/glob, pipe to `head`, or redirect to a file. Block only the bare broad form and
// hand the agent the bounded alternative; it re-runs and moves on.
//
// This runs on EVERY Bash call, so it is deliberately conservative — it fails OPEN on
// anything ambiguous and blocks only the clearest offender (a recursive content search
// with no cap, no scope, and no redirect). It never touches tests or non-search commands.
//
// Exit 0 = allow. Exit 2 = block (stderr is fed back to the agent).

import { readFileSync } from 'node:fs';

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

if (payload?.tool_name !== 'Bash') allow();

const command = payload?.tool_input?.command;
if (typeof command !== 'string' || command.trim() === '') allow();

// Collapse quoted substrings to a single placeholder so a multi-word pattern
// ("foo bar") counts as one token and never masquerades as a path argument.
const stripped = command.replace(/'[^']*'/g, ' Q ').replace(/"[^"]*"/g, ' Q ');

// 1) Is this a recursive content search? ripgrep is recursive by default; grep only
//    with -r/-R/--recursive (including bundled short flags like -rn).
const hasRg = /(^|[\s|&;(])rg(\s|$)/.test(stripped);
const hasGrep = /(^|[\s|&;(])grep(\s|$)/.test(stripped);
const grepRecursive =
  hasGrep && (/(^|\s)-[a-zA-Z]*[rR][a-zA-Z]*(\s|$)/.test(stripped) || /(^|\s)--recursive(\s|$)/.test(stripped));
if (!hasRg && !grepRecursive) allow();

// 2) Any output cap, scope filter, pipe-to-limiter, or redirect makes it bounded.
const bounded =
  /(^|\s)-[a-zA-Z]*[lLcq][a-zA-Z]*(\s|$)/.test(stripped) || // -l -L -c -q (and bundles like -rl)
  /(^|\s)-m(\s|=|\d)/.test(stripped) || // -m N / -m5
  /--max-count\b/.test(stripped) ||
  /--count\b/.test(stripped) ||
  /--count-matches\b/.test(stripped) ||
  /--files-with-matches\b/.test(stripped) ||
  /--files-without-match\b/.test(stripped) ||
  /--quiet\b/.test(stripped) ||
  /--glob\b/.test(stripped) ||
  /(^|\s)-g(\s|=)/.test(stripped) ||
  /--include\b/.test(stripped) ||
  /--type\b/.test(stripped) ||
  /(^|\s)-t(\s|=)/.test(stripped) ||
  /\|\s*(head|tail|wc|less|tee)\b/.test(stripped) ||
  /(>>|>)/.test(stripped);
if (bounded) allow();

// 3) An explicit narrowing path/file argument makes it scoped. Inspect the segment that
//    holds the search tool; the first non-flag token is the pattern, so a real path is
//    either a token containing "/" or a second bareword. Numeric tokens (values of flags
//    like -A 3 / -C 2) and "." (whole tree) do not count as scoping.
const segment =
  stripped
    .split(/&&|\|\|?|;|\n/)
    .find((s) => /(^|\s)rg(\s|$)/.test(s) || /(^|\s)grep(\s|$)/.test(s)) ?? stripped;
const tokens = segment.trim().split(/\s+/);
const toolIdx = tokens.findIndex((t) => t === 'rg' || t === 'grep');
const args = toolIdx >= 0 ? tokens.slice(toolIdx + 1) : tokens;
const scopeTokens = args.filter((t) => t && !t.startsWith('-') && t !== '.' && t !== './' && !/^\d+$/.test(t));
const hasPathScope = scopeTokens.some((t) => t.includes('/')) || scopeTokens.length >= 2;
if (hasPathScope) allow();

block(
  [
    'BLOCKED by Kyro: this search has no output bound and can flood context with',
    'tens of thousands of tokens. Re-run it bounded — pick one:',
    "  • list matching files:  add -l        (rg -l 'pat')",
    '  • count matches:        add -c',
    '  • cap results:          add -m 50   or  | head -50',
    "  • scope to a path/glob: rg 'pat' src/feature   or  --glob '*.ts'",
    "  • need it all: redirect to a file:  rg 'pat' > /tmp/hits.txt",
    'Then read only what you need.',
  ].join('\n'),
);
