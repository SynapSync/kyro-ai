#!/usr/bin/env node
// HARN-01 snapshot/backup coverage (Sprint 1 R1/R2 + Sprint 2 T2.1 lifecycle gates).
//
// Exercises the public pipeline (applyOperationPlan from dist) and:
//   S1  (R1): `mkdir` over an existing directory with content must leave the
//         target byte-identical AND create no recursive backup (strict gate).
//   S1b (R1): `rmdir-if-empty` that does not act (missing / non-empty dir /
//         file target) must create no backup; the acting case (empty dir)
//         still snapshots during the transaction then disposes on confirm.
//   S2  (R2): mutating operations keep rollback for missing, file, directory,
//         symlink, permission-mode, rmdir-acting and mkdir-new cases: a
//         failing tail step triggers rollback and the pre-state is restored.
//   S3  (R3): a successful plan that creates a directory backup must leave
//         zero `kyro-pipeline-*` residuals of that plan after confirm.
//   S4  (R3): clean rollback disposes that plan's directory backups; a rollback
//         that fails mid-way must keep remaining backups as diagnostic evidence.
//   S5  (R4): snapshot create failure (mkdtemp) must propagate, leave the
//         target unchanged, and fail closed before apply (must not report
//         "rollback completed" when nothing was mutated).
//   S6  (R5): print a COMPARATIVE line (time, bytes copied, residuals) versus
//         the Sprint 1 baseline without claiming a quantitative savings.
// Detection uses two independent signals:
//      a) instrumented fs.cpSync / fs.mkdtempSync call + byte counting, with a
//         positive-control probe proving the detector is sensitive;
//      b) tmpdir scan for new `kyro-pipeline-*` entries (independent of patching).
// A reproducible BASELINE_JSON line (elapsed time, bytes copied, residuals) is
// always printed without claiming any improvement (R5).
//
// Modes (default is strict since the T1.2 policy landed):
//   - default / --strict: exit 1 if any no-op scenario creates a recursive
//     copy or residual backup, OR if the S3–S5 lifecycle gates fail. This is
//     the `npm run check:operation-snapshots` integration mode.
//   - --baseline: record metrics and exit 0 even when backups are observed
//     (pre-policy recording mode kept for comparison runs).
import { createRequire } from 'node:module';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync as fsMkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(fileURLToPath(import.meta.url), '../..');
const require = createRequire(import.meta.url);
// Mutable CJS handle to the shared builtin exports object: patching fs.cpSync /
// fs.mkdtempSync here intercepts dist's `require("node:fs")` call-time lookups.
// (NOTE: `import * as fs` would be a frozen namespace; createRequire is required.)
const fs = require('node:fs');

