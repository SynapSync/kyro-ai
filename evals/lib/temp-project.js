const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * Runs a callback with a disposable temporary project directory.
 *
 * @param {(tempRoot: string) => void} callback Callback that receives the temp project root.
 */
function withTempProject(callback) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kyro-eval-'));

  try {
    callback(tempRoot);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

/**
 * Writes a scope state.json file under a temporary project root.
 *
 * @param {string} tempRoot Absolute path to the temporary project root.
 * @param {string} scope Sprint scope identifier.
 * @param {object} state State payload to persist.
 */
function writeState(tempRoot, scope, state) {
  const stateDir = path.join(tempRoot, '.agents', 'sprint-forge', scope);

  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'state.json'), `${JSON.stringify(state, null, 2)}\n`);
}

/**
 * Writes a rules.md file under a temporary project root.
 *
 * @param {string} tempRoot Absolute path to the temporary project root.
 * @param {string} content Rules file contents.
 */
function writeRules(tempRoot, content) {
  const rulesDir = path.join(tempRoot, '.agents', 'sprint-forge');

  fs.mkdirSync(rulesDir, { recursive: true });
  fs.writeFileSync(path.join(rulesDir, 'rules.md'), content);
}

module.exports = {
  withTempProject,
  writeRules,
  writeState
};
