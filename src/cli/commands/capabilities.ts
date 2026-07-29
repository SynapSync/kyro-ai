import { KyroCoreError } from '../core/errors';
import { buildCapabilitiesPayload } from '../core/capabilities';

interface CapabilitiesArgs {
  json: boolean;
  help: boolean;
}

export function runCapabilitiesCommand(rawArgs: string[]): void {
  const args = parseCapabilitiesArgs(rawArgs);
  if (args.help) {
    printCapabilitiesHelp();
    return;
  }
  const payload = buildCapabilitiesPayload();
  if (args.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  console.log(`kyro ${payload.version}`);
  for (const verb of payload.capabilities) console.log(verb);
}

function parseCapabilitiesArgs(rawArgs: string[]): CapabilitiesArgs {
  let json = false;
  let help = false;
  for (const arg of rawArgs) {
    if (arg === '--help' || arg === '-h') help = true;
    else if (arg === '--json') json = true;
    else throw new KyroCoreError('INVALID_INPUT', `Unknown capabilities option: ${arg}`);
  }
  return { json, help };
}

function printCapabilitiesHelp(): void {
  console.log(`Usage: kyro capabilities [--json]

Lists the tool-owned verbs this CLI exposes, plus its version. The orchestrator runs this at
forge start to verify the installed runtime supports the verbs the skill assets invoke; an
UNKNOWN_COMMAND failure on this command itself means the runtime predates the handshake.

Options:
  --json    Print { version, capabilities[] } as JSON
  -h, --help`);
}