const STRICT = process.argv.includes('--strict') || !process.argv.includes('--baseline');
const REPEATS = Number(
  (process.argv.find((a) => a.startsWith('--repeats=')) ?? '').split('=')[1] || '3',
);
if (!Number.isInteger(REPEATS) || REPEATS < 1 || REPEATS > 20) {
  throw new Error(`--repeats must be an integer in [1,20], got ${REPEATS}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// --- Recursive-copy detector: patch the shared node:fs exports in-process. ---
// dist/cli/pipeline/operation-steps.js dereferences `require("node:fs").cpSync`
// at call time, so patching the cached builtin exports object intercepts it.
const realCpSync = fs.cpSync;
const realMkdtempSync = fs.mkdtempSync;
let copyCalls = 0;
let copiedBytes = 0;
let mkdtempPipelineCalls = 0;
const createdPipelineTemps = [];
// Test-only interceptors: S4 fails a later restore copy; S5 fails snapshot mkdtemp.
let failCpSyncIf = null;
let failMkdtempIf = null;

function dirBytes(root) {
  let total = 0;
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) {
        try {
          total += statSync(full).size;
        } catch {
          /* raced deletion: ignore */
        }
      }
    }
  }
  return total;
}

function resetCounters() {
  copyCalls = 0;
  copiedBytes = 0;
  mkdtempPipelineCalls = 0;
  createdPipelineTemps.length = 0;
}

fs.cpSync = function countedCpSync(src, dest, options) {
  copyCalls += 1;
  if (options && options.recursive) {
    try {
      if (existsSync(src) && lstatSync(src).isDirectory()) copiedBytes += dirBytes(src);
    } catch {
      /* best-effort accounting only */
    }
  }
  if (failCpSyncIf && failCpSyncIf(src, dest)) {
    throw new Error(`simulated copy failure dest=${dest}`);
  }
  return realCpSync(src, dest, options);
};

fs.mkdtempSync = function countedMkdtempSync(prefix, options) {
  if (failMkdtempIf && failMkdtempIf(prefix)) {
    throw new Error('ENOSPC: no space left on device (simulated mkdtemp)');
  }
  const created = realMkdtempSync(prefix, options);
  if (String(prefix).includes('kyro-pipeline-')) {
    mkdtempPipelineCalls += 1;
    createdPipelineTemps.push(created);
  }
  return created;
};

// --- Helpers ---
function listPipelineTemps() {
  return readdirSync(tmpdir()).filter((name) => name.startsWith('kyro-pipeline-')).sort();
}

function inventory(root) {
  const files = {};
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full, rel);
      else if (entry.isFile()) {
        files[rel] = createHash('sha256').update(readFileSync(full)).digest('hex');
      } else if (entry.isSymbolicLink()) {
        files[`${rel}@symlink`] = readlinkSafe(full);
      }
    }
  };
  walk(root, '');
  return files;
}

function readlinkSafe(path) {
  try {
    return readlinkSync(path);
  } catch {
    return '<unreadable>';
  }
}

function sameInventory(before, after) {
  return JSON.stringify(before) === JSON.stringify(after);
}

// --- Fixture: deterministic existing directory with content ---
function buildFixture(sandbox) {
  const existing = join(sandbox, 'target', 'existing');
  mkdirSync(join(existing, 'nested', 'deep'), { recursive: true });
  writeFileSync(join(existing, 'file-a.txt'), `${'alpha\n'.repeat(200)}`, 'utf-8');
  writeFileSync(join(existing, 'file-b.bin'), Buffer.alloc(64 * 1024, 0xab));
  writeFileSync(join(existing, 'nested', 'inner.txt'), `${'inner\n'.repeat(100)}`, 'utf-8');
  writeFileSync(join(existing, 'nested', 'deep', 'leaf.txt'), 'leaf\n', 'utf-8');
  return existing;
}

// --- Main ---
const distStep = join(repo, 'dist/cli/pipeline/operation-steps.js');
assert(existsSync(distStep), `Missing built pipeline (run npm run build first): ${distStep}`);
const { applyOperationPlan } = require(distStep);
assert(typeof applyOperationPlan === 'function', 'applyOperationPlan not exported from dist');

const context = { packageRoot: repo, resolveManagedPath: (p) => p };

// 0) Positive control: prove the detector observes recursive copies.
{
  const probe = fsMkdtempSync(join(tmpdir(), 'kyro-op-snap-probe-'));
  try {
    const src = join(probe, 'src');
    mkdirSync(join(src, 'sub'), { recursive: true });
    writeFileSync(join(src, 'sub', 'data.txt'), 'probe\n', 'utf-8');
    resetCounters();
    fs.cpSync(src, join(probe, 'dst'), { recursive: true });
    assert(copyCalls === 1, `detector probe: expected 1 cpSync call, saw ${copyCalls}`);
    assert(copiedBytes > 0, 'detector probe: expected copiedBytes > 0');
    console.log(`PROBE: detector sensitive (copyCalls=1, copiedBytes=${copiedBytes})`);
  } finally {
    resetCounters();
    rmSync(probe, { recursive: true, force: true });
  }
}

const sandbox = fsMkdtempSync(join(tmpdir(), 'kyro-op-snap-check-'));
let totalElapsedMs = 0;
let totalCopyCalls = 0;
let totalBytesCopied = 0;
let totalMkdtemp = 0;
// Gate aggregates: every no-op scenario (S1 + S1b non-acting) must stay at zero.
const gate = { copyCalls: 0, mkdtemp: 0, residuals: 0 };
// Sprint 2 lifecycle gates (S3–S5): success-path and clean-rollback residuals
// must be 0; failed rollback must keep remaining directory backups; snapshot
// create failure must fail closed before apply.
const lifecycle = {
  s3Residuals: -1,
  s3ElapsedMs: 0,
  s3CopyCalls: 0,
  s3BytesCopied: 0,
  s4CleanResiduals: -1,
  s4FailedRemaining: -1,
  s4FailedExpected: 2,
  s5Threw: false,
  s5TargetIntact: false,
  s5FailClosed: false,
  s6Printed: false,
};
const tempsBeforeAll = listPipelineTemps();
const tidyTemps = [];

function snapTemps() {
  return new Set(listPipelineTemps());
}

function diffTemps(before) {
  return listPipelineTemps().filter((name) => !before.has(name));
}

function planResidualPaths() {
  return createdPipelineTemps.filter((path) => existsSync(path));
}

function planResidualNames() {
  return planResidualPaths().map((path) => path.split(/[/\\]/).pop());
}

function tidy(names) {
  for (const name of new Set(names)) {
    try {
      rmSync(join(tmpdir(), name), { recursive: true, force: true });
    } catch {
      /* best-effort tidy */
    }
  }
}

// Runs one no-op plan, asserts the target state is preserved, and folds the
// backup signals into the strict gate.
function runNoopScenario(label, plan, verify) {
  const tempsBefore = snapTemps();
  resetCounters();
  const startedAt = Date.now();
  applyOperationPlan(plan, context);
  const elapsedMs = Date.now() - startedAt;
  verify();
  const newTemps = planResidualNames();
  gate.copyCalls += copyCalls;
  gate.mkdtemp += mkdtempPipelineCalls;
  gate.residuals += newTemps.length;
  totalElapsedMs += elapsedMs;
  totalCopyCalls += copyCalls;
  totalBytesCopied += copiedBytes;
  totalMkdtemp += mkdtempPipelineCalls;
  tidyTemps.push(...newTemps, ...diffTemps(tempsBefore));
  console.log(
    `${label}: targetIntact=true elapsedMs=${elapsedMs} copyCalls=${copyCalls} ` +
      `bytesCopied=${copiedBytes} mkdtempPipeline=${mkdtempPipelineCalls} ` +
      `newResiduals=${newTemps.length}`,
  );
}

function expectPlanThrow(label, plan) {
  let threw = false;
  try {
    applyOperationPlan(plan, context);
  } catch (error) {
    threw = true;
    console.log(`${label}: plan failed as designed (${error.message.slice(0, 120)})`);
  }
  assert(threw, `${label}: expected the plan to fail to trigger rollback`);
}

const FAIL_TAIL = (caseDir) => ({
  action: 'copy',
  path: join(caseDir, 'never-created.txt'),
  source: 'definitely/missing/source.txt',
});

try {
  // --- S1: mkdir no-op over an existing directory with content (repeated) ---
  const existing = buildFixture(sandbox);
  console.log(`SCENARIO S1: mkdir no-op over existing dir with content x${REPEATS}`);
  for (let i = 1; i <= REPEATS; i += 1) {
    const beforeInv = inventory(existing);
    runNoopScenario(`S1 ITER ${i}`, [{ action: 'mkdir', path: existing }], () => {
      assert(sameInventory(beforeInv, inventory(existing)), `S1 iter ${i}: target altered`);
    });
  }

  // --- S1b: rmdir-if-empty that does not act must not back up ---
  console.log('SCENARIO S1b: rmdir-if-empty no-ops (missing / non-empty / file)');
  const s1b = join(sandbox, 's1b');
  mkdirSync(s1b, { recursive: true });
  runNoopScenario('S1b missing', [{ action: 'rmdir-if-empty', path: join(s1b, 'gone') }], () => {
    assert(!existsSync(join(s1b, 'gone')), 'S1b missing: target should stay absent');
  });
  const nonEmpty = join(s1b, 'non-empty');
  mkdirSync(nonEmpty, { recursive: true });
  writeFileSync(join(nonEmpty, 'keep.txt'), 'keep\n', 'utf-8');
  const nonEmptyBefore = inventory(nonEmpty);
  runNoopScenario('S1b non-empty-dir', [{ action: 'rmdir-if-empty', path: nonEmpty }], () => {
    assert(existsSync(nonEmpty), 'S1b non-empty: directory must remain');
    assert(sameInventory(nonEmptyBefore, inventory(nonEmpty)), 'S1b non-empty: content altered');
  });
  const fileTarget = join(s1b, 'file.txt');
  writeFileSync(fileTarget, 'file-content\n', 'utf-8');
  runNoopScenario('S1b file-target', [{ action: 'rmdir-if-empty', path: fileTarget }], () => {
    assert(readFileSync(fileTarget, 'utf-8') === 'file-content\n', 'S1b file: content altered');
  });

  // --- S1b acting case: empty dir is removed; snapshot is taken then disposed on confirm ---
  {
    const emptyDir = join(s1b, 'empty');
    mkdirSync(emptyDir, { recursive: true });
    resetCounters();
    applyOperationPlan([{ action: 'rmdir-if-empty', path: emptyDir }], context);
    const newTemps = planResidualNames();
    assert(!existsSync(emptyDir), 'S1b acting: empty dir must be removed');
    assert(copyCalls === 1 && mkdtempPipelineCalls === 1, 'S1b acting: mutating op must snapshot during the transaction ' +
      `(copyCalls=${copyCalls}, mkdtemp=${mkdtempPipelineCalls})`);
    assert(newTemps.length === 0, 'S1b acting: successful apply must dispose the plan backup (want 0 residuals)');
    console.log(`S1b acting: removed=true snapshotTaken=true disposed=true copyCalls=1 bytesCopied=${copiedBytes} newResiduals=0`);
    tidyTemps.push(...newTemps);
  }

  // --- S2: rollback regression for mutating operations ---
  console.log('SCENARIO S2: rollback restores missing / file / dir / symlink / perms');
  const s2 = join(sandbox, 's2');
  mkdirSync(s2, { recursive: true });

  { // missing: created file vanishes on rollback
    const dir = join(s2, 'missing');
    mkdirSync(dir, { recursive: true });
    const created = join(dir, 'new.txt');
    const tempsBefore = snapTemps();
    resetCounters();
    expectPlanThrow('S2 missing', [{ action: 'write', path: created, content: 'hello' }, FAIL_TAIL(dir)]);
    assert(!existsSync(created), 'S2 missing: created file must vanish on rollback');
    assert(planResidualNames().length === 0, 'S2 missing: no residual backup expected');
    console.log('S2 missing: restored=true (absent)');
  }
  { // file + permission mode
    const dir = join(s2, 'file');
    mkdirSync(dir, { recursive: true });
    const target = join(dir, 'data.txt');
    writeFileSync(target, 'orig-content', 'utf-8');
    chmodSync(target, 0o600);
    const tempsBefore = snapTemps();
    resetCounters();
    expectPlanThrow('S2 file', [{ action: 'write', path: target, content: 'MUTATED' }, FAIL_TAIL(dir)]);
    assert(readFileSync(target, 'utf-8') === 'orig-content', 'S2 file: content not restored');
    assert((statSync(target).mode & 0o777) === 0o600, 'S2 file: permission mode not restored');
    assert(planResidualNames().length === 0, 'S2 file: no residual backup expected');
    console.log('S2 file: restored=true content+mode(0600)');
  }
  { // directory with content removed then restored
    const dir = join(s2, 'dir');
    const victim = join(dir, 'victim');
    mkdirSync(join(victim, 'nested'), { recursive: true });
    writeFileSync(join(victim, 'a.txt'), 'aaa', 'utf-8');
    writeFileSync(join(victim, 'nested', 'b.txt'), 'bbb', 'utf-8');
    const beforeInv = inventory(victim);
    const tempsBefore = snapTemps();
    resetCounters();
    expectPlanThrow('S2 directory', [{ action: 'remove', path: victim }, FAIL_TAIL(dir)]);
    assert(existsSync(victim), 'S2 directory: removed dir must be restored');
    assert(sameInventory(beforeInv, inventory(victim)), 'S2 directory: content not restored');
    assert(planResidualNames().length === 0, 'S2 directory: rollback must clean its own backup');
    console.log(`S2 directory: restored=true snapshotBytes=${copiedBytes}`);
  }
  { // symlink removed then restored with the same destination
    const dir = join(s2, 'symlink');
    mkdirSync(dir, { recursive: true });
    const real = join(dir, 'real.txt');
    writeFileSync(real, 'real', 'utf-8');
    const link = join(dir, 'link');
    symlinkSync(real, link);
    const destBefore = readlinkSync(link);
    const tempsBefore = snapTemps();
    resetCounters();
    expectPlanThrow('S2 symlink', [{ action: 'remove', path: link }, FAIL_TAIL(dir)]);
    assert(lstatSync(link).isSymbolicLink(), 'S2 symlink: link must be restored as a symlink');
    assert(readlinkSync(link) === destBefore, 'S2 symlink: destination changed');
    assert(planResidualNames().length === 0, 'S2 symlink: no residual backup expected');
    console.log('S2 symlink: restored=true destination preserved');
  }
  { // rmdir-if-empty acting rollback: empty dir comes back
    const dir = join(s2, 'rmdir-acting');
    const victim = join(dir, 'empty');
    mkdirSync(victim, { recursive: true });
    const tempsBefore = snapTemps();
    resetCounters();
    expectPlanThrow('S2 rmdir-acting', [{ action: 'rmdir-if-empty', path: victim }, FAIL_TAIL(dir)]);
    assert(existsSync(victim) && lstatSync(victim).isDirectory(), 'S2 rmdir-acting: dir must be restored');
    assert(readdirSync(victim).length === 0, 'S2 rmdir-acting: restored dir must be empty');
    assert(planResidualNames().length === 0, 'S2 rmdir-acting: rollback must clean its own backup');
    console.log('S2 rmdir-acting: restored=true (empty dir)');
  }
  { // mkdir-new rollback: created dir vanishes
    const dir = join(s2, 'mkdir-new');
    mkdirSync(dir, { recursive: true });
    const created = join(dir, 'fresh');
    const tempsBefore = snapTemps();
    resetCounters();
    expectPlanThrow('S2 mkdir-new', [{ action: 'mkdir', path: created }, FAIL_TAIL(dir)]);
    assert(!existsSync(created), 'S2 mkdir-new: created dir must vanish on rollback');
    assert(planResidualNames().length === 0, 'S2 mkdir-new: no residual backup expected');
    console.log('S2 mkdir-new: restored=true (absent)');
  }

  // --- S3 (R3): successful plan that creates a directory backup must leave 0 residuals ---
  {
    console.log('SCENARIO S3: successful directory-mutating plan must leave 0 kyro-pipeline-* residuals');
    const dir = join(sandbox, 's3');
    const victim = join(dir, 'victim');
    mkdirSync(join(victim, 'nested'), { recursive: true });
    writeFileSync(join(victim, 'payload.txt'), `${'payload\n'.repeat(50)}`, 'utf-8');
    writeFileSync(join(victim, 'nested', 'leaf.txt'), 'leaf\n', 'utf-8');
    resetCounters();
    const startedAt = Date.now();
    applyOperationPlan([{ action: 'remove', path: victim }], context);
    const elapsedMs = Date.now() - startedAt;
    assert(!existsSync(victim), 'S3: victim directory must be removed on success');
    const newTemps = planResidualNames();
    lifecycle.s3Residuals = newTemps.length;
    lifecycle.s3ElapsedMs = elapsedMs;
    lifecycle.s3CopyCalls = copyCalls;
    lifecycle.s3BytesCopied = copiedBytes;
    tidyTemps.push(...newTemps);
    console.log(
      `S3 success: removed=true elapsedMs=${elapsedMs} copyCalls=${copyCalls} ` +
        `bytesCopied=${copiedBytes} mkdtempPipeline=${mkdtempPipelineCalls} ` +
        `newResiduals=${newTemps.length} (want 0)`,
    );
  }

  // --- S4 (R3): clean rollback disposes backups; failed rollback keeps remaining ---
  {
    console.log('SCENARIO S4: clean rollback disposes backups; failed rollback keeps remaining as evidence');
    const cleanDir = join(sandbox, 's4-clean');
    const victim = join(cleanDir, 'victim');
    mkdirSync(join(victim, 'nested'), { recursive: true });
    writeFileSync(join(victim, 'a.txt'), 'aaa', 'utf-8');
    writeFileSync(join(victim, 'nested', 'b.txt'), 'bbb', 'utf-8');
    const beforeInv = inventory(victim);
    resetCounters();
    expectPlanThrow('S4 clean-rollback', [{ action: 'remove', path: victim }, FAIL_TAIL(cleanDir)]);
    assert(existsSync(victim), 'S4 clean-rollback: removed dir must be restored');
    assert(sameInventory(beforeInv, inventory(victim)), 'S4 clean-rollback: content not restored');
    const cleanTemps = planResidualNames();
    lifecycle.s4CleanResiduals = cleanTemps.length;
    tidyTemps.push(...cleanTemps);
    console.log(`S4 clean-rollback: restored=true newResiduals=${cleanTemps.length} (want 0)`);

    const failDir = join(sandbox, 's4-failed');
    const dirA = join(failDir, 'later-restore-a');
    const dirB = join(failDir, 'first-restore-b');
    mkdirSync(join(dirA, 'nested'), { recursive: true });
    writeFileSync(join(dirA, 'a.txt'), 'aaa', 'utf-8');
    mkdirSync(join(dirB, 'nested'), { recursive: true });
    writeFileSync(join(dirB, 'b.txt'), 'bbb', 'utf-8');
    resetCounters();
    failCpSyncIf = (_src, dest) => resolve(String(dest)) === resolve(dirA);
    let failedRollbackThrew = false;
    try {
      applyOperationPlan(
        [{ action: 'remove', path: dirA }, { action: 'remove', path: dirB }, FAIL_TAIL(failDir)],
        context,
      );
    } catch (error) {
      failedRollbackThrew = true;
      console.log(`S4 failed-rollback: plan failed as designed (${error.message.slice(0, 120)})`);
    } finally {
      failCpSyncIf = null;
    }
    assert(failedRollbackThrew, 'S4 failed-rollback: expected apply+rollback failure');
    assert(existsSync(dirB), 'S4 failed-rollback: first restore (dirB) should have succeeded');
    const remaining = planResidualNames();
    lifecycle.s4FailedRemaining = remaining.length;
    tidyTemps.push(...remaining);
    console.log(
      `S4 failed-rollback: remaining=${remaining.length} (want ${lifecycle.s4FailedExpected} directory backups as evidence)`,
    );
  }

  // --- S5 (R4): snapshot create failure must fail closed without mutating the target ---
  {
    console.log('SCENARIO S5: snapshot create failure propagates; target unchanged; fail-closed');
    const dir = join(sandbox, 's5');
    const victim = join(dir, 'victim');
    mkdirSync(join(victim, 'nested'), { recursive: true });
    writeFileSync(join(victim, 'keep.txt'), 'must-survive\n', 'utf-8');
    const beforeInv = inventory(victim);
    resetCounters();
    failMkdtempIf = (prefix) => String(prefix).includes('kyro-pipeline-');
    let threw = false;
    let errorMessage = '';
    try {
      applyOperationPlan([{ action: 'remove', path: victim }], context);
    } catch (error) {
      threw = true;
      errorMessage = error.message;
      console.log(`S5 snapshot-create: plan failed as designed (${errorMessage.slice(0, 160)})`);
    } finally {
      failMkdtempIf = null;
    }
    const intact = existsSync(victim) && sameInventory(beforeInv, inventory(victim));
    const failClosed = threw && intact && !/rollback completed/i.test(errorMessage);
    lifecycle.s5Threw = threw;
    lifecycle.s5TargetIntact = intact;
    lifecycle.s5FailClosed = failClosed;
    const newTemps = planResidualNames();
    tidyTemps.push(...newTemps);
    console.log(
      `S5 snapshot-create: threw=${threw} targetIntact=${intact} failClosed=${failClosed} ` +
        `newResiduals=${newTemps.length} (failClosed wants threw+intact and no "rollback completed")`,
    );
    assert(threw, 'S5: snapshot create failure must propagate (must not report success)');
    assert(intact, 'S5: target must be unchanged after snapshot create failure');
  }
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}

const tempsAfterAll = listPipelineTemps();
const baseline = {
  scenario: 'S1 mkdir-noop + S1b rmdir-noops + S2 rollback-matrix',
  repeats: REPEATS,
  strict: STRICT,
  totalElapsedMs,
  totalCopyCalls,
  totalMkdtempPipelineCalls: totalMkdtemp,
  totalBytesCopied,
  gateNoopCopyCalls: gate.copyCalls,
  gateNoopMkdtemp: gate.mkdtemp,
  gateNoopResiduals: gate.residuals,
  residualsBefore: tempsBeforeAll.length,
  residualsAfter: tempsAfterAll.length,
  rollbackCases: ['missing', 'file+0600', 'directory', 'symlink', 'rmdir-acting', 'mkdir-new'],
  targetIntact: true,
  detectorProbe: 'sensitive',
};
console.log(`BASELINE_JSON ${JSON.stringify(baseline)}`);

// S6 (R5): comparative metrics vs Sprint 1 — record only, never claim savings.
const SPRINT1_BASELINE = {
  source: 'sprint-001-snapshot-policy',
  scenario: 'S1 mkdir-noop + S1b rmdir-noops + S2 rollback-matrix',
  repeats: 3,
  gateNoopCopyCalls: 0,
  gateNoopMkdtemp: 0,
  gateNoopResiduals: 0,
  documentedNoopBytesCopied: 0,
  rollbackCases: 6,
  successPathResiduals: 1,
};
const comparative = {
  versus: SPRINT1_BASELINE.source,
  sprint1: SPRINT1_BASELINE,
  current: {
    repeats: REPEATS,
    totalElapsedMs,
    totalCopyCalls,
    totalBytesCopied,
    gateNoopCopyCalls: gate.copyCalls,
    gateNoopMkdtemp: gate.mkdtemp,
    gateNoopResiduals: gate.residuals,
    s3SuccessResiduals: lifecycle.s3Residuals,
    s3ElapsedMs: lifecycle.s3ElapsedMs,
    s3CopyCalls: lifecycle.s3CopyCalls,
    s3BytesCopied: lifecycle.s3BytesCopied,
    s4CleanResiduals: lifecycle.s4CleanResiduals,
    s4FailedRemaining: lifecycle.s4FailedRemaining,
    s5FailClosed: lifecycle.s5FailClosed,
    residualsBefore: tempsBeforeAll.length,
    residualsAfter: tempsAfterAll.length,
  },
  claimedSavings: false,
};
console.log(`COMPARATIVE ${JSON.stringify(comparative)}`);
lifecycle.s6Printed = true;

// Tidy any leftovers this run still owns (failed-rollback evidence, incomplete
// snapshot attempts). Successful plans and clean rollbacks should already be 0.
tidy(tidyTemps);

if (STRICT && (gate.copyCalls > 0 || gate.mkdtemp > 0 || gate.residuals > 0)) {
  console.error(
    `STRICT_GATE_FAILED noopCopyCalls=${gate.copyCalls} noopMkdtemp=${gate.mkdtemp} ` +
      `noopResiduals=${gate.residuals}: no-op operations must not create a recursive backup`,
  );
  process.exit(1);
}

const lifecycleFailed =
  lifecycle.s3Residuals !== 0 ||
  lifecycle.s4CleanResiduals !== 0 ||
  lifecycle.s4FailedRemaining < lifecycle.s4FailedExpected ||
  !lifecycle.s5FailClosed ||
  !lifecycle.s6Printed;

if (STRICT && lifecycleFailed) {
  console.error(
    `LIFECYCLE_GATE_FAILED s3Residuals=${lifecycle.s3Residuals} (want 0) ` +
      `s4CleanResiduals=${lifecycle.s4CleanResiduals} (want 0) ` +
      `s4FailedRemaining=${lifecycle.s4FailedRemaining} (want >=${lifecycle.s4FailedExpected}) ` +
      `s5FailClosed=${lifecycle.s5FailClosed} s6Printed=${lifecycle.s6Printed}: ` +
      `success-path leak, failed-rollback evidence, or snapshot fail-closed gap`,
  );
  process.exit(1);
}

if (!STRICT && (gate.copyCalls > 0 || gate.residuals > 0 || lifecycleFailed)) {
  console.log('RESULT: BASELINE_RECORDED (backups observed; strict gate off via --baseline)');
} else {
  console.log('RESULT: PASS (no recursive backup for no-ops; rollback preserved; lifecycle gates green)');
}
