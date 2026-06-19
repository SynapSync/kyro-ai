import { doctor } from './commands/doctor';
import { detect } from './commands/detect';
import { install, sync } from './commands/install';
import { runTui } from './commands/tui';
import { repair } from './commands/repair';
import { runScopeCommand } from './commands/scope';
import { uninstall } from './commands/uninstall';
import { printCommandHelp, printHelp, readPackageVersion } from './help';
import { parseOptions } from './options';

export async function runCli(): Promise<void> {
  const [command = '', ...args] = process.argv.slice(2);

  if (command === '' || command === 'tui') {
    await runTui();
    return;
  }

  if (command === '--help' || command === '-h' || command === 'help') {
    printHelp();
    return;
  }

  if (command === '--version' || command === '-v' || command === 'version') {
    console.log(readPackageVersion());
    return;
  }

  if (command === 'scope') {
    runScopeCommand(args);
    return;
  }

  const options = parseOptions(args);

  if (options.help) {
    printCommandHelp(command);
    return;
  }

  switch (command) {
    case 'install':
      install(options);
      break;
    case 'detect':
      detect(options);
      break;
    case 'doctor':
      doctor(options);
      break;
    case 'repair':
      await repair(options);
      break;
    case 'sync':
      sync(options);
      break;
    case 'uninstall':
      uninstall(options);
      break;
    default:
      throw new Error(`Unknown command: ${command}. Run kyro --help.`);
  }
}
