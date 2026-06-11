#!/usr/bin/env node

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const failures = [];

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

execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' });

const packOutput = execFileSync('npm', ['pack', '--silent'], {
  cwd: root,
  encoding: 'utf8'
}).trim();

const tarball = path.join(root, packOutput);
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kyro-install-smoke-'));

try {
  fs.writeFileSync(path.join(tempRoot, 'package.json'), '{}\n');

  execFileSync('npm', ['install', tarball], {
    cwd: tempRoot,
    stdio: 'inherit'
  });

  const cliPath = path.join(
    tempRoot,
    'node_modules',
    '@synapsync',
    'kyro-workflow',
    'dist',
    'cli',
    'index.js'
  );

  assert(fs.existsSync(cliPath), 'Packed tarball must include dist/cli/index.js');

  const initResult = spawnSync(process.execPath, [cliPath, 'init'], {
    cwd: tempRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      KYRO_PROJECT_DIR: tempRoot,
      KYRO_PACKAGE_ROOT: path.join(tempRoot, 'node_modules', '@synapsync', 'kyro-workflow')
    }
  });

  assert(initResult.status === 0, 'kyro-workflow init must succeed in smoke project.');
  assert(fs.existsSync(path.join(tempRoot, '.agents', 'orchestrator.md')), 'init must copy orchestrator.');
  assert(fs.existsSync(path.join(tempRoot, '.skills', 'sprint-forge', 'SKILL.md')), 'init must copy sprint-forge.');
  assert(fs.existsSync(path.join(tempRoot, '.skills', 'qa-review', 'SKILL.md')), 'init must copy qa-review.');
  assert(fs.existsSync(path.join(tempRoot, 'config.json')), 'init must write config.json.');
  assert(fs.existsSync(path.join(tempRoot, '.kyro', 'install.json')), 'init must write .kyro/install.json.');

  const config = JSON.parse(fs.readFileSync(path.join(tempRoot, 'config.json'), 'utf8'));
  assert(
    Object.keys(config.quality_gates || {}).length === 0,
    'default config must ship with empty quality_gates.'
  );

  const doctorResult = spawnSync(process.execPath, [cliPath, 'doctor'], {
    cwd: tempRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      KYRO_PROJECT_DIR: tempRoot,
      KYRO_PACKAGE_ROOT: path.join(tempRoot, 'node_modules', '@synapsync', 'kyro-workflow')
    }
  });

  assert(doctorResult.status === 0, 'kyro-workflow doctor must pass after init.');

  const secondInit = spawnSync(process.execPath, [cliPath, 'init'], {
    cwd: tempRoot,
    encoding: 'utf8'
  });

  assert(secondInit.status === 1, 'init must fail closed when already installed.');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
  fs.rmSync(tarball, { force: true });
}

if (failures.length > 0) {
  process.stderr.write(`${JSON.stringify({ status: 'fail', failures }, null, 2)}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({ status: 'pass' }, null, 2)}\n`);
