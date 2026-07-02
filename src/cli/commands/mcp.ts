import { MCP_TOOLS } from '../mcp/tool-catalog';
import { serveMcp } from '../mcp/server';

export function runMcpCommand(args: string[]): void {
  const [subcommand = ''] = args;
  if (subcommand === '--help' || subcommand === '-h' || subcommand === 'help' || subcommand === '') {
    printMcpHelp();
    return;
  }
  if (subcommand === 'serve') {
    serveMcp();
    return;
  }
  if (subcommand === 'tools') {
    console.log(JSON.stringify({ tools: MCP_TOOLS }, null, 2));
    return;
  }
  throw new Error(`Unknown mcp subcommand: ${subcommand}. Run kyro mcp --help.`);
}

function printMcpHelp(): void {
  console.log(`Usage:
  kyro mcp serve    Start the Kyro MCP stdio server
  kyro mcp tools    Print the MCP tool catalog as JSON
`);
}
