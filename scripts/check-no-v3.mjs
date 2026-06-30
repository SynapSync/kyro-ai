import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Fail the build if the agent-facing runtime references a v3 artifact as something to read/write.
// The runtime (agents/, commands/, skills/) must speak only the v4 sprint.json model.
// Prohibitive mentions ("do not create state.json", "... are v3 artifacts") are allowed.

const repo = resolve(new URL('..', import.meta.url).pathname);
const ROOTS = ['agents', 'commands', 'skills'];
const SKIP_DIRS = new Set(['old-to-delete', 'node_modules']);
// manifest.json is a historical changelog (describes past v3-era versions), not agent instructions.
const SKIP_FILES = new Set(['manifest.json']);

const V3_PATTERNS = [
  /\bstate\.json\b/,
  /\bindex\.json\b/,
  /\bROADMAP\.md\b/,
  /\bROADMAP\.summary\b/,
  /\bDEBT\.summary\b/,
  /\bSPRINT\.summary\b/,
  /\bevents\.ndjson\b/,
  /\brules\.index\b/,
  /\brules\.md\b/,
  /\bRE-?ENTRY-?PROMPTS\b/i,
  /\.summary\.json\b/,
  /\bphases\//,
];

// A line that references a v3 artifact is OK only if it is clearly prohibitive/explanatory.
const ALLOW_MARKERS = /\b(no|not|never|don't|do not|v3|migrate|deprecated|instead of|no longer|are v3|legacy)\b/i;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out.push(...walk(join(dir, entry.name)));
    } else if (/\.(md|json|ya?ml)$/.test(entry.name) && !SKIP_FILES.has(entry.name)) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

const violations = [];
for (const root of ROOTS) {
  const abs = join(repo, root);
  try { statSync(abs); } catch { continue; }
  for (const file of walk(abs)) {
    const lines = readFileSync(file, 'utf-8').split(/\r?\n/);
    lines.forEach((line, i) => {
      if (!V3_PATTERNS.some((p) => p.test(line))) return;
      if (ALLOW_MARKERS.test(line)) return; // prohibitive / explanatory mention
      violations.push(`${file.slice(repo.length + 1)}:${i + 1}  ${line.trim()}`);
    });
  }
}

if (violations.length > 0) {
  console.error('check:no-v3 FAILED — runtime references v3 artifacts as read/write targets:');
  for (const v of violations) console.error(`  ${v}`);
  console.error('\nThe runtime must use only sprint.json (v4). Reword or remove these references.');
  process.exit(1);
}

console.log('check:no-v3 — runtime is clean (no v3 artifact instructions)');
