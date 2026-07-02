#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const repo = resolve(fileURLToPath(import.meta.url), '../..');
const cli = resolve(repo, 'dist/cli.js');
const expectedTools = ['context_pack','doctor_artifacts','analyze_scope','close_sprint','scope_list','scope_inspect','repair_scope'];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function withServer(cwd, fn) {
  const child = spawn(process.execPath, [cli, 'mcp', 'serve'], { cwd, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, HOME: join(cwd, '.home') } });
  const stderr = [];
  child.stderr.on('data', (d) => stderr.push(String(d)));
  const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const queue = [];
  const waiters = [];
  rl.on('line', (line) => {
    JSON.parse(line); // stdout purity: every line must parse.
    if (waiters.length) waiters.shift()(line);
    else queue.push(line);
  });
  const nextLine = () => queue.length ? Promise.resolve(queue.shift()) : new Promise((resolveLine) => waiters.push(resolveLine));
  let id = 1;
  const send = async (method, params = undefined) => {
    const request = { jsonrpc: '2.0', id: id++, method, ...(params === undefined ? {} : { params }) };
    child.stdin.write(`${JSON.stringify(request)}\n`);
    return JSON.parse(await nextLine());
  };
  const notify = (method, params = undefined) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) })}\n`);
  const raw = async (line) => { child.stdin.write(`${line}\n`); return JSON.parse(await nextLine()); };
  try {
    await fn({ send, notify, raw });
  } finally {
    child.stdin.end();
    child.kill('SIGTERM');
    rl.close();
  }
  void stderr;
}

function makeSandbox(caseName = 'close-sprint-happy') {
  const root = join(tmpdir(), `kyro-mcp-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(root, { recursive: true });
  mkdirSync(join(root, '.home'), { recursive: true });
  cpSync(resolve(repo, `fixtures/evals/${caseName}/state`), root, { recursive: true });
  return root;
}

function fileSig(path) {
  const stat = statSync(path);
  return { mtimeMs: stat.mtimeMs, bytes: readFileSync(path, 'utf-8') };
}

async function main() {
  const golden = JSON.parse(readFileSync(resolve(repo, 'fixtures/mcp/tool-catalog.golden.json'), 'utf-8'));
  assert(golden.tools.length === 7, 'golden catalog must contain exactly 7 tools');
  assert(golden.tools.map((t) => t.name).sort().join(',') === expectedTools.sort().join(','), 'golden catalog tool names drifted');

  const preinit = makeSandbox('route-execute-task');
  await withServer(preinit, async ({ send }) => {
    const response = await send('tools/list');
    assert(response.error?.code === -32002, 'request before initialize should fail');
  });
  rmSync(preinit, { recursive: true, force: true });

  const sandbox = makeSandbox('close-sprint-happy');
  try {
    await withServer(sandbox, async ({ send, notify, raw }) => {
      const init = await send('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'check-mcp', version: '1' } });
      assert(init.result?.protocolVersion === '2025-06-18', 'version negotiation should fall back to pinned version');
      assert(JSON.stringify(init.result.capabilities) === JSON.stringify({ tools: {} }), 'capabilities must be tools-only');
      notify('notifications/initialized');

      const list = await send('tools/list');
      assert(list.result?.tools?.length === 7, 'tools/list should return 7 tools');
      assert(JSON.stringify(list.result.tools) === JSON.stringify(golden.tools), 'tool catalog differs from golden');

      const ping = await send('ping');
      assert(ping.result && Object.keys(ping.result).length === 0, 'ping should return empty result');

      for (const tool of ['context_pack','doctor_artifacts','analyze_scope','scope_list','scope_inspect']) {
        const args = tool === 'scope_inspect' ? { scope: 'demo' } : tool === 'scope_list' ? {} : { scope: 'demo' };
        const response = await send('tools/call', { name: tool, arguments: args });
        assert(response.result?.isError === false, `${tool} should succeed`);
        assert(response.result?.structuredContent !== undefined, `${tool} should return structuredContent`);
      }

      const sprintPath = join(sandbox, '.agents/kyro/scopes/demo/sprint.json');
      const before = fileSig(sprintPath);
      const dry = await send('tools/call', { name: 'close_sprint', arguments: { scope: 'demo', outcome: 'shipped' } });
      assert(dry.result?.isError === false && dry.result.structuredContent?.phase === 'plan', 'close_sprint without confirm should return plan');
      const afterDry = fileSig(sprintPath);
      assert(before.bytes === afterDry.bytes && before.mtimeMs === afterDry.mtimeMs, 'close_sprint dry-run must not write');

      const applied = await send('tools/call', { name: 'close_sprint', arguments: { scope: 'demo', outcome: 'shipped', confirm: true } });
      assert(applied.result?.isError === false && applied.result.structuredContent?.phase === 'applied', 'close_sprint confirm should apply');
      assert(existsSync(join(sandbox, '.agents/kyro/scopes/demo/archive/sprint-001-demo-sprint.json')), 'close_sprint confirm should write snapshot');

      const doubleClose = await send('tools/call', { name: 'close_sprint', arguments: { scope: 'demo', outcome: 'shipped', confirm: true } });
      assert(doubleClose.result?.isError === true, 'double close should be a tool error');
      assert(doubleClose.result.structuredContent?.code === 'SNAPSHOT_EXISTS', 'double close should expose SNAPSHOT_EXISTS');

      const malformed = await raw('{not json');
      assert(malformed.error?.code === -32700, 'malformed JSON should return parse error');
      const afterMalformed = await send('ping');
      assert(afterMalformed.result, 'server should survive malformed JSON');

      const unknown = await send('unknown/method');
      assert(unknown.error?.code === -32601, 'unknown method should return -32601');
    });
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }


  const forbiddenConsole = [];
  for (const dir of ['src/cli/core', 'src/cli/mcp']) {
    const root = resolve(repo, dir);
    const stack = [root];
    while (stack.length) {
      const current = stack.pop();
      const { readdirSync, statSync } = await import('node:fs');
      for (const entry of readdirSync(current)) {
        const full = resolve(current, entry);
        const stat = statSync(full);
        if (stat.isDirectory()) stack.push(full);
        else if (entry.endsWith('.ts') && /console\./.test(readFileSync(full, 'utf-8'))) forbiddenConsole.push(full.replace(`${repo}/`, ''));
      }
    }
  }
  assert(forbiddenConsole.length === 0, `console.* is forbidden in core/mcp: ${forbiddenConsole.join(', ')}`);

  console.log('check:mcp — MCP stdio conformance passed');
}

main().catch((error) => {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
