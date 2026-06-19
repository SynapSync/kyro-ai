import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
    json: false,
    purgeAdapterAssets: false,
    prune: false,
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

function installPlanSection(output) {
  const marker = 'Install plan\n';
  const index = output.indexOf(marker);
  assert(index >= 0, 'missing install plan section');
  return output.slice(index + marker.length);
}

function assertCommonPlan(plan, name) {
  assert(plan.includes('Adapter preflight (install)'), `${name}: missing adapter preflight`);
  assert(plan.includes('Plan summary:'), `${name}: missing plan summary`);
  assert(plan.includes('Install plan'), `${name}: missing install plan title`);
  assert(plan.includes('- mkdir .agents/kyro/scopes'), `${name}: missing artifact root mkdir`);
  assert(plan.includes(`- write ~/.agents/kyro/versions/${version}/manifest.json`), `${name}: missing version manifest`);
  assert(plan.includes(`- write ~/.agents/kyro/versions/${version}/KYRO.md`), `${name}: missing runtime bootstrap`);
  assert(plan.includes('- symlink ~/.agents/kyro/current'), `${name}: missing current symlink`);
}

function assertStandardCommandSkills(plan, name) {
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
assertStandardCommandSkills(standardPlan, 'standard');
assertStandardCommandSkills(codexPlan, 'codex');
assertStandardCommandSkills(combinedPlan, 'combined');

assert(!standardPlan.includes('- upsert-block AGENTS.md # agents-md'), 'standard: should not manage AGENTS.md block');
assert(!openCodePlan.includes('- upsert-block AGENTS.md # agents-md'), 'opencode: should not manage AGENTS.md block');
assert(codexPlan.includes('- upsert-block AGENTS.md # agents-md'), 'codex: should manage AGENTS.md block');
assert(combinedPlan.includes('- upsert-block AGENTS.md # agents-md'), 'combined: should manage AGENTS.md block once');

assert(standardPlan.includes('- standard: status=implemented;'), 'standard: missing preflight status');
assert(openCodePlan.includes('- opencode: status=implemented;'), 'opencode: missing preflight status');
assert(codexPlan.includes('- codex: status=implemented;'), 'codex: missing preflight status');
assert(openCodePlan.includes('- write ~/.config/opencode/skills/kyro-forge/SKILL.md'), 'opencode: missing native forge skill projection');
assert(openCodePlan.includes('- write ~/.config/opencode/commands/kyro/forge.md'), 'opencode: missing native forge command projection');
assert(openCodePlan.includes('- merge-json ~/.config/opencode/opencode.json'), 'opencode: missing native settings overlay');
assert(!openCodePlan.includes('- write ~/.agents/skills/kyro-forge/SKILL.md'), 'opencode: should not use standard global command skill projection');
assert(countIncludes(combinedPlan, '- write ~/.agents/skills/kyro-forge/SKILL.md') === 1, 'combined: forge skill should be projected once');
assert(countIncludes(combinedPlan, '- upsert-block AGENTS.md # agents-md') === 1, 'combined: AGENTS.md block should be projected once');

withWorkspace('kyro-adapter-preflight-', () => {
  const { parseAgent } = require(join(repo, 'dist/cli/options.js'));
  const { install } = require(join(repo, 'dist/cli/commands/install.js'));
  let failed = false;
  try {
    captureLogs(() => install(cliOptions({ agents: [parseAgent('claude')], dryRun: true })));
  } catch (error) {
    failed = true;
    assert(String(error).includes('not implemented yet: claude'), 'preflight: planned adapter failure should name claude');
    assert(String(error).includes('native projection'), 'preflight: planned adapter failure should mention native projection');
  }
  assert(failed, 'preflight: expected planned adapter install to fail');
});

{
  const { mergeJsonObjectContent } = require(join(repo, 'dist/cli/injectors/json-merge.js'));
  const merged = mergeJsonObjectContent(`{
    // Preserve user settings and comments should parse.
    "model": "anthropic/claude",
    "agent": {
      "existing": {
        "model": "custom",
      }
    },
    "mcp": {
      "user-server": {
        "command": ["node", "server.js"]
      }
    }
  }`, JSON.stringify({
    agent: {
      'kyro-orchestrator': {
        mode: 'primary',
        prompt: '{file:~/.agents/kyro/current/KYRO.md}',
      },
    },
    mcp: {
      kyro: {
        command: ['kyro', 'mcp'],
      },
    },
  }));
  const parsed = JSON.parse(merged);
  assert(parsed.model === 'anthropic/claude', 'json-merge: did not preserve root setting');
  assert(parsed.agent.existing.model === 'custom', 'json-merge: did not preserve nested agent setting');
  assert(parsed.agent['kyro-orchestrator'].mode === 'primary', 'json-merge: did not add nested agent setting');
  assert(parsed.mcp['user-server'].command[1] === 'server.js', 'json-merge: did not preserve existing MCP setting');
  assert(parsed.mcp.kyro.command[0] === 'kyro', 'json-merge: did not add nested MCP setting');
}

{
  const {
    endMarker,
    formatManagedBlock,
    hasManagedBlockContent,
    removeManagedBlock,
    startMarker,
    upsertManagedBlock,
  } = require(join(repo, 'dist/cli/injectors/managed-block.js'));

  const empty = upsertManagedBlock('', 'agents-md', 'hello');
  assert(empty === `${formatManagedBlock('agents-md', 'hello')}\n`, 'managed-block: unexpected empty-file upsert');
  assert(hasManagedBlockContent(empty, 'agents-md'), 'managed-block: missing block after upsert');

  const userContent = '# Notes\n\nKeep me.\n';
  const inserted = upsertManagedBlock(userContent, 'agents-md', 'hello');
  assert(inserted.includes('Keep me.'), 'managed-block: user content not preserved');
  assert(countIncludes(inserted, startMarker('agents-md')) === 1, 'managed-block: duplicate start marker after insert');
  assert(countIncludes(inserted, endMarker('agents-md')) === 1, 'managed-block: duplicate end marker after insert');

  const updated = upsertManagedBlock(inserted, 'agents-md', 'updated');
  assert(updated.includes('updated'), 'managed-block: updated content missing');
  assert(!updated.includes('hello'), 'managed-block: old content still present after update');
  assert(updated.includes('Keep me.'), 'managed-block: user content not preserved after update');
  assert(countIncludes(updated, startMarker('agents-md')) === 1, 'managed-block: duplicate start marker after update');

  const removed = removeManagedBlock(updated, 'agents-md');
  assert(!hasManagedBlockContent(removed, 'agents-md'), 'managed-block: block still present after remove');
  assert(removed.includes('Keep me.'), 'managed-block: user content not preserved after remove');

  const removeMissing = removeManagedBlock(userContent, 'missing');
  assert(removeMissing === userContent.trimEnd() + '\n', 'managed-block: remove missing block should preserve normalized content');

  const specialName = 'agent.block+name?';
  const special = upsertManagedBlock('', specialName, 'symbols');
  assert(hasManagedBlockContent(special, specialName), 'managed-block: special block name not detected');
  assert(removeManagedBlock(special, specialName) === '\n', 'managed-block: special block name not removed');
}

withWorkspace('kyro-adapter-contract-', (cwd) => {
  const { ADAPTERS } = require(join(repo, 'dist/cli/adapters/registry.js'));
  const homeDir = join(cwd, '.home');
  mkdirSync(join(homeDir, '.agents'), { recursive: true });
  mkdirSync(join(homeDir, '.codex'), { recursive: true });
  mkdirSync(join(homeDir, '.config', 'opencode'), { recursive: true });
  mkdirSync(join(homeDir, '.claude'), { recursive: true });
  mkdirSync(join(homeDir, '.cursor'), { recursive: true });

  assert(ADAPTERS.length === 5, `adapter contract: expected 5 adapters, got ${ADAPTERS.length}`);
  for (const adapter of ADAPTERS) {
    assert(typeof adapter.capabilities === 'function', `${adapter.agent}: missing capabilities()`);
    assert(typeof adapter.paths === 'function', `${adapter.agent}: missing paths()`);
    assert(typeof adapter.detect === 'function', `${adapter.agent}: missing detect()`);
    assert(typeof adapter.systemPromptStrategy === 'function', `${adapter.agent}: missing systemPromptStrategy()`);
    assert(typeof adapter.mcpStrategy === 'function', `${adapter.agent}: missing mcpStrategy()`);

    const paths = adapter.paths(homeDir);
    const detection = adapter.detect({ homeDir, envPath: '' });
    assert(detection.agent === adapter.agent, `${adapter.agent}: detection agent mismatch`);
    assert(detection.configPath === (paths.globalConfigDir ?? null), `${adapter.agent}: detection config path mismatch`);
  }

  const byAgent = Object.fromEntries(ADAPTERS.map((adapter) => [adapter.agent, adapter]));
  assert(byAgent.standard.capabilities().join(',') === 'command-skills', 'standard: unexpected capabilities');
  assert(byAgent.standard.systemPromptStrategy() === 'none', 'standard: unexpected system prompt strategy');
  assert(byAgent.standard.mcpStrategy() === 'none', 'standard: unexpected MCP strategy');
  assert(byAgent.standard.detect({ homeDir, envPath: '' }).installed === true, 'standard: should always be installed compatibility adapter');

  assert(byAgent.opencode.paths(homeDir).globalConfigDir.endsWith('/.config/opencode'), 'opencode: unexpected config root');
  assert(byAgent.opencode.capabilities().join(',') === 'command-skills,filesystem-detect,system-prompt,slash-commands', 'opencode: unexpected capabilities');
  assert(byAgent.opencode.systemPromptStrategy() === 'json-agent-overlay', 'opencode: unexpected system prompt strategy');
  assert(byAgent.opencode.mcpStrategy() === 'none', 'opencode: unexpected MCP strategy');
  assert(byAgent.opencode.detect({ homeDir, envPath: '' }).configFound === true, 'opencode: expected config detection');

  assert(byAgent.codex.capabilities().includes('workspace-agents-block'), 'codex: missing workspace block capability');
  assert(byAgent.codex.paths(homeDir).mcpConfigPath.endsWith('/.codex/config.toml'), 'codex: unexpected MCP config path');
  assert(byAgent.codex.systemPromptStrategy() === 'managed-block', 'codex: unexpected system prompt strategy');
  assert(byAgent.codex.mcpStrategy() === 'toml-file', 'codex: unexpected MCP strategy');
  assert(byAgent.codex.detect({ homeDir, envPath: '' }).configFound === true, 'codex: expected config detection');

  assert(byAgent.claude.status === 'planned', 'claude: expected planned status');
  assert(byAgent.claude.paths(homeDir).subAgentsDir.endsWith('/.claude/agents'), 'claude: unexpected sub-agent path');
  assert(byAgent.cursor.status === 'planned', 'cursor: expected planned status');
  assert(byAgent.cursor.systemPromptStrategy() === 'instructions-file', 'cursor: unexpected system prompt strategy');
});

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

withWorkspace('kyro-adapter-opencode-install-', (installDir) => {
  const { parseAgent } = require(join(repo, 'dist/cli/options.js'));
  const { install, sync } = require(join(repo, 'dist/cli/commands/install.js'));
  const { uninstall } = require(join(repo, 'dist/cli/commands/uninstall.js'));
  const opencode = parseAgent('opencode');
  const home = join(installDir, '.home');
  const settingsPath = join(home, '.config', 'opencode', 'opencode.json');
  mkdirSync(join(home, '.config', 'opencode'), { recursive: true });
  writeFileSync(settingsPath, `{
    // Existing OpenCode config should survive.
    "model": "user/model",
    "agent": {
      "existing": {
        "model": "kept",
      }
    },
    "mcp": {
      "user-server": {
        "command": ["node", "server.js"]
      }
    }
  }`, 'utf-8');

  captureLogs(() => install(cliOptions({ agents: [opencode] })));

  for (const command of ['forge', 'status', 'wrap-up']) {
    const skillPath = join(home, '.config', 'opencode', 'skills', `kyro-${command}`, 'SKILL.md');
    const commandPath = join(home, '.config', 'opencode', 'commands', 'kyro', `${command}.md`);
    assert(existsSync(skillPath), `opencode install: missing native skill ${skillPath}`);
    assert(existsSync(commandPath), `opencode install: missing native command ${commandPath}`);
    const commandText = readFileSync(commandPath, 'utf-8');
    assert(commandText.includes(`kyro-${command}/SKILL.md`), `opencode install: command ${command} should route to native skill`);
  }

  let settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
  assert(settings.model === 'user/model', 'opencode install: did not preserve root setting');
  assert(settings.agent.existing.model === 'kept', 'opencode install: did not preserve existing agent');
  assert(settings.mcp['user-server'].command[1] === 'server.js', 'opencode install: did not preserve existing MCP config');
  assert(settings.agent['kyro-orchestrator'].mode === 'primary', 'opencode install: missing kyro orchestrator overlay');
  assert(settings.agent['kyro-orchestrator'].prompt.includes('Kyro workflow orchestrator'), 'opencode install: missing kyro orchestrator prompt');

  const afterInstall = readFileSync(settingsPath, 'utf-8');
  captureLogs(() => sync(cliOptions({ agents: [opencode] })));
  assert(readFileSync(settingsPath, 'utf-8') === afterInstall, 'opencode sync: settings overlay should be idempotent');

  const uninstallOutput = captureLogs(() => uninstall(cliOptions()));
  assert(uninstallOutput.includes('Uninstall summary:'), 'opencode uninstall: missing uninstall summary');
  assert(uninstallOutput.includes('purgeAdapterAssets=no'), 'opencode uninstall: summary should report purge disabled');
  settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
  assert(settings.model === 'user/model', 'opencode uninstall: did not preserve root setting');
  assert(settings.agent.existing.model === 'kept', 'opencode uninstall: did not preserve existing agent');
  assert(!settings.agent['kyro-orchestrator'], 'opencode uninstall: Kyro orchestrator overlay still present');
  assert(settings.mcp['user-server'].command[1] === 'server.js', 'opencode uninstall: did not preserve existing MCP config');
  for (const command of ['forge', 'status', 'wrap-up']) {
    assert(existsSync(join(home, '.config', 'opencode', 'skills', `kyro-${command}`, 'SKILL.md')), `opencode uninstall: should preserve native skill ${command} without purge`);
    assert(existsSync(join(home, '.config', 'opencode', 'commands', 'kyro', `${command}.md`)), `opencode uninstall: should preserve native command ${command} without purge`);
  }

  assert(!existsSync(join(home, '.agents', 'skills', 'kyro-forge', 'SKILL.md')), 'opencode install: should not install standard global skill projection');

  captureLogs(() => install(cliOptions({ agents: [opencode] })));
  const purgeDryRunOutput = captureLogs(() => uninstall(cliOptions({ purgeAdapterAssets: true, dryRun: true })));
  assert(purgeDryRunOutput.includes('purgeAdapterAssets=yes'), 'opencode purge dry-run: summary should report purge enabled');
  assert(purgeDryRunOutput.includes('- remove ~/.config/opencode/skills/kyro-forge/SKILL.md'), 'opencode purge dry-run: plan should include native skill removal');
  assert(purgeDryRunOutput.includes('- remove ~/.config/opencode/commands/kyro/forge.md'), 'opencode purge dry-run: plan should include native command removal');
  assert(purgeDryRunOutput.includes('Dry run complete. No files changed.'), 'opencode purge dry-run: should report no file changes');
  settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
  assert(settings.agent['kyro-orchestrator'], 'opencode purge dry-run: Kyro orchestrator overlay should remain');
  for (const command of ['forge', 'status', 'wrap-up']) {
    assert(existsSync(join(home, '.config', 'opencode', 'skills', `kyro-${command}`, 'SKILL.md')), `opencode purge dry-run: native skill ${command} should remain`);
    assert(existsSync(join(home, '.config', 'opencode', 'commands', 'kyro', `${command}.md`)), `opencode purge dry-run: native command ${command} should remain`);
  }

  const purgeOutput = captureLogs(() => uninstall(cliOptions({ purgeAdapterAssets: true })));
  assert(purgeOutput.includes('purgeAdapterAssets=yes'), 'opencode purge: summary should report purge enabled');
  assert(purgeOutput.includes('- rmdir-if-empty ~/.config/opencode/commands/kyro'), 'opencode purge: plan should clean command namespace directory');
  assert(purgeOutput.includes('- rmdir-if-empty ~/.config/opencode/skills/kyro-forge'), 'opencode purge: plan should clean skill directory');
  settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
  assert(settings.model === 'user/model', 'opencode purge: did not preserve root setting');
  assert(settings.agent.existing.model === 'kept', 'opencode purge: did not preserve existing agent');
  assert(!settings.agent['kyro-orchestrator'], 'opencode purge: Kyro orchestrator overlay still present');
  for (const command of ['forge', 'status', 'wrap-up']) {
    assert(!existsSync(join(home, '.config', 'opencode', 'skills', `kyro-${command}`, 'SKILL.md')), `opencode purge: native skill ${command} still present`);
    assert(!existsSync(join(home, '.config', 'opencode', 'commands', 'kyro', `${command}.md`)), `opencode purge: native command ${command} still present`);
    assert(!existsSync(join(home, '.config', 'opencode', 'skills', `kyro-${command}`)), `opencode purge: empty skill directory ${command} still present`);
  }
  assert(!existsSync(join(home, '.config', 'opencode', 'commands', 'kyro')), 'opencode purge: empty command namespace still present');
  assert(existsSync(join(home, '.config', 'opencode')), 'opencode purge: shared OpenCode config directory should remain');
});

withWorkspace('kyro-pipeline-rollback-', (cwd) => {
  const { applyPlan } = require(join(repo, 'dist/cli/fs.js'));
  const agentsPath = join(cwd, 'AGENTS.md');
  const original = '# Existing\n\nKeep this exact content.\n';
  writeFileSync(agentsPath, original, 'utf-8');

  let failed = false;
  try {
    applyPlan([
      { action: 'upsert-block', path: 'AGENTS.md', blockName: 'agents-md', content: 'temporary mutation' },
      { action: 'copy', path: 'SHOULD_NOT_EXIST.md', source: 'missing-source-file.md' },
    ]);
  } catch (error) {
    failed = true;
    assert(String(error).includes('rollback completed'), 'pipeline rollback: failure did not report rollback completion');
  }

  assert(failed, 'pipeline rollback: expected applyPlan to fail');
  assert(readFileSync(agentsPath, 'utf-8') === original, 'pipeline rollback: AGENTS.md was not restored');
  assert(!existsSync(join(cwd, 'SHOULD_NOT_EXIST.md')), 'pipeline rollback: failed copy target should not exist');
});

withWorkspace('kyro-json-merge-rollback-', (cwd) => {
  const { applyPlan } = require(join(repo, 'dist/cli/fs.js'));
  const settingsPath = join(cwd, '.config', 'opencode', 'opencode.json');
  const original = '{\n  "model": "user/model",\n  "agent": {\n    "existing": {\n      "model": "kept"\n    }\n  }\n}\n';
  mkdirSync(join(cwd, '.config', 'opencode'), { recursive: true });
  writeFileSync(settingsPath, original, 'utf-8');

  let failed = false;
  try {
    applyPlan([
      {
        action: 'merge-json',
        path: '.config/opencode/opencode.json',
        content: JSON.stringify({ agent: { kyro: { prompt: 'temporary mutation' } } }),
      },
      { action: 'copy', path: 'SHOULD_NOT_EXIST.md', source: 'missing-source-file.md' },
    ]);
  } catch (error) {
    failed = true;
    assert(String(error).includes('rollback completed'), 'json merge rollback: failure did not report rollback completion');
  }

  assert(failed, 'json merge rollback: expected applyPlan to fail');
  assert(readFileSync(settingsPath, 'utf-8') === original, 'json merge rollback: opencode.json was not restored');
  assert(!existsSync(join(cwd, 'SHOULD_NOT_EXIST.md')), 'json merge rollback: failed copy target should not exist');
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

withWorkspace('kyro-sync-drift-', (cwd) => {
  const { parseAgent } = require(join(repo, 'dist/cli/options.js'));
  const { install, sync } = require(join(repo, 'dist/cli/commands/install.js'));
  const { readPackageVersion } = require(join(repo, 'dist/cli/help.js'));
  const codex = parseAgent('codex');
  const home = join(cwd, '.home');

  captureLogs(() => install(cliOptions({ agents: [codex] })));

  const version = readPackageVersion();
  const versionDir = join(home, '.agents', 'kyro', 'versions', version);
  assert(existsSync(versionDir), 'sync-drift: version dir should exist after install');

  const obsoleteSkill = join(home, '.agents', 'skills', 'kyro-obsolete-fixture', 'SKILL.md');
  const sharedOpenCodeConfig = join(home, '.config', 'opencode', 'opencode.json');
  mkdirSync(join(home, '.agents', 'skills', 'kyro-obsolete-fixture'), { recursive: true });
  mkdirSync(join(home, '.config', 'opencode'), { recursive: true });
  writeFileSync(obsoleteSkill, 'legacy', 'utf-8');
  writeFileSync(sharedOpenCodeConfig, '{ "model": "user/model" }\n', 'utf-8');

  const manifestPath = join(versionDir, 'manifest.json');
  const oldManifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  oldManifest.managedFiles.push('~/.agents/skills/kyro-obsolete-fixture/SKILL.md', '~/.config/opencode/opencode.json');
  writeFileSync(manifestPath, `${JSON.stringify(oldManifest, null, 2)}\n`, 'utf-8');

  const staleDir = join(home, '.agents', 'kyro', 'versions', '0.0.0');
  mkdirSync(staleDir, { recursive: true });
  writeFileSync(join(staleDir, 'stale.txt'), 'stale', 'utf-8');

  const syncOutput = captureLogs(() => sync(cliOptions({ agents: [codex] })));
  assert(syncOutput.includes('Drift analysis:'), 'sync-drift: missing drift report');
  assert(syncOutput.includes('Stale runtime versions'), 'sync-drift: missing stale versions in drift');
  assert(syncOutput.includes('Orphaned managed files'), 'sync-drift: missing orphaned files in drift');
  assert(syncOutput.includes('~/.agents/skills/kyro-obsolete-fixture/SKILL.md'), 'sync-drift: missing obsolete adapter skill in drift');
  assert(syncOutput.includes('Shared config preserved'), 'sync-drift: missing preserved shared config report');
  assert(syncOutput.includes('~/.config/opencode/opencode.json'), 'sync-drift: shared opencode config should be reported as preserved');
  assert(syncOutput.includes('Tip: run with --prune'), 'sync-drift: missing --prune tip');
  assert(existsSync(staleDir), 'sync-drift: stale dir should still exist without --prune');
  assert(existsSync(obsoleteSkill), 'sync-drift: obsolete skill should still exist without --prune');
  assert(existsSync(sharedOpenCodeConfig), 'sync-drift: shared opencode config should still exist without --prune');

  const oldManifestBeforePrune = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  oldManifestBeforePrune.managedFiles.push('~/.agents/skills/kyro-obsolete-fixture/SKILL.md', '~/.config/opencode/opencode.json');
  writeFileSync(manifestPath, `${JSON.stringify(oldManifestBeforePrune, null, 2)}\n`, 'utf-8');

  const staleDir2 = join(home, '.agents', 'kyro', 'versions', '0.0.1');
  mkdirSync(staleDir2, { recursive: true });
  writeFileSync(join(staleDir2, 'stale.txt'), 'stale', 'utf-8');

  const pruneDryRunOutput = captureLogs(() => sync(cliOptions({ agents: [codex], prune: true, dryRun: true })));
  assert(pruneDryRunOutput.includes('Prune plan:'), 'sync-prune dry-run: missing prune plan');
  assert(pruneDryRunOutput.includes('Dry run complete. No files changed.'), 'sync-prune dry-run: should report no file changes');
  assert(pruneDryRunOutput.includes('~/.agents/skills/kyro-obsolete-fixture/SKILL.md'), 'sync-prune dry-run: prune plan should include obsolete adapter skill');
  assert(pruneDryRunOutput.includes('Shared config preserved'), 'sync-prune dry-run: preserved shared config should still be reported');
  assert(!pruneDryRunOutput.includes('- remove ~/.config/opencode/opencode.json'), 'sync-prune dry-run: prune plan should not remove shared opencode config');
  assert(existsSync(staleDir), 'sync-prune dry-run: stale dir 0.0.0 should remain');
  assert(existsSync(staleDir2), 'sync-prune dry-run: stale dir 0.0.1 should remain');
  assert(existsSync(obsoleteSkill), 'sync-prune dry-run: obsolete skill should remain');
  assert(existsSync(sharedOpenCodeConfig), 'sync-prune dry-run: shared opencode config should remain');

  const pruneOutput = captureLogs(() => sync(cliOptions({ agents: [codex], prune: true })));
  assert(pruneOutput.includes('Prune plan:'), 'sync-prune: missing prune plan');
  assert(pruneOutput.includes('remove'), 'sync-prune: prune plan should include remove operations');
  assert(pruneOutput.includes('~/.agents/skills/kyro-obsolete-fixture/SKILL.md'), 'sync-prune: prune plan should include obsolete adapter skill');
  assert(pruneOutput.includes('Shared config preserved'), 'sync-prune: preserved shared config should still be reported');
  assert(pruneOutput.includes('~/.config/opencode/opencode.json'), 'sync-prune: shared opencode config should be reported as preserved');
  assert(!pruneOutput.includes('- remove ~/.config/opencode/opencode.json'), 'sync-prune: prune plan should not remove shared opencode config');
  assert(!existsSync(staleDir), 'sync-prune: stale dir 0.0.0 should be removed');
  assert(!existsSync(staleDir2), 'sync-prune: stale dir 0.0.1 should be removed');
  assert(!existsSync(obsoleteSkill), 'sync-prune: obsolete adapter skill should be removed');
  assert(existsSync(sharedOpenCodeConfig), 'sync-prune: shared opencode config should be preserved');
  assert(existsSync(versionDir), 'sync-prune: current version dir should be preserved');
  for (const runtimeFile of ['manifest.json', 'KYRO.md', 'commands/forge.md', 'skills/sprint-forge/SKILL.md', 'core/WORKFLOW.yaml']) {
    assert(existsSync(join(versionDir, runtimeFile)), `sync-prune: current runtime file ${runtimeFile} should be preserved`);
  }
});

withWorkspace('kyro-sync-shared-config-only-', (cwd) => {
  const { parseAgent } = require(join(repo, 'dist/cli/options.js'));
  const { install, sync } = require(join(repo, 'dist/cli/commands/install.js'));
  const { readPackageVersion } = require(join(repo, 'dist/cli/help.js'));
  const codex = parseAgent('codex');
  const home = join(cwd, '.home');

  captureLogs(() => install(cliOptions({ agents: [codex] })));

  const versionDir = join(home, '.agents', 'kyro', 'versions', readPackageVersion());
  const sharedOpenCodeConfig = join(home, '.config', 'opencode', 'opencode.json');
  mkdirSync(join(home, '.config', 'opencode'), { recursive: true });
  writeFileSync(sharedOpenCodeConfig, '{ "model": "user/model" }\n', 'utf-8');

  const manifestPath = join(versionDir, 'manifest.json');
  const oldManifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  oldManifest.managedFiles.push('~/.config/opencode/opencode.json');
  writeFileSync(manifestPath, `${JSON.stringify(oldManifest, null, 2)}\n`, 'utf-8');

  const syncOutput = captureLogs(() => sync(cliOptions({ agents: [codex] })));
  assert(syncOutput.includes('Shared config preserved'), 'sync-shared-config-only: missing preserved shared config report');
  assert(syncOutput.includes('~/.config/opencode/opencode.json'), 'sync-shared-config-only: shared opencode config should be reported as preserved');
  assert(!syncOutput.includes('Tip: run with --prune'), 'sync-shared-config-only: should not suggest prune when nothing is prunable');
  assert(existsSync(sharedOpenCodeConfig), 'sync-shared-config-only: shared opencode config should remain');

  const oldManifestBeforePrune = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  oldManifestBeforePrune.managedFiles.push('~/.config/opencode/opencode.json');
  writeFileSync(manifestPath, `${JSON.stringify(oldManifestBeforePrune, null, 2)}\n`, 'utf-8');

  const pruneDryRunOutput = captureLogs(() => sync(cliOptions({ agents: [codex], prune: true, dryRun: true })));
  assert(pruneDryRunOutput.includes('No prunable drift found. Shared config was preserved.'), 'sync-shared-config-only prune dry-run: should explain that no files are prunable');
  assert(!pruneDryRunOutput.includes('Prune plan:'), 'sync-shared-config-only prune dry-run: should not print an empty prune plan');
  assert(existsSync(sharedOpenCodeConfig), 'sync-shared-config-only prune dry-run: shared opencode config should remain');
});

withWorkspace('kyro-adapter-detect-', () => {
  const { parseAgent } = require(join(repo, 'dist/cli/options.js'));
  const { detect } = require(join(repo, 'dist/cli/commands/detect.js'));

  const textOutput = captureLogs(() => detect(cliOptions()));
  for (const agent of ['standard', 'opencode', 'codex', 'claude', 'cursor']) {
    assert(textOutput.includes(`${agent}: status=`), `detect: missing ${agent}`);
  }
  assert(textOutput.includes('capabilities=command-skills'), 'detect: missing capabilities');
  assert(textOutput.includes('systemPromptStrategy='), 'detect: missing system prompt strategy');
  assert(textOutput.includes('mcpStrategy='), 'detect: missing MCP strategy');

  const jsonOutput = captureLogs(() => detect(cliOptions({ agents: [parseAgent('codex')], json: true })));
  const payload = JSON.parse(jsonOutput);
  assert(payload.adapters.length === 1, 'detect --json: expected filtered adapter');
  assert(payload.adapters[0].agent === 'codex', 'detect --json: expected codex adapter');
  assert(payload.adapters[0].systemPromptStrategy === 'managed-block', 'detect --json: missing codex system prompt strategy');
  assert(payload.adapters[0].mcpStrategy === 'toml-file', 'detect --json: missing codex MCP strategy');
});

console.log('Adapter fixtures passed');
