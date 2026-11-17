#!/usr/bin/env node
// Pins what every flag parser accepts and rejects.
//
// Flags are declared as tables read by src/cli/core/flags.ts. That refactor had to change nothing a
// user can observe, so fixtures/flag-parsing/cases.json records, for each parser, the parsed value or
// the thrown error (code, message, remedy) for an argument list per behavior: every flag alone, with a
// value, with its value missing at the end of the list, with a value that starts with --, with an
// empty value, as --flag=value, doubled, next to an unknown flag, and with positionals. The expected
// values were captured from the build before the refactor (commit 7b09b77), not from this code.
//
// The parsers are module-private, so each one is reached by compiling its dist/ file with one extra
// line that exports it. The file is not written anywhere: dist/ is untouched.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(fileURLToPath(import.meta.url), '../..');
const dist = join(repo, 'dist/cli');
const require = createRequire(import.meta.url);
const Module = require('node:module');

if (!existsSync(join(dist, 'core/flags.js'))) {
  console.error('check:flag-parsing FAILED: dist/ is missing or stale; run npm run build first.');
  process.exit(1);
}

const fixture = JSON.parse(readFileSync(join(repo, 'fixtures/flag-parsing/cases.json'), 'utf-8'));

const WORK_VERB_FLAGS = ['work', 'task', 'from', 'by', 'reason', 'expect-revision', 'yes'];
// id -> where the parser lives and how to call it with an argument list.
const PARSERS = {
  options: ['options.js', 'parseOptions', (f, a) => f(a)],
  'record-evidence': ['commands/record-evidence.js', 'parseRecordEvidenceArgs', (f, a) => f(a)],
  'debt-add': ['commands/debt.js', 'parseAddArgs', (f, a) => f(a)],
  'debt-resolve': ['commands/debt.js', 'parseResolveArgs', (f, a) => f(a)],
  'debt-defer': ['commands/debt.js', 'parseDeferArgs', (f, a) => f(a)],
  'debt-escalate': ['commands/debt.js', 'parseEscalateArgs', (f, a) => f(a)],
  'debt-start': ['commands/debt.js', 'parseTargetIdArgs', (f, a) => f(a, 'start')],
  'add-emergent': ['commands/add-emergent.js', 'parseAddEmergentArgs', (f, a) => f(a)],
  'adr-add': ['commands/adr.js', 'parseAdrAddArgs', (f, a) => f(a)],
  'scenario-add': ['commands/scenario.js', 'parseScenarioAddArgs', (f, a) => f(a)],
  'scenario-link': ['commands/scenario.js', 'parseScenarioLinkArgs', (f, a) => f(a)],
  'rule-add': ['commands/rule.js', 'parseRuleAddArgs', (f, a) => f(a)],
  'rule-update': ['commands/rule.js', 'parseLocalRuleArgs', (f, a) => f('update', a)],
  'rule-remove': ['commands/rule.js', 'parseLocalRuleArgs', (f, a) => f('remove', a)],
  'rule-replace': ['commands/rule.js', 'parseLocalRuleArgs', (f, a) => f('replace', a)],
  status: ['commands/status.js', 'parseStatusArgs', (f, a) => f(a)],
  trace: ['commands/trace.js', 'parseTraceArgs', (f, a) => f(a)],
  'close-sprint': ['commands/close-sprint.js', 'parseCloseSprintArgs', (f, a) => f(a)],
  plan: ['commands/plan.js', 'parsePlanArgs', (f, a) => f(a)],
  review: ['commands/review.js', 'parseReviewArgs', (f, a) => f(a)],
  'remediate-canonicalize': ['commands/remediate.js', 'parseCanonicalizeArgs', (f, a) => f(a)],
  remediate: ['commands/remediate.js', 'parseArgs', (f, a) => f(a, 'preview')],
  recertify: ['commands/recertify.js', 'parseArgs', (f, a) => f(a, 'preview')],
  'repair-integrity': ['commands/repair.js', 'parseIntegrityArgs', (f, a) => f(a)],
  clarify: ['commands/clarify.js', 'parseClarifyArgs', (f, a) => f(a)],
  'scope-set-active': ['commands/scope.js', 'parseSetActiveArgs', (f, a) => f(a)],
  'scope-discard': ['commands/scope.js', 'parseDiscardArgs', (f, a) => f(a)],
  'scope-retire': ['commands/scope.js', 'parseRetireArgs', (f, a) => f(a)],
  'scope-complete': ['commands/scope.js', 'parseCompleteArgs', (f, a) => f(a)],
  'scope-reopen': ['commands/scope.js', 'parseReopenArgs', (f, a) => f(a)],
  // work.ts has one parser; the verbs differ only in the flag names they allow.
  'work-parse-a': ['commands/work.js', 'parse', (f, a) => f(a, WORK_VERB_FLAGS)],
  'work-parse-b': ['commands/work.js', 'parse', (f, a) => f(a, ['work', 'task'])],
  'work-parse-c': ['commands/work.js', 'parse', (f, a) => f(a, ['work', 'json', 'yes', 'dry-run'])],
};

