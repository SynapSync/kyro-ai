import { readJsonFromPackage } from './fs';

export function readPackageVersion(): string {
  return readJsonFromPackage<{ version: string }>('package.json').version;
}

export function printHelp(): void {
  console.log(`Kyro — Multi-Agent Harness

Usage:
  kyro                         Open interactive TUI
  kyro install                 Install Kyro standard .agents assets
  kyro detect                  Detect local agent adapters
  kyro doctor                  Check package/workspace health
  kyro analyze [options]       Semantic cross-check of a scope (clarity, coverage, deps, debt)
  kyro review <task> [options] Tool-owned maker/checker verdict write
  kyro repair [options]        Validate and normalize a scope's sprint.json
  kyro close-sprint [options]  Snapshot + close the active sprint (zero-loss, tool-owned)
  kyro context-pack [options]  Emit a context package for a scope from sprint.json
  kyro eval [options]          Run deterministic behavioral eval cases
  kyro mcp <subcommand>        Run or inspect the Kyro MCP server
  kyro trace [options]          Read or clear the append-only scope trace
  kyro scope <subcommand>      List, inspect, or set active Kyro scopes
  kyro sync [options]          Refresh managed workspace assets
  kyro uninstall [options]     Remove managed workspace assets

Options:
  --agent <name>               Agent adapter: standard, opencode, codex
  --scope <scope>              Install scope: workspace (default)
  --kyro-scope <scope>         Select Kyro artifact scope
  --tokens                     Include token/context budget audit for doctor
  --artifacts                  Include Kyro artifact integrity audit for doctor
  --adapters                   Include adapter inventory for doctor
  --trace                      Include trace summary for doctor
  --json                       Print machine-readable output where supported
  --verbosity <level>          Output depth for context-pack: concise or detailed (default)
  --purge-adapter-assets       Remove adapter-owned entrypoint files during uninstall
  --prune                      Clean obsolete adapter-owned files during sync
  --dry-run                    Preview changes
  --yes, -y, --confirm         Skip confirmation prompts where available
  --help, -h                   Show help
  --version, -v                Show version

Examples:
  kyro install --scope workspace --dry-run
  kyro detect --json
  kyro doctor --tokens --artifacts
  kyro repair --kyro-scope auth-refactor --dry-run
  kyro review T1.1 --kyro-scope auth-refactor --verdict pass --yes
  kyro context-pack --kyro-scope 01-token-cost-optimization --json
  kyro eval --json
  kyro trace --kyro-scope auth-refactor --tail 20
  kyro scope list
`);
}

export function printCommandHelp(command: string): void {
  if (command === 'install') {
    console.log('Usage: kyro install [--agent standard|opencode|codex] --scope workspace [--dry-run] [--yes]');
  } else if (command === 'detect') {
    console.log('Usage: kyro detect [--agent standard|opencode|codex|claude|cursor] [--json]');
  } else if (command === 'doctor') {
    console.log('Usage: kyro doctor [--tokens] [--artifacts] [--adapters] [--trace] [--kyro-scope <scope>]');
  } else if (command === 'repair') {
    console.log('Usage: kyro repair [--kyro-scope <scope>] [--dry-run] [--yes]');
  } else if (command === 'analyze') {
    console.log('Usage: kyro analyze [--kyro-scope <scope>] [--json]');
  } else if (command === 'review') {
    console.log('Usage: kyro review <task> [--kyro-scope <scope>] [--verdict pass|fail] [--checked-criterion <text>] [--finding severity:detail] [--by <actor>] [--dry-run] [--yes]');
  } else if (command === 'close-sprint') {
    console.log('Usage: kyro close-sprint [--kyro-scope <scope>] [--outcome <text>] [--note <text>] [--summary <text>] [--recommendation <text>] [--learning <text>] [--dry-run] [--yes]');
  } else if (command === 'context-pack') {
    console.log('Usage: kyro context-pack [--kyro-scope <scope>] [--task <id>] [--verbosity concise|detailed] [--json]');
  } else if (command === 'eval') {
    console.log('Usage: kyro eval [--case <id>] [--tag <tag>] [--agent <name>] [--json] [--list] [--keep-sandbox]');
    console.log('Exit codes: 0 all passed; 1 expectation failed; 2 harness error.');
  } else if (command === 'mcp') {
    console.log('Usage: kyro mcp serve | tools');
  } else if (command === 'trace') {
    console.log('Usage: kyro trace [scope|--kyro-scope <scope>] [--json] [--tail N] [--type <event>] [--clear <scope>]');
  } else if (command === 'scope') {
    console.log('Usage: kyro scope list | inspect <scope> | set-active <scope>');
  } else if (command === 'sync') {
    console.log('Usage: kyro sync [--agent standard|opencode|codex] [--prune] [--dry-run]');
  } else if (command === 'uninstall') {
    console.log('Usage: kyro uninstall [--purge-adapter-assets] [--dry-run] [--yes]');
  } else {
    printHelp();
  }
}
