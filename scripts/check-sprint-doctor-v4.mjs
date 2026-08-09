import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repo = resolve(new URL('..', import.meta.url).pathname);
const cli = join(repo, 'dist/cli.js');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const validKyroJson = {
  schemaVersion: 4,
  artifactRoot: '.agents/kyro/scopes',
  activeScope: 'demo',
  scopes: [{ id: 'demo', title: 'Demo', status: 'active' }],
  runtimePath: '~/.agents/kyro/current',
  installedAdapters: [],
};

const validDebt = {
  id: 'D-1',
  title: 'Document a known limitation.',
  origin: 1,
  priority: 'low',
  status: 'deferred',
  targetSprint: null,
  note: 'Tracked without fabricating a migration.',
};

const validSprintJson = {
  schemaVersion: 4,
  scope: 'demo',
  title: 'Demo',
  status: 'active',
  objective: 'Demonstrate a valid v4 sprint file.',
  successCriteria: ['The doctor reports the file as valid.'],
  clarifications: [],
  conventions: [{ id: 'c-1', rule: 'Run build before close.', tags: ['build'], addedSprint: 1 }],
  adrs: [
    {
      id: 'ADR-0001',
      title: 'Use sprint.json for scope state',
      status: 'accepted',
      date: '2026-07-15',
      context: 'Scope state must be inspectable and recoverable from one structured artifact.',
      decision: 'Keep durable architectural decisions in sprint.json.adrs[].',
      consequences: ['Doctor can validate ADR shape together with the rest of sprint.json.'],
      alternatives: ['Create markdown ADR files per scope.'],
      links: { docs: ['docs/architecture.md'] },
    },
  ],
  roadmap: {
    plannedSprintCount: 1,
    sizingRationale: 'Single sprint.',
    sprints: [{ n: 1, slug: 'demo', title: 'Demo', state: 'active' }],
  },
  ledger: [],
  previousSprint: null,
  activeSprint: {
    n: 1,
    slug: 'demo',
    title: 'Demo',
    objective: 'Do the demo.',
    status: 'executing',
    phases: [
      {
        id: 'P1',
        title: 'Phase 1',
        objective: 'Demo phase.',
        status: 'active',
        tasks: [
          {
            id: 'T1.1',
            title: 'Demo task',
            description: 'Do a thing.',
            files_to_touch: ['a.ts'],
            context: 'context',
            acceptance_criteria: ['it works'],
            depends_on: [],
            status: 'pending',
            evidence: null,
            verdict: null,
          },
        ],
      },
    ],
    emergentTasks: [],
    definitionOfDone: ['done'],
  },
  debt: [validDebt],
  handoff: { nextAction: 'execute_task', nextTaskId: 'T1.1', blockers: [], note: '', lastUpdated: '2026-06-29' },
};

function makeFixture(kyroJson, sprintJson, archiveFiles = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'kyro-v4-doctor-'));
  const scopeDir = join(dir, '.agents/kyro/scopes/demo');
  mkdirSync(scopeDir, { recursive: true });
  writeFileSync(join(dir, '.agents/kyro/kyro.json'), `${JSON.stringify(kyroJson, null, 2)}\n`);
  writeFileSync(join(scopeDir, 'sprint.json'), `${JSON.stringify(sprintJson, null, 2)}\n`);
  for (const [relPath, content] of Object.entries(archiveFiles)) {
    const abs = join(scopeDir, relPath);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
  }
  return dir;
}

