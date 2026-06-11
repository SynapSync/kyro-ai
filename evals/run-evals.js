#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { withTempProject, writeRules, writeState } = require('./lib/temp-project');

const root = path.resolve(__dirname, '..');
const failures = [];
const scenarios = [];

/**
 * Records a failed assertion when the condition is false.
 *
 * @param {boolean} condition Assertion condition.
 * @param {string} message Failure message.
 */
function assert(condition, message) {
  if (!condition) {
    failures.push(message);
  }
}

/**
 * Returns whether a repository-relative path exists.
 *
 * @param {string} relativePath Repository-relative path.
 * @returns {boolean} True when the path exists.
 */
function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

/**
 * Reads a repository-relative text file.
 *
 * @param {string} relativePath Repository-relative path.
 * @returns {string} File contents.
 */
function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function scenarioInitArtifacts() {
  const base = 'evals/fixtures/ts-lib/.agents/sprint-forge/sample';

  assert(exists(`${base}/README.md`), 'INIT fixture is missing README.md.');
  assert(exists(`${base}/ROADMAP.md`), 'INIT fixture is missing ROADMAP.md.');
  assert(exists(`${base}/RE-ENTRY-PROMPTS.md`), 'INIT fixture is missing RE-ENTRY-PROMPTS.md.');
  assert(exists(`${base}/findings/baseline.md`), 'INIT fixture is missing finding file.');
}

function scenarioDebtInherited() {
  const sprint = read('evals/fixtures/mid-sprint/.agents/sprint-forge/sample/sprints/SPRINT-2-followup.md');

  assert(sprint.includes('| 1 | Keep inherited debt visible.'), 'Sprint 2 fixture did not inherit debt row #1.');
}

function scenarioRecommendationDisposition() {
  const sprint = read('evals/fixtures/mid-sprint/.agents/sprint-forge/sample/sprints/SPRINT-2-followup.md');

  assert(sprint.includes('Disposition of Previous Sprint Recommendations'), 'Sprint 2 fixture is missing disposition section.');
  assert(sprint.includes('Keep inherited debt visible in Sprint 2.'), 'Sprint 2 fixture is missing previous recommendation disposition.');
}

function scenarioGateConfigFailsClosed() {
  const config = JSON.parse(read('config.json'));

  assert(config.gates.always_gate.includes('sprint_plan'), 'sprint_plan must be in always_gate.');
  assert(config.gates.always_gate.includes('commit'), 'commit must be in always_gate.');
  assert(config.gates.taxonomy.sprint_plan, 'sprint_plan gate taxonomy is missing.');
}

function scenarioParallelismContracts() {
  const config = JSON.parse(read('config.json'));
  const helper = read('skills/sprint-forge/assets/helpers/subagent-parallelism.md');

  assert(config.parallelism.fallback === 'sequential', 'Parallelism fallback must be sequential.');
  assert(config.parallelism.worktree_tasks === false, 'Worktree tasks must be disabled by default.');
  assert(helper.includes('Architecture') && helper.includes('Dependencies') && helper.includes('Risks') && helper.includes('Debt'), 'INIT fan-out tracks are incomplete.');
}

function scenarioMemoryCanonicalPolicy() {
  const config = JSON.parse(read('config.json'));
  const docs = read('docs/memory-adapter.md');

  assert(config.memory.rules_canonical === '.agents/sprint-forge/rules.md', 'rules.md must remain canonical.');
  assert(config.memory.mcp_enabled === false, 'MCP memory must be disabled by default.');
  assert(docs.includes('Manual edits to `rules.md` win.'), 'Memory conflict policy must preserve rules.md authority.');
}

function scenarioBlockerBlocksDebugArtifacts() {
  const target = 'evals/fixtures/bad-src/debug-artifact.js';
  const script = path.join(root, 'scripts', 'post-edit-scan.js');
  const result = spawnSync(process.execPath, [script, target], {
    cwd: root,
    encoding: 'utf8'
  });

  assert(result.status === 1, 'post-edit-scan must fail closed on debug artifacts in application code.');
  assert((result.stdout || '').includes('console.log'), 'post-edit-scan failure must identify the debug artifact rule.');
}

