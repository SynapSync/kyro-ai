#!/usr/bin/env node
// Verifies `kyro debt <subcommand>`: it mutates sprint.json.debt[] deterministically through the
// tool (no hand-edit), never deletes a debt item, never reuses an id, and refuses invalid transitions
// (restart a resolved item, escalate downward, defer without a concrete reason) without writing.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(fileURLToPath(import.meta.url), '../..');
const cli = resolve(repo, 'dist/cli.js');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sandbox() {
  const root = join(tmpdir(), `kyro-debt-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(join(root, '.home'), { recursive: true });
  cpSync(resolve(repo, 'fixtures/evals/route-review-task/state'), root, { recursive: true });
  return root;
}

function sprintPath(root) {
  return join(root, '.agents/kyro/scopes/demo/sprint.json');
}

function readSprint(root) {
  return JSON.parse(readFileSync(sprintPath(root), 'utf-8'));
}

function run(args, root) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    env: { ...process.env, HOME: join(root, '.home') },
    encoding: 'utf-8',
  });
}

// 1) `add` twice: sequential non-reused ids, status open, origin = active sprint number, and the
//    produced sprint.json stays schema-valid with no CRITICAL analyze findings.
{
  const root = sandbox();
  try {
    const first = run(['debt', 'add', '--title', 'Missing test coverage', '--priority', 'high', '--kyro-scope', 'demo'], root);
    assert(first.status === 0, `first debt add should succeed: ${first.stdout}${first.stderr}`);
    const afterFirst = readSprint(root).debt;
    assert(afterFirst.length === 1 && afterFirst[0].id === 'debt-1', `expected debt-1, got ${JSON.stringify(afterFirst)}`);
    assert(afterFirst[0].status === 'open', 'new debt should start open');
    assert(afterFirst[0].origin === 1, `origin should be the active sprint number (1), got ${afterFirst[0].origin}`);
    assert(afterFirst[0].priority === 'high', 'priority should round-trip');

    const second = run(['debt', 'add', '--title', 'Second item', '--priority', 'medium', '--kyro-scope', 'demo'], root);
    assert(second.status === 0, `second debt add should succeed: ${second.stdout}${second.stderr}`);
    const afterSecond = readSprint(root).debt;
    assert(afterSecond.length === 2, `expected 2 debt items, got ${afterSecond.length}`);
    const ids = afterSecond.map((d) => d.id).sort();
    assert(ids[0] === 'debt-1' && ids[1] === 'debt-2', `expected sequential non-reused ids, got ${JSON.stringify(ids)}`);

    const analyzeResult = run(['analyze', '--kyro-scope', 'demo', '--json'], root);
    assert(analyzeResult.status === 0, `analyze should succeed after debt add: ${analyzeResult.stdout}${analyzeResult.stderr}`);
    const envelope = JSON.parse(analyzeResult.stdout);
    assert(envelope.schemaVersion === 1 && envelope.ok === true, 'analyze must return a successful CLI envelope');
    const findings = envelope.data.findings ?? [];
    const critical = findings.filter((f) => f.severity === 'CRITICAL');
    assert(critical.length === 0, `analyze should report no CRITICAL findings, got ${JSON.stringify(critical)}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// 2) `start` on an open item flips it to in_progress; `start` on a resolved item is refused.
{
  const root = sandbox();
  try {
    run(['debt', 'add', '--title', 'Start me', '--priority', 'low', '--kyro-scope', 'demo'], root);
    const start = run(['debt', 'start', 'debt-1', '--kyro-scope', 'demo'], root);
    assert(start.status === 0, `start should succeed: ${start.stdout}${start.stderr}`);
    assert(readSprint(root).debt[0].status === 'in_progress', 'debt-1 should be in_progress after start');

    run(['debt', 'resolve', 'debt-1', '--kyro-scope', 'demo'], root);
    assert(readSprint(root).debt[0].status === 'resolved', 'debt-1 should be resolved before the restart check');
    const before = readFileSync(sprintPath(root), 'utf-8');
    const restart = run(['debt', 'start', 'debt-1', '--kyro-scope', 'demo'], root);
    assert(restart.status === 1, 'starting a resolved item should fail');
    assert((restart.stderr + restart.stdout).includes('INVALID_INPUT'), `restart of resolved should be INVALID_INPUT, got: ${restart.stderr}${restart.stdout}`);
    assert(readFileSync(sprintPath(root), 'utf-8') === before, 'rejected restart must not write sprint.json');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// 3) `resolve` sets status resolved and records --note.
{
  const root = sandbox();
  try {
    run(['debt', 'add', '--title', 'Resolve me', '--priority', 'medium', '--kyro-scope', 'demo'], root);
    const resolve = run(['debt', 'resolve', 'debt-1', '--note', 'Fixed in T1.1.', '--kyro-scope', 'demo'], root);
    assert(resolve.status === 0, `resolve should succeed: ${resolve.stdout}${resolve.stderr}`);
    const item = readSprint(root).debt[0];
    assert(item.status === 'resolved', 'debt-1 should be resolved');
    assert(item.note === 'Fixed in T1.1.', `note should be recorded, got ${JSON.stringify(item.note)}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// 4) `defer` requires both --target and --note; with both it sets deferred + targetSprint + note.
{
  const root = sandbox();
  try {
    run(['debt', 'add', '--title', 'Defer me', '--priority', 'low', '--kyro-scope', 'demo'], root);
    const before = readFileSync(sprintPath(root), 'utf-8');

    const noNote = run(['debt', 'defer', 'debt-1', '--target', '3', '--kyro-scope', 'demo'], root);
    assert(noNote.status === 1, 'defer without --note should fail');
    assert((noNote.stderr + noNote.stdout).includes('--note'), `defer without --note should mention --note, got: ${noNote.stderr}${noNote.stdout}`);

    const noTarget = run(['debt', 'defer', 'debt-1', '--note', 'Waiting on design.', '--kyro-scope', 'demo'], root);
    assert(noTarget.status === 1, 'defer without --target should fail');
    assert((noTarget.stderr + noTarget.stdout).includes('--target'), `defer without --target should mention --target, got: ${noTarget.stderr}${noTarget.stdout}`);

    assert(readFileSync(sprintPath(root), 'utf-8') === before, 'rejected defer calls must not write sprint.json');

    const ok = run(['debt', 'defer', 'debt-1', '--target', '3', '--note', 'Waiting on design.', '--kyro-scope', 'demo'], root);
    assert(ok.status === 0, `defer with both should succeed: ${ok.stdout}${ok.stderr}`);
    const item = readSprint(root).debt[0];
    assert(item.status === 'deferred', 'debt-1 should be deferred');
    assert(item.targetSprint === 3, `targetSprint should be 3, got ${item.targetSprint}`);
    assert(item.note === 'Waiting on design.', `note should be recorded, got ${JSON.stringify(item.note)}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// 5) `escalate` raises priority; escalating to a lower-or-equal priority is refused.
{
  const root = sandbox();
  try {
    run(['debt', 'add', '--title', 'Escalate me', '--priority', 'medium', '--kyro-scope', 'demo'], root);
    const up = run(['debt', 'escalate', 'debt-1', '--priority', 'high', '--kyro-scope', 'demo'], root);
    assert(up.status === 0, `escalate medium->high should succeed: ${up.stdout}${up.stderr}`);
    assert(readSprint(root).debt[0].priority === 'high', 'debt-1 should be high after escalate');

    const before = readFileSync(sprintPath(root), 'utf-8');
    const down = run(['debt', 'escalate', 'debt-1', '--priority', 'medium', '--kyro-scope', 'demo'], root);
    assert(down.status === 1, 'escalate high->medium (lower) should fail');
    assert(readFileSync(sprintPath(root), 'utf-8') === before, 'rejected escalate must not write sprint.json');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// 6) Unknown id on start/resolve/defer/escalate -> DEBT_NOT_FOUND, nothing written.
{
  const root = sandbox();
  try {
    const before = readFileSync(sprintPath(root), 'utf-8');
    for (const args of [
      ['debt', 'start', 'debt-99', '--kyro-scope', 'demo'],
      ['debt', 'resolve', 'debt-99', '--kyro-scope', 'demo'],
      ['debt', 'defer', 'debt-99', '--target', '2', '--note', 'x', '--kyro-scope', 'demo'],
      ['debt', 'escalate', 'debt-99', '--priority', 'high', '--kyro-scope', 'demo'],
    ]) {
      const result = run(args, root);
      assert(result.status === 1, `${args.join(' ')} should fail for unknown id`);
      assert((result.stderr + result.stdout).includes('DEBT_NOT_FOUND'), `${args.join(' ')} should report DEBT_NOT_FOUND, got: ${result.stderr}${result.stdout}`);
    }
    assert(readFileSync(sprintPath(root), 'utf-8') === before, 'unknown-id calls must not write sprint.json');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// 7) `--dry-run` on `add` prints a plan and writes nothing.
{
  const root = sandbox();
  try {
    const before = readFileSync(sprintPath(root), 'utf-8');
    const dry = run(['debt', 'add', '--title', 'Dry run item', '--priority', 'low', '--kyro-scope', 'demo', '--dry-run'], root);
    assert(dry.status === 0, `dry-run add should succeed: ${dry.stdout}${dry.stderr}`);
    assert(dry.stdout.includes('write') || dry.stdout.toLowerCase().includes('plan'), `dry-run should print a plan, got: ${dry.stdout}`);
    assert(dry.stdout.includes('Dry run complete'), `dry-run should announce no write, got: ${dry.stdout}`);
    assert(readFileSync(sprintPath(root), 'utf-8') === before, 'dry-run must not write sprint.json');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// 8) A pre-existing debt item is never dropped or mutated when a different item is changed.
{
  const root = sandbox();
  try {
    run(['debt', 'add', '--title', 'First item', '--priority', 'low', '--kyro-scope', 'demo'], root);
    run(['debt', 'add', '--title', 'Second item', '--priority', 'medium', '--kyro-scope', 'demo'], root);
    const untouchedBefore = readSprint(root).debt.find((d) => d.id === 'debt-1');

    run(['debt', 'resolve', 'debt-2', '--note', 'Done.', '--kyro-scope', 'demo'], root);

    const afterDebt = readSprint(root).debt;
    assert(afterDebt.length === 2, `both items should remain, got ${afterDebt.length}`);
    const untouchedAfter = afterDebt.find((d) => d.id === 'debt-1');
    assert(JSON.stringify(untouchedAfter) === JSON.stringify(untouchedBefore), 'debt-1 must be unchanged when debt-2 is mutated');
    const changed = afterDebt.find((d) => d.id === 'debt-2');
    assert(changed.status === 'resolved', 'debt-2 should be resolved');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// N) `kyro debt` is not a backdoor repair path. A scope carrying a legacy non-numeric origin is
//    refused with the field path and left byte-identical, so correcting it must go through the
//    audited `kyro remediate` transaction instead of a silent in-place rewrite.
{
  const root = sandbox();
  try {
    run(['debt', 'add', '--title', 'Legacy item', '--priority', 'low', '--kyro-scope', 'demo'], root);
    const corrupted = readSprint(root);
    corrupted.debt[0].origin = 'food-analysis FR-FA-013 revision';
    writeFileSync(sprintPath(root), `${JSON.stringify(corrupted, null, 2)}\n`);
    const before = readFileSync(sprintPath(root), 'utf-8');

    for (const args of [
      ['debt', 'add', '--title', 'Another', '--priority', 'low', '--kyro-scope', 'demo'],
      ['debt', 'resolve', 'debt-1', '--note', 'Done.', '--kyro-scope', 'demo'],
      ['debt', 'escalate', 'debt-1', '--priority', 'high', '--kyro-scope', 'demo'],
    ]) {
      const result = run(args, root);
      const output = `${result.stdout}${result.stderr}`;
      assert(result.status !== 0, `debt ${args[1]} must refuse a scope with a non-numeric origin: ${output}`);
      assert(output.includes('debt[0].origin must be a number'), `debt ${args[1]} must name the offending field: ${output}`);
      assert(readFileSync(sprintPath(root), 'utf-8') === before, `debt ${args[1]} must not write while refusing`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// N) The canonical write boundary is exact (ADR-0001): a legacy-only key, a missing canonical key,
//    an invalid literal and a wrong type each refuse every mutation, name the offending field path,
//    and leave the scope byte-identical. Recognizing legacy input is a reader's job, never a licence
//    to write it back.
{
  const drift = [
    ['extra legacy key', (debt) => { debt.addedSprint = 1; }, 'debt[0].addedSprint is not a canonical debt key'],
    ['missing canonical key', (debt) => { delete debt.targetSprint; }, 'debt[0].targetSprint must be a number or null'],
    ['invalid literal', (debt) => { debt.priority = 'blocker'; }, 'debt[0].priority must be one of'],
    ['wrong type', (debt) => { debt.origin = '1'; }, 'debt[0].origin must be a number'],
  ];

  for (const [name, mutate, expectedField] of drift) {
    const root = sandbox();
    try {
      run(['debt', 'add', '--title', 'Legacy item', '--priority', 'low', '--kyro-scope', 'demo'], root);
      const corrupted = readSprint(root);
      mutate(corrupted.debt[0]);
      writeFileSync(sprintPath(root), `${JSON.stringify(corrupted, null, 2)}\n`);
      const before = readFileSync(sprintPath(root), 'utf-8');

      for (const args of [
        ['debt', 'add', '--title', 'Another', '--priority', 'low', '--kyro-scope', 'demo'],
        ['debt', 'resolve', 'debt-1', '--note', 'Done.', '--kyro-scope', 'demo'],
        ['debt', 'escalate', 'debt-1', '--priority', 'high', '--kyro-scope', 'demo'],
      ]) {
        const result = run(args, root);
        const output = `${result.stdout}${result.stderr}`;
        assert(result.status !== 0, `debt ${args[1]} must refuse ${name}: ${output}`);
        assert(output.includes(expectedField), `debt ${args[1]} must name the ${name} field path: ${output}`);
        assert(output.includes('not an authorization'), `debt ${args[1]} must say the compatibility reading is diagnostic only: ${output}`);
        assert(readFileSync(sprintPath(root), 'utf-8') === before, `debt ${args[1]} must not write while refusing ${name}`);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
}

// N+1) `debt add` emits exactly the seven canonical keys — no legacy key survives a fresh write.
{
  const root = sandbox();
  try {
    const result = run(['debt', 'add', '--title', 'Exact shape', '--priority', 'medium', '--kyro-scope', 'demo'], root);
    assert(result.status === 0, `debt add must succeed on a canonical scope: ${result.stdout}${result.stderr}`);
    const written = readSprint(root).debt.at(-1);
    assert(
      JSON.stringify(Object.keys(written).sort()) === JSON.stringify(['id', 'note', 'origin', 'priority', 'status', 'targetSprint', 'title']),
      `debt add must emit exactly the seven canonical keys: ${JSON.stringify(Object.keys(written))}`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

console.log('check:debt — tool-owned debt mutation verified end-to-end');
