#!/usr/bin/env node
/**
 * Runs the steps of `npm run check` (see scripts/lib/check-steps.mjs) concurrently.
 *
 *   node scripts/run-checks.mjs [options]
 *
 *   --jobs <n>        concurrent steps (default: min(8, max(2, cores - 1)); env KYRO_CHECK_JOBS)
 *   --serial          one step at a time in the original order (same as --jobs 1)
 *   --bail            stop starting new steps after the first failure
 *   --only <pattern>  run only matching steps (repeatable, comma separated; substring or * glob)
 *   --skip <pattern>  drop matching steps (same syntax)
 *   --list            print the steps and their group, run nothing
 *   --timings <file>  write per-step durations as JSON ({ total, out: [{ n, ms, code }] })
 *   --step-timeout <s> kill a step that runs longer than this (default 900; env KYRO_CHECK_STEP_TIMEOUT)
 *
 * Every step runs as `npm run <name>` in its own process group with a private TMPDIR, so one step
 * can never see, count or delete another step's temporary files. stdout and stderr are buffered
 * and printed only for failed steps, after the run.
 */
import { spawn } from 'node:child_process';
import { availableParallelism, cpus, tmpdir } from 'node:os';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NOT_IN_SUITE, STEPS } from './lib/check-steps.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_DEFAULT_JOBS = 8;
const DEFAULT_STEP_TIMEOUT_S = 900;

export function defaultJobs(cores = cpuCount()) {
  return Math.min(MAX_DEFAULT_JOBS, Math.max(2, cores - 1));
}

function cpuCount() {
  try {
    if (typeof availableParallelism === 'function') return availableParallelism();
  } catch { /* fall through */ }
  return cpus().length || 1;
}

