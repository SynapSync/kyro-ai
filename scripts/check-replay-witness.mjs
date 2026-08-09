/** Version-dispatch regression for immutable replay witnesses. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(fileURLToPath(import.meta.url), '../..');
const witness = await import(resolve(repo, 'dist/cli/remediation/replay-witness.js'));
const canonical = await import(resolve(repo, 'dist/cli/remediation/canonical-state.js'));
const fixture = JSON.parse(readFileSync(resolve(repo, 'fixtures/evals/close-sprint-happy/state/.agents/kyro/scopes/demo/sprint.json'), 'utf8'));

let passed = 0;
function assert(condition, message) {
  if (!condition) throw new Error(message);
  passed += 1;
}

const digest = canonical.remediationStateDigest(fixture);
const valid = witness.validateReplayWitness({ recordSchemaVersion: 1, snapshot: fixture, expectedStateSha256: digest });
assert(valid.status === witness.REPLAY_WITNESS_VALIDATION_STATUS.VALID, `v1 witness must validate: ${valid.detail ?? ''}`);
if (valid.status === witness.REPLAY_WITNESS_VALIDATION_STATUS.VALID) {
  assert(valid.witness.version === 1, 'v1 parser must tag the parsed witness with v1');
  assert(valid.witness.snapshot.scope === 'demo', 'v1 parser must expose only a typed SprintFile');
}

const unsupported = witness.validateReplayWitness({ recordSchemaVersion: 2, snapshot: fixture, expectedStateSha256: digest });
assert(unsupported.status === witness.REPLAY_WITNESS_VALIDATION_STATUS.UNSUPPORTED, 'unknown witness version must fail closed as unsupported');

const invalid = witness.validateReplayWitness({ recordSchemaVersion: 1, snapshot: fixture, expectedStateSha256: '0'.repeat(64) });
assert(invalid.status === witness.REPLAY_WITNESS_VALIDATION_STATUS.INVALID, 'digest mismatch must never produce a valid witness');

console.log(`check:replay-witness — ${passed} assertions passed`);
