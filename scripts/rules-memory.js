#!/usr/bin/env node

const fs = require('node:fs');
const { fail, pass, readJson, resolveRoot } = require('./lib/workflow-utils');
const { parseRules, query, resolveProvider, sync } = require('./lib/memory-bridge');

const [command, ...args] = process.argv.slice(2);
const config = readJson('config.json');
const memory = config.memory || {};
const rulesPath = resolveRoot(memory.rules_canonical || '.agents/sprint-forge/rules.md');
const indexPath = resolveRoot(memory.derived_index || '.agents/sprint-forge/rules.index.json');

/**
 * Reads the canonical rules file when present.
 *
 * @returns {string} Rules file contents.
 */
function readRules() {
  if (!fs.existsSync(rulesPath)) {
    return '';
  }

  return fs.readFileSync(rulesPath, 'utf8');
}

if (command === 'sync') {
  const content = readRules();
  const rules = parseRules(content);
  const result = sync({
    memory,
    indexPath,
    content,
    rules
  });

  if (result.status === 'not_configured') {
    fail(result.message, [result]);
  }

  pass('Rules memory index generated.', [result]);
} else if (command === 'query') {
  const queryText = args.join(' ').toLowerCase();

  if (!queryText) {
    throw new Error('Usage: node scripts/rules-memory.js query <text>');
  }

  const content = readRules();
  const rules = parseRules(content);
  const provider = resolveProvider(memory);
  const matches = query({
    memory,
    rules,
    query: queryText,
    maxRules: memory.max_retrieved_rules || 5
  });

  if (provider === 'mcp' && matches.length === 0) {
    pass('Rules memory query completed.', [
      {
        provider,
        status: 'not_configured',
        message: 'MCP memory provider is not implemented yet. Falling back to empty result set.'
      }
    ]);
  } else {
    pass('Rules memory query completed.', matches);
  }
} else {
  fail('Unknown rules memory command.', [{ command, expected: ['sync', 'query'] }]);
}
