export const CLI_COMMANDS = [
  'install',
  'detect',
  'doctor',
  'analyze',
  'review',
  'repair',
  'close-sprint',
  'clarify',
  'context-pack',
  'scope',
  'sync',
  'uninstall',
  'eval',
  'mcp',
  'trace',
] as const;

export type CliCommand = (typeof CLI_COMMANDS)[number];

export function isCliCommand(value: string): value is CliCommand {
  return (CLI_COMMANDS as readonly string[]).includes(value);
}
