import { readJsonFromPackage } from './fs';

export function readPackageVersion(): string {
  return readJsonFromPackage<{ version: string }>('package.json').version;
}

export function printHelp(): void {
  console.log(`Kyro — Multi-Agent Harness

Usage:
  kyro                         Open interactive TUI
  kyro install                 Install/update the global Kyro runtime
  kyro detect                  Detect local agent adapters
  kyro doctor                  Check package/workspace health
  kyro analyze [options]       Semantic cross-check of a scope (clarity, coverage, deps, debt)
  kyro record-evidence <task>  Tool-owned maker evidence write (sets status, routes to review)
  kyro plan --from <file>      Tool-owned scope bootstrap (init) or next-sprint materialization (sprint)
  kyro review <task> [options] Tool-owned maker/checker verdict write
  kyro debt <subcommand>       Tool-owned debt mutation: add, start, resolve, defer, escalate
  kyro add-emergent [options]  Tool-owned append to activeSprint.emergentTasks[]
  kyro scenario <subcommand>   Tool-owned scenario add / task link (no hand-edit)
  kyro adr <subcommand>        Tool-owned ADR append (full v4 record)
  kyro rule <subcommand>       Tool-owned scope/global convention append
  kyro repair [options]        Validate and normalize a scope's sprint.json
  kyro remediate <subcommand>  Typed, append-only correction of a CLOSED scope: preview, apply
  kyro recertify <subcommand>  Certify a remediated scope against re-verified evidence: preview, apply
  kyro status [mode]           Read-only scope progress, review debt, and debt report
  kyro close-sprint [options]  Checkpoint + close the active sprint (lossless, tool-owned)
  kyro clarify --from <file>   Tool-owned clarification resolution write
  kyro context-pack [options]  Emit a context package for a scope from sprint.json
  kyro capabilities [--json]   List supported tool-owned verbs (runtime handshake)
  kyro eval [options]          Run deterministic behavioral eval cases
  kyro mcp <subcommand>        Run or inspect the Kyro MCP server
  kyro trace [options]          Read or clear the append-only scope trace
  kyro scope <subcommand>      List, inspect, activate, or retire Kyro scopes
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
  --verbose                    Show detailed install/sync operation plans
  --verbosity <level>          Output depth for context-pack: concise or detailed (default)
  --purge-adapter-assets       Remove adapter-owned entrypoint files during uninstall
  --prune                      Clean obsolete adapter-owned files during sync
  --init-workspace             Initialize Kyro in this workspace during install
  --no-init-workspace          Install runtime only; never initialize a new workspace
  --dry-run                    Preview changes
  --yes, -y, --confirm         Skip confirmation prompts where available
  --help, -h                   Show help
  --version, -v                Show version

Examples:
  kyro install --scope workspace --dry-run
  kyro install --init-workspace
  kyro detect --json
  kyro doctor --tokens --artifacts
  kyro repair --kyro-scope auth-refactor --dry-run
  kyro remediate preview --kyro-scope auth-refactor --manifest remediation.json
  kyro recertify preview --kyro-scope auth-refactor --manifest certification.json
  kyro status --kyro-scope auth-refactor --json
  kyro status debt --kyro-scope auth-refactor
  kyro record-evidence T1.1 --kyro-scope auth-refactor --summary "..." --validation "npm test" --file src/x.ts
  kyro plan --from lean-plan.json --kyro-scope auth-refactor --dry-run
  kyro clarify --from clarifications.json --kyro-scope auth-refactor --dry-run
  kyro review T1.1 --kyro-scope auth-refactor --verdict pass --yes
  kyro debt add --title "Missing test" --priority high --kyro-scope auth-refactor
  kyro add-emergent --title "Add missing migration" --description "..." --acceptance "Migration runs clean." --kyro-scope auth-refactor
  kyro scenario add --id S10 --requirement R1 --given "..." --when "..." --then "..." --kyro-scope auth-refactor
  kyro scenario link --task T1.2 --scenario S10 --kyro-scope auth-refactor
  kyro adr add --title "..." --context "..." --decision "..." --consequence "..." --alternative "..." --kyro-scope auth-refactor
  kyro rule add --rule "..." --tag process [--global] --kyro-scope auth-refactor
  kyro context-pack --kyro-scope 01-token-cost-optimization --json
  kyro eval --json
  kyro trace --kyro-scope auth-refactor --tail 20
  kyro scope list
`);
}