function runDoctor(dir) {
  const result = spawnSync(process.execPath, [cli, 'doctor', '--artifacts', '--kyro-scope', 'demo'], {
    cwd: dir,
    env: { ...process.env, HOME: join(dir, '.home') },
    encoding: 'utf-8',
  });
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

function assertCase(name, kyroJson, sprintJson, expectedStatus, expectedText, archiveFiles = {}) {
  const dir = makeFixture(kyroJson, sprintJson, archiveFiles);
  try {
    const { status, output } = runDoctor(dir);
    assert(status === expectedStatus, `${name}: expected exit ${expectedStatus}, got ${status}\n${output}`);
    assert(output.includes(expectedText), `${name}: expected output to include "${expectedText}"\n${output}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// 1. Valid v4 artifacts pass.
assertCase('valid', validKyroJson, validSprintJson, 0, 'Schema shapes are valid.');

// 1b. Debt fields mirror the runtime Debt contract so Lens never receives a shape doctor accepted.
for (const [name, patch, expectedText] of [
  ['debt-origin-string', { origin: 'food-analysis FR-FA-013 revision' }, 'debt[0].origin must be a number'],
  ['debt-priority-invalid', { priority: 'urgent' }, 'debt[0].priority must be one of'],
  ['debt-target-sprint-string', { targetSprint: '2' }, 'debt[0].targetSprint must be a number or null'],
  ['debt-note-not-string', { note: 42 }, 'debt[0].note must be a string'],
]) {
  assertCase(
    name,
    validKyroJson,
    { ...validSprintJson, debt: [{ ...validDebt, ...patch }] },
    1,
    expectedText,
  );
}

// Legacy v4 files may still contain runtimeVersion as an ignored extra field.
assertCase(
  'legacy-runtime-version',
  { ...validKyroJson, runtimeVersion: '4.0.0' },
  validSprintJson,
  0,
  'Schema shapes are valid.',
);

// 2. kyro.json scopes as string[] fails with a specific message.
assertCase(
  'string-scopes',
  { ...validKyroJson, scopes: ['demo'] },
  validSprintJson,
  1,
  'scopes[0] must be an object',
);

// 3. conventions[] as plain strings fails and names the field.
assertCase(
  'string-conventions',
  validKyroJson,
  { ...validSprintJson, conventions: ['just a string'] },
  1,
  'conventions[0]',
);

// 4. Snapshot path on a ledger entry must be a string when present.
assertCase(
  'bad-snapshot',
  validKyroJson,
  {
    ...validSprintJson,
    ledger: [{ n: 1, slug: 'demo', outcome: 'shipped', closedAt: '2026-06-29', archive: 'archive/sprint-001-demo.md', snapshot: 42 }],
  },
  1,
  'ledger[0].snapshot must be a string',
);

// 5. Malformed ADRs fail through the same sprint.json doctor validation path.
assertCase(
  'bad-adr-status',
  validKyroJson,
  { ...validSprintJson, adrs: [{ ...validSprintJson.adrs[0], status: 'approved' }] },
  1,
  'adrs[0].status must be one of',
);

// 6. ADR ids must be unique per scope.
assertCase(
  'duplicate-adr-id',
  validKyroJson,
  { ...validSprintJson, adrs: [validSprintJson.adrs[0], { ...validSprintJson.adrs[0], title: 'Duplicate ADR' }] },
  1,
  'duplicate ADR id ADR-0001',
);

// 7. ADR links to other ADRs must resolve inside the same scope.
assertCase(
  'bad-adr-reference',
  validKyroJson,
  { ...validSprintJson, adrs: [{ ...validSprintJson.adrs[0], links: { supersedes: ['ADR-9999'] } }] },
  1,
  'unknown ADR id ADR-9999',
);

// 8. ADR ids must use the canonical ADR-0001 style.
assertCase(
  'bad-adr-id',
  validKyroJson,
  { ...validSprintJson, adrs: [{ ...validSprintJson.adrs[0], id: 'ADR-1' }] },
  1,
  'adrs[0].id must match ADR-0001 format',
);

// 9. ADR dates must be real YYYY-MM-DD dates.
assertCase(
  'bad-adr-date',
  validKyroJson,
  { ...validSprintJson, adrs: [{ ...validSprintJson.adrs[0], date: '2026-02-31' }] },
  1,
  'adrs[0].date must be a YYYY-MM-DD date string',
);

// 10. ADR narrative fields must be meaningful, not empty placeholders.
assertCase(
  'empty-adr-narrative',
  validKyroJson,
  { ...validSprintJson, adrs: [{ ...validSprintJson.adrs[0], context: '', consequences: [] }] },
  1,
  'adrs[0].context must be a non-empty string',
);

// A closed sprint whose snapshot exists but whose narrative .md needs validation.
const closedSprintJson = {
  ...validSprintJson,
  activeSprint: null,
  roadmap: {
    plannedSprintCount: 1,
    sizingRationale: 'Single sprint.',
    sprints: [{ n: 1, slug: 'demo', title: 'Demo work', state: 'closed' }],
  },
  ledger: [
    { n: 1, slug: 'demo', outcome: 'shipped', closedAt: '2026-06-29', archive: 'archive/sprint-001-demo.md', snapshot: 'archive/sprint-001-demo.json' },
  ],
  handoff: { nextAction: 'plan_sprint', nextTaskId: null, blockers: [], note: '', lastUpdated: '2026-06-29' },
};
const goodSnapshot = '{"n":1,"slug":"demo"}\n';
const brokenNarrative = "---\ntitle: 'demo — Sprint 1: undefined'\n---\n\n# Sprint 1: undefined\n\n## Objective\n\nx\n";
const goodNarrative = "---\ntitle: 'demo — Sprint 1: Demo work'\n---\n\n# Sprint 1: Demo work\n\n## Objective\n\nx\n";

// 11. A narrative rendered with an undefined title fails and names the sprint.
assertCase(
  'broken-narrative',
  validKyroJson,
  closedSprintJson,
  1,
  'broken archive narrative',
  { 'archive/sprint-001-demo.json': goodSnapshot, 'archive/sprint-001-demo.md': brokenNarrative },
);

// 12. A well-formed narrative passes.
assertCase(
  'good-narrative',
  validKyroJson,
  closedSprintJson,
  0,
  'narrative(s), all well-formed.',
  { 'archive/sprint-001-demo.json': goodSnapshot, 'archive/sprint-001-demo.md': goodNarrative },
);

// 13. An incomplete kyro.json (missing required v4 fields) must produce a CLEAN fail, not a crash.
//    A crash would print "Cannot read properties of undefined" instead of the diagnostic message.
assertCase(
  'incomplete-kyro-json',
  { scopes: [{ id: 'demo', title: 'Demo', status: 'active' }], activeScope: 'demo' },
  validSprintJson,
  1,
  'is incomplete',
);

// 14. An unresolved [NEEDS CLARIFICATION] marker must FAIL — the deterministic clarify gate.
assertCase(
  'unresolved-clarification',
  validKyroJson,
  { ...validSprintJson, objective: 'Build auth [NEEDS CLARIFICATION: OAuth or JWT?]' },
  1,
  'unresolved [NEEDS CLARIFICATION]',
);

// 14b. A documentation reference to the marker must PASS — backtick-wrapped (same payload as a real
//    marker) and placeholder forms are not unresolved markers. Prevents the field-test false positive.
assertCase(
  'documented-clarification-passes',
  validKyroJson,
  { ...validSprintJson, objective: 'Gate blocks any `[NEEDS CLARIFICATION: OAuth or JWT?]` or [NEEDS CLARIFICATION: <gap>] reference' },
  0,
  'Schema shapes are valid.',
);

// 15. REGRESSION (schema/runtime contract): an activeSprint missing a field the runtime consumes
//    (definitionOfDone — close-sprint reads `.length`) must FAIL the doctor, never PASS and then
//    crash close-sprint. If the doctor says PASS, no downstream command may explode.
const { definitionOfDone: _dod, ...activeWithoutDod } = validSprintJson.activeSprint;
assertCase(
  'incomplete-active-sprint',
  validKyroJson,
  { ...validSprintJson, activeSprint: activeWithoutDod },
  1,
  'activeSprint.definitionOfDone',
);

// 16. Same contract for tasks: a task missing `title` (consumed by the narrative render) must FAIL.
const taskWithoutTitle = { ...validSprintJson.activeSprint.phases[0].tasks[0] };
delete taskWithoutTitle.title;
assertCase(
  'task-missing-title',
  validKyroJson,
  {
    ...validSprintJson,
    activeSprint: {
      ...validSprintJson.activeSprint,
      phases: [{ ...validSprintJson.activeSprint.phases[0], tasks: [taskWithoutTitle] }],
    },
  },
  1,
  'tasks[0].title',
);

console.log('check:sprint-doctor-v4 — all cases passed');
