#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { scanLines } from './lib/scan.mjs';

const repo = resolve(fileURLToPath(import.meta.url), '../..');
const cli = resolve(repo, 'dist/cli.js');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function run(args, cwd, env = {}) {
  return spawnSync(process.execPath, [cli, ...args], { cwd, env: { ...process.env, HOME: join(cwd, '.home'), ...env }, encoding: 'utf-8' });
}

function sandbox(caseName = 'close-sprint-happy') {
  const root = join(tmpdir(), `kyro-guard-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(root, { recursive: true });
  mkdirSync(join(root, '.home'), { recursive: true });
  cpSync(resolve(repo, `fixtures/evals/${caseName}/state`), root, { recursive: true });
  return root;
}

function sig(path) {
  const stat = statSync(path);
  return { mtimeMs: stat.mtimeMs, bytes: readFileSync(path, 'utf-8') };
}

function writePolicy(root, policy) {
  writeFileSync(join(root, '.agents/kyro/policy.json'), `${JSON.stringify(policy, null, 2)}\n`);
}

async function withServer(cwd, fn) {
  const child = spawn(process.execPath, [cli, 'mcp', 'serve'], { cwd, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, HOME: join(cwd, '.home') } });
  const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const queue = [];
  const waiters = [];
  rl.on('line', (line) => {
    JSON.parse(line);
    if (waiters.length) waiters.shift()(line);
    else queue.push(line);
  });
  const nextLine = () => queue.length ? Promise.resolve(queue.shift()) : new Promise((resolveLine) => waiters.push(resolveLine));
  let id = 1;
  const send = async (method, params = undefined) => {
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: id++, method, ...(params === undefined ? {} : { params }) })}\n`);
    return JSON.parse(await nextLine());
  };
  try {
    await fn({ send });
  } finally {
    child.stdin.end();
    child.kill('SIGTERM');
    rl.close();
  }
}

