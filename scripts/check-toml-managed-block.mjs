#!/usr/bin/env node
// A managed TOML table must never be added next to an unmarked copy of the same table: TOML
// forbids duplicate tables and Codex refuses to load such a config.toml.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repo = resolve(fileURLToPath(import.meta.url), '../..');
const { upsertManagedBlock } = require(resolve(repo, 'dist/cli/injectors/managed-block.js'));

const content = '[mcp_servers.kyro]\ncommand = "kyro"\nargs = ["mcp", "serve"]';
const upsert = (existing) => upsertManagedBlock(existing, 'mcp-server-kyro', content, 'hash');
const count = (text) => (text.match(/^\s*\[mcp_servers\.kyro\]\s*$/gm) ?? []).length;
const START = '# kyro-ai:mcp-server-kyro:start';

// 1. Nothing there: one managed block.
let out = upsert('model = "x"\n');
assert.equal(count(out), 1); assert(out.includes(START));

// 2. An unmarked table in Kyro's own shape (what older installs wrote): adopted, not duplicated.
const legacy = 'model = "x"\n\n[mcp_servers.kyro]\ncommand = "kyro"\nargs = ["mcp","serve"]\n\n[mcp_servers.other]\ncommand = "o"\n';
out = upsert(legacy);
assert.equal(count(out), 1, 'legacy table adopted into one table');
assert(out.includes(START) && out.includes('[mcp_servers.other]\ncommand = "o"'), 'neighbouring tables kept');
assert.equal(upsert(out), out, 'idempotent after adoption');

// 3. The state the bug produced (unmarked table plus managed block): healed to one table.
const duplicated = `${legacy}\n${START}\n${content}\n# kyro-ai:mcp-server-kyro:end\n`;
assert.equal(count(duplicated), 2);
out = upsert(duplicated);
assert.equal(count(out), 1, 'duplicate tables healed');
assert(out.includes('[mcp_servers.other]'), 'neighbouring tables kept after healing');

// 4. A table the user customised (extra keys or sub-tables): left exactly as it is, no second table.
for (const custom of [
  '[mcp_servers.kyro]\ncommand = "kyro"\nargs = ["mcp","serve"]\nenv = { A = "1" }\n',
  '[mcp_servers.kyro]\ncommand = "kyro"\nargs = ["mcp","serve"]\n\n[mcp_servers.kyro.env]\nA = "1"\n',
]) {
  assert.equal(upsert(custom), custom, 'customised table untouched');
}

// 5. Quoted header form is recognised; a managed block alone is just replaced in place.
assert.equal(count(upsert('[mcp_servers."kyro"]\ncommand = "kyro"\n').replace('"kyro"]', 'kyro]')), 1);
const alone = `${START}\n[mcp_servers.kyro]\ncommand = "old"\n# kyro-ai:mcp-server-kyro:end\n`;
out = upsert(alone);
assert.equal(count(out), 1); assert(out.includes('args = ["mcp", "serve"]') && !out.includes('"old"'));

// 6. HTML blocks (AGENTS.md) are unaffected.
const html = upsertManagedBlock('# T\n', 'kyro', '[not toml]\nbody', 'html');
assert(html.includes('<!-- kyro-ai:kyro:start -->') && html.includes('[not toml]'));

console.log('check:toml-managed-block — unmarked TOML tables are adopted or respected, never duplicated');