function scenarioHarnessConfigExists() {
  const config = JSON.parse(read('config.json'));

  assert(config.harness, 'config.json must define harness section.');
  assert(config.harness.capabilities.subagents === false, 'harness.capabilities.subagents must default to false.');
  assert(config.harness.enforcement === 'manual', 'harness.enforcement must default to manual.');
}

function scenarioCoreNoHardcodedModel() {
  const orchestrator = read('agents/orchestrator.md');
  const contextFiles = ['contexts/init.md', 'contexts/sprint.md', 'contexts/review.md'];

  assert(!orchestrator.includes('model: opus'), 'orchestrator must not hardcode model: opus.');

  for (const file of contextFiles) {
    assert(!read(file).includes('model: opus'), `${file} must not hardcode model: opus.`);
  }
}

function scenarioAdaptersShipped() {
  assert(exists('adapters/README.md'), 'adapters/README.md must exist.');
  assert(exists('adapters/cursor/kyro-workflow.mdc'), 'adapters/cursor/kyro-workflow.mdc must exist.');
  assert(exists('adapters/generic/AGENTS.snippet.md'), 'adapters/generic/AGENTS.snippet.md must exist.');
}

function scenarioGenericEnvResolution() {
  const script = `
    const { getProjectRoot, getPackageRoot } = require('./scripts/lib/workflow-utils');
    const project = getProjectRoot();
    const pkg = getPackageRoot();
    if (!project.endsWith('eval-fixture-project')) process.exit(2);
    if (!pkg.endsWith('kyro-workflow')) process.exit(3);
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      KYRO_PROJECT_DIR: path.join(root, 'eval-fixture-project'),
      KYRO_PACKAGE_ROOT: root
    }
  });

  assert(result.status === 0, 'workflow-utils must resolve KYRO_PROJECT_DIR and KYRO_PACKAGE_ROOT.');
}

function scenarioClaudeHookUsesPackageRoot() {
  const settings = JSON.parse(read('.claude-plugin/settings.json'));
  const hookCommand = settings.hooks?.PostToolUse?.[0]?.hooks?.[0]?.command || '';

  assert(hookCommand.includes('post-edit-hook.js'), 'Claude hook must invoke post-edit-hook.js.');
  assert(hookCommand.includes('CLAUDE_PLUGIN_ROOT'), 'Claude hook must reference plugin root variable.');
}

/**
 * Spawns a Kyro script with an isolated temporary project root.
 *
 * @param {string} scriptName Script filename under scripts/.
 * @param {string[]} args Script arguments.
 * @param {string} tempRoot Temporary project root.
 * @returns {import('node:child_process').SpawnSyncReturns<string>} Spawn result.
 */
function runInTempProject(scriptName, args, tempRoot) {
  return spawnSync(process.execPath, [path.join(root, 'scripts', scriptName), ...args], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      KYRO_PROJECT_DIR: tempRoot,
      KYRO_PACKAGE_ROOT: root
    }
  });
}

function scenarioGateUnknownFailsClosed() {
  withTempProject((tempRoot) => {
    const result = runInTempProject('gate-decision.js', ['eval-scope', 'not_a_real_gate'], tempRoot);

    assert(result.status === 1, 'gate-decision must fail closed for unknown gates.');
    assert((result.stdout || '').includes('"status": "fail"'), 'Unknown gate failure must emit structured JSON.');
  });
}

function scenarioGateAutoAuditUsesTempState() {
  withTempProject((tempRoot) => {
    const scope = 'eval-gate-scope';
    const timestamp = new Date().toISOString();

    writeState(tempRoot, scope, {
      schema_version: 1,
      scope,
      created_at: timestamp,
      updated_at: timestamp,
      sprints: [],
      debt: [],
      metrics: {},
      audit: []
    });

    const result = runInTempProject('gate-decision.js', [scope, 'implementation'], tempRoot);

    assert(result.status === 0, 'gate-decision must succeed for known auto gate in standard mode.');

    const payload = JSON.parse(result.stdout || '{}');
    assert(payload.details?.[0]?.decision === 'auto', 'implementation gate should auto-approve in standard mode.');

    const state = JSON.parse(
      fs.readFileSync(
        path.join(tempRoot, '.agents', 'sprint-forge', scope, 'state.json'),
        'utf8'
      )
    );
    const auditEntry = state.audit.find((entry) => entry.action === 'gate.auto_approved');

    assert(Boolean(auditEntry), 'auto gate must append gate.auto_approved to temp state audit trail.');
    assert(auditEntry.details?.gate === 'implementation', 'gate audit entry must record the gate name.');
  });
}

function scenarioRulesMemorySyncAndQuery() {
  withTempProject((tempRoot) => {
    writeRules(
      tempRoot,
      '[LEARN] 2026-06-11 (eval-fixture) — Always validate debt inheritance through state.json.\n'
    );

    const syncResult = runInTempProject('rules-memory.js', ['sync'], tempRoot);
    assert(syncResult.status === 0, 'rules-memory sync must succeed in temp project.');

    const indexPath = path.join(tempRoot, '.agents', 'sprint-forge', 'rules.index.json');
    assert(fs.existsSync(indexPath), 'rules-memory sync must create rules.index.json in temp project.');

    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    assert(index.rules.length === 1, 'rules-memory sync must index learned rules.');

    const queryResult = runInTempProject('rules-memory.js', ['query', 'debt'], tempRoot);
    assert(queryResult.status === 0, 'rules-memory query must succeed in temp project.');

    const queryPayload = JSON.parse(queryResult.stdout || '{}');
    assert(queryPayload.details?.length === 1, 'rules-memory query must return matching learned rules.');
  });
}

function scenarioHarnessDetectExists() {
  const result = spawnSync(process.execPath, [path.join(root, 'scripts', 'harness-detect.js')], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      KYRO_PACKAGE_ROOT: root
    }
  });

  assert(result.status === 0, 'harness-detect must succeed.');

  const payload = JSON.parse(result.stdout || '{}');
  assert(payload.details?.[0]?.suggested_config?.harness?.id, 'harness-detect must suggest a harness id.');
}

function scenarioQaReviewProgressiveOnly() {
  const skill = read('skills/qa-review/SKILL.md');

  assert(!exists('skills/qa-review/assets/references/legacy-full-audit-reference.md'), 'QA legacy fallback must be removed.');
  assert(!skill.includes('legacy-full-audit-reference.md'), 'qa-review SKILL must not reference the legacy fallback.');
  assert(skill.includes('assets/references/code-review.md'), 'qa-review SKILL must route to focused code-review reference.');
  assert(skill.includes('assets/references/sprint-sync.md'), 'qa-review SKILL must route to focused sprint-sync reference.');
  assert(exists('skills/qa-review/assets/references/code-review.md'), 'Focused code-review reference must exist.');
  assert(exists('skills/qa-review/assets/references/architecture.md'), 'Focused architecture reference must exist.');
  assert(exists('skills/qa-review/assets/references/security.md'), 'Focused security reference must exist.');
  assert(exists('skills/qa-review/assets/references/sprint-sync.md'), 'Focused sprint-sync reference must exist.');
}

[
  scenarioInitArtifacts,
  scenarioDebtInherited,
  scenarioRecommendationDisposition,
  scenarioGateConfigFailsClosed,
  scenarioParallelismContracts,
  scenarioMemoryCanonicalPolicy,
  scenarioBlockerBlocksDebugArtifacts,
  scenarioHarnessConfigExists,
  scenarioCoreNoHardcodedModel,
  scenarioAdaptersShipped,
  scenarioGenericEnvResolution,
  scenarioClaudeHookUsesPackageRoot,
  scenarioGateUnknownFailsClosed,
  scenarioGateAutoAuditUsesTempState,
  scenarioRulesMemorySyncAndQuery,
  scenarioHarnessDetectExists,
  scenarioQaReviewProgressiveOnly
].forEach((scenario) => {
  scenario();
  scenarios.push(scenario.name);
});

if (failures.length > 0) {
  process.stderr.write(`${JSON.stringify({ status: 'fail', failures }, null, 2)}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({ status: 'pass', scenarios: scenarios.length }, null, 2)}\n`);
