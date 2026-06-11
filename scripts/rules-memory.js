#!/usr/bin/env node

const fs = require('node:fs');
const crypto = require('node:crypto');
const { fail, pass, readJson, resolveRoot } = require('./lib/workflow-utils');

const [command, ...args] = process.argv.slice(2);
const config = readJson('config.json');
const memory = config.memory || {};
const rulesPath = resolveRoot(memory.rules_canonical || '.agents/sprint-forge/rules.md');
const indexPath = resolveRoot(memory.derived_index || '.agents/sprint-forge/rules.index.json');

function hash(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function parseRules(content) {
  return content
    .split('\n')
    .filter((line) => line.startsWith('[LEARN]'))
    .map((line, index) => {
      const match = line.match(/^\[LEARN\]\s+(\d{4}-\d{2}-\d{2})\s+\(([^)]+)\)\s+—\s+(.+)$/);

      return {
        id: index + 1,
        raw: line,
        date: match?.[1] || null,
        project: match?.[2] || null,
        rule: match?.[3] || line.replace(/^\[LEARN\]\s*/, '')
      };
    });
}

function readRules() {
  if (!fs.existsSync(rulesPath)) {
    return '';
  }

  return fs.readFileSync(rulesPath, 'utf8');
}

if (command === 'sync') {
  const content = readRules();
  const rules = parseRules(content);
  const index = {
    source: memory.rules_canonical,
    source_hash: hash(content),
    mcp_enabled: Boolean(memory.mcp_enabled),
    generated_at: new Date().toISOString(),
    rules
  };

  fs.mkdirSync(require('node:path').dirname(indexPath), { recursive: true });
  fs.writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);

  pass('Rules memory index generated.', [{ path: indexPath, rules: rules.length, mcp_enabled: index.mcp_enabled }]);
} else if (command === 'query') {
  const query = args.join(' ').toLowerCase();

  if (!query) {
    throw new Error('Usage: node scripts/rules-memory.js query <text>');
  }

  const content = readRules();
  const rules = parseRules(content);
  const terms = query.split(/\W+/).filter(Boolean);
  const matches = rules
    .map((rule) => ({
      ...rule,
      score: terms.filter((term) => rule.raw.toLowerCase().includes(term)).length
    }))
    .filter((rule) => rule.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, memory.max_retrieved_rules || 5);

  pass('Rules memory query completed.', matches);
} else {
  fail('Unknown rules memory command.', [{ command, expected: ['sync', 'query'] }]);
}
