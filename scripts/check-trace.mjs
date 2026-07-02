#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const repo = resolve(fileURLToPath(import.meta.url), '../..');
const cli = resolve(repo, 'dist/cli.js');
const allowedTraceReaders = new Set(['src/cli/core/trace.ts', 'src/cli/commands/trace.ts', 'src/cli/commands/doctor.ts']);
const eventTypes = ['route_selected','tool_command_run','validation_result','gate_approved','retry_count','blocked_reason','close_snapshot'];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function run(command, args, options = {}) {
  return spawnSync(command, args, { cwd: repo, encoding: 'utf-8', ...options });
}

function rg(pattern, extra = []) {
  const result = run('rg', ['-n', pattern, 'src/cli', ...extra]);
  if (result.status === 1) return [];
  assert(result.status === 0, `rg failed for ${pattern}: ${result.stderr}`);
  return result.stdout.trim().split('\n').filter(Boolean);
}

function rel(line) {
  return line.split(':')[0];
}

function makeSandbox(caseName = 'close-sprint-happy') {
  const root = join(tmpdir(), `kyro-trace-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(root, { recursive: true });
  mkdirSync(join(root, '.home'), { recursive: true });
  cpSync(resolve(repo, `fixtures/evals/${caseName}/state`), root, { recursive: true });
  return root;
}

function spawnCli(args, cwd, env = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    env: { ...process.env, HOME: join(cwd, '.home'), ...env },
    encoding: 'utf-8',
  });
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

function assertNoRoutingReads() {
  const lines = rg('readTrace|events\\.ndjson');
  const offenders = lines.filter((line) => !allowedTraceReaders.has(rel(line)));
  assert(offenders.length === 0, `trace must not be read outside allowed surfaces:\n${offenders.join('\n')}`);
}

function assertAppendOnlyStatic() {
  const lines = rg('writeFileSync|truncate|flag: .w.|flag: "w"|flag: \'w\'|events\\.ndjson');
  const offenders = lines.filter((line) => {
    const file = rel(line);
    if (file === 'src/cli/core/trace.ts') return /writeFileSync|truncate|flag: .w.|flag: "w"|flag: 'w'/.test(line);
    if (file === 'src/cli/commands/trace.ts') return /writeFileSync|truncate|flag: .w.|flag: "w"|flag: 'w'/.test(line);
    return /events\.ndjson/.test(line);
  });
  assert(offenders.length === 0, `trace append-only static check failed:\n${offenders.join('\n')}`);
}

function assertGoldenCatalog() {
  const golden = JSON.parse(readFileSync(resolve(repo, 'fixtures/trace/events.golden.json'), 'utf-8'));
  const goldenTypes = golden.events.map((event) => event.type).sort();
  assert(JSON.stringify(goldenTypes) === JSON.stringify([...eventTypes].sort()), 'trace golden event types drifted');
  const source = readFileSync(resolve(repo, 'src/cli/core/trace.ts'), 'utf-8');
  const sourceTypes = [...source.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).filter((value) => eventTypes.includes(value));
  assert(JSON.stringify([...new Set(sourceTypes)].sort()) === JSON.stringify([...eventTypes].sort()), 'TRACE_EVENT_TYPES drifted from golden catalog');
}

function assertNonFatal() {
  const sandbox = makeSandbox();
  try {
    const tracePath = join(sandbox, '.agents/kyro/scopes/demo/trace');
    writeFileSync(tracePath, 'not a directory');
    const result = spawnCli(['close-sprint', '--kyro-scope', 'demo', '--outcome', 'shipped', '--yes'], sandbox);
    assert(result.status === 0, `trace failure must not fail close-sprint: ${result.stderr || result.stdout}`);
    assert(existsSync(join(sandbox, '.agents/kyro/scopes/demo/archive/sprint-001-demo-sprint.json')), 'real close snapshot should still land');
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

function assertNdjsonAndCrashTolerantRead() {
  const sandbox = makeSandbox();
  try {
    const result = spawnCli(['close-sprint', '--kyro-scope', 'demo', '--outcome', 'shipped', '--yes'], sandbox);
    assert(result.status === 0, `close-sprint should succeed: ${result.stderr || result.stdout}`);
    const eventsPath = join(sandbox, '.agents/kyro/scopes/demo/trace/events.ndjson');
    assert(existsSync(eventsPath), 'trace events should exist');
    const lines = readFileSync(eventsPath, 'utf-8').trim().split('\n');
    for (const line of lines) {
      const event = JSON.parse(line);
      assert(event.v === 1, 'trace event must have v=1');
      assert(eventTypes.includes(event.type), `unknown trace event type ${event.type}`);
    }
    writeFileSync(eventsPath, `${readFileSync(eventsPath, 'utf-8')}{"v":1,"type"`, 'utf-8');
    const read = spawnCli(['trace', '--kyro-scope', 'demo', '--json'], sandbox);
    assert(read.status === 0, `trace reader should tolerate corrupt final line: ${read.stderr}`);
    assert(read.stderr.includes('Skipped 1 corrupt trace line'), 'trace reader should report skipped corrupt line');
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

async function assertMcpStdoutPurityWithTrace() {
  const sandbox = makeSandbox('route-execute-task');
  try {
    await withServer(sandbox, async ({ send }) => {
      await send('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'trace-check', version: '1' } });
      const response = await send('tools/call', { name: 'context_pack', arguments: { scope: 'demo' } });
      assert(response.result?.isError === false, 'context_pack should succeed through MCP with trace on');
    });
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

function assertKillSwitch() {
  const sandbox = makeSandbox();
  try {
    const result = spawnCli(['close-sprint', '--kyro-scope', 'demo', '--outcome', 'shipped', '--yes'], sandbox, { KYRO_TRACE: '0' });
    assert(result.status === 0, `close-sprint should succeed with KYRO_TRACE=0: ${result.stderr || result.stdout}`);
    assert(!existsSync(join(sandbox, '.agents/kyro/scopes/demo/trace/events.ndjson')), 'KYRO_TRACE=0 should not write events');
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

async function main() {
  assertNoRoutingReads();
  assertAppendOnlyStatic();
  assertGoldenCatalog();
  assertNonFatal();
  assertNdjsonAndCrashTolerantRead();
  assertKillSwitch();
  await assertMcpStdoutPurityWithTrace();
  console.log('check:trace — append-only trace invariants passed');
}

main().catch((error) => {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
