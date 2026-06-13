import { readJsonFromPackage } from './fs';

export function readPackageVersion(): string {
  return readJsonFromPackage<{ version: string }>('package.json').version;
}

export function printHelp(): void {
  console.log(`Kyro — Multi-Agent Harness\n\nUsage:\n  kyro                         Open interactive TUI\n  kyro install [options]       Install Kyro adapter assets\n  kyro doctor                  Check package/workspace health\n  kyro sync [options]          Refresh managed workspace assets\n  kyro uninstall [options]     Remove managed workspace assets\n\nOptions:\n  --agent <name>               Agent adapter: opencode, codex\n  --scope <scope>              Install scope: workspace (default)\n  --dry-run                    Preview changes\n  --yes, -y                    Skip confirmation prompts where available\n  --help, -h                   Show help\n  --version, -v                Show version\n\nExamples:\n  kyro install --agent opencode --scope workspace --dry-run\n  kyro install --agent opencode --scope workspace --yes
  kyro install --agent codex --scope workspace --yes\n  kyro doctor\n`);
}

export function printCommandHelp(command: string): void {
  if (command === 'install') {
    console.log('Usage: kyro install --agent opencode --scope workspace [--dry-run] [--yes]');
  } else if (command === 'sync') {
    console.log('Usage: kyro sync [--agent opencode] [--dry-run]');
  } else if (command === 'uninstall') {
    console.log('Usage: kyro uninstall [--dry-run] [--yes]');
  } else {
    printHelp();
  }
}
