#!/usr/bin/env node
// The startup handshake must be self-contained in BOTH entry points.
//
// The packaged sprint-forge source must retain the startup contract even though Claude only
// exposes the public command wrappers. Standard/Codex/OpenCode runtime projections still load it.
// `agents/orchestrator.md` is never loaded. It used to carry no startup steps at all — only a
// parenthetical "(Startup handshake)" pointing at the orchestrator — so an agent entering through
// the skill saw unsubstituted {{KYRO_CLI}} tokens, no capability handshake, and no routing call.
// In the field that produced a hand-authored, unroutable scope.
//
// Fixing it means the two files duplicate ~18 lines. This check is what keeps them from drifting:
// every startup element must be present in both, or the build fails.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(fileURLToPath(import.meta.url), '../..');

const ENTRY_POINTS = [
  ['agents/orchestrator.md', 'orchestrator agent'],
  ['internal/skills/sprint-forge/SKILL.md', 'sprint-forge skill (direct-invocation path)'],
];

// Each element is [label, pattern]. Patterns are deliberately loose on prose and strict on the
// operative token, so wording can be edited but the mechanism cannot silently disappear.
const REQUIRED_ELEMENTS = [
  ['placeholder token present verbatim', /\{\{KYRO_CLI\}\}/],
  ['CLI resolution ladder — probe step', /kyro --version/],
  ['CLI resolution ladder — runtime fallback path', /~\/\.agents\/kyro\/current\/dist\/cli\.js/],
  ['CLI resolution ladder — install remedy when absent', /npx kyro-ai@latest install/],
  ['capability handshake', /\{\{KYRO_CLI\}\} capabilities --json/],
  ['handshake guards the tool-owned verbs', /record-evidence/],
  ['routing via the lean context pack', /\{\{KYRO_CLI\}\} context-pack --kyro-scope/],
  ['abort rule on a too-old or missing runtime', /\bABORT\b|\bSTOP\b/],
  ['explicit refusal to fall back to hand-editing', /hand-edit|hand-author|hand-writ/i],
];

const failures = [];

for (const [relativePath, label] of ENTRY_POINTS) {
  let text;
  try {
    text = readFileSync(join(repo, relativePath), 'utf-8');
  } catch (error) {
    failures.push(`${relativePath}: cannot read (${error.message})`);
    continue;
  }
  for (const [element, pattern] of REQUIRED_ELEMENTS) {
    if (!pattern.test(text)) {
      failures.push(`${relativePath} (${label}): missing startup element — ${element} [${pattern}]`);
    }
  }
}

if (failures.length > 0) {
  console.error(`check:startup-contract — ${failures.length} problem(s):\n${failures.join('\n')}`);
  process.exit(1);
}

console.log(
  `check:startup-contract — ${REQUIRED_ELEMENTS.length} startup elements present in all ${ENTRY_POINTS.length} entry points`,
);
