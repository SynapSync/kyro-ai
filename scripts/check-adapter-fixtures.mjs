import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repo = resolve(new URL('..', import.meta.url).pathname);
const require = createRequire(import.meta.url);
const packageJson = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf-8'));
const version = packageJson.version;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function createWorkspace(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

function clearDistCache() {
  const distRoot = join(repo, 'dist');
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(distRoot)) delete require.cache[key];
  }
}

function withWorkspace(prefix, callback) {
  const cwd = createWorkspace(prefix);
  const previousCwd = process.cwd();
  const previousHome = process.env.HOME;
  try {
    process.chdir(cwd);
    process.env.HOME = join(cwd, '.home');
    clearDistCache();
    return callback(cwd);
  } finally {
    process.chdir(previousCwd);
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    clearDistCache();
    rmSync(cwd, { recursive: true, force: true });
  }
}

function captureLogs(callback) {
  const logs = [];
  const originalLog = console.log;
  try {
    console.log = (...args) => logs.push(args.join(' '));
    callback();
  } finally {
    console.log = originalLog;
  }
  return `${logs.join('\n')}\n`;
}

function cliOptions(overrides = {}) {
  return {
    agents: [],
    scope: 'workspace',
    dryRun: false,
    yes: true,
    help: false,
    tokens: false,
    artifacts: false,
    adapters: false,
    kyroScope: null,
    ...overrides,
  };
}

function dryRunPlan(agentArg) {
  return withWorkspace('kyro-adapter-plan-', () => {
    const { parseAgent } = require(join(repo, 'dist/cli/options.js'));
    const { install } = require(join(repo, 'dist/cli/commands/install.js'));
    const agents = agentArg.split(',').map((agent) => parseAgent(agent));
    return captureLogs(() => install(cliOptions({ agents, dryRun: true })));
  });
}

function countIncludes(text, needle) {
  return text.split(needle).length - 1;
}

function assertCommonPlan(plan, name) {
  assert(plan.includes('Install plan'), `${name}: missing install plan title`);
  assert(plan.includes('- mkdir .agents/kyro/scopes'), `${name}: missing artifact root mkdir`);
  assert(plan.includes(`- write ~/.agents/kyro/versions/${version}/manifest.json`), `${name}: missing version manifest`);
  assert(plan.includes(`- write ~/.agents/kyro/versions/${version}/KYRO.md`), `${name}: missing runtime bootstrap`);
  assert(plan.includes('- symlink ~/.agents/kyro/current'), `${name}: missing current symlink`);
  for (const command of ['forge', 'status', 'wrap-up']) {
    assert(plan.includes(`- write ~/.agents/skills/kyro-${command}/SKILL.md`), `${name}: missing ${command} command skill`);
  }
}

const standardPlan = dryRunPlan('standard');
const openCodePlan = dryRunPlan('opencode');
const codexPlan = dryRunPlan('codex');
const combinedPlan = dryRunPlan('standard,opencode,codex');

assertCommonPlan(standardPlan, 'standard');
assertCommonPlan(openCodePlan, 'opencode');
assertCommonPlan(codexPlan, 'codex');
assertCommonPlan(combinedPlan, 'combined');

assert(!standardPlan.includes('- upsert-block AGENTS.md # agents-md'), 'standard: should not manage AGENTS.md block');
assert(!openCodePlan.includes('- upsert-block AGENTS.md # agents-md'), 'opencode: should not manage AGENTS.md block');
assert(codexPlan.includes('- upsert-block AGENTS.md # agents-md'), 'codex: should manage AGENTS.md block');
assert(combinedPlan.includes('- upsert-block AGENTS.md # agents-md'), 'combined: should manage AGENTS.md block once');

assert(standardPlan === openCodePlan, 'opencode plan should match standard plan until native OpenCode support is implemented');
assert(countIncludes(combinedPlan, '- write ~/.agents/skills/kyro-forge/SKILL.md') === 1, 'combined: forge skill should be projected once');
assert(countIncludes(combinedPlan, '- upsert-block AGENTS.md # agents-md') === 1, 'combined: AGENTS.md block should be projected once');

withWorkspace('kyro-adapter-install-', (installDir) => {
  const { parseAgent } = require(join(repo, 'dist/cli/options.js'));
  const { install, sync } = require(join(repo, 'dist/cli/commands/install.js'));
  const { uninstall } = require(join(repo, 'dist/cli/commands/uninstall.js'));
  const codex = parseAgent('codex');
  writeFileSync(join(installDir, 'AGENTS.md'), '# Workspace Notes\n\nKeep this user content.\n', 'utf-8');

  captureLogs(() => install(cliOptions({ agents: [codex] })));

  const home = join(installDir, '.home');
  for (const command of ['forge', 'status', 'wrap-up']) {
    const skillPath = join(home, '.agents', 'skills', `kyro-${command}`, 'SKILL.md');
    assert(existsSync(skillPath), `install: missing projected skill ${skillPath}`);
  }
  assert(existsSync(join(home, '.agents', 'kyro', 'versions', version, 'manifest.json')), 'install: missing runtime manifest');
  assert(existsSync(join(home, '.agents', 'kyro', 'current')), 'install: missing current runtime link');

  let agentsText = readFileSync(join(installDir, 'AGENTS.md'), 'utf-8');
  assert(agentsText.includes('Keep this user content.'), 'install: user AGENTS.md content was not preserved');
  assert(countIncludes(agentsText, '<!-- kyro-ai:agents-md:start -->') === 1, 'install: expected one Kyro start marker');
  assert(countIncludes(agentsText, '<!-- kyro-ai:agents-md:end -->') === 1, 'install: expected one Kyro end marker');

  captureLogs(() => sync(cliOptions({ agents: [codex] })));
  agentsText = readFileSync(join(installDir, 'AGENTS.md'), 'utf-8');
  assert(countIncludes(agentsText, '<!-- kyro-ai:agents-md:start -->') === 1, 'sync: duplicated Kyro start marker');
  assert(countIncludes(agentsText, '<!-- kyro-ai:agents-md:end -->') === 1, 'sync: duplicated Kyro end marker');
  assert(agentsText.includes('Keep this user content.'), 'sync: user AGENTS.md content was not preserved');

  captureLogs(() => uninstall(cliOptions()));
  agentsText = readFileSync(join(installDir, 'AGENTS.md'), 'utf-8');
  assert(!agentsText.includes('<!-- kyro-ai:agents-md:start -->'), 'uninstall: Kyro start marker still present');
  assert(!agentsText.includes('<!-- kyro-ai:agents-md:end -->'), 'uninstall: Kyro end marker still present');
  assert(agentsText.includes('Keep this user content.'), 'uninstall: user AGENTS.md content was not preserved');
});

withWorkspace('kyro-adapter-doctor-', () => {
  const { doctor } = require(join(repo, 'dist/cli/commands/doctor.js'));
  const output = captureLogs(() => doctor(cliOptions({ adapters: true })));
  for (const agent of ['standard', 'opencode', 'codex', 'claude', 'cursor']) {
    assert(output.includes(`adapter inventory: ${agent}`), `doctor --adapters: missing ${agent}`);
  }
  assert(output.includes('status=implemented'), 'doctor --adapters: missing implemented status');
  assert(output.includes('status=planned'), 'doctor --adapters: missing planned status');
  assert(output.includes('capabilities=command-skills'), 'doctor --adapters: missing command-skills capability');
  assert(output.includes('workspace-agents-block'), 'doctor --adapters: missing workspace AGENTS block capability');
});

console.log('Adapter fixtures passed');
