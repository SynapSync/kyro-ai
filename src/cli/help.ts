import { readJsonFromPackage } from './fs';

export function readPackageVersion(): string {
  return readJsonFromPackage<{ version: string }>('package.json').version;
}

export function printHelp(): void {
  console.log(`Kyro — Multi-Agent Harness

Usage:
  kyro                         Open interactive TUI
  kyro install                 Install Kyro standard .agents assets
  kyro doctor                  Check package/workspace health
  kyro repair [options]        Repair scoped JSON artifacts from Markdown
  kyro scope <subcommand>      List, inspect, or set active Kyro scopes
  kyro sync [options]          Refresh managed workspace assets
  kyro uninstall [options]     Remove managed workspace assets

Options:
  --agent <name>               Agent adapter: standard, opencode, codex
  --scope <scope>              Install scope: workspace (default)
  --kyro-scope <scope>         Select Kyro artifact scope
  --tokens                     Include token/context budget audit for doctor
  --artifacts                  Include Kyro artifact integrity audit for doctor
  --dry-run                    Preview changes
  --yes, -y                    Skip confirmation prompts where available
  --help, -h                   Show help
  --version, -v                Show version

Examples:
  kyro install --scope workspace --dry-run
  kyro doctor --tokens --artifacts
  kyro repair --kyro-scope auth-refactor --dry-run
  kyro scope list
`);
}

export function printCommandHelp(command: string): void {
  if (command === 'install') {
    console.log('Usage: kyro install [--agent standard|opencode|codex] --scope workspace [--dry-run] [--yes]');
  } else if (command === 'doctor') {
    console.log('Usage: kyro doctor [--tokens] [--artifacts] [--kyro-scope <scope>]');
  } else if (command === 'repair') {
    console.log('Usage: kyro repair [--kyro-scope <scope>] [--dry-run] [--yes]');
  } else if (command === 'scope') {
    console.log('Usage: kyro scope list | inspect <scope> | set-active <scope>');
  } else if (command === 'sync') {
    console.log('Usage: kyro sync [--agent standard|opencode|codex] [--dry-run]');
  } else if (command === 'uninstall') {
    console.log('Usage: kyro uninstall [--dry-run] [--yes]');
  } else {
    printHelp();
  }
}
