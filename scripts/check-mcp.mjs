#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { scanLines } from './lib/scan.mjs';

const repo = resolve(fileURLToPath(import.meta.url), '../..');
const cli = resolve(repo, 'dist/cli.js');
const expectedTools = ['context_pack','doctor_artifacts','analyze_scope','close_sprint','scope_list','scope_inspect','repair_scope','remediate_scope','review_task','trace_tail'];

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

function runCli(args, cwd) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, HOME: join(cwd, '.home') },
  });
}

function combinedOutput(result) {
  return `${result.stdout ?? ''}${result.stderr ?? ''}`;
}

async function main() {
  const golden = JSON.parse(readFileSync(resolve(repo, 'fixtures/mcp/tool-catalog.golden.json'), 'utf-8'));
  assert(golden.tools.length === 10, 'golden catalog must contain exactly 10 tools');
  assert(golden.tools.map((t) => t.name).sort().join(',') === [...expectedTools].sort().join(','), 'golden catalog tool names drifted');

  // ACI ergonomics gates (Plan 07).
  const handlersSrc = readFileSync(resolve(repo, 'src/cli/mcp/handlers.ts'), 'utf-8');
  for (const tool of golden.tools) {
    // (1) Every tool description carries usage guidance.
    assert(/\bUse\b/.test(tool.description) && tool.description.length > 20, `tool ${tool.name} description must state when to use it`);
    // (2) No declared-but-unread schema param (would have caught the dead `verbosity` stub).
    for (const param of Object.keys(tool.inputSchema.properties ?? {})) {
      assert(handlersSrc.includes(`args.${param}`), `tool ${tool.name} declares param "${param}" that no handler reads (dead param)`);
    }
    // (3) Annotations present.
    assert(tool.annotations && Object.keys(tool.annotations).length > 0, `tool ${tool.name} must declare annotations`);
  }
  // (4) Uniform error contract: no plain Error in the command/app surface.
  const plainThrows = scanLines('throw new Error\\(', 'src/cli/commands', { cwd: repo });
  if (/throw new Error\(/.test(readFileSync(resolve(repo, 'src/cli/app.ts'), 'utf-8'))) plainThrows.push('src/cli/app.ts');
  if (/throw new Error\(/.test(readFileSync(resolve(repo, 'src/cli/options.ts'), 'utf-8'))) plainThrows.push('src/cli/options.ts');
  assert(plainThrows.length === 0, `plain "throw new Error(" is forbidden in commands/app/options (use KyroCoreError): ${plainThrows.join(' | ')}`);

  // (5) CLI user-facing parse errors must render the same ACI envelope.
  const invalidDoctor = runCli(['doctor', '--bogus'], repo);
  assert(invalidDoctor.status === 1, 'doctor --bogus should exit 1');
  assert(combinedOutput(invalidDoctor).includes('Code: INVALID_INPUT'), 'doctor --bogus should render Code: INVALID_INPUT');
  const invalidAgent = runCli(['install', '--agent', 'nope', '--dry-run'], repo);
  assert(invalidAgent.status === 1, 'install --agent nope should exit 1');
  assert(combinedOutput(invalidAgent).includes('Code: INVALID_INPUT'), 'install --agent nope should render Code: INVALID_INPUT');

  // (6) --confirm must be accepted anywhere docs advertise it as a --yes alias.
  const reviewConfirmSandbox = makeSandbox('route-execute-task');
  const reviewConfirm = runCli(['review', 'T1.1', '--verdict', 'fail', '--confirm'], reviewConfirmSandbox);
  assert(!combinedOutput(reviewConfirm).includes('Unknown review option: --confirm'), 'review should accept --confirm alias');
  rmSync(reviewConfirmSandbox, { recursive: true, force: true });
  const closeConfirmSandbox = makeSandbox('close-sprint-happy');
  const closeConfirm = runCli(['close-sprint', '--confirm'], closeConfirmSandbox);
  assert(!combinedOutput(closeConfirm).includes('Unknown option: --confirm'), 'close-sprint should accept --confirm alias');
  rmSync(closeConfirmSandbox, { recursive: true, force: true });
  const scopeConfirmSandbox = makeSandbox('guard-scope-set-active-confirm');
  const scopeConfirm = runCli(['scope', 'set-active', 'demo', '--confirm'], scopeConfirmSandbox);
  assert(!combinedOutput(scopeConfirm).includes('Unknown scope set-active option: --confirm'), 'scope set-active should accept --confirm alias');
  rmSync(scopeConfirmSandbox, { recursive: true, force: true });

  const preinit = makeSandbox('route-execute-task');
  await withServer(preinit, async ({ send }) => {
    const response = await send('tools/list');
    assert(response.error?.code === -32002, 'request before initialize should fail');
  });
  rmSync(preinit, { recursive: true, force: true });

  const waiverSandbox = makeSandbox('review-waived-criterion');
  try {
    await withServer(waiverSandbox, async ({ send, notify }) => {
      await send('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'check-mcp-waiver', version: '1' } });
      notify('notifications/initialized');
      const waived = await send('tools/call', {
        name: 'review_task',
        arguments: {
          scope: 'demo',
          task_id: 'T1.1',
          verdict: 'pass',
          waived_criteria: ['Validation passes.::superseded by an approved scope change'],
          by: 'checker',
          confirm: true,
        },
      });
      assert(waived.result?.isError === false, `review_task should accept waived_criteria: ${JSON.stringify(waived)}`);
    });
    const sprint = JSON.parse(readFileSync(join(waiverSandbox, '.agents/kyro/scopes/demo/sprint.json'), 'utf-8'));
    const verdict = sprint.activeSprint.phases[0].tasks[0].verdict;
    assert(verdict?.waived_criteria?.[0]?.criterion === 'Validation passes.', 'MCP review_task should persist waived criterion');
    assert(verdict.waived_criteria[0].reason === 'superseded by an approved scope change', 'MCP review_task should persist waiver reason');
  } finally {
    rmSync(waiverSandbox, { recursive: true, force: true });
  }

  const sandbox = makeSandbox('close-sprint-happy');
  try {
    await withServer(sandbox, async ({ send, notify, raw }) => {
      const init = await send('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'check-mcp', version: '1' } });
      assert(init.result?.protocolVersion === '2025-06-18', 'version negotiation should fall back to pinned version');
      assert(JSON.stringify(init.result.capabilities) === JSON.stringify({ tools: {} }), 'capabilities must be tools-only');
      notify('notifications/initialized');

      const list = await send('tools/list');
      assert(list.result?.tools?.length === 10, 'tools/list should return 10 tools');
      assert(list.result.tools.find((tool) => tool.name === 'close_sprint')?.annotations?.idempotentHint === true, 'close_sprint must advertise idempotent retries');
      assert(JSON.stringify(list.result.tools) === JSON.stringify(golden.tools), 'tool catalog differs from golden');

      const ping = await send('ping');
      assert(ping.result && Object.keys(ping.result).length === 0, 'ping should return empty result');

      for (const tool of ['context_pack','doctor_artifacts','analyze_scope','scope_list','scope_inspect']) {
        const args = tool === 'scope_inspect' ? { scope: 'demo' } : tool === 'scope_list' ? {} : { scope: 'demo' };
        const response = await send('tools/call', { name: tool, arguments: args });
        assert(response.result?.isError === false, `${tool} should succeed`);
        assert(response.result?.structuredContent !== undefined, `${tool} should return structuredContent`);
        // ACI: text content is an actionable summary, not a raw JSON dump.
        const text = response.result?.content?.[0]?.text ?? '';
        assert(text.startsWith(`${tool}:`), `${tool} should return a "${tool}:" summary, got: ${text.slice(0, 40)}`);
        assert(!text.trimStart().startsWith('{'), `${tool} summary must not be a raw JSON dump`);
      }

      // Verbosity flows end-to-end (would have caught the dead `verbosity` stub).
      const concise = await send('tools/call', { name: 'context_pack', arguments: { scope: 'demo', verbosity: 'concise' } });
      assert(concise.result?.structuredContent?.verbosity === 'concise', 'context_pack must honor verbosity=concise');

      // trace_tail: read-only observability tool.
      const traceRes = await send('tools/call', { name: 'trace_tail', arguments: { scope: 'demo', limit: '5' } });
      assert(traceRes.result?.isError === false, 'trace_tail should succeed');
      assert(Array.isArray(traceRes.result.structuredContent?.events), 'trace_tail should return an events array');

      // review_task: dispatches and returns the typed error envelope for a missing task.
      const reviewBogus = await send('tools/call', { name: 'review_task', arguments: { scope: 'demo', task_id: 'NOPE' } });
      assert(reviewBogus.result?.isError === true, 'review_task on a missing task should be a tool error');
      assert(reviewBogus.result.structuredContent?.code === 'TASK_NOT_FOUND', 'review_task missing task should expose TASK_NOT_FOUND');

      const sprintPath = join(sandbox, '.agents/kyro/scopes/demo/sprint.json');
      const before = fileSig(sprintPath);
      const dry = await send('tools/call', { name: 'close_sprint', arguments: { scope: 'demo', outcome: 'shipped' } });
      assert(dry.result?.isError === false && dry.result.structuredContent?.phase === 'plan', 'close_sprint without confirm should return plan');
      const afterDry = fileSig(sprintPath);
      assert(before.bytes === afterDry.bytes && before.mtimeMs === afterDry.mtimeMs, 'close_sprint dry-run must not write');
      assert(!existsSync(join(sandbox, '.agents/kyro/scopes/demo/archive/sprint-001-demo-sprint.checkpoint.json')), 'close_sprint without confirm must not publish a checkpoint');

      const applied = await send('tools/call', { name: 'close_sprint', arguments: { scope: 'demo', outcome: 'shipped', confirm: true } });
      assert(applied.result?.isError === false && applied.result.structuredContent?.phase === 'applied', 'close_sprint confirm should apply');
      assert(existsSync(join(sandbox, '.agents/kyro/scopes/demo/archive/sprint-001-demo-sprint.json')), 'close_sprint confirm should write snapshot');
      assert(existsSync(join(sandbox, '.agents/kyro/scopes/demo/archive/sprint-001-demo-sprint.checkpoint.json')), 'close_sprint confirm should write lossless checkpoint');
      assert(typeof applied.result.structuredContent?.checkpointId === 'string', 'close_sprint should return additive checkpointId');

      const doubleClose = await send('tools/call', { name: 'close_sprint', arguments: { scope: 'demo', outcome: 'shipped', confirm: true } });
      assert(doubleClose.result?.isError === false, 'matching close retry should be idempotent');
      assert(doubleClose.result.structuredContent?.resumed === true, 'matching close retry should report resumed=true');

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
