#!/usr/bin/env node

const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const {
  fail,
  getProjectRoot,
  packageRoot,
  pass,
  readJson,
  resolveRoot
} = require('./lib/workflow-utils');

const skipQuality = process.argv.includes('--skip-quality');
const results = [];
const postEditScript = path.join(packageRoot, 'scripts', 'post-edit-scan.js');
const stateScript = path.join(packageRoot, 'scripts', 'state.js');

/**
 * Runs a checkpoint command and records pass/fail status.
 *
 * @param {string} name Checkpoint label.
 * @param {string} command Shell command to execute.
 */
function runCommand(name, command) {
  try {
    execSync(command, {
      cwd: getProjectRoot(),
      stdio: 'pipe',
      encoding: 'utf8'
    });
    results.push({ name, command, status: 'pass' });
  } catch (error) {
    results.push({
      name,
      command,
      status: 'fail',
      output: `${error.stdout || ''}${error.stderr || ''}`.trim()
    });
  }
}

if (!skipQuality) {
  const config = readJson('config.json');

  for (const [name, command] of Object.entries(config.quality_gates || {})) {
    runCommand(name, command);
  }
}

runCommand('post-edit-scan', `node "${postEditScript}"`);

const sprintForgeDir = resolveRoot('.agents', 'sprint-forge');

if (fs.existsSync(sprintForgeDir)) {
  for (const entry of fs.readdirSync(sprintForgeDir, { withFileTypes: true })) {
    if (entry.isDirectory() && fs.existsSync(path.join(sprintForgeDir, entry.name, 'state.json'))) {
      runCommand(`state:${entry.name}`, `node "${stateScript}" validate ${entry.name}`);
    }
  }
}

const failures = results.filter((result) => result.status === 'fail');

if (failures.length > 0) {
  fail('Pre-commit checkpoint failed.', failures);
}

pass(skipQuality ? 'Pre-commit checkpoint passed with quality gates skipped.' : 'Pre-commit checkpoint passed.', results);