function assertScopeSetActiveConfirmAndTrace() {
  const root = sandbox('route-init');
  try {
    const statePath = join(root, '.agents/kyro/kyro.json');
    const before = sig(statePath);
    const denied = run(['scope', 'set-active', 'demo'], root);
    assert(denied.status === 1, 'scope set-active without --yes should fail');
    assert((denied.stderr + denied.stdout).includes('CONFIRMATION_REQUIRED') || (denied.stderr + denied.stdout).includes('requires explicit confirmation'), 'scope set-active should explain confirmation');
    const afterDenied = sig(statePath);
    assert(before.bytes === afterDenied.bytes && before.mtimeMs === afterDenied.mtimeMs, 'scope set-active without --yes must not write kyro.json');

    const approved = run(['scope', 'set-active', 'demo', '--yes'], root);
    assert(approved.status === 0, `scope set-active --yes should pass: ${approved.stderr}`);
    const trace = readFileSync(join(root, '.agents/kyro/scopes/demo/trace/events.ndjson'), 'utf-8');
    assert(trace.includes('"type":"blocked_reason"') && trace.includes('CONFIRMATION_REQUIRED'), 'confirmation denial should be traced');
    assert(trace.includes('"type":"gate_approved"') && trace.includes('scope_set_active'), 'approval should be traced');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function assertMcpBlockedZeroWrite() {
  const root = sandbox();
  try {
    writePolicy(root, { policyVersion: 1, operations: { close_sprint: { level: 'blocked' } }, allow: [] });
    const sprintPath = join(root, '.agents/kyro/scopes/demo/sprint.json');
    const before = sig(sprintPath);
    await withServer(root, async ({ send }) => {
      await send('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'guard-check', version: '1' } });
      const response = await send('tools/call', { name: 'close_sprint', arguments: { scope: 'demo', outcome: 'shipped', confirm: true } });
      assert(response.result?.isError === true, 'blocked MCP close_sprint should return tool error');
      assert(response.result.structuredContent?.code === 'POLICY_BLOCKED', 'blocked MCP close_sprint should expose POLICY_BLOCKED');
    });
    const after = sig(sprintPath);
    assert(before.bytes === after.bytes && before.mtimeMs === after.mtimeMs, 'blocked MCP close_sprint must not write sprint.json');
    const trace = readFileSync(join(root, '.agents/kyro/scopes/demo/trace/events.ndjson'), 'utf-8');
    assert(trace.includes('POLICY_BLOCKED'), 'blocked MCP decision should be traced');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function assertFailSafeMergeAndAnalysisFinding() {
  const root = sandbox('route-init');
  try {
    writePolicy(root, { policyVersion: 1, operations: { clear_active_sprint: { level: 'tool_owned' } }, allow: [] });
    const source = `process.chdir(${JSON.stringify(root)}); const { guardedOperationLevel } = require(${JSON.stringify(resolve(repo, 'dist/cli/core/policy.js'))}); console.log(guardedOperationLevel('clear_active_sprint'));`;
    const checked = spawnSync(process.execPath, ['-e', source], { cwd: root, encoding: 'utf-8' });
    assert(checked.status === 0 && checked.stdout.trim() === 'blocked', 'weakening override must not loosen blocked default');

    writeFileSync(join(root, '.agents/kyro/policy.json'), '{not json');
    const analyze = run(['analyze', '--kyro-scope', 'demo', '--json'], root);
    assert(analyze.status === 1, 'malformed policy should produce blocking analyze finding');
    assert(analyze.stdout.includes('policy.json'), 'analyze should surface policy validation finding');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function assertMcpProjection() {
  const root = join(tmpdir(), `kyro-mcp-proj-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(root, { recursive: true });
  mkdirSync(join(root, '.home'), { recursive: true });
  try {
    // Pin the invocation to the node fallback: install with a PATH that has no `kyro` binary so
    // `isKyroOnPath()` is deterministically false, making the projected MCP command stable across
    // machines (a dev box with a global `kyro` would otherwise emit `command = "node"` vs "kyro").
    const noKyroPath = join(root, '.home');
    const install = run(['install', '--agent', 'codex', '--scope', 'workspace', '--init-workspace', '--yes'], root, { PATH: noKyroPath });
    assert(install.status === 0, `codex install should pass: ${install.stderr || install.stdout}`);
    const configPath = join(root, '.home/.codex/config.toml');
    const first = readFileSync(configPath, 'utf-8');
    assert(first.includes('# kyro-ai:mcp-server-kyro:start'), 'codex MCP block should use TOML-safe hash markers');
    assert(first.includes('[mcp_servers.kyro]'), 'codex MCP block should declare mcp_servers.kyro');
    assert(first.includes('command = "node"'), 'codex MCP block should register the node fallback command when kyro is off PATH');
    // The `~` in the invocation is expanded to an absolute path for the MCP registration: codex
    // spawns the command without a shell, so a literal `~` would not expand and cli.js would not resolve.
    const expectedCli = join(root, '.home', '.agents/kyro/current/dist/cli.js');
    assert(first.includes(`args = [${JSON.stringify(expectedCli)},"mcp","serve"]`), `codex MCP block should register the ~-expanded runtime cli.js mcp serve invocation (expected ${expectedCli})`);
    const reinstall = run(['install', '--agent', 'codex', '--scope', 'workspace', '--yes'], root, { PATH: noKyroPath });
    assert(reinstall.status === 0, 'codex reinstall should pass');
    const second = readFileSync(configPath, 'utf-8');
    assert(second.split('# kyro-ai:mcp-server-kyro:start').length - 1 === 1, 'codex MCP projection should be idempotent');
    const uninstall = run(['uninstall', '--yes'], root);
    assert(uninstall.status === 0, `uninstall should pass: ${uninstall.stderr || uninstall.stdout}`);
    const removed = readFileSync(configPath, 'utf-8');
    assert(!removed.includes('[mcp_servers.kyro]'), 'codex MCP projection should be removable');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function assertSingleDecisionSite() {
  const lines = scanLines('level ===|policy\\.operations|rank\\(|stricter\\(', 'src/cli', { cwd: repo });
  const offenders = lines.filter((line) => {
    if (line.startsWith('src/cli/core/policy.ts:')) return false;
    // guardEnforcementForLevel derives the reporting tier (doctor --adapters) from a level;
    // it reports enforcement, it is not the policy decision site.
    if (line.startsWith('src/cli/adapters/registry-types.ts:') && line.includes("level === 'blocked'")) return false;
    return true;
  });
  assert(offenders.length === 0, `guard decision logic outside core/policy.ts:\n${offenders.join('\n')}`);
}

async function main() {
  assertSingleDecisionSite();
  assertScopeSetActiveConfirmAndTrace();
  await assertMcpBlockedZeroWrite();
  assertFailSafeMergeAndAnalysisFinding();
  assertMcpProjection();
  console.log('check:guardrails — portable guardrail invariants passed');
}

main().catch((error) => {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