const hooked = new Map();
function privateExports(file, names) {
  const key = `${file}:${names.join(',')}`;
  if (hooked.has(key)) return hooked.get(key);
  const path = join(dist, file);
  const hook = `\nmodule.exports.__p = {${names.map((name) => `${name}: typeof ${name} === 'function' ? ${name} : undefined`).join(', ')}};\n`;
  const loaded = new Module(path, null);
  loaded.filename = path;
  loaded.paths = Module._nodeModulePaths(dirname(path));
  loaded._compile(readFileSync(path, 'utf-8') + hook, path);
  hooked.set(key, loaded.exports.__p);
  return loaded.exports.__p;
}

const UNDEFINED = '__undefined__';
const normalize = (value) => JSON.parse(JSON.stringify(value, (_key, v) => (v === undefined ? UNDEFINED : typeof v === 'number' && !Number.isFinite(v) ? `__num_${v}__` : v)));

const failures = [];
const fail = (message) => { if (failures.length < 25) failures.push(message); else if (failures.length === 25) failures.push('... more failures omitted'); };

const namesByFile = new Map();
for (const [file, fn] of Object.values(PARSERS).map(([f, n]) => [f, n])) {
  namesByFile.set(file, [...new Set([...(namesByFile.get(file) ?? []), fn])]);
}

const perParser = new Map();
for (const [id, args, expected] of fixture.cases) {
  const entry = PARSERS[id];
  if (!entry) { fail(`unknown parser id in fixture: ${id}`); continue; }
  const [file, fnName, call] = entry;
  const fn = privateExports(file, namesByFile.get(file))[fnName];
  if (typeof fn !== 'function') { fail(`${id}: ${fnName} is not defined in dist/cli/${file}`); continue; }
  let actual;
  try {
    actual = { ok: call(fn, [...args]) };
  } catch (error) {
    actual = { error: { code: error.code, message: error.message, remedy: error.remedy } };
  }
  perParser.set(id, (perParser.get(id) ?? 0) + 1);
  if (JSON.stringify(normalize(actual)) !== JSON.stringify(expected)) {
    fail(`${id} ${JSON.stringify(args)}\n  expected ${JSON.stringify(expected)}\n  actual   ${JSON.stringify(normalize(actual))}`);
  }
}
for (const id of Object.keys(PARSERS)) {
  if (!perParser.get(id)) fail(`no cases for parser ${id}`);
}

// Help text must stay byte-identical; the fixture holds the sha256 of each command's output.
const help = require(join(dist, 'help.js'));
function captured(print) {
  const original = console.log;
  let text = '';
  console.log = (...parts) => { text += `${parts.join(' ')}\n`; };
  try { print(); } finally { console.log = original; }
  return createHash('sha256').update(text).digest('hex');
}
for (const [command, digest] of Object.entries(fixture.help)) {
  const actual = captured(command === '__root' ? () => help.printHelp() : () => help.printCommandHelp(command));
  if (actual !== digest) fail(`help for ${command} changed (sha256 ${actual}, expected ${digest})`);
}

// The same behavior through the real process: exit code, stdout, stderr, and the --json envelope.
const sandbox = mkdtempSync(join(tmpdir(), 'kyro-flag-parsing-'));
try {
  for (const [args, expected] of fixture.cli) {
    const run = spawnSync(process.execPath, [join(repo, 'dist/cli.js'), ...args], {
      cwd: sandbox,
      env: { PATH: process.env.PATH, HOME: join(sandbox, 'home') },
      encoding: 'utf-8',
    });
    const actual = { status: run.status, stdout: run.stdout, stderr: run.stderr };
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      fail(`kyro ${args.join(' ')}\n  expected ${JSON.stringify(expected)}\n  actual   ${JSON.stringify(actual)}`);
    }
  }
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`check:flag-parsing FAILED (${failures.length} problem${failures.length === 1 ? '' : 's'}):\n${failures.join('\n')}`);
  process.exit(1);
}
console.log(`check:flag-parsing passed: ${fixture.cases.length} parser cases across ${Object.keys(PARSERS).length} parsers, ${Object.keys(fixture.help).length} help texts, ${fixture.cli.length} CLI runs.`);
