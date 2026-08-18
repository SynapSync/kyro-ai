#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readlinkSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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

/**
 * Digest of an entire directory tree: every relative path and every byte of every file. Directories
 * are projected too (`D:<rel>`), so adding or removing an empty one changes the digest — a
 * file-only projection would call a tree "byte-identical" after its structure was rewritten.
 */
function hashTree(root) {
  const entries = [];
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        entries.push(`D:${rel}`);
        walk(path, rel);
      } else if (entry.isSymbolicLink()) {
        entries.push(`L:${rel}:${readlinkSync(path)}`);
      } else {
        entries.push(`F:${rel}:${createHash('sha256').update(readFileSync(path)).digest('hex')}`);
      }
    }
  };
  walk(root, '');
  return createHash('sha256').update(entries.join('\n')).digest('hex');
}

function registerScopes(sandbox, entries) {
  const statePath = join(sandbox, '.agents/kyro/kyro.json');
  const state = JSON.parse(readFileSync(statePath, 'utf-8'));
  state.scopes.push(...entries);
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

function readRegistry(sandbox) {
  const layered = join(sandbox, '.agents/kyro/project.json');
  const legacy = join(sandbox, '.agents/kyro/kyro.json');
  return JSON.parse(readFileSync(existsSync(layered) ? layered : legacy, 'utf-8'));
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

/**
 * Scope identity comes from evidence, not from a directory existing. A stray folder used to become
 * an IRRECONCILABLE blocker AND get minted into project.json as a `planning` scope.
 */
function assertForeignDirectoryIsNeverAScope() {
  const sandbox = makeSandbox();
  try {
    mkdirSync(join(sandbox, '.agents/kyro/scopes/notes-backup'), { recursive: true });
    writeFileSync(join(sandbox, '.agents/kyro/scopes/notes-backup/README.md'), 'personal notes\n');
    mkdirSync(join(sandbox, '.agents/kyro/scopes/.ds-junk'), { recursive: true });

    const global = spawnCli(['repair', 'integrity', 'prepare', '--json'], sandbox);
    assert(global.status === 0, `global prepare should succeed: ${global.stderr}`);
    const plan = JSON.parse(global.stdout);
    assert(plan.blockers.length === 0, `foreign directories must never block integrity: ${global.stdout}`);

    const list = spawnCli(['scope', 'list'], sandbox);
    assert(!list.stdout.includes('notes-backup'), `foreign directories must not appear in scope list: ${list.stdout}`);

    // Advisory, never fatal, and only on a global run.
    const doctor = spawnCli(['doctor'], sandbox);
    assert(doctor.status === 0, `doctor must not fail over foreign directories: ${doctor.stdout}`);
    assert(/\[WARN\] scope directories/.test(doctor.stdout), `global doctor should warn about ignored directories: ${doctor.stdout}`);
    const scopedDoctor = spawnCli(['doctor', '--kyro-scope', 'demo'], sandbox);
    assert(!/\[WARN\] scope directories/.test(scopedDoctor.stdout), `a scoped doctor must not report unrelated directories: ${scopedDoctor.stdout}`);

    // An explicit --kyro-scope must not be a way around discovery.
    for (const args of [['status'], ['context-pack'], ['repair', 'integrity', 'prepare'], ['doctor', '--artifacts']]) {
      const result = spawnCli([...args, '--kyro-scope', 'notes-backup'], sandbox);
      assert(result.status !== 0, `${args.join(' ')} --kyro-scope notes-backup should fail: ${result.stdout}`);
      const output = `${result.stdout}${result.stderr}`;
      assert(output.includes('SCOPE_NOT_FOUND'), `${args.join(' ')} should report SCOPE_NOT_FOUND, not an integrity problem: ${output}`);
    }
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

/**
 * Refusing to call junk a scope must not hide a scope that lost sprint.json but can still be
 * resumed — and finding Kyro-shaped files must not promise a recovery that does not exist.
 */
function assertRecoverableAndDamagedAreDistinguished() {
  const sandbox = makeSandbox();
  try {
    const close = spawnCli(['close-sprint', '--kyro-scope', 'demo', '--outcome', 'shipped', '--yes'], sandbox);
    assert(close.status === 0, `close-sprint should succeed: ${close.stderr || close.stdout}`);
    // demo keeps its own archive but loses sprint.json -> genuinely resumable.
    rmSync(join(sandbox, '.agents/kyro/scopes/demo/sprint.json'), { force: true });
    // Kyro artifacts, but nothing usable -> must not promise a resume.
    mkdirSync(join(sandbox, '.agents/kyro/scopes/damaged/archive'), { recursive: true });
    writeFileSync(join(sandbox, '.agents/kyro/scopes/damaged/archive/sprint-001-x.checkpoint.json'), 'not a checkpoint\n');

    const global = spawnCli(['repair', 'integrity', 'prepare', '--json'], sandbox);
    assert(global.status === 0, `global prepare should succeed: ${global.stderr}`);
    const codes = JSON.parse(global.stdout).blockers.map((blocker) => blocker.code);
    assert(codes.includes('recoverable-no-sprint'), `a scope with a usable checkpoint must be reported as recoverable: ${global.stdout}`);
    assert(codes.includes('owned-damaged'), `Kyro artifacts without a usable checkpoint must not claim recoverability: ${global.stdout}`);

    // A recoverable scope must stay visible to the auditor that exists to inspect it.
    const doctor = spawnCli(['doctor', '--artifacts', '--kyro-scope', 'demo'], sandbox);
    assert(/demo\//.test(doctor.stdout), `doctor must still audit a scope that lost sprint.json: ${doctor.stdout}`);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

/** A checkpoint is resumable only when close-sprint can consume the exact same regular path. */
function assertSymlinkCheckpointNeverClaimsRecovery() {
  const sandbox = makeSandbox();
  try {
    const closeArgs = ['close-sprint', '--kyro-scope', 'demo', '--outcome', 'shipped', '--yes'];
    const close = spawnCli(closeArgs, sandbox);
    assert(close.status === 0, `close-sprint should succeed: ${close.stderr || close.stdout}`);

    const archive = join(sandbox, '.agents/kyro/scopes/demo/archive');
    const checkpointName = readdirSync(archive).find((file) => file.endsWith('.checkpoint.json'));
    assert(Boolean(checkpointName), 'close-sprint must publish a checkpoint fixture');
    const checkpointPath = join(archive, checkpointName);
    const preservedPath = join(sandbox, '.agents/kyro/scopes/demo/preserved-checkpoint.json');
    cpSync(checkpointPath, preservedPath);
    rmSync(checkpointPath);
    symlinkSync('../preserved-checkpoint.json', checkpointPath);
    rmSync(join(sandbox, '.agents/kyro/scopes/demo/sprint.json'));

    const prepare = spawnCli(['repair', 'integrity', 'prepare', '--kyro-scope', 'demo', '--json'], sandbox);
    assert(prepare.status === 0, `prepare should diagnose an unsafe checkpoint: ${prepare.stderr}`);
    const blockers = JSON.parse(prepare.stdout).blockers;
    assert(
      blockers.some((blocker) => blocker.code === 'owned-damaged' && /unsafe|symbolic link/i.test(blocker.summary)),
      `a symlink checkpoint must be owned-damaged with an unsafe-path diagnosis: ${prepare.stdout}`,
    );
    assert(
      !blockers.some((blocker) => blocker.code === 'recoverable-no-sprint'),
      `a symlink checkpoint must never promise recovery: ${prepare.stdout}`,
    );

    const doctor = spawnCli(['doctor', '--artifacts', '--kyro-scope', 'demo'], sandbox);
    assert(doctor.status !== 0, `Doctor must fail an unsafe checkpoint path: ${doctor.stdout}`);
    assert(/UNSAFE_PATH|symbolic link/i.test(`${doctor.stdout}${doctor.stderr}`), `Doctor must name the unsafe checkpoint path: ${doctor.stdout}${doctor.stderr}`);

    const impossibleRetry = spawnCli(closeArgs, sandbox);
    assert(impossibleRetry.status !== 0, 'close-sprint must continue rejecting a checkpoint symlink');

    rmSync(checkpointPath);
    cpSync(preservedPath, checkpointPath);
    const restoredPrepare = spawnCli(['repair', 'integrity', 'prepare', '--kyro-scope', 'demo', '--json'], sandbox);
    assert(restoredPrepare.status === 0, `prepare should accept the restored regular checkpoint: ${restoredPrepare.stderr}`);
    assert(
      JSON.parse(restoredPrepare.stdout).blockers.some((blocker) => blocker.code === 'recoverable-no-sprint'),
      `restoring the regular checkpoint must restore the real resume path: ${restoredPrepare.stdout}`,
    );
    const resumed = spawnCli(closeArgs, sandbox);
    assert(resumed.status === 0, `close-sprint must resume after the regular checkpoint is restored: ${resumed.stderr || resumed.stdout}`);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

/**
 * Ownership is proved by names Kyro writes, never by a generic one. `archive/` is an ordinary word:
 * if merely holding something counted, a human's `notes-backup/archive/README.md` would classify as
 * owned-damaged and become a project-wide blocker — the original defect, one level deeper.
 */
function assertGenericArchiveContentIsNotOwnership() {
  const sandbox = makeSandbox();
  try {
    const foreign = join(sandbox, '.agents/kyro/scopes/notes-backup');
    mkdirSync(join(foreign, 'archive'), { recursive: true });
    mkdirSync(join(foreign, 'archive/2024'), { recursive: true });
    writeFileSync(join(foreign, 'archive/README.md'), 'my notes\n');
    writeFileSync(join(foreign, 'archive/2024/january.md'), 'older notes\n');
    // An empty archive/ is likewise no evidence.
    mkdirSync(join(sandbox, '.agents/kyro/scopes/empty-archive/archive'), { recursive: true });
    // Nor is an empty record directory, even one whose name only Kyro chooses: there is no history
    // in it to protect, so it must not become a project-wide blocker.
    for (const dir of ['certifications', 'remediations', 'checkpoint-remediations']) {
      mkdirSync(join(sandbox, `.agents/kyro/scopes/empty-${dir}/archive/${dir}`), { recursive: true });
    }
    // A name Kyro cannot produce is not Kyro's name: every writer pads its index to three digits.
    mkdirSync(join(sandbox, '.agents/kyro/scopes/short-index/archive/remediations'), { recursive: true });
    writeFileSync(join(sandbox, '.agents/kyro/scopes/short-index/archive/remediations/remediation-1.json'), '{}\n');
    // And where the name is the entire proof, a symlink is not the file it names — otherwise
    // anything reachable on the filesystem could claim a directory as Kyro's.
    mkdirSync(join(sandbox, '.agents/kyro/scopes/linked-record/archive/remediations'), { recursive: true });
    writeFileSync(join(sandbox, '.agents/kyro/scopes/linked-record/target.json'), '{}\n');
    symlinkSync('../../target.json', join(sandbox, '.agents/kyro/scopes/linked-record/archive/remediations/remediation-001.json'));
    mkdirSync(join(sandbox, '.agents/kyro/scopes/linked-retirement'), { recursive: true });
    writeFileSync(join(sandbox, '.agents/kyro/scopes/linked-retirement/target.json'), 'not a checkpoint\n');
    symlinkSync('target.json', join(sandbox, '.agents/kyro/scopes/linked-retirement/retirement.checkpoint.json'));

    const global = spawnCli(['repair', 'integrity', 'prepare', '--json'], sandbox);
    assert(global.status === 0, `global prepare should succeed: ${global.stderr}`);
    const plan = JSON.parse(global.stdout);
    assert(
      plan.blockers.length === 0,
      `a generic archive/ must not make a foreign directory an owned-damaged blocker: ${global.stdout}`,
    );

    const list = spawnCli(['scope', 'list'], sandbox);
    for (const id of ['notes-backup', 'empty-archive', 'empty-remediations', 'short-index', 'linked-record', 'linked-retirement']) {
      assert(!list.stdout.includes(id), `${id} holds no name Kyro writes and must not be a scope: ${list.stdout}`);
    }

    // The counterpart: a name only Kyro writes IS ownership, even when nothing is resumable and even
    // when the record's own bytes are unreadable. The recognizable name is the evidence.
    mkdirSync(join(sandbox, '.agents/kyro/scopes/owned-checkpoint/archive'), { recursive: true });
    writeFileSync(join(sandbox, '.agents/kyro/scopes/owned-checkpoint/archive/sprint-001-x.checkpoint.json'), 'not a checkpoint\n');
    mkdirSync(join(sandbox, '.agents/kyro/scopes/owned-checkpoint-directory/archive/sprint-001-x.checkpoint.json'), { recursive: true });
    mkdirSync(join(sandbox, '.agents/kyro/scopes/owned-remediation/archive/remediations'), { recursive: true });
    writeFileSync(join(sandbox, '.agents/kyro/scopes/owned-remediation/archive/remediations/remediation-001.json'), 'not json\n');
    mkdirSync(join(sandbox, '.agents/kyro/scopes/owned-certification/archive/certifications'), { recursive: true });
    writeFileSync(join(sandbox, '.agents/kyro/scopes/owned-certification/archive/certifications/certification-001.json'), 'not json\n');
    mkdirSync(join(sandbox, '.agents/kyro/scopes/owned-canonicalization/archive/checkpoint-remediations'), { recursive: true });
    writeFileSync(join(sandbox, '.agents/kyro/scopes/owned-canonicalization/archive/checkpoint-remediations/canonicalization-001.json'), 'not json\n');
    mkdirSync(join(sandbox, '.agents/kyro/scopes/owned-retirement'), { recursive: true });
    writeFileSync(join(sandbox, '.agents/kyro/scopes/owned-retirement/retirement.checkpoint.json'), 'not a checkpoint\n');
    // A Kyro checkpoint-shaped symlink is evidence of damaged managed state, but is never usable.
    mkdirSync(join(sandbox, '.agents/kyro/scopes/linked-checkpoint/archive'), { recursive: true });
    writeFileSync(join(sandbox, '.agents/kyro/scopes/linked-checkpoint/target.json'), 'not a checkpoint\n');
    symlinkSync('../target.json', join(sandbox, '.agents/kyro/scopes/linked-checkpoint/archive/sprint-001-x.checkpoint.json'));
    mkdirSync(join(sandbox, '.agents/kyro/scopes/linked-checkpoint-missing/archive'), { recursive: true });
    symlinkSync('../missing.json', join(sandbox, '.agents/kyro/scopes/linked-checkpoint-missing/archive/sprint-001-x.checkpoint.json'));
    mkdirSync(join(sandbox, '.agents/kyro/scopes/linked-checkpoint-external/archive'), { recursive: true });
    symlinkSync('/etc/hosts', join(sandbox, '.agents/kyro/scopes/linked-checkpoint-external/archive/sprint-001-x.checkpoint.json'));

    const second = spawnCli(['repair', 'integrity', 'prepare', '--json'], sandbox);
    assert(second.status === 0, `global prepare should succeed: ${second.stderr}`);
    const damagedBlockers = JSON.parse(second.stdout).blockers
      .filter((blocker) => blocker.code === 'owned-damaged');
    const summaryFor = (id) => damagedBlockers.find((blocker) => blocker.summary.startsWith(`${id}:`))?.summary ?? '';
    assert(
      summaryFor('linked-checkpoint').includes('checkpoint path is a symbolic link and cannot be resumed safely'),
      `Dirent.isFile must own the exact symlink-candidate diagnosis: ${second.stdout}`,
    );
    assert(
      summaryFor('owned-checkpoint-directory').includes('checkpoint candidate is not a regular file'),
      `Dirent.isFile must own the exact non-regular-candidate diagnosis: ${second.stdout}`,
    );
    const damaged = damagedBlockers
      .filter((blocker) => blocker.code === 'owned-damaged')
      .map((blocker) => blocker.summary.split(':')[0])
      .sort();
    // Exact equality, not `includes`: this is what proves the negatives above stayed foreign while
    // their real-file counterparts did not.
    assert(
      JSON.stringify(damaged) === JSON.stringify([
        'linked-checkpoint', 'linked-checkpoint-external', 'linked-checkpoint-missing',
        'owned-canonicalization', 'owned-certification', 'owned-checkpoint', 'owned-checkpoint-directory',
        'owned-remediation', 'owned-retirement',
      ]),
      `exactly the Kyro-named regular files must prove ownership: ${JSON.stringify(damaged)}`,
    );
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

/**
 * Installs upgraded from before this rule may already carry a junk registry entry. Cleaning it must
 * be possible — globally AND scoped — and must not touch a single byte of the directory Kyro does
 * not own. Registry membership is the second axis: only UNREGISTERED + FOREIGN is a wrong name, so
 * rejecting every foreign directory at the guard would leave scoped repair with no way to clean up.
 */
function assertPreExistingContaminationIsCleanable() {
  for (const mode of ['global', 'scoped']) {
    const sandbox = makeSandbox();
    try {
      const foreign = join(sandbox, '.agents/kyro/scopes/notes-backup');
      mkdirSync(join(foreign, 'drafts'), { recursive: true });
      mkdirSync(join(foreign, 'inbox'), { recursive: true });
      writeFileSync(join(foreign, 'README.md'), 'do not touch\n');
      writeFileSync(join(foreign, 'drafts/idea.md'), 'do not touch this either\n');
      registerScopes(sandbox, [{ id: 'notes-backup', title: 'notes-backup', status: 'planning' }]);
      const before = hashTree(foreign);

      // The digest must be structural, not file-only: an empty directory is part of what "preserved
      // byte for byte" has to mean, or removing one would go unnoticed by this very assertion.
      mkdirSync(join(foreign, 'probe'), { recursive: true });
      assert(hashTree(foreign) !== before, `${mode}: hashTree must notice an added empty directory`);
      rmSync(join(foreign, 'probe'), { recursive: true, force: true });
      assert(hashTree(foreign) === before, `${mode}: hashTree must be stable once the probe is removed`);

      const scopeArgs = mode === 'scoped' ? ['--kyro-scope', 'notes-backup'] : [];
      const prepare = spawnCli(['repair', 'integrity', 'prepare', ...scopeArgs, '--json'], sandbox);
      assert(prepare.status === 0, `${mode} prepare should succeed: ${prepare.stderr}`);
      const plan = JSON.parse(prepare.stdout);
      assert(
        plan.targets.unregister.includes('notes-backup'),
        `${mode}: a registry entry pointing at a foreign directory must be an unregister target, not a blocker: ${prepare.stdout}`,
      );

      // apply re-derives the plan, so it must be given the same scope the digest was computed under.
      const apply = spawnCli(['repair', 'integrity', 'apply', ...scopeArgs, '--digest', plan.digest, '--yes'], sandbox);
      assert(apply.status === 0, `${mode} apply should clean the contaminated entry: ${apply.stderr || apply.stdout}`);

      assert(hashTree(foreign) === before, `${mode}: unregister must not modify a byte of the foreign directory tree`);

      assert(
        !readRegistry(sandbox).scopes.some((entry) => entry.id === 'notes-backup'),
        `${mode}: the contaminated entry must be gone from the registry: ${JSON.stringify(readRegistry(sandbox).scopes)}`,
      );

      // Once unregistered, the same id is an ordinary wrong name again.
      const after = spawnCli(['repair', 'integrity', 'prepare', '--kyro-scope', 'notes-backup', '--json'], sandbox);
      assert(after.status !== 0, `${mode}: an unregistered foreign directory must not be addressable: ${after.stdout}`);
      assert(
        `${after.stdout}${after.stderr}`.includes('SCOPE_NOT_FOUND'),
        `${mode}: an unregistered foreign directory must report SCOPE_NOT_FOUND: ${after.stdout}${after.stderr}`,
      );
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  }
}

/**
 * The full cross product. Directory class alone decided classification before, so "registered" and
 * "on disk" collapsed into one bucket and a registered scope with an invalid sprint.json was
 * reported as healthy.
 */
function assertRegistryMatrixIsClassifiedByBothAxes() {
  const sandbox = makeSandbox();
  try {
    // REGISTERED + RECOVERABLE: demo closes (writing its own checkpoint), then loses sprint.json.
    const close = spawnCli(['close-sprint', '--kyro-scope', 'demo', '--outcome', 'shipped', '--yes'], sandbox);
    assert(close.status === 0, `close-sprint should succeed: ${close.stderr || close.stdout}`);
    rmSync(join(sandbox, '.agents/kyro/scopes/demo/sprint.json'), { force: true });

    // REGISTERED + CORRUPT_SPRINT.
    mkdirSync(join(sandbox, '.agents/kyro/scopes/reg-corrupt'), { recursive: true });
    writeFileSync(join(sandbox, '.agents/kyro/scopes/reg-corrupt/sprint.json'), 'not json');
    // REGISTERED + FOREIGN.
    mkdirSync(join(sandbox, '.agents/kyro/scopes/reg-foreign'), { recursive: true });
    writeFileSync(join(sandbox, '.agents/kyro/scopes/reg-foreign/notes.txt'), 'not ours\n');
    // REGISTERED + ABSENT: registered below, never created on disk.
    registerScopes(sandbox, [
      { id: 'reg-corrupt', title: 'reg-corrupt', status: 'planning' },
      { id: 'reg-foreign', title: 'reg-foreign', status: 'planning' },
      { id: 'reg-absent', title: 'reg-absent', status: 'planning' },
    ]);
    // UNREGISTERED + FOREIGN.
    mkdirSync(join(sandbox, '.agents/kyro/scopes/stray'), { recursive: true });
    writeFileSync(join(sandbox, '.agents/kyro/scopes/stray/notes.txt'), 'not ours either\n');

    const prepare = spawnCli(['repair', 'integrity', 'prepare', '--json'], sandbox);
    assert(prepare.status === 0, `global prepare should succeed: ${prepare.stderr}`);
    const plan = JSON.parse(prepare.stdout);
    const codeFor = (id) => (plan.blockers.find((blocker) => blocker.summary.startsWith(`${id}:`)) ?? {}).code;

    assert(codeFor('demo') === 'recoverable-no-sprint', `registered + recoverable must report recoverable-no-sprint: ${prepare.stdout}`);
    assert(codeFor('reg-corrupt') === 'irreconcilable', `registered + corrupt sprint.json must report irreconcilable: ${prepare.stdout}`);
    assert(
      plan.targets.unregister.includes('reg-foreign') && plan.targets.unregister.includes('reg-absent'),
      `registered + foreign and registered + absent are both orphan registry entries: ${prepare.stdout}`,
    );
    assert(codeFor('reg-foreign') === undefined, `a registered foreign directory must be an unregister target, not a blocker: ${prepare.stdout}`);
    assert(
      !prepare.stdout.includes('stray'),
      `an unregistered foreign directory must be invisible to integrity entirely: ${prepare.stdout}`,
    );
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

/** Managed ancestors are classified without ever following their target. */
function assertManagedAncestorSymlinksAreScopeBound() {
  for (const level of ['scope-root', 'sprint', 'archive', 'record-directory']) {
    const sandbox = makeSandbox();
    const external = join(sandbox, `external-${level}`);
    try {
      mkdirSync(external, { recursive: true });
      writeFileSync(join(external, 'sentinel.txt'), 'first\n');
      const scopeRoot = join(sandbox, '.agents/kyro/scopes/demo');
      if (level === 'scope-root') {
        rmSync(scopeRoot, { recursive: true, force: true });
        symlinkSync(external, scopeRoot);
      } else if (level === 'sprint') {
        const sprint = join(scopeRoot, 'sprint.json');
        cpSync(sprint, join(external, 'sprint.json'));
        rmSync(sprint);
        symlinkSync(join(external, 'sprint.json'), sprint);
      } else if (level === 'archive') {
        symlinkSync(external, join(scopeRoot, 'archive'));
      } else {
        mkdirSync(join(scopeRoot, 'archive'), { recursive: true });
        symlinkSync(external, join(scopeRoot, 'archive/remediations'));
      }

      const first = spawnCli(['repair', 'integrity', 'prepare', '--kyro-scope', 'demo', '--json'], sandbox);
      assert(first.status === 0, `${level}: scoped prepare must diagnose the unsafe path: ${first.stderr}`);
      const firstPlan = JSON.parse(first.stdout);
      assert(
        firstPlan.blockers.some((blocker) => blocker.code === 'owned-damaged' && /unsafe|symbolic link/i.test(blocker.summary)),
        `${level}: a registered unsafe managed path must be owned-damaged: ${first.stdout}`,
      );
      assert(firstPlan.operations.length === 0, `${level}: unsafe paths must never produce repair operations: ${first.stdout}`);
      assert(!`${first.stdout}${first.stderr}`.includes(external), `${level}: diagnostics must not reveal the symlink target`);

      const doctor = spawnCli(['doctor', '--artifacts', '--kyro-scope', 'demo'], sandbox);
      assert(doctor.status !== 0, `${level}: Doctor must fail the same unsafe managed path: ${doctor.stdout}`);
      assert(/UNSAFE_PATH|symbolic link/i.test(`${doctor.stdout}${doctor.stderr}`), `${level}: Doctor must name unsafe-path: ${doctor.stdout}${doctor.stderr}`);
      assert(!`${doctor.stdout}${doctor.stderr}`.includes(external), `${level}: Doctor must not reveal the symlink target`);

      writeFileSync(join(external, 'new-checkpoint-name.checkpoint.json'), 'not ours\n');
      const second = spawnCli(['repair', 'integrity', 'prepare', '--kyro-scope', 'demo', '--json'], sandbox);
      assert(second.status === 0, `${level}: repeat prepare must remain diagnostic: ${second.stderr}`);
      const projection = (output) => {
        const plan = JSON.parse(output);
        return JSON.stringify({ findings: plan.findings, blockers: plan.blockers, operations: plan.operations });
      };
      assert(
        projection(first.stdout) === projection(second.stdout),
        `${level}: changing the external target must not change classification or blockers`,
      );
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  }
}

/** Unregistered unsafe namespace entries remain foreign advisories, not global blockers. */
function assertUnsafeForeignEntriesAreWarnOnly() {
  const sandbox = makeSandbox();
  const external = join(sandbox, 'external-foreign');
  try {
    mkdirSync(external, { recursive: true });
    writeFileSync(join(external, 'sprint.json'), '{"scope":"not-readable"}\n');
    symlinkSync(external, join(sandbox, '.agents/kyro/scopes/linked-root'));
    mkdirSync(join(sandbox, '.agents/kyro/scopes/linked-sprint'), { recursive: true });
    symlinkSync(join(external, 'sprint.json'), join(sandbox, '.agents/kyro/scopes/linked-sprint/sprint.json'));
    mkdirSync(join(sandbox, '.agents/kyro/scopes/linked-archive'), { recursive: true });
    symlinkSync(external, join(sandbox, '.agents/kyro/scopes/linked-archive/archive'));

    const prepare = spawnCli(['repair', 'integrity', 'prepare', '--json'], sandbox);
    assert(prepare.status === 0, `global prepare should ignore unsafe foreign entries: ${prepare.stderr}`);
    for (const id of ['linked-root', 'linked-sprint', 'linked-archive']) {
      assert(!prepare.stdout.includes(id), `${id}: unsafe foreign entry must not enter Integrity: ${prepare.stdout}`);
    }

    // The target behind archive/ is not part of Kyro's namespace. Even adding a name Kyro would
    // recognize on a real archive must not change classification, because the link is never read.
    writeFileSync(join(external, 'sprint-999-external.checkpoint.json'), 'not a checkpoint\n');
    const afterTargetMutation = spawnCli(['repair', 'integrity', 'prepare', '--json'], sandbox);
    assert(afterTargetMutation.status === 0, `target mutation must remain non-blocking: ${afterTargetMutation.stderr}`);
    assert(
      !afterTargetMutation.stdout.includes('linked-archive'),
      `ownership discovery must not enumerate a symlinked archive target: ${afterTargetMutation.stdout}`,
    );

    const doctor = spawnCli(['doctor'], sandbox);
    assert(doctor.status === 0, `global Doctor must warn, not fail, for unsafe foreign entries: ${doctor.stdout}`);
    for (const id of ['linked-root', 'linked-sprint', 'linked-archive']) {
      assert(doctor.stdout.includes(id), `${id}: global Doctor must report the ignored namespace entry: ${doctor.stdout}`);
    }
    assert(!doctor.stdout.includes(external), `global Doctor must not reveal or inspect external targets: ${doctor.stdout}`);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

/** Read failures are explicit safety facts; they never collapse to an empty, healthy survey. */
function assertUnreadableArchiveNeverCollapsesToClean() {
  const sandbox = makeSandbox();
  const archive = join(sandbox, '.agents/kyro/scopes/demo/archive');
  try {
    mkdirSync(archive, { recursive: true });
    chmodSync(archive, 0o000);
    let permissionsEnforced = false;
    try { readdirSync(archive); }
    catch (error) { permissionsEnforced = ['EACCES', 'EPERM'].includes(error.code); }
    const prepare = spawnCli(['repair', 'integrity', 'prepare', '--kyro-scope', 'demo', '--json'], sandbox);
    // Some privileged environments can still enumerate mode-000 directories; only assert the
    // unreadable contract where the platform actually enforced it.
    if (permissionsEnforced) {
      assert(prepare.status === 0, `unreadable archive should be diagnosed, not crash: ${prepare.stderr}`);
      const plan = JSON.parse(prepare.stdout);
      assert(
        plan.blockers.some((blocker) => blocker.code === 'owned-damaged'),
        `an unreadable registered archive must never produce a clean Integrity plan: ${prepare.stdout}`,
      );
      assert(plan.operations.length === 0, `an unreadable archive must produce zero operations: ${prepare.stdout}`);
    }
  } finally {
    try { chmodSync(archive, 0o700); } catch {}
    rmSync(sandbox, { recursive: true, force: true });
  }
}

/** A prepare-approved unregister becomes invalid as soon as its path stops being safely foreign. */
function assertUnregisterDivergesOnUnsafePathRace() {
  for (const race of ['symlink', 'owned-evidence']) {
    const sandbox = makeSandbox();
    try {
      const foreign = join(sandbox, '.agents/kyro/scopes/notes-backup');
      mkdirSync(foreign, { recursive: true });
      writeFileSync(join(foreign, 'README.md'), 'do not touch\n');
      registerScopes(sandbox, [{ id: 'notes-backup', title: 'notes-backup', status: 'planning' }]);
      const prepare = spawnCli(['repair', 'integrity', 'prepare', '--kyro-scope', 'notes-backup', '--json'], sandbox);
      assert(prepare.status === 0, `${race}: prepare should approve safe foreign cleanup: ${prepare.stderr}`);
      const plan = JSON.parse(prepare.stdout);
      assert(plan.targets.unregister.includes('notes-backup'), `${race}: expected unregister target: ${prepare.stdout}`);

      if (race === 'symlink') {
        const external = join(sandbox, 'external-race');
        mkdirSync(external, { recursive: true });
        writeFileSync(join(external, 'README.md'), 'external\n');
        rmSync(foreign, { recursive: true, force: true });
        symlinkSync(external, foreign);
      } else {
        mkdirSync(join(foreign, 'archive'), { recursive: true });
        writeFileSync(join(foreign, 'archive/sprint-001-race.checkpoint.json'), 'not a checkpoint\n');
      }
      const beforeRegistry = JSON.stringify(readRegistry(sandbox));
      const beforeTree = hashTree(race === 'symlink' ? join(sandbox, 'external-race') : foreign);
      const apply = spawnCli([
        'repair', 'integrity', 'apply', '--kyro-scope', 'notes-backup', '--digest', plan.digest, '--yes',
      ], sandbox);
      assert(apply.status !== 0, `${race}: apply must reject drift after prepare: ${apply.stdout}`);
      assert(/DIVERGED/.test(`${apply.stdout}${apply.stderr}`), `${race}: apply must report DIVERGED: ${apply.stdout}${apply.stderr}`);
      assert(JSON.stringify(readRegistry(sandbox)) === beforeRegistry, `${race}: divergent apply must not write registry state`);
      assert(
        hashTree(race === 'symlink' ? join(sandbox, 'external-race') : foreign) === beforeTree,
        `${race}: divergent apply must preserve the observed tree`,
      );
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
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
  assertForeignDirectoryIsNeverAScope();
  assertRecoverableAndDamagedAreDistinguished();
  assertSymlinkCheckpointNeverClaimsRecovery();
  assertGenericArchiveContentIsNotOwnership();
  assertPreExistingContaminationIsCleanable();
  assertRegistryMatrixIsClassifiedByBothAxes();
  assertManagedAncestorSymlinksAreScopeBound();
  assertUnsafeForeignEntriesAreWarnOnly();
  assertUnreadableArchiveNeverCollapsesToClean();
  assertUnregisterDivergesOnUnsafePathRace();
  assertLegacyTraceHistoryStillReadable();
  assertTraceMergeIsChronologicalNotPositional();
  assertTraceMergeTieBreakIsStable();
  console.log('check:blast-radius-isolation — startup-surface scoping, healthy/broken sibling isolation, and legacy trace continuity passed');
}

main();
