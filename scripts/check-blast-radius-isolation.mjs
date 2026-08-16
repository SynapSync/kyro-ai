#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanLines } from './lib/scan.mjs';

const repo = resolve(fileURLToPath(import.meta.url), '../..');
const cli = resolve(repo, 'dist/cli.js');

// The four startup surfaces that resolve a Kyro scope and must never re-widen `repair integrity
// prepare`/`apply`/`doctor --artifacts` back to a global (no --kyro-scope) scan before or instead of
// resolving that scope. A drift-bearing, unrelated scope must never block a healthy one again.
const startupSurfaces = [
  'commands/forge.md',
  'internal/skills/sprint-forge/SKILL.md',
  'agents/orchestrator.md',
  'internal/skills/sprint-forge/assets/modes/recover.md',
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function makeSandbox(caseName = 'close-sprint-happy') {
  const root = join(tmpdir(), `kyro-blast-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(root, { recursive: true });
  mkdirSync(join(root, '.home'), { recursive: true });
  cpSync(resolve(repo, `fixtures/evals/${caseName}/state`), root, { recursive: true });
  return root;
}

function spawnCli(args, cwd) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    env: { ...process.env, HOME: join(cwd, '.home') },
    encoding: 'utf-8',
  });
}

function assertPrepareApplyDoctorAlwaysScoped() {
  const offenders = [];
  for (const file of startupSurfaces) {
    const text = readFileSync(resolve(repo, file), 'utf-8');
    const lines = text.split('\n');
    lines.forEach((line, index) => {
      // Only actual invocations (the literal `{{KYRO_CLI}} ...` form), never prose that merely
      // mentions the verb — e.g. "when `repair integrity prepare` reports findings".
      const isInvocation = /\{\{KYRO_CLI\}\}\s+(repair integrity (prepare|apply)|doctor --artifacts)\b/.test(line);
      if (isInvocation && !line.includes('--kyro-scope')) {
        offenders.push(`${file}:${index + 1}: ${line.trim()}`);
      }
    });
  }
  assert(
    offenders.length === 0,
    `startup surfaces must always pass --kyro-scope to repair integrity prepare/apply and doctor --artifacts (blast-radius regression):\n${offenders.join('\n')}`,
  );
}

function assertScopeResolvedBeforeIntegrityPrepare() {
  // Only the three routers resolve a scope inline before calling prepare; recover.md receives an
  // already-resolved scope from its caller and has no resolution step of its own.
  const routers = ['commands/forge.md', 'internal/skills/sprint-forge/SKILL.md', 'agents/orchestrator.md'];
  for (const file of routers) {
    const lines = readFileSync(resolve(repo, file), 'utf-8').split('\n');
    const resolveLine = lines.findIndex((line) => /resolve (the )?(active )?scope/i.test(line));
    const prepareLine = lines.findIndex((line) => /repair integrity prepare --kyro-scope/.test(line));
    assert(resolveLine !== -1, `${file}: could not find a scope-resolution step`);
    assert(prepareLine !== -1, `${file}: could not find a scoped integrity prepare step`);
    assert(
      resolveLine < prepareLine,
      `${file}: scope resolution (line ${resolveLine + 1}) must come before repair integrity prepare (line ${prepareLine + 1})`,
    );
  }
}

function assertNoRoutingReadsOfLegacyEventsLiteral() {
  // legacyTraceEventsPath must stay confined to the trace module and its two consumers — any other
  // hit means the legacy path leaked into a place that could accidentally start writing there again.
  const allowed = new Set(['src/cli/artifacts/paths.ts', 'src/cli/core/trace.ts', 'src/cli/commands/trace.ts']);
  const lines = scanLines('legacyTraceEventsPath', 'src/cli', { cwd: repo });
  const offenders = lines.filter((line) => !allowed.has(line.split(':')[0]));
  assert(offenders.length === 0, `legacyTraceEventsPath must stay confined to trace read paths:\n${offenders.join('\n')}`);
}

function assertHealthyScopeIsolatedFromBrokenSibling() {
  const sandbox = makeSandbox();
  try {
    // Scope B: irreconcilable — on disk, unregistered, no valid sprint.json.
    mkdirSync(join(sandbox, '.agents/kyro/scopes/broken'), { recursive: true });
    writeFileSync(join(sandbox, '.agents/kyro/scopes/broken/sprint.json'), 'not json');

    const scoped = spawnCli(['repair', 'integrity', 'prepare', '--kyro-scope', 'demo', '--json'], sandbox);
    assert(scoped.status === 0, `scoped prepare on the healthy scope should succeed: ${scoped.stderr}`);
    const scopedPlan = JSON.parse(scoped.stdout);
    assert(scopedPlan.findings.length === 0, `scoped prepare must not see the broken sibling scope: ${scoped.stdout}`);
    assert(scopedPlan.blockers.length === 0, `scoped prepare must report zero blockers for the healthy scope: ${scoped.stdout}`);

    const close = spawnCli(['close-sprint', '--kyro-scope', 'demo', '--outcome', 'shipped', '--yes'], sandbox);
    assert(close.status === 0, `close-sprint on the healthy scope must succeed despite the broken sibling: ${close.stderr || close.stdout}`);

    const doctorScoped = spawnCli(['doctor', '--artifacts', '--kyro-scope', 'demo'], sandbox);
    assert(doctorScoped.status === 0, `scoped doctor --artifacts must pass for the healthy scope despite the broken sibling: ${doctorScoped.stdout}`);

    const global = spawnCli(['repair', 'integrity', 'prepare', '--json'], sandbox);
    assert(global.status === 0, `global prepare should still succeed (report, not crash): ${global.stderr}`);
    const globalPlan = JSON.parse(global.stdout);
    assert(
      globalPlan.blockers.some((b) => b.summary.includes('broken')),
      `an explicit global scan (no --kyro-scope) must still surface the broken scope: ${global.stdout}`,
    );
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

function assertLegacyTraceOnlyDirectoryNeverDiscoveredAsScope() {
  const sandbox = makeSandbox();
  try {
    // Simulates the exact leftover the pre-fix trace writer could produce: a directory under
    // scopes/ holding nothing but a trace/ folder, no sprint.json.
    mkdirSync(join(sandbox, '.agents/kyro/scopes/ghost/trace'), { recursive: true });
    writeFileSync(
      join(sandbox, '.agents/kyro/scopes/ghost/trace/events.ndjson'),
      `${JSON.stringify({ v: 1, ts: '2020-01-01T00:00:00.000Z', scope: 'ghost', type: 'gate_approved', gate: 'repair_scope' })}\n`,
    );

    const global = spawnCli(['repair', 'integrity', 'prepare', '--json'], sandbox);
    assert(global.status === 0, `global prepare should succeed: ${global.stderr}`);
    assert(!global.stdout.includes('ghost'), `a trace-only leftover directory must never be discovered as a scope: ${global.stdout}`);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

function assertLegacyTraceHistoryStillReadable() {
  const sandbox = makeSandbox();
  try {
    mkdirSync(join(sandbox, '.agents/kyro/scopes/demo/trace'), { recursive: true });
    writeFileSync(
      join(sandbox, '.agents/kyro/scopes/demo/trace/events.ndjson'),
      `${JSON.stringify({ v: 1, ts: '2020-01-01T00:00:00.000Z', scope: 'demo', type: 'route_selected' })}\n`,
    );

    const close = spawnCli(['close-sprint', '--kyro-scope', 'demo', '--outcome', 'shipped', '--yes'], sandbox);
    assert(close.status === 0, `close-sprint should succeed: ${close.stderr || close.stdout}`);
    assert(existsSync(join(sandbox, '.agents/kyro/trace/demo/events.ndjson')), 'new-path trace events should exist after a post-upgrade write');

    const read = spawnCli(['trace', '--kyro-scope', 'demo', '--json'], sandbox);
    assert(read.status === 0, `trace read should succeed: ${read.stderr}`);
    const events = read.stdout.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
    assert(events[0].ts === '2020-01-01T00:00:00.000Z', `legacy pre-upgrade trace history must still be readable and ordered first: ${read.stdout}`);
    assert(events.length > 1, `post-upgrade events must be merged alongside legacy history: ${read.stdout}`);

    const clear = spawnCli(['trace', '--clear', 'demo'], sandbox);
    assert(clear.status === 0, `trace --clear should succeed: ${clear.stderr}`);
    assert(!existsSync(join(sandbox, '.agents/kyro/scopes/demo/trace/events.ndjson')), '--clear must also remove the legacy-path file');
    assert(!existsSync(join(sandbox, '.agents/kyro/trace/demo/events.ndjson')), '--clear must remove the current-path file');
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

/**
 * Rollback / mixed-runtime case: an older binary appends to the legacy path AFTER current-path
 * events already exist, so the legacy file holds the newest event. Concatenating legacy-then-current
 * would render it out of order and let `--tail` hide it entirely.
 */
function assertTraceMergeIsChronologicalNotPositional() {
  const sandbox = makeSandbox();
  try {
    mkdirSync(join(sandbox, '.agents/kyro/scopes/demo/trace'), { recursive: true });
    mkdirSync(join(sandbox, '.agents/kyro/trace/demo'), { recursive: true });
    const event = (ts, type) => `${JSON.stringify({ v: 1, ts, scope: 'demo', type })}\n`;

    // Legacy holds the NEWEST event; current holds the older one.
    writeFileSync(join(sandbox, '.agents/kyro/scopes/demo/trace/events.ndjson'), event('2030-01-01T00:00:00.000Z', 'route_selected'));
    writeFileSync(join(sandbox, '.agents/kyro/trace/demo/events.ndjson'), event('2020-01-01T00:00:00.000Z', 'gate_approved'));

    const read = spawnCli(['trace', '--kyro-scope', 'demo', '--json'], sandbox);
    assert(read.status === 0, `trace read should succeed: ${read.stderr}`);
    const events = read.stdout.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
    assert(events.length === 2, `both files must be read: ${read.stdout}`);
    assert(
      events[0].ts === '2020-01-01T00:00:00.000Z' && events[1].ts === '2030-01-01T00:00:00.000Z',
      `merged trace must be ordered by timestamp, not by which file it came from: ${read.stdout}`,
    );

    // --tail must keep the genuinely newest event, wherever it physically lives.
    const tailed = spawnCli(['trace', '--kyro-scope', 'demo', '--json', '--tail', '1'], sandbox);
    assert(tailed.status === 0, `tailed trace read should succeed: ${tailed.stderr}`);
    const tailEvents = tailed.stdout.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
    assert(tailEvents.length === 1, `--tail 1 should return exactly one event: ${tailed.stdout}`);
    assert(
      tailEvents[0].ts === '2030-01-01T00:00:00.000Z',
      `--tail must keep the newest event even when it lives on the legacy path: ${tailed.stdout}`,
    );
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

/** Identical timestamps must still render in one stable order (legacy first, then file line order). */
function assertTraceMergeTieBreakIsStable() {
  const sandbox = makeSandbox();
  try {
    mkdirSync(join(sandbox, '.agents/kyro/scopes/demo/trace'), { recursive: true });
    mkdirSync(join(sandbox, '.agents/kyro/trace/demo'), { recursive: true });
    const ts = '2025-06-01T12:00:00.000Z';
    writeFileSync(
      join(sandbox, '.agents/kyro/scopes/demo/trace/events.ndjson'),
      `${JSON.stringify({ v: 1, ts, scope: 'demo', type: 'route_selected' })}\n${JSON.stringify({ v: 1, ts, scope: 'demo', type: 'retry_count', round: 1, limit: 3, blocked: false })}\n`,
    );
    writeFileSync(
      join(sandbox, '.agents/kyro/trace/demo/events.ndjson'),
      `${JSON.stringify({ v: 1, ts, scope: 'demo', type: 'gate_approved', gate: 'a' })}\n${JSON.stringify({ v: 1, ts, scope: 'demo', type: 'close_snapshot', snapshot: 's', outcome: 'shipped' })}\n`,
    );

    const runs = [0, 1].map(() => {
      const read = spawnCli(['trace', '--kyro-scope', 'demo', '--json'], sandbox);
      assert(read.status === 0, `trace read should succeed: ${read.stderr}`);
      return read.stdout.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line).type).join(',');
    });
    assert(runs[0] === runs[1], `equal-timestamp ordering must be reproducible across reads: ${runs.join(' vs ')}`);
    assert(
      runs[0] === 'route_selected,retry_count,gate_approved,close_snapshot',
      `equal timestamps must tie-break legacy-first then original line order, got: ${runs[0]}`,
    );
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

function main() {
  assertPrepareApplyDoctorAlwaysScoped();
  assertScopeResolvedBeforeIntegrityPrepare();
  assertNoRoutingReadsOfLegacyEventsLiteral();
  assertHealthyScopeIsolatedFromBrokenSibling();
  assertLegacyTraceOnlyDirectoryNeverDiscoveredAsScope();
  assertLegacyTraceHistoryStillReadable();
  assertTraceMergeIsChronologicalNotPositional();
  assertTraceMergeTieBreakIsStable();
  console.log('check:blast-radius-isolation — startup-surface scoping, healthy/broken sibling isolation, and legacy trace continuity passed');
}

main();
