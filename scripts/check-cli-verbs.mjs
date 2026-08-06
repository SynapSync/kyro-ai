#!/usr/bin/env node
// No Kyro asset may reference a CLI verb that does not exist.
//
// Twice in the field an agent closed its report by telling the user to run a command Kyro has never
// had: `kyro execute` in one incident, `kyro execute_task --kyro-scope <s> --task 1.1` in the next.
// Both exit with UNKNOWN_COMMAND. The pattern is not random — there IS no verb for executing a
// task (execution is agent-side; `record-evidence` writes the result), so an agent reaching for one
// finds nothing and fills the gap by inventing.
//
// This check cannot stop a model from improvising mid-conversation, but it guarantees the assets it
// reads never teach a verb that does not resolve, and it fails the build the moment a real verb is
// renamed without updating the docs.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(fileURLToPath(import.meta.url), '../..');

/** Verbs the dispatcher actually accepts, read from source so this can never drift. */
function readRealVerbs() {
  const app = readFileSync(join(repo, 'src/cli/app.ts'), 'utf-8');
  const verbs = new Set();
  for (const match of app.matchAll(/command === '([a-z][a-z-]*)'/g)) verbs.add(match[1]);
  for (const match of app.matchAll(/case '([a-z][a-z-]*)':/g)) verbs.add(match[1]);
  return verbs;
}

function listMarkdown(dir) {
  const out = [];
  const walk = (current) => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith('.md')) out.push(full);
    }
  };
  walk(dir);
  return out;
}

const realVerbs = readRealVerbs();
if (realVerbs.size < 15) {
  console.error(`check:cli-verbs — only parsed ${realVerbs.size} verbs from src/cli/app.ts; the parser is probably stale.`);
  process.exit(1);
}

// `{{KYRO_CLI}} <verb>` in source assets, plus a bare `kyro <verb>` in docs/hooks prose.
const INVOCATION_PATTERNS = [
  /\{\{KYRO_CLI\}\}\s+([a-z][a-z_-]*)/g,
  /(?<![\w/.:-])kyro\s+([a-z][a-z_-]*)/g,
];
// Words that follow "kyro" in prose without being a verb.
const NOT_A_VERB = new Set(['is', 'and', 'or', 'the', 'to', 'a', 'an', 'in', 'on', 'as', 'for', 'with', 'workflows', 'install', 'owns', 'artifacts', 'runtime', 'state', 'scope', 'scopes', 'doctor', 'plugin', 'lens', 'ai']);

/**
 * Docs legitimately name a non-existent verb to say it does not exist — getting-started.md warns
 * that there is no `kyro delegate`. Naming the counter-example is exactly how you stop an agent
 * from inventing it, so a negated line is allowed.
 */
const NEGATION_CUE = /\b(no|not|never|non-existent|unknown_command|instead of|rather than)\b/i;

function lineContaining(text, index) {
  const start = text.lastIndexOf('\n', index) + 1;
  const end = text.indexOf('\n', index);
  return text.slice(start, end === -1 ? undefined : end);
}

const roots = ['internal/skills', 'agents', 'commands', 'docs'].map((dir) => join(repo, dir));
const failures = [];

for (const root of roots) {
  for (const file of listMarkdown(root)) {
    const text = readFileSync(file, 'utf-8');
    for (const pattern of INVOCATION_PATTERNS) {
      for (const match of text.matchAll(pattern)) {
        const verb = match[1];
        if (realVerbs.has(verb) || NOT_A_VERB.has(verb)) continue;
        if (NEGATION_CUE.test(lineContaining(text, match.index))) continue;
        // Underscored words are never verbs (they are nextAction values like execute_task) — the
        // exact shape both field incidents invented, so call it out explicitly.
        const hint = verb.includes('_')
          ? ` — "${verb}" looks like a handoff.nextAction value, not a CLI verb`
          : '';
        failures.push(`${file.slice(repo.length + 1)}: references "kyro ${verb}", which is not a CLI verb${hint}`);
      }
    }
  }
}

if (failures.length > 0) {
  console.error(`check:cli-verbs — ${failures.length} reference(s) to a non-existent CLI verb:`);
  for (const failure of failures) console.error(`  ${failure}`);
  console.error('');
  console.error(`Real verbs: ${[...realVerbs].sort().join(', ')}`);
  process.exit(1);
}

console.log(`check:cli-verbs — every CLI reference in assets resolves to one of ${realVerbs.size} real verbs`);
