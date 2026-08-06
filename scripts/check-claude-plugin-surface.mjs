import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(resolve(root, '.claude-plugin/plugin.json'), 'utf-8'));
const canonicalCommands = markdownNames(resolve(root, 'commands'));
const claudeCommands = markdownNames(resolve(root, 'providers/claude/commands'));

assert(!Object.hasOwn(manifest, 'skills'), 'plugin.json must not register internal skills');
assert(
  JSON.stringify(manifest.agents) === JSON.stringify([]),
  'plugin.json must replace default agent discovery with an empty public agent surface',
);
assert(
  JSON.stringify(manifest.commands) === JSON.stringify(['./providers/claude/commands/']),
  'plugin.json must replace default command discovery with the Claude public wrapper directory',
);
assert(!existsSync(resolve(root, 'skills')), 'plugin root skills/ would be auto-discovered by Claude');
assert(
  JSON.stringify(claudeCommands) === JSON.stringify(canonicalCommands),
  `Claude command surface mismatch: expected ${canonicalCommands.join(', ')}, got ${claudeCommands.join(', ')}`,
);

for (const command of canonicalCommands) {
  const wrapper = readFileSync(resolve(root, 'providers/claude/commands', `${command}.md`), 'utf-8');
  assert(
    wrapper.includes(`\${CLAUDE_PLUGIN_ROOT}/commands/${command}.md`),
    `${command} wrapper must delegate to the canonical command router`,
  );
  assert(
    wrapper.includes('\${CLAUDE_PLUGIN_ROOT}/internal/skills/...'),
    `${command} wrapper must map internal skill paths explicitly`,
  );
}

for (const internalSkill of ['sprint-forge', 'seedbed', 'qa-review', 'kyro-sprint-executor']) {
  assert(
    existsSync(resolve(root, 'internal/skills', internalSkill, 'SKILL.md')),
    `missing internal skill source: ${internalSkill}`,
  );
  assert(!claudeCommands.includes(internalSkill), `internal skill leaked into Claude commands: ${internalSkill}`);
}

console.log(`check:claude-plugin-surface — ${claudeCommands.length} public commands; internal skills hidden`);

function markdownNames(directory) {
  return readdirSync(directory)
    .filter((entry) => entry.endsWith('.md'))
    .map((entry) => entry.slice(0, -3))
    .sort();
}

function assert(condition, message) {
  if (!condition) throw new Error(`check:claude-plugin-surface: ${message}`);
}
