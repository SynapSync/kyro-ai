import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

// The agent-facing runtime (agents/, commands/, skills/) must speak only the sprint.json model.
// Fail the build if it references any non-model artifact filename as something to read or write.

const repo = resolve(new URL('..', import.meta.url).pathname);
const ROOTS = ['agents', 'commands', 'skills'];
const SKIP_DIRS = new Set(['node_modules']);
const SKIP_FILES = new Set(['manifest.json']);

// Filenames the sprint.json model never uses. Their presence in runtime docs is drift.
const FORBIDDEN_PATTERNS = [
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

// A reference is allowed only if the line is clearly prohibitive ("never create state.json").
const ALLOW_MARKERS = /\b(no|not|never|don't|do not|instead of|no longer)\b/i;

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
      if (!FORBIDDEN_PATTERNS.some((p) => p.test(line))) return;
      if (ALLOW_MARKERS.test(line)) return; // prohibitive / explanatory mention
      violations.push(`${file.slice(repo.length + 1)}:${i + 1}  ${line.trim()}`);
    });
  }
}

if (violations.length > 0) {
  console.error('check:runtime-artifacts FAILED — runtime references non-model artifacts:');
  for (const v of violations) console.error(`  ${v}`);
  console.error('\nThe runtime must use only sprint.json. Reword or remove these references.');
  process.exit(1);
}

console.log('check:runtime-artifacts — runtime speaks only the sprint.json model');
