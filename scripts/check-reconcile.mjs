/** W3: real CLI reconciliation using disposable homes and a local npm ownership fixture. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const repo = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const version = JSON.parse(fs.readFileSync(join(repo, 'package.json'), 'utf8')).version;
const root = fs.mkdtempSync(join(tmpdir(), 'kyro-w3-reconcile-'));
const saved = { cwd: process.cwd(), ...Object.fromEntries(['HOME', 'USERPROFILE', 'npm_config_cache', 'PATH', 'KYRO_LINK_MODE'].map((key) => [key, process.env[key]])) };
const windows = process.platform === 'win32';
const agents = ['standard', 'opencode', 'codex', 'claude'];
const names = ['forge', 'status', 'task-context', 'idea', 'qa', 'scope-retire', 'work', 'sprint-executor'];
const json = (path) => JSON.parse(fs.readFileSync(path, 'utf8'));
const put = (path, content) => { fs.mkdirSync(dirname(path), { recursive: true }); fs.writeFileSync(path, content); };
function fixture(name, detected = []) {
  const cwd = join(root, name), home = join(cwd, 'home'), prefix = join(cwd, 'prefix'), bin = windows ? prefix : join(prefix, 'bin');
  const modules = windows ? join(prefix, 'node_modules') : join(prefix, 'lib/node_modules');
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(home);
  fs.mkdirSync(modules, { recursive: true });
  const packageRoot = join(modules, 'kyro-ai');
  fs.mkdirSync(packageRoot);
  for (const path of ['dist', 'agents', 'commands', 'internal', 'package.json', 'config.json', 'WORKFLOW.yaml']) fs.cpSync(join(repo, path), join(packageRoot, path), { recursive: true });
  if (windows) {
    fs.copyFileSync(process.execPath, join(bin, 'node.exe'));
    put(join(bin, 'kyro.cmd'), `@echo off\r\n"${process.execPath}" "%~dp0node_modules\\kyro-ai\\dist\\cli.js" %*\r\n`);
  } else {
    fs.symlinkSync(process.execPath, join(bin, 'node'));
    fs.symlinkSync(join(packageRoot, 'dist/cli.js'), join(bin, 'kyro'));
  }
  const npmLog = join(cwd, 'npm.log');
  const npmPath = join(bin, windows ? 'npm.cmd' : 'npm');
  if (windows) {
    put(join(bin, 'npm-fixture.cjs'), `const fs = require('node:fs'); fs.appendFileSync(${JSON.stringify(npmLog)}, process.argv.slice(2).join(' ') + '\\n'); const values = ${JSON.stringify({ prefix, root: modules, view: JSON.stringify(version) })}; const value = values[process.argv[2]]; if (!value) process.exit(91); process.stdout.write(value + '\\n');`);
    put(npmPath, `@echo off\r\n"${process.execPath}" "%~dp0npm-fixture.cjs" %*\r\n`);
  } else {
    put(npmPath, `#!/bin/sh\nprintf '%s\\n' "$*" >> '${npmLog}'\ncase "$1" in\n prefix) printf '%s\\n' '${prefix}' ;;\n root) printf '%s\\n' '${modules}' ;;\n view) printf '"${version}"\\n' ;;\n *) exit 91 ;;\nesac\n`);
  }
  fs.chmodSync(npmPath, 0o755);
  const envPath = windows ? `${bin}${delimiter}${join(process.env.SystemRoot ?? 'C:\\Windows', 'System32')}` : bin;
  const f = { cwd, home, bin, npmLog, env: { ...process.env, HOME: home, USERPROFILE: home, npm_config_cache: join(cwd, 'npm-cache'), PATH: envPath } };
  delete f.env.KYRO_LINK_MODE;
  for (const agent of detected) detect(f, agent);
  return f;
}
function detect(f, agent) {
  const path = join(f.bin, windows ? `${agent}.cmd` : agent);
  put(path, windows ? '@echo off\r\nexit /b 0\r\n' : '#!/bin/sh\nexit 0\n'); fs.chmodSync(path, 0o755);
}
function run(f, args, env = {}) {
  const result = spawnSync(process.execPath, [join(repo, 'dist/cli.js'), ...args], { cwd: f.cwd, env: { ...f.env, ...env }, encoding: 'utf8' });
  assert.equal(result.error, undefined, `child spawn failed: ${result.error}`);
  assert.equal(result.status, 0, `${args.join(' ')}: ${result.stdout}\n${result.stderr}`);
  for (const agent of agents) assert.match(result.stdout, new RegExp(`Adapter ${agent}: (added|refreshed|unchanged|skipped\\(disabled\\)|not-detected); projection=(canonical|link|copy|none)`));
  if (fs.existsSync(f.npmLog)) assert(!fs.readFileSync(f.npmLog, 'utf8').includes('install'), 'npm fixture must never install');
  return result.stdout;
}
function files(f) {
  return ['.agents/skills', '.claude/skills', '.config/opencode/skills'].flatMap((path) => names.map((name) => join(f.home, path, `kyro-${name}/SKILL.md`)));
}
function fresh(f) {
  for (const file of files(f)) assert.match(fs.readFileSync(file, 'utf8'), new RegExp(`runtimeVersion: "${version.replaceAll('.', '\\.')}"`), file);
  assert(fs.existsSync(join(f.home, '.config/opencode/commands/kyro/work.md')));
}
function configBytes(f) {
  const paths = [join(f.cwd, 'AGENTS.md'), join(f.home, '.codex/config.toml'), join(f.home, '.config/opencode/opencode.json')];
  const contents = ['# User notes\r\nKeep bytes.\r\n', '# User MCP\n[model]\nname = "custom"\n', '{\n // user comment\n "model": "custom",\n "agent": {"mine": {"model": "kept"}}\n}\n'];
  paths.forEach((path, index) => put(path, contents[index]));
  return () => paths.forEach((path, index) => assert.equal(fs.readFileSync(path, 'utf8'), contents[index], path));
}
try {
  const all = fixture('all', ['claude', 'codex', 'opencode', 'pi']);
  const first = run(all, ['install', '--no-init-workspace']);
  fresh(all);
  assert(!fs.existsSync(join(all.cwd, '.agents/kyro/project.json')));
  assert(!fs.existsSync(join(all.home, '.pi')), 'Pi reads canonical skills; W3 must not project Pi config');
  assert(!fs.existsSync(join(all.home, '.codex')), 'Codex canonical skills need no config directory');
  for (const agent of agents) assert(first.includes(`Adapter ${agent}: added;`));
  assert(json(join(all.home, '.agents/kyro/adapters.json')).adapters.every((entry) => !entry.integrations));
  console.log('PASS C1/C7 clean runtime-only install: all implemented detected harnesses and Pi canonical discovery; four added outcome rows');

  const absent = fixture('absent');
  for (const args of [['install', '--no-init-workspace'], ['install', '--init-workspace'], ['sync'], ['update', '--yes']]) {
    const output = run(absent, args);
    for (const agent of ['claude', 'opencode', 'codex']) assert(output.includes(`Adapter ${agent}: not-detected; projection=none`) || output.includes(`Adapter ${agent}: not-detected; projection=canonical`));
    for (const path of ['.claude', '.codex', '.config/opencode', '.pi']) assert(!fs.existsSync(join(absent.home, path)), path);
  }
  const explicitAbsent = spawnSync(process.execPath, [join(repo, 'dist/cli.js'), 'install', '--no-init-workspace', '--agent', 'claude'], { cwd: absent.cwd, env: absent.env, encoding: 'utf8' });
  assert.equal(explicitAbsent.status, 1);
  assert.match(explicitAbsent.stderr, /Agent adapter not detected: claude/);
  assert(!fs.existsSync(join(absent.home, '.claude')));
  console.log('PASS C4/C7 no detection: install, sync, update create no harness config directories');

  const addedSync = fixture('added-sync');
  run(addedSync, ['install', '--init-workspace']);
  detect(addedSync, 'claude');
  assert.match(run(addedSync, ['sync']), /Adapter claude: added; projection=(link|copy)/);
  assert(fs.existsSync(join(addedSync.home, '.claude/skills/kyro-work/SKILL.md')));
  const addedUpdate = fixture('added-update');
  run(addedUpdate, ['install', '--no-init-workspace']);
  detect(addedUpdate, 'opencode');
  assert.match(run(addedUpdate, ['update', '--yes']), /Adapter opencode: added; projection=(link|copy)/);
  assert(fs.existsSync(join(addedUpdate.home, '.config/opencode/commands/kyro/work.md')));
  console.log('PASS C2 current-version update and workspace sync detect and add a new harness');

  const copy = fixture('copy', ['claude', 'codex', 'opencode']);
  run(copy, ['install', '--no-init-workspace'], { KYRO_LINK_MODE: 'copy' });
  for (const file of files(copy)) put(file, fs.readFileSync(file, 'utf8').replace(`runtimeVersion: "${version}"`, 'runtimeVersion: "0.0.0"'));
  const manifest = join(copy.home, '.agents/kyro/current/manifest.json');
  const stale = json(manifest); stale.packageVersion = '0.0.0'; put(manifest, JSON.stringify(stale));
  const refreshed = run(copy, ['update', '--yes'], { KYRO_LINK_MODE: 'copy' });
  fresh(copy);
  for (const agent of agents) assert(refreshed.includes(`Adapter ${agent}: refreshed;`));
  const unchanged = run(copy, ['update', '--yes'], { KYRO_LINK_MODE: 'copy' });
  for (const agent of agents) assert(unchanged.includes(`Adapter ${agent}: unchanged;`));
  assert(fs.lstatSync(join(copy.home, '.claude/skills/kyro-work')).isDirectory());
  const copyRegistryPath = join(copy.home, '.agents/kyro/adapters.json');
  const copyRegistry = json(copyRegistryPath);
  copyRegistry.adapters.find((entry) => entry.agent === 'claude').projection = 'copy';
  put(copyRegistryPath, JSON.stringify(copyRegistry));
  const mixed = run(copy, ['update', '--yes']);
  assert(mixed.includes('Adapter claude: unchanged; projection=copy'));
  assert.match(mixed, /Adapter opencode: refreshed; projection=(link|copy)/);
  assert(fs.lstatSync(join(copy.home, '.claude/skills/kyro-work')).isDirectory());
  console.log('PASS C3/C7 outside-workspace update refreshes all 24 stale skills; copy modes reported; repeat update unchanged');

  const configs = fixture('configs', ['claude', 'codex', 'opencode']);
  const unchangedConfigs = configBytes(configs);
  for (const args of [['install', '--init-workspace'], ['sync'], ['update', '--yes']]) { run(configs, args); unchangedConfigs(); }
  const runtimeConfigs = fixture('runtime-configs', ['claude', 'codex', 'opencode']);
  const unchangedRuntimeConfigs = configBytes(runtimeConfigs);
  run(runtimeConfigs, ['install', '--no-init-workspace']); unchangedRuntimeConfigs();
  run(runtimeConfigs, ['update', '--yes']); unchangedRuntimeConfigs();
  console.log('PASS C5 install, sync, update preserve exact config bytes with integrations off (workspace and runtime-only)');

  const optin = fixture('optin', ['codex', 'opencode']);
  configBytes(optin);
  const configsPaths = [join(optin.cwd, 'AGENTS.md'), join(optin.home, '.codex/config.toml'), join(optin.home, '.config/opencode/opencode.json')];
  process.chdir(optin.cwd); Object.assign(process.env, optin.env);
  for (const key of Object.keys(require.cache)) if (key.startsWith(join(repo, 'dist'))) delete require.cache[key];
  const { codexAdapter } = require(join(repo, 'dist/cli/adapters/codex.js'));
  const { openCodeAdapter } = require(join(repo, 'dist/cli/adapters/opencode.js'));
  const noIntegrationManifest = json(join(all.home, '.agents/kyro/current/manifest.json'));
  process.env.HOME = all.home; process.env.USERPROFILE = all.home;
  assert.equal(codexAdapter.doctor(noIntegrationManifest).status, 'pass', 'Codex does not require a disabled AGENTS.md integration');
  process.env.HOME = optin.home; process.env.USERPROFILE = optin.home;
  const { upsertManagedBlock } = require(join(repo, 'dist/cli/injectors/managed-block.js'));
  const { mergeJsonObjectContent } = require(join(repo, 'dist/cli/injectors/json-merge.js'));
  const expectedPlan = []; codexAdapter.buildProjection(expectedPlan, { integrations: true, includeWorkspace: true }); codexAdapter.buildMcpProjection(expectedPlan); openCodeAdapter.buildProjection(expectedPlan, { integrations: true, includeWorkspace: true });
  const expected = configsPaths.map((path) => fs.readFileSync(path, 'utf8'));
  for (const op of expectedPlan) {
    const index = op.path === 'AGENTS.md' ? 0 : op.path === '~/.codex/config.toml' ? 1 : op.path === '~/.config/opencode/opencode.json' ? 2 : -1;
    if (index < 0) continue;
    expected[index] = op.action === 'merge-json' ? mergeJsonObjectContent(expected[index], op.content) : upsertManagedBlock(expected[index], op.blockName, op.content, op.commentStyle);
  }
  run(optin, ['install', '--init-workspace', '--agent', 'codex,opencode', '--integrations']);
  for (const args of [null, ['sync'], ['update', '--yes']]) {
    if (args) {
      for (const op of expectedPlan.filter((op) => op.action === 'upsert-block')) {
        const index = op.path === 'AGENTS.md' ? 0 : 1;
        expected[index] = upsertManagedBlock(expected[index], op.blockName, op.content, op.commentStyle);
      }
      run(optin, args);
    }
    configsPaths.forEach((path, index) => assert.equal(fs.readFileSync(path, 'utf8'), expected[index]));
  }
  const registryPath = join(optin.home, '.agents/kyro/adapters.json');
  const registry = json(registryPath);
  assert(registry.adapters.filter((entry) => ['codex', 'opencode'].includes(entry.agent)).every((entry) => entry.integrations));
  assert.equal(registry.adapters.find((entry) => entry.agent === 'standard').integrations, false);
  const settings = json(configsPaths[2]); assert.equal(settings.agent['kyro-orchestrator'].mode, 'primary');
  assert.equal(settings.agent.mine.model, 'kept'); assert(fs.readFileSync(configsPaths[1], 'utf8').includes('[mcp_servers.kyro]'));
  const legacy = fixture('legacy', ['codex', 'opencode']); configBytes(legacy);
  put(join(legacy.cwd, '.agents/kyro/project.json'), '{"schemaVersion":4,"artifactRoot":".agents/kyro/scopes"}');
  put(join(legacy.cwd, '.agents/kyro/local.json'), JSON.stringify({ schemaVersion: 4, installedAdapters: ['codex', 'opencode'].map((agent) => ({ agent, scope: 'workspace', installedAt: '2000-01-01T00:00:00.000Z', corePath: '~/.agents/kyro/current' })) }));
  run(legacy, ['sync']);
  assert(json(join(legacy.home, '.agents/kyro/adapters.json')).adapters.filter((entry) => ['codex', 'opencode'].includes(entry.agent)).every((entry) => entry.integrations));
  assert(fs.readFileSync(join(legacy.cwd, 'AGENTS.md'), 'utf8').includes('kyro-ai:agents-md:start'));
  console.log('PASS C6 integrations opt-in matches existing builders byte-for-byte, stays enabled on sync/update, and legacy registration retains integrations');

  const disabledRegistry = json(join(all.home, '.agents/kyro/adapters.json'));
  disabledRegistry.adapters.find((entry) => entry.agent === 'claude').state = 'disabled';
  put(join(all.home, '.agents/kyro/adapters.json'), JSON.stringify(disabledRegistry));
  fs.rmSync(join(all.home, '.claude/skills'), { recursive: true });
  assert(run(all, ['update', '--yes']).includes('Adapter claude: skipped(disabled); projection=none'));
  assert(!fs.existsSync(join(all.home, '.claude/skills')));
  const before = fs.readFileSync(join(all.home, '.agents/kyro/adapters.json'));
  run(all, ['install', '--no-init-workspace', '--dry-run']);
  assert.deepEqual(fs.readFileSync(join(all.home, '.agents/kyro/adapters.json')), before);
  assert(!fs.existsSync(join(all.home, '.claude/skills')));
  console.log('PASS C7 disabled stays skipped on update; dry-run preserves registry and projections');
  console.log('W3 reconciliation checks passed (criteria 1-7).');
} finally {
  process.chdir(saved.cwd);
  for (const key of ['HOME', 'USERPROFILE', 'npm_config_cache', 'PATH', 'KYRO_LINK_MODE']) if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
  fs.rmSync(root, { recursive: true, force: true });
}
