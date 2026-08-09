/** Real v2 remediation emission and strict compact-witness contract vector. */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(fileURLToPath(import.meta.url), '../..');
const cli = resolve(repo, 'dist/cli.js');
const fixture = resolve(repo, 'fixtures/evals/close-sprint-happy/state');
const SCOPE = 'demo';
let passed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
  passed += 1;
}
function readJson(path) { return JSON.parse(readFileSync(path, 'utf8')); }
function writeJson(path, value) { writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`); }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
function digest(value) { return createHash('sha256').update(JSON.stringify(canonical(value)), 'utf8').digest('hex'); }
function stateDigest(sprint) { const state = { ...sprint }; delete state.remediations; return digest(state); }
function run(root, args) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, HOME: join(root, '.home') } });
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

const root = mkdtempSync(join(tmpdir(), 'kyro-compact-witness-'));
try {
  cpSync(fixture, root, { recursive: true });
  mkdirSync(join(root, '.home'), { recursive: true });
  const sprintPath = join(root, `.agents/kyro/scopes/${SCOPE}/sprint.json`);
  const sprint = readJson(sprintPath);
  sprint.debt = [{ id: 'debt-1', title: 'Legacy origin.', origin: 1, priority: 'low', status: 'deferred', targetSprint: null, note: 'Tracked.' }];
  writeJson(sprintPath, sprint);
  const close = run(root, ['close-sprint', '--kyro-scope', SCOPE, '--outcome', 'shipped', '--note', 'Closed.', '--summary', 'Closed.', '--confirm']);
  assert(close.status === 0, `fixture close failed: ${close.output}`);
  const corrupt = readJson(sprintPath);
  corrupt.debt[0].origin = 'legacy prose';
  writeJson(sprintPath, corrupt);

  writeJson(join(root, 'manifest.json'), {
    schemaVersion: 1,
    kind: 'scope-remediation-manifest',
    scope: SCOPE,
    base: { stateSha256: stateDigest(corrupt), remediationHead: null },
    issues: [{ id: 'I-1', code: 'debt.origin.not-number', path: 'debt[0].origin', observedValueSha256: digest('legacy prose') }],
    operations: [{ id: 'O-1', kind: 'debt.origin.set', resolves: ['I-1'], debtId: 'debt-1', expectedOriginSha256: digest('legacy prose'), origin: 1, reason: 'Correct attribution.' }],
    provenance: { reason: 'Repair historical origin.', actor: 'regression-harness' },
  });
  const applied = run(root, ['remediate', 'apply', '--kyro-scope', SCOPE, '--manifest', 'manifest.json', '--yes']);
  assert(applied.status === 0, `v2 remediation must apply: ${applied.output}`);
  const record = readJson(join(root, `.agents/kyro/scopes/${SCOPE}/archive/remediations/remediation-001.json`));
  assert(record.schemaVersion === 2, 'new remediation record must be schemaVersion 2');
  assert(JSON.stringify(Object.keys(record.result).sort()) === JSON.stringify(['stateSha256', 'witness']), 'v2 result must contain only digest and compact witness');
  assert(!JSON.stringify(record).includes('"snapshot"'), 'v2 record must not embed a SprintFile snapshot');
  assert(record.result.witness.schemaVersion === 1 && record.result.witness.kind === 'operations-replay', 'v2 witness must use the typed operations-replay v1 discriminant');

  const protocol = await import(resolve(repo, 'dist/cli/remediation/protocol.js'));
  const extra = structuredClone(record);
  extra.result.witness.extra = true;
  assert(protocol.validateScopeRemediation(extra, 'record').some((issue) => issue.field === 'result.witness.extra'), 'v2 validator must reject unknown witness fields');
  const malformed = structuredClone(record);
  malformed.result.witness.kind = 'opaque-state';
  assert(protocol.validateScopeRemediation(malformed, 'record').some((issue) => issue.field === 'result.witness.kind'), 'v2 validator must name malformed witness kinds');
  const historicV1 = structuredClone(record);
  historicV1.schemaVersion = 1;
  historicV1.result = { stateSha256: record.result.stateSha256, snapshot: readJson(sprintPath) };
  assert(protocol.validateScopeRemediation(historicV1, 'record').length === 0, 'a historic v1 record must continue to parse without coercion');
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log(`check:compact-remediation-witness — ${passed} assertions passed`);