export function printCommandHelp(command: string): void {
  if (command === 'install') {
    console.log('Usage: kyro install [--agent standard|opencode|codex] --scope workspace [--init-workspace|--no-init-workspace] [--dry-run] [--yes]');
  } else if (command === 'detect') {
    console.log('Usage: kyro detect [--agent standard|opencode|codex|claude|cursor] [--json]');
  } else if (command === 'doctor') {
    console.log('Usage: kyro doctor [--tokens] [--artifacts] [--adapters] [--trace] [--kyro-scope <scope>]');
  } else if (command === 'repair') {
    console.log('Usage: kyro repair [--kyro-scope <scope>] [--dry-run] [--yes|--confirm]');
  } else if (command === 'remediate') {
    console.log('Usage: kyro remediate preview|apply --manifest <path> [--kyro-scope <scope>] [--json] (apply requires --yes)');
  } else if (command === 'recertify') {
    console.log('Usage: kyro recertify preview|apply --manifest <path> [--kyro-scope <scope>] [--json] (apply requires --yes)');
  } else if (command === 'status') {
    console.log('Usage: kyro status [brief|full|debt] [--kyro-scope <scope>] [--json]');
  } else if (command === 'analyze') {
    console.log('Usage: kyro analyze [--kyro-scope <scope>] [--json]');
  } else if (command === 'record-evidence') {
    console.log('Usage: kyro record-evidence <task> [--kyro-scope <scope>] --summary <text> --validation <text> [--validation <text> ...] [--file <path> ...] [--notes <text>] [--by <actor>] [--status done|blocked] [--dry-run]');
  } else if (command === 'plan') {
    console.log('Usage: kyro plan --from <file> [--kyro-scope <scope>] [--dry-run]  (mode auto-detected: init when the scope has no sprint.json, sprint when it is ready to plan its next sprint; run kyro plan --help for both file shapes)');
  } else if (command === 'review') {
    console.log('Usage: kyro review <task> [--kyro-scope <scope>] [--verdict pass|fail] [--checked-criterion <text>] [--finding severity:detail] [--by <actor>] [--dry-run] [--yes]');
  } else if (command === 'debt') {
    console.log(`Usage:
  kyro debt add --title <text> --priority <critical|high|medium|low> [--target <n>] [--note <text>] [--kyro-scope <scope>] [--dry-run]
  kyro debt start <id> [--kyro-scope <scope>] [--dry-run]
  kyro debt resolve <id> [--note <text>] [--kyro-scope <scope>] [--dry-run]
  kyro debt defer <id> --target <n> --note <text> [--kyro-scope <scope>] [--dry-run]
  kyro debt escalate <id> --priority <critical|high|medium|low> [--kyro-scope <scope>] [--dry-run]`);
  } else if (command === 'add-emergent') {
    console.log('Usage: kyro add-emergent --title <text> --description <text> --acceptance <text> [--acceptance <text> ...] [--file <path> ...] [--context <text>] [--depends-on <id> ...] [--kyro-scope <scope>] [--dry-run]');
  } else if (command === 'scenario') {
    console.log(`Usage:
  kyro scenario add --id <S#> --requirement <R#> --given <text> --when <text> --then <text> [--kyro-scope <scope>] [--dry-run]
  kyro scenario link --task <T#> --scenario <S#> [--kyro-scope <scope>] [--dry-run]`);
  } else if (command === 'adr') {
    console.log('Usage: kyro adr add --title <text> --context <text> --decision <text> --consequence <text> [--consequence ...] --alternative <text> [--alternative ...] [--id ADR-0001] [--status accepted|proposed|rejected|superseded] [--date YYYY-MM-DD] [--kyro-scope <scope>] [--dry-run]');
  } else if (command === 'rule') {
    console.log('Usage: kyro rule add --rule <text> [--tag <tag> ...] [--id <id>] [--global] [--kyro-scope <scope>] [--dry-run]');
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
