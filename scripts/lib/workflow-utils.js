const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const defaultPackageRoot = path.resolve(__dirname, '..', '..');

/**
 * Returns the installed Kyro package root.
 *
 * Resolution order: KYRO_PACKAGE_ROOT, CLAUDE_PLUGIN_ROOT, default from __dirname.
 *
 * @returns {string} Absolute path to the Kyro package directory.
 */
function getPackageRoot() {
  const fromEnv = process.env.KYRO_PACKAGE_ROOT || process.env.CLAUDE_PLUGIN_ROOT;

  if (fromEnv) {
    return path.resolve(fromEnv);
  }

  return defaultPackageRoot;
}

/**
 * Returns the consumer project root (where git and sprint artifacts live).
 *
 * Resolution order: KYRO_PROJECT_DIR, CLAUDE_PROJECT_DIR, cwd.
 *
 * @returns {string} Absolute path to the active project directory.
 */
function getProjectRoot() {
  const fromEnv = process.env.KYRO_PROJECT_DIR || process.env.CLAUDE_PROJECT_DIR;

  if (fromEnv) {
    return path.resolve(fromEnv);
  }

  return process.cwd();
}

/**
 * Resolves a path relative to the consumer project root.
 *
 * @param {...string} segments Path segments under the project root.
 * @returns {string} Absolute path in the consumer project.
 */
function resolveRoot(...segments) {
  return path.join(getProjectRoot(), ...segments);
}

/**
 * Resolves a path relative to the installed Kyro package root.
 *
 * @param {...string} segments Path segments under the package root.
 * @returns {string} Absolute path in the Kyro package.
 */
function resolvePackage(...segments) {
  return path.join(getPackageRoot(), ...segments);
}

/**
 * Reads text from the project when present, otherwise from the Kyro package.
 *
 * @param {string} relativePath Path relative to project or package root.
 * @returns {string} File contents.
 */
function readText(relativePath) {
  const projectPath = resolveRoot(relativePath);

  if (fs.existsSync(projectPath)) {
    return fs.readFileSync(projectPath, 'utf8');
  }

  const packagePath = resolvePackage(relativePath);

  if (fs.existsSync(packagePath)) {
    return fs.readFileSync(packagePath, 'utf8');
  }

  throw new Error(`File not found: ${relativePath}`);
}

/**
 * Parses JSON from the project when present, otherwise from the Kyro package.
 *
 * @param {string} relativePath Path relative to project or package root.
 * @returns {unknown} Parsed JSON value.
 */
function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

/**
 * Recursively lists files under an absolute directory.
 *
 * @param {string} directory Absolute directory path.
 * @returns {string[]} Absolute file paths.
 */
function listFilesRecursively(directory) {
  if (!fs.existsSync(directory)) {
    return [];
  }

  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      return listFilesRecursively(entryPath);
    }

    return [entryPath];
  });
}

/**
 * Collects changed and untracked source paths from the consumer git repository.
 *
 * @returns {string[]} Repository-relative file paths.
 */
function getChangedFiles() {
  const projectRoot = getProjectRoot();
  const gitArgs = { cwd: projectRoot, encoding: 'utf8' };

  const staged = execFileSync('git', ['diff', '--name-only', '--cached', '--diff-filter=ACMR'], gitArgs);
  const unstaged = execFileSync('git', ['diff', '--name-only', '--diff-filter=ACMR'], gitArgs);
  const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], gitArgs);

  return [
    ...new Set([
      ...staged.split('\n'),
      ...unstaged.split('\n'),
      ...untracked.split('\n')
    ].filter(Boolean))
  ];
}

/**
 * Writes a structured JSON result to stdout.
 *
 * @param {{ status: string, message: string, details?: unknown[] }} result Result payload.
 */
function emitResult(result) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

/**
 * Emits a failure result and exits the process.
 *
 * @param {string} message Failure summary.
 * @param {unknown[]} [details] Structured failure details.
 */
function fail(message, details = []) {
  emitResult({
    status: 'fail',
    message,
    details
  });
  process.exit(1);
}

/**
 * Emits a success result.
 *
 * @param {string} message Success summary.
 * @param {unknown[]} [details] Structured success details.
 */
function pass(message, details = []) {
  emitResult({
    status: 'pass',
    message,
    details
  });
}

module.exports = {
  emitResult,
  fail,
  getChangedFiles,
  getPackageRoot,
  getProjectRoot,
  listFilesRecursively,
  /** @deprecated Use getPackageRoot() instead. */
  get packageRoot() {
    return getPackageRoot();
  },
  pass,
  readJson,
  readText,
  resolvePackage,
  resolveRoot,
  /** @deprecated Use getProjectRoot() for consumer paths or getPackageRoot() for bundled assets. */
  get root() {
    return getProjectRoot();
  }
};
