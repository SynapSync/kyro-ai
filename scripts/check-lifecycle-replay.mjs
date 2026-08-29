#!/usr/bin/env node
// Exercises a long post-checkpoint lifecycle suffix without copying the accumulated histories during replay.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const repo = resolve(fileURLToPath(import.meta.url), '../..');
const fixture = resolve(repo, 'fixtures/evals/close-sprint-happy/state');
const cli = resolve(repo, 'dist/cli.js');
const require = createRequire(import.meta.url);
const lifecycle = require(resolve(repo, 'dist/cli/checkpoints/lifecycle-state.js'));
const root = mkdtempSync(join(tmpdir(), 'kyro-lifecycle-replay-'));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function json(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function closeWorkspace() {
  cpSync(fixture, root, { recursive: true });
  const result = spawnSync(process.execPath, [cli, 'close-sprint', '--kyro-scope', 'demo', '--outcome', 'shipped', '--yes'], {
    cwd: root,
    env: { ...process.env, HOME: join(root, '.home'), KYRO_TRACE: '0', OPENSSL_CONF: '/dev/null' },
    encoding: 'utf8',
  });
  assert(result.status === 0, `fixture close must succeed: ${result.stdout}${result.stderr}`);
}

try {
  closeWorkspace();
  const sprintPath = join(root, '.agents/kyro/scopes/demo/sprint.json');
  const projectPath = join(root, '.agents/kyro/kyro.json');
  const checkpointSprint = json(sprintPath);
  const project = json(projectPath);
  const checkpointEntry = project.scopes.find((entry) => entry.id === 'demo');
  assert(checkpointEntry, 'fixture must contain the demo registry entry');

  let sprint = structuredClone(checkpointSprint);
  let entry = structuredClone(checkpointEntry);
  const sprintHistory = [];
  const entryHistory = [];

  for (let index = 0; index < 1000; index += 1) {
    const completedAt = `2026-08-28T12:${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}.000Z`;
    const completion = {
      completedAt,
      by: 'lifecycle-replay-check',
      summary: `cycle ${index}`,
      requestDigest: lifecycle.scopeCompletionRequestDigest('demo', `cycle ${index}`),
      beforeEntryDigest: lifecycle.completionRegistryEntryDigest(entry),
    };
    sprint = lifecycle.completedSprintState(sprint, completion);
    entry = lifecycle.completedScopeEntry(entry, completion);

    const record = {
      reopenedAt: `2026-08-28T13:${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}.000Z`,
      by: 'lifecycle-replay-check',
      reason: `continue cycle ${index}`,
      completion,
      requestDigest: lifecycle.scopeReopenRequestDigest('demo', `continue cycle ${index}`, completion),
      beforeEntryDigest: lifecycle.reopenRegistryEntryDigest(entry),
    };
    sprintHistory.push(record);
    entryHistory.push(record);
    sprint = lifecycle.reopenedSprintState(sprint, record, sprintHistory);
    entry = lifecycle.reopenedScopeEntry(entry, record, sprint, entryHistory);
  }

  const result = lifecycle.verifyScopeLifecycleEvolution(checkpointSprint, checkpointEntry, sprint, entry);
  assert(result.status === lifecycle.SCOPE_LIFECYCLE_VERIFICATION_STATUS.LIFECYCLE_REPLAYED, `expected replay success, got ${result.status}/${result.reason}`);
  assert(result.appliedOperations === 2000, `expected 2,000 applied operations, got ${result.appliedOperations}`);
  assert(JSON.stringify(result.sprint) === JSON.stringify(sprint), 'replayed sprint must equal the live projection');
  assert(JSON.stringify(result.entry) === JSON.stringify(entry), 'replayed registry entry must equal the live projection');
  console.log('Lifecycle replay check passed.');
} finally {
  rmSync(root, { recursive: true, force: true });
}
