#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { fail, getChangedFiles, getProjectRoot, pass, resolveRoot } = require('./lib/workflow-utils');

const sourceExtensions = new Set([
  '.cjs',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.mts',
  '.py',
  '.ts',
  '.tsx'
]);

const debugExemptPrefixes = [
  'scripts/'
];

const debugPatterns = [
  { name: 'console.log', pattern: /\bconsole\.log\s*\(/ },
  { name: 'console.debug', pattern: /\bconsole\.debug\s*\(/ },
  { name: 'debugger', pattern: /\bdebugger\b/ },
  { name: 'python print', pattern: /^\s*print\s*\(/m }
];

const secretPatterns = [
  { name: 'private key', pattern: /-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  { name: 'generic api key', pattern: /\b(api[_-]?key|secret|token|password)\b\s*[:=]\s*['"][^'"]{16,}['"]/i },
  { name: 'github token', pattern: /\bgh[pousr]_[A-Za-z0-9_]{36,}\b/ },
  { name: 'stripe secret key', pattern: /\bsk_(live|test)_[A-Za-z0-9]{16,}\b/ }
];

/**
 * Returns whether a repository-relative path should be scanned.
 *
 * @param {string} relativePath Repository-relative file path.
 * @returns {boolean} True when the file extension is scannable.
 */
function shouldScan(relativePath) {
  return sourceExtensions.has(path.extname(relativePath));
}

/**
 * Returns whether debug-artifact rules should apply to a file.
 *
 * @param {string} relativePath Repository-relative file path.
 * @returns {boolean} True when debug rules should run.
 */
function shouldScanDebugArtifacts(relativePath) {
  return !debugExemptPrefixes.some((prefix) => relativePath.startsWith(prefix));
}

/**
 * Scans one file for debug artifacts and likely secrets.
 *
 * @param {string} relativePath Repository-relative file path.
 * @returns {Array<{ file: string, line: number, rule: string }>} Findings.
 */
function scanFile(relativePath) {
  const absolutePath = path.join(getProjectRoot(), relativePath);

  if (!fs.existsSync(absolutePath) || !shouldScan(relativePath)) {
    return [];
  }

  const content = fs.readFileSync(absolutePath, 'utf8');
  const findings = [];
  const rules = shouldScanDebugArtifacts(relativePath)
    ? [...debugPatterns, ...secretPatterns]
    : secretPatterns;

  for (const rule of rules) {
    const match = content.match(rule.pattern);

    if (match) {
      const line = content.slice(0, match.index).split('\n').length;
      findings.push({
        file: relativePath,
        line,
        rule: rule.name
      });
    }
  }

  return findings;
}

const files = process.argv.slice(2);
const targetFiles = files.length > 0 ? files : getChangedFiles();
const findings = targetFiles.flatMap(scanFile);

if (findings.length > 0) {
  fail('Post-edit scan found blocking issues.', findings);
}

pass('Post-edit scan passed.', targetFiles.map((file) => ({ file })));
