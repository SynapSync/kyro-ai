import { doctor } from './commands/doctor';
import { analyze } from './commands/analyze';
import { detect } from './commands/detect';
import { install, sync } from './commands/install';
import { runTui } from './commands/tui';
import { runRepairCommand } from './commands/repair';
import { runRecertifyCommand } from './commands/recertify';
import { runRemediateCommand } from './commands/remediate';
import { contextPack } from './commands/context-pack';
import { runStatusCommand } from './commands/status';
import { runScopeCommand } from './commands/scope';
import { runCloseSprintCommand } from './commands/close-sprint';
import { uninstall } from './commands/uninstall';
import { runEval } from './commands/eval';
import { runMcpCommand } from './commands/mcp';
import { runTraceCommand } from './commands/trace';
import { runReviewCommand } from './commands/review';
import { runRecordEvidenceCommand } from './commands/record-evidence';
import { runPlanCommand } from './commands/plan';
import { runDebtCommand } from './commands/debt';
import { runAddEmergentCommand } from './commands/add-emergent';
import { runScenarioCommand } from './commands/scenario';
import { runClarifyCommand } from './commands/clarify';
import { runAdrCommand } from './commands/adr';
import { runRuleCommand } from './commands/rule';
import { runCapabilitiesCommand } from './commands/capabilities';
import { printCommandHelp, printHelp, readPackageVersion } from './help';
import { parseOptions } from './options';
import { KyroCoreError } from './core/errors';
import { withStateWriterLockAsync } from './pipeline/state-writer-lock';

let cliWriterLocked = false;

export async function runCli(): Promise<void> {
  const [command = '', ...args] = process.argv.slice(2);
  if (!cliWriterLocked && isMutatingInvocation(command, args)) {
    cliWriterLocked = true;
    try { await withStateWriterLockAsync(runCli); }
    finally { cliWriterLocked = false; }
    return;
  }

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

  if (command === 'capabilities') {
    runCapabilitiesCommand(args);
    return;
  }

  if (command === 'mcp') {
    runMcpCommand(args);
    return;
  }

  if (command === 'trace') {
    runTraceCommand(args);
    return;
  }

  if (command === 'review') {
    runReviewCommand(args);
    return;
  }

  if (command === 'record-evidence') {
    runRecordEvidenceCommand(args);
    return;
  }

  if (command === 'plan') {
    runPlanCommand(args);
    return;
  }

  if (command === 'remediate') {
    runRemediateCommand(args);
    return;
  }

  if (command === 'recertify') {
    runRecertifyCommand(args);
    return;
  }

  if (command === 'debt') {
    runDebtCommand(args);
    return;
  }

  if (command === 'add-emergent') {
    runAddEmergentCommand(args);
    return;
  }

  if (command === 'scenario') {
    runScenarioCommand(args);
    return;
  }

  if (command === 'clarify') {
    runClarifyCommand(args);
    return;
  }

  if (command === 'adr') {
    runAdrCommand(args);
    return;
  }

  if (command === 'rule') {
    runRuleCommand(args);
    return;
  }

  if (command === 'repair') {
    await runRepairCommand(args);
    return;
  }

  if (command === 'scope') {
    runScopeCommand(args);
    return;
  }

  if (command === 'close-sprint') {
    await runCloseSprintCommand(args);
    return;
  }

  if (command === 'status') {
    runStatusCommand(args);
    return;
  }

  if (command === 'context-pack') {
    const options = parseOptions(args);
    if (options.help) {
      printCommandHelp(command);
      return;
    }
    contextPack(options);
    return;
  }

  const options = parseOptions(args);

  if (options.help) {
    printCommandHelp(command);
    return;
  }

  switch (command) {
    case 'install':
      await install(options);
      break;
    case 'detect':
      detect(options);
      break;
    case 'doctor':
      doctor(options);
      break;
    case 'analyze':
      analyze(options);
      break;
    case 'sync':
      sync(options);
      break;
    case 'uninstall':
      uninstall(options);
      break;
    case 'eval':
      runEval(options);
      break;
    default:
      throw new KyroCoreError('UNKNOWN_COMMAND', `Unknown command: ${command}.`, 'Run kyro --help.');
  }
}

function isMutatingInvocation(command: string, args: string[]): boolean {
  if (args.includes('--dry-run')) return false;
  // close-sprint owns its lock after interactive confirmation so prompts never block writers.
  // install owns a post-prompt lock and rebuilds its plan from fresh state.
  if (['sync', 'uninstall', 'repair', 'remediate', 'recertify', 'review', 'record-evidence', 'plan', 'debt', 'add-emergent', 'scenario', 'clarify', 'adr', 'rule'].includes(command)) return true;
  if (command === 'scope' && args[0] === 'set-active') return true;
  if (command === 'scope' && args[0] === 'retire' && args.includes('--yes')) return true;
  if (command === 'scope' && args[0] === 'complete' && args.includes('--yes')) return true;
  if (command === 'scope' && args[0] === 'reopen' && args.includes('--yes')) return true;
  return command === 'trace' && args.includes('--clear');
}
