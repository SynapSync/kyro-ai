import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Phase 3 leak guard (design.md §5.4 / tasks.md 3.4): the {{KYRO_CLI}} placeholder must be
// substituted in every projected copy and must remain verbatim in source. Two assertions:
//
// 1. Structural / projected-tree: install into a temp HOME and confirm no file under the
//    projected runtime's skills/commands/agents trees still contains the raw placeholder.
// 2. Source-side: every source skills/** and agents/** markdown file must contain the
//    placeholder token where it used to hold a literal CLI invocation, and must NOT contain a
//    bare literal `kyro <subcommand>` invocation (regression guard against a new mode file
//    shipping raw `kyro close-sprint` instead of `{{KYRO_CLI}} close-sprint`).

const repo = resolve(new URL('..', import.meta.url).pathname);
const require = createRequire(import.meta.url);

const PLACEHOLDER = '{{KYRO_CLI}}';
// Matches a backtick- or code-fence-wrapped bare `kyro <subcommand>` invocation. Deliberately
// requires whitespace after `kyro` so it does not match `kyro.json`, `kyro-forge`, or `/kyro:*`
// slash-command references, which are correctly excluded from the substitution surface.
const BARE_INVOCATION_PATTERN = /(?<![\w/.:-])kyro[ \t]+[a-z][a-z-]*/;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function withWorkspace(prefix, callback) {
  const cwd = mkdtempSync(join(tmpdir(), prefix));
  const previousCwd = process.cwd();
  const previousHome = process.env.HOME;
  try {
    process.chdir(cwd);
    process.env.HOME = join(cwd, '.home');
    return callback(cwd);
  } finally {
    process.chdir(previousCwd);
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    rmSync(cwd, { recursive: true, force: true });
  }
}

function captureLogs(callback) {
  const originalLog = console.log;
  try {
    console.log = () => {};
    callback();
  } finally {
    console.log = originalLog;
  }
}

function listFilesRecursive(root) {
  if (!existsSync(root)) return [];
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) files.push(full);
    }
  };
  walk(root);
  return files;
}

// --- 1. Projected-tree assertion: no leaked placeholder after install ---

withWorkspace('kyro-no-placeholder-', (cwd) => {
  const { install } = require(join(repo, 'dist/cli/commands/install.js'));
  captureLogs(() =>
    install({
      agents: [],
      scope: 'workspace',
      dryRun: false,
      yes: true,
      help: false,
      tokens: false,
      artifacts: false,
      adapters: false,
      kyroScope: null,
      json: false,
      purgeAdapterAssets: false,
      prune: false,
    }),
  );

  const home = join(cwd, '.home');
  const runtimeDir = join(home, '.agents', 'kyro', 'current');
  const projectedRoots = [
    join(runtimeDir, 'skills'),
    join(runtimeDir, 'commands'),
    join(runtimeDir, 'core', 'agents'),
  ];

  for (const root of projectedRoots) {
    const files = listFilesRecursive(root);
    assert(files.length > 0, `check-no-placeholder: expected projected files under ${root}`);
    for (const file of files) {
      const text = readFileSync(file, 'utf-8');
      assert(!text.includes(PLACEHOLDER), `check-no-placeholder: projected file leaks raw placeholder: ${file}`);
    }
  }
});

// --- 2. Source-side assertion: placeholder present, no bare literal invocation ---

const sourceRoots = [join(repo, 'internal', 'skills'), join(repo, 'agents')];
let placeholderFilesFound = 0;

for (const root of sourceRoots) {
  for (const file of listFilesRecursive(root)) {
    if (!file.endsWith('.md')) continue;
    const text = readFileSync(file, 'utf-8');
    if (text.includes(PLACEHOLDER)) placeholderFilesFound += 1;
    const bareMatch = text.match(BARE_INVOCATION_PATTERN);
    assert(
      !bareMatch,
      `check-no-placeholder: source file has a bare literal CLI invocation "${bareMatch?.[0]}" — use {{KYRO_CLI}} instead: ${file}`,
    );
  }
}

assert(placeholderFilesFound >= 14, `check-no-placeholder: expected at least 14 source files carrying ${PLACEHOLDER}, found ${placeholderFilesFound}`);

console.log(`check:no-placeholder — no projected leak; ${placeholderFilesFound} source files carry ${PLACEHOLDER} verbatim`);
