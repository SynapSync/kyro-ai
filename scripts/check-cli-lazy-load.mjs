#!/usr/bin/env node
// The CLI must load only what a verb needs, and the startup fast paths must stay tiny.
//
// dist/cli/app.js used to import all ~30 command modules at the top, so `kyro --version` paid for the
// whole CLI (about 90 ms against 30 ms now). This check runs the real dist/cli.js with a Module._load
// hook and asserts, deterministically (no wall-clock budget), the exact set of modules each fast path loads.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(fileURLToPath(import.meta.url), '../..');
const cli = join(repo, 'dist/cli.js');
if (!existsSync(cli)) {
  console.error('check:cli-lazy-load FAILED: dist/cli.js is missing; run npm run build first.');
  process.exit(1);
}

const probe = `
const Module = require('module');
const path = require('path');
const dist = [];
const external = [];
const original = Module._load;
Module._load = function (request, parent, isMain) {
  const file = Module._resolveFilename(request, parent, isMain);
  if (path.isAbsolute(file)) {
    const normalized = file.split(path.sep).join('/');
    const marker = normalized.indexOf('/dist/');
    if (marker >= 0 && normalized.startsWith(${JSON.stringify(repo.split('\\').join('/'))})) dist.push(normalized.slice(marker + 6));
    else external.push(normalized);
  }
  return original.apply(this, arguments);
};
process.on('exit', () => { process.stderr.write('\\n@@LOADED@@' + JSON.stringify({ dist: [...new Set(dist)], external: [...new Set(external)] }) + '\\n'); });
process.argv = [process.argv[0], ${JSON.stringify(cli)}, ...JSON.parse(process.env.KYRO_PROBE_ARGS)];
require(${JSON.stringify(cli)});
`;

function loadedModules(args) {
  const run = spawnSync(process.execPath, ['-e', probe], {
    cwd: repo,
    encoding: 'utf-8',
    env: { ...process.env, KYRO_PROBE_ARGS: JSON.stringify(args) },
  });
  const marker = /@@LOADED@@(.*)/.exec(run.stderr ?? '');
  if (!marker) throw new Error(`probe for [${args.join(' ')}] produced no module list:\n${run.stderr}`);
  return JSON.parse(marker[1]);
}

// Exact module sets. Adding a file here is a deliberate decision to slow down startup: prefer a
// require() inside the verb branch (src/cli/app.ts) or a lazy import in the module that pulls it in.
const FAST_PATH = [
  'cli.js',
  'cli/app.js',
  'cli/help.js',
  'cli/constants.js',
  'cli/core/errors.js',
  'cli/core/cli-envelope.js',
  'cli/core/capabilities.js',
];
// --help renders the agent list from the adapter registry, which legitimately loads about 40
// modules and whose exact set shifts whenever an adapter or its helpers change. An allowlist would be
// churn, so it gets a ceiling (40 today) plus the hard rule that no command module loads.
const HELP_MAX_DIST_MODULES = 50;

const cases = [
  ...['--version', '-v', 'version'].map((arg) => ({ args: [arg], allowed: FAST_PATH, noExternal: true })),
  { args: ['capabilities', '--json'], allowed: [...FAST_PATH, 'cli/commands/capabilities.js'], noExternal: false },
  ...['--help', '-h', 'help'].map((arg) => ({ args: [arg], maxDist: HELP_MAX_DIST_MODULES, noCommands: true })),
];

const failures = [];
for (const { args, allowed, noExternal, maxDist, noCommands } of cases) {
  const label = `kyro ${args.join(' ')}`;
  const { dist, external } = loadedModules(args);
  if (allowed) {
    const extra = dist.filter((file) => !allowed.includes(file));
    if (extra.length > 0) failures.push(`${label} loaded modules outside its allowlist: ${extra.join(', ')}. Lazy-load them with require() inside the verb branch, or add them to the allowlist in this script on purpose.`);
  }
  if (noCommands) {
    const commands = dist.filter((file) => file.startsWith('cli/commands/'));
    if (commands.length > 0) failures.push(`${label} loaded command modules: ${commands.join(', ')}. Lazy-load them.`);
  }
  if (maxDist !== undefined && dist.length > maxDist) failures.push(`${label} loaded ${dist.length} dist modules, more than the ${maxDist} ceiling. Lazy-load the new imports or raise the ceiling on purpose.`);
  if (noExternal && external.length > 0) failures.push(`${label} loaded non-dist modules: ${external.join(', ')}. The fast path must not load node_modules.`);
}

if (failures.length > 0) {
  console.error(`check:cli-lazy-load FAILED\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log(`check:cli-lazy-load OK (${cases.length} invocations)`);
