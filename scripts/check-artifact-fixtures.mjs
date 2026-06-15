import { cpSync, mkdtempSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repo = resolve(new URL('..', import.meta.url).pathname);
const cli = join(repo, 'dist/cli.js');
const fixtures = join(repo, 'fixtures/artifact-integrity');

function run(cwd, args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    env: { ...process.env, HOME: join(cwd, '.home') },
    encoding: 'utf-8',
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertDoctor(name, expectedStatus, expectedText) {
  const result = run(join(fixtures, name), ['doctor', '--artifacts', '--kyro-scope', 'demo']);
  const output = `${result.stdout}\n${result.stderr}`;
  assert(result.status === expectedStatus, `${name}: expected exit ${expectedStatus}, got ${result.status}\n${output}`);
  assert(output.includes(expectedText), `${name}: expected output to include ${expectedText}\n${output}`);
}

assertDoctor('valid', 0, '[PASS] artifact state.json');
assertDoctor('missing-summary', 0, '[WARN] artifact ROADMAP.summary.json');
assertDoctor('invalid-state', 1, '[FAIL] artifact state.json');
assertDoctor('active-sprint-missing', 1, 'activeSprint not found');

const staleDir = mkdtempSync(join(tmpdir(), 'kyro-stale-'));
cpSync(join(fixtures, 'stale-summary'), staleDir, { recursive: true });
const roadmap = join(staleDir, '.agents/kyro/scopes/demo/ROADMAP.md');
const future = new Date(Date.now() + 5000);
utimesSync(roadmap, future, future);
const stale = run(staleDir, ['doctor', '--artifacts', '--kyro-scope', 'demo']);
const staleOutput = `${stale.stdout}\n${stale.stderr}`;
assert(stale.status === 0, `stale-summary: expected exit 0\n${staleOutput}`);
assert(staleOutput.includes('older than ROADMAP.md'), `stale-summary: expected stale warning\n${staleOutput}`);
rmSync(staleDir, { recursive: true, force: true });

const repairDir = mkdtempSync(join(tmpdir(), 'kyro-repair-'));
cpSync(join(fixtures, 'missing-summary'), repairDir, { recursive: true });
const repair = run(repairDir, ['repair', '--kyro-scope', 'demo', '--yes']);
const repairOutput = `${repair.stdout}\n${repair.stderr}`;
assert(repair.status === 0, `repair: expected exit 0\n${repairOutput}`);
const repaired = run(repairDir, ['doctor', '--artifacts', '--kyro-scope', 'demo']);
const repairedOutput = `${repaired.stdout}\n${repaired.stderr}`;
assert(repaired.status === 0, `repaired doctor: expected exit 0\n${repairedOutput}`);
assert(!repairedOutput.includes('missing'), `repaired doctor: expected missing warnings to be gone\n${repairedOutput}`);
rmSync(repairDir, { recursive: true, force: true });

console.log('Artifact integrity fixtures passed');