function parseArgs(argv) {
  const opts = { jobs: undefined, serial: false, bail: false, only: [], skip: [], list: false, timings: null, stepTimeout: undefined };
  const value = (i, flag) => {
    if (i + 1 >= argv.length) fail(`${flag} needs a value`);
    return argv[i + 1];
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const [flag, inline] = arg.startsWith('--') && arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, undefined];
    const take = () => { if (inline !== undefined) return inline; const v = value(i, flag); i += 1; return v; };
    if (flag === '--jobs' || flag === '-j') opts.jobs = positiveInt(take(), '--jobs');
    else if (flag === '--serial') opts.serial = true;
    else if (flag === '--bail') opts.bail = true;
    else if (flag === '--only') opts.only.push(...take().split(',').filter(Boolean));
    else if (flag === '--skip') opts.skip.push(...take().split(',').filter(Boolean));
    else if (flag === '--list') opts.list = true;
    else if (flag === '--timings') opts.timings = resolve(take());
    else if (flag === '--step-timeout') opts.stepTimeout = positiveInt(take(), '--step-timeout');
    else if (flag === '--help' || flag === '-h') { console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace(/^\/\*\*\n|^#!.*\n/gm, '').replace(/^ \* ?/gm, '')); process.exit(0); }
    else fail(`unknown argument: ${arg}`);
  }
  return opts;
}

function positiveInt(text, flag) {
  const n = Number(text);
  if (!Number.isInteger(n) || n < 1) fail(`${flag} must be a positive integer, got "${text}"`);
  return n;
}

function fail(message) {
  console.error(`run-checks: ${message}`);
  process.exit(2);
}

/** Substring match, or `*` glob when the pattern contains one. `check:` prefix is optional. */
export function matches(name, pattern) {
  const bare = name.replace(/^check:/, '');
  if (!pattern.includes('*')) return name.includes(pattern) || bare.includes(pattern);
  const re = new RegExp(`^${pattern.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
  return re.test(name) || re.test(bare);
}

/** The step list and package.json must describe the same suite. Throws a readable message if not. */
export function validateSteps(steps = STEPS, pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'))) {
  const problems = [];
  const seen = new Set();
  const scripts = pkg.scripts ?? {};
  for (const step of steps) {
    if (seen.has(step.name)) problems.push(`duplicate step ${step.name}`);
    seen.add(step.name);
    if (typeof scripts[step.name] !== 'string') problems.push(`step ${step.name} has no script in package.json`);
    if (step.group && !['gate', 'pool', 'serial', 'exclusive'].includes(step.group)) problems.push(`step ${step.name} has unknown group ${step.group}`);
    if ((step.group === 'serial' || step.group === 'exclusive') && !step.why) problems.push(`step ${step.name} is ${step.group} but gives no reason (why)`);
  }
  for (const name of Object.keys(scripts)) {
    if (/^check(:|$)/.test(name) && !seen.has(name) && !(name in NOT_IN_SUITE)) {
      problems.push(`package.json script ${name} is neither a step in scripts/lib/check-steps.mjs nor listed in NOT_IN_SUITE`);
    }
  }
  for (const name of Object.keys(NOT_IN_SUITE)) {
    if (typeof scripts[name] !== 'string') problems.push(`NOT_IN_SUITE lists ${name}, which is not a package.json script`);
    if (seen.has(name)) problems.push(`${name} is both a step and in NOT_IN_SUITE`);
  }
  if (typeof scripts.check === 'string' && scripts.check.includes('npm run check:')) {
    problems.push('package.json "check" lists steps itself; the list belongs in scripts/lib/check-steps.mjs');
  }
  if (problems.length) throw new Error(`step list is inconsistent with package.json:\n  - ${problems.join('\n  - ')}`);
}

/** Steps currently running; the signal handler kills their process groups. */
const active = new Set();
let interruptSignal = null;
const INTERRUPT_GRACE_MS = 3000;

const fmt = (ms) => `${(ms / 1000).toFixed(1)}s`;

function runStep(step, tmpRoot, timeoutMs) {
  return new Promise((done) => {
    const started = Date.now();
    const stepTmp = mkdtempSync(join(tmpRoot, `${step.name.replace(/[^a-z0-9]+/gi, '-')}-`));
    const chunks = [];
    const isWin = process.platform === 'win32';
    const child = spawn(isWin ? 'npm.cmd' : 'npm', ['run', '--silent', step.name], {
      cwd: repo,
      env: { ...process.env, TMPDIR: stepTmp, TEMP: stepTmp, TMP: stepTmp },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: !isWin,
      shell: isWin,
    });
    let timedOut = false;
    let spawnError = null;
    const killTree = (signal) => {
      try { if (isWin) child.kill(signal); else process.kill(-child.pid, signal); } catch { /* already gone */ }
    };
    const handle = { killTree };
    active.add(handle);
    const timer = setTimeout(() => { timedOut = true; killTree('SIGKILL'); }, timeoutMs);
    child.stdout.on('data', (d) => chunks.push(d));
    child.stderr.on('data', (d) => chunks.push(d));
    child.on('error', (error) => { spawnError = error; });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      active.delete(handle);
      killTree('SIGKILL'); // reap anything the step left behind
      try { rmSync(stepTmp, { recursive: true, force: true }); } catch { /* best effort */ }
      let reason = '';
      const interrupted = Boolean(interruptSignal) && !timedOut && !spawnError && (signal !== null || code !== 0);
      if (interrupted) reason = `interrupted by ${interruptSignal}; the step was killed`;
      else if (spawnError) reason = `could not start: ${spawnError.message}`;
      else if (timedOut) reason = `timed out after ${fmt(timeoutMs)} and was killed`;
      else if (signal) reason = `killed by signal ${signal}`;
      else if (code !== 0) reason = `exit status ${code}`;
      done({ interrupted, step, code: reason ? (code ?? 1) || 1 : 0, signal, reason, ms: Date.now() - started, output: Buffer.concat(chunks).toString('utf8') });
    });
  });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  try { validateSteps(); } catch (error) { console.error(`run-checks: ${error.message}`); process.exit(2); }

  let selected = STEPS.filter((s) => !opts.only.length || opts.only.some((p) => matches(s.name, p)));
  selected = selected.filter((s) => !opts.skip.some((p) => matches(s.name, p)));
  if (!selected.length) fail('no steps selected');

  if (opts.list) {
    const width = Math.max(...selected.map((s) => s.name.length));
    for (const s of selected) console.log(`${s.name.padEnd(width)}  ${s.group ?? 'pool'}`);
    console.log(`${selected.length} steps${selected.length === STEPS.length ? '' : ` of ${STEPS.length}`}`);
    return 0;
  }

  const envJobs = process.env.KYRO_CHECK_JOBS ? positiveInt(process.env.KYRO_CHECK_JOBS, 'KYRO_CHECK_JOBS') : undefined;
  const jobs = opts.serial ? 1 : (opts.jobs ?? envJobs ?? defaultJobs());
  const timeoutS = opts.stepTimeout ?? (process.env.KYRO_CHECK_STEP_TIMEOUT ? positiveInt(process.env.KYRO_CHECK_STEP_TIMEOUT, 'KYRO_CHECK_STEP_TIMEOUT') : DEFAULT_STEP_TIMEOUT_S);
  const timeoutMs = timeoutS * 1000;
  const tmpRoot = mkdtempSync(join(tmpdir(), 'kyro-checks-'));
  const groupOf = (s) => s.group ?? 'pool';
  const results = [];
  const total = selected.length;
  const started = Date.now();
  let stopped = null;

  console.log(`run-checks: ${total} steps, ${opts.serial || jobs === 1 ? 'serial' : `${jobs} jobs`}${opts.bail ? ', bail' : ''}, step timeout ${timeoutS}s`);

  const record = (result) => {
    results.push(result);
    const ok = result.code === 0;
    console.log(`${ok ? 'PASS' : result.interrupted ? 'KILL' : 'FAIL'}  [${String(results.length).padStart(2)}/${total}]  ${result.step.name}  ${fmt(result.ms)}${ok ? '' : `  (${result.reason})`}`);
    if (!ok && !result.interrupted && opts.bail && !stopped) stopped = `--bail: stopped after ${result.step.name} failed`;
  };

  // SIGINT/SIGTERM: stop starting steps, terminate every running step's process group, SIGKILL
  // whatever is left after a short grace period. A second signal escalates to SIGKILL at once.
  const onSignal = (name) => {
    if (interruptSignal) {
      for (const h of [...active]) h.killTree('SIGKILL');
      return;
    }
    interruptSignal = name;
    stopped = 'interrupted';
    for (const h of [...active]) h.killTree('SIGTERM');
    setTimeout(() => { for (const h of [...active]) h.killTree('SIGKILL'); }, INTERRUPT_GRACE_MS).unref();
  };
  process.on('SIGINT', () => onSignal('SIGINT'));
  process.on('SIGTERM', () => onSignal('SIGTERM'));

  if (jobs === 1) {
    // Serial: the original order, nothing overlaps.
    for (const step of selected) {
      if (stopped) break;
      const result = await runStep(step, tmpRoot, timeoutMs);
      record(result);
      if (result.code !== 0 && groupOf(step) === 'gate' && !stopped) stopped = `gate step ${step.name} failed`;
    }
  } else {
    const gates = selected.filter((s) => groupOf(s) === 'gate');
    const poolSteps = selected.filter((s) => ['pool', 'serial'].includes(groupOf(s))).sort((a, b) => (b.est ?? 0) - (a.est ?? 0));
    const exclusive = selected.filter((s) => groupOf(s) === 'exclusive');

    // Gates first, together; they decide whether the rest is meaningful.
    const gateResults = await Promise.all(gates.map((s) => runStep(s, tmpRoot, timeoutMs)));
    gateResults.forEach(record);
    const failedGate = gateResults.find((r) => r.code !== 0);
    if (failedGate && !stopped) stopped = `gate step ${failedGate.step.name} failed`;

    // Pool: up to `jobs` steps at a time; at most one `serial` step among them.
    const queue = [...poolSteps];
    let running = 0;
    let serialRunning = false;
    await new Promise((finish) => {
      const pump = () => {
        while (!stopped && running < jobs) {
          const index = queue.findIndex((s) => groupOf(s) !== 'serial' || !serialRunning);
          if (index === -1) break;
          const [step] = queue.splice(index, 1);
          const isSerial = groupOf(step) === 'serial';
          running += 1;
          if (isSerial) serialRunning = true;
          runStep(step, tmpRoot, timeoutMs).then((result) => {
            running -= 1;
            if (isSerial) serialRunning = false;
            record(result);
            pump();
          });
        }
        if (running === 0 && (stopped || queue.length === 0)) finish();
      };
      pump();
    });

    // Exclusive steps run alone, after the pool has drained.
    for (const step of exclusive) {
      if (stopped) break;
      record(await runStep(step, tmpRoot, timeoutMs));
    }
  }

  rmSync(tmpRoot, { recursive: true, force: true });

  const wall = Date.now() - started;
  const sum = results.reduce((acc, r) => acc + r.ms, 0);
  const killed = results.filter((r) => r.interrupted);
  const failed = results.filter((r) => r.code !== 0 && !r.interrupted);
  const notRun = selected.filter((s) => !results.some((r) => r.step === s));

  for (const r of failed) {
    console.log(`\n${'='.repeat(78)}\nFAILED: ${r.step.name}  (${r.reason}, ${fmt(r.ms)})\n${'='.repeat(78)}`);
    process.stdout.write(r.output.endsWith('\n') || !r.output ? r.output : `${r.output}\n`);
    console.log(`${'-'.repeat(78)}\nend of output for ${r.step.name}`);
  }

  if (interruptSignal) console.log(`\nINTERRUPTED by ${interruptSignal}: running steps were killed and no further steps were started.`);
  console.log(`\nSummary: ${total} steps, ${results.length - failed.length - killed.length} passed, ${failed.length} failed${killed.length ? `, ${killed.length} killed` : ''}${notRun.length ? `, ${notRun.length} not run` : ''}`);
  if (killed.length) console.log(`Killed (interrupted): ${killed.map((r) => r.step.name).join(', ')}`);
  if (failed.length) console.log(`Failed: ${failed.map((r) => r.step.name).join(', ')}`);
  if (notRun.length) console.log(`Not run (${stopped}): ${notRun.map((s) => s.name).join(', ')}`);
  console.log(`Wall time: ${fmt(wall)}   Sum of step times: ${fmt(sum)}   (${jobs === 1 ? 'serial' : `${jobs} jobs`})`);
  if (jobs > 1) {
    const slowest = [...results].sort((a, b) => b.ms - a.ms)[0];
    if (slowest) console.log(`Slowest step: ${slowest.step.name} ${fmt(slowest.ms)}`);
  }

  if (opts.timings) {
    mkdirSync(dirname(opts.timings), { recursive: true });
    const out = results.map((r) => ({ n: r.step.name, ms: r.ms, code: r.code, ...(r.code === 0 ? {} : { tail: r.output.slice(-2000) }) }));
    writeFileSync(opts.timings, `${JSON.stringify({ total: wall, sum, jobs, out }, null, 2)}\n`);
  }

  if (interruptSignal) return interruptSignal === 'SIGINT' ? 130 : 143;
  return failed.length || killed.length || notRun.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => process.exit(code), (error) => { console.error(error); process.exit(2); });
}
