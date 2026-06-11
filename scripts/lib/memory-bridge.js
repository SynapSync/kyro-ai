const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');

/**
 * Hashes rule file content for provenance tracking.
 *
 * @param {string} content Rules file contents.
 * @returns {string} SHA-256 hex digest.
 */
function hash(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Parses learned rules from a rules.md file.
 *
 * @param {string} content Rules file contents.
 * @returns {object[]} Parsed rule entries.
 */
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

/**
 * Resolves the active memory provider from config.
 *
 * @param {object} memory Memory config block.
 * @returns {'local' | 'mcp'} Provider identifier.
 */
function resolveProvider(memory = {}) {
  if (memory.provider === 'mcp' || memory.provider === 'local') {
    return memory.provider;
  }

  return memory.mcp_enabled ? 'mcp' : 'local';
}

/**
 * Scores rules against a query string.
 *
 * @param {object[]} rules Parsed rules.
 * @param {string} query Query text.
 * @param {number} maxRules Maximum matches to return.
 * @returns {object[]} Ranked rule matches.
 */
function scoreRules(rules, query, maxRules) {
  const terms = query.split(/\W+/).filter(Boolean);

  return rules
    .map((rule) => ({
      ...rule,
      score: terms.filter((term) => rule.raw.toLowerCase().includes(term)).length
    }))
    .filter((rule) => rule.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxRules);
}

/**
 * Syncs learned rules through the local derived index provider.
 *
 * @param {object} options Sync options.
 * @param {object} options.memory Memory config block.
 * @param {string} options.indexPath Absolute path to the derived index file.
 * @param {string} options.content Rules file contents.
 * @param {object[]} options.rules Parsed rules.
 * @returns {object} Sync result metadata.
 */
function localSync({ memory, indexPath, content, rules }) {
  const index = {
    source: memory.rules_canonical,
    source_hash: hash(content),
    provider: 'local',
    mcp_enabled: Boolean(memory.mcp_enabled),
    generated_at: new Date().toISOString(),
    rules
  };

  fs.mkdirSync(path.dirname(indexPath), { recursive: true });
  fs.writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);

  return {
    provider: 'local',
    path: indexPath,
    rules: rules.length
  };
}

/**
 * Queries learned rules through the local derived index provider.
 *
 * @param {object} options Query options.
 * @param {object[]} options.rules Parsed rules.
 * @param {string} options.query Query text.
 * @param {number} options.maxRules Maximum matches to return.
 * @returns {object[]} Ranked rule matches.
 */
function localQuery({ rules, query, maxRules }) {
  return scoreRules(rules, query, maxRules);
}

/**
 * MCP sync stub — interface only until a server adapter is selected.
 *
 * @returns {object} Stub sync result.
 */
function mcpSync() {
  return {
    provider: 'mcp',
    status: 'not_configured',
    message: 'MCP memory provider is not implemented yet. Use provider: local or wait for a server-specific adapter.'
  };
}

/**
 * MCP query stub — interface only until a server adapter is selected.
 *
 * @returns {object[]} Empty match list with provider metadata attached by caller.
 */
function mcpQuery() {
  return [];
}

/**
 * Syncs learned rules through the configured memory provider.
 *
 * @param {object} options Sync options.
 * @returns {object} Provider sync result.
 */
function sync(options) {
  const provider = resolveProvider(options.memory);

  if (provider === 'mcp') {
    return mcpSync(options);
  }

  return localSync(options);
}

/**
 * Queries learned rules through the configured memory provider.
 *
 * @param {object} options Query options.
 * @returns {object[]} Provider query matches.
 */
function query(options) {
  const provider = resolveProvider(options.memory);

  if (provider === 'mcp') {
    return mcpQuery(options);
  }

  return localQuery(options);
}

module.exports = {
  hash,
  localQuery,
  localSync,
  mcpQuery,
  mcpSync,
  parseRules,
  query,
  resolveProvider,
  scoreRules,
  sync
};
