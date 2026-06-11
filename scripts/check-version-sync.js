#!/usr/bin/env node

const fs = require('node:fs');
const { fail, pass, readJson, resolveRoot } = require('./lib/workflow-utils');

function readWorkflowVersion() {
  const content = fs.readFileSync(resolveRoot('WORKFLOW.yaml'), 'utf8');
  const match = content.match(/^version:\s*["']?([^"'\n]+)["']?/m);

  if (!match) {
    throw new Error('WORKFLOW.yaml is missing a version field.');
  }

  return match[1].trim();
}

const packageJson = readJson('package.json');
const packageLock = readJson('package-lock.json');
const pluginJson = readJson('.claude-plugin/plugin.json');
const expected = packageJson.version;
const versions = {
  'package.json': packageJson.version,
  'package-lock.json': packageLock.version,
  'package-lock.json packages[""].version': packageLock.packages?.['']?.version,
  '.claude-plugin/plugin.json': pluginJson.version,
  'WORKFLOW.yaml': readWorkflowVersion()
};

const mismatches = Object.entries(versions).filter(([, version]) => version !== expected);

if (mismatches.length > 0) {
  fail(`Version sync check failed. Expected every metadata file to use ${expected}.`, mismatches.map(([file, version]) => ({
    file,
    version: version || '<missing>'
  })));
}

pass(`Version sync check passed (${expected}).`, Object.entries(versions).map(([file, version]) => ({
  file,
  version
})));
