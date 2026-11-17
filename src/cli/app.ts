import { printCommandHelp, printHelp, readPackageVersion } from './help';
import { KyroCoreError } from './core/errors';

// Command modules (and the state-writer lock) are loaded with require() only when their verb runs, so
// `--version`, `--help` and unknown verbs never pay for the whole CLI. The build is CommonJS.
// scripts/check-cli-lazy-load.mjs fails if `--version` loads anything under dist/cli/commands.

let cliWriterLocked = false;

export async function runCli(): Promise<void> {
  const [command = '', ...args] = process.argv.slice(2);
  if (!cliWriterLocked && isMutatingInvocation(command, args)) {
    cliWriterLocked = true;
    try { await (require('./pipeline/state-writer-lock') as typeof import('./pipeline/state-writer-lock')).withStateWriterLockAsync(runCli); }
    finally { cliWriterLocked = false; }
    return;
  }

  if (command === '' || command === 'tui') {
    await (require('./commands/tui') as typeof import('./commands/tui')).runTui();
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
    (require('./commands/capabilities') as typeof import('./commands/capabilities')).runCapabilitiesCommand(args);
    return;
  }

  if (command === 'work') {
    (require('./commands/work') as typeof import('./commands/work')).runWorkCommand(args);
    return;
  }

  if (command === 'adapters') {
    (require('./commands/adapters') as typeof import('./commands/adapters')).runAdaptersCommand(args);
    return;
  }

  if (command === 'mcp') {
    (require('./commands/mcp') as typeof import('./commands/mcp')).runMcpCommand(args);
    return;
  }

  if (command === 'trace') {
    (require('./commands/trace') as typeof import('./commands/trace')).runTraceCommand(args);
    return;
  }

  if (command === 'review') {
    (require('./commands/review') as typeof import('./commands/review')).runReviewCommand(args);
    return;
  }

  if (command === 'record-evidence') {
    (require('./commands/record-evidence') as typeof import('./commands/record-evidence')).runRecordEvidenceCommand(args);
    return;
  }

  if (command === 'plan') {
    (require('./commands/plan') as typeof import('./commands/plan')).runPlanCommand(args);
    return;
  }

  if (command === 'remediate') {
    (require('./commands/remediate') as typeof import('./commands/remediate')).runRemediateCommand(args);
    return;
  }

  if (command === 'recertify') {
    (require('./commands/recertify') as typeof import('./commands/recertify')).runRecertifyCommand(args);
    return;
  }

  if (command === 'debt') {
    (require('./commands/debt') as typeof import('./commands/debt')).runDebtCommand(args);
    return;
  }

  if (command === 'add-emergent') {
    (require('./commands/add-emergent') as typeof import('./commands/add-emergent')).runAddEmergentCommand(args);
    return;
  }

  if (command === 'scenario') {
    (require('./commands/scenario') as typeof import('./commands/scenario')).runScenarioCommand(args);
    return;
  }

  if (command === 'clarify') {
    (require('./commands/clarify') as typeof import('./commands/clarify')).runClarifyCommand(args);
    return;
  }

  if (command === 'adr') {
    (require('./commands/adr') as typeof import('./commands/adr')).runAdrCommand(args);
    return;
  }

  if (command === 'rule') {
    (require('./commands/rule') as typeof import('./commands/rule')).runRuleCommand(args);
    return;
  }

  if (command === 'repair') {
    await (require('./commands/repair') as typeof import('./commands/repair')).runRepairCommand(args);
    return;
  }

  if (command === 'scope') {
    (require('./commands/scope') as typeof import('./commands/scope')).runScopeCommand(args);
    return;
  }

  if (command === 'close-sprint') {
    await (require('./commands/close-sprint') as typeof import('./commands/close-sprint')).runCloseSprintCommand(args);
    return;
  }

  if (command === 'status') {
    (require('./commands/status') as typeof import('./commands/status')).runStatusCommand(args);
    return;
  }

  if (command === 'context-pack') {
    const options = lazyParseOptions(args);
    if (options.help) {
      printCommandHelp(command);
      return;
    }
    (require('./commands/context-pack') as typeof import('./commands/context-pack')).contextPack(options);
    return;
  }

  const options = lazyParseOptions(args);

  if (options.help) {
    printCommandHelp(command);
    return;
  }

  switch (command) {
    case 'install':
      await (require('./commands/install') as typeof import('./commands/install')).install(options);
      break;
    case 'detect':
      (require('./commands/detect') as typeof import('./commands/detect')).detect(options);
      break;
    case 'doctor':
      (require('./commands/doctor') as typeof import('./commands/doctor')).doctor(options);
      break;
    case 'analyze':
      (require('./commands/analyze') as typeof import('./commands/analyze')).analyze(options);
      break;
    case 'sync':
      (require('./commands/install') as typeof import('./commands/install')).sync(options);
      break;
    case 'update':
      await (require('./commands/update') as typeof import('./commands/update')).runUpdate(options);
      break;
    case 'uninstall':
      (require('./commands/uninstall') as typeof import('./commands/uninstall')).uninstall(options);
      break;
    case 'eval':
      (require('./commands/eval') as typeof import('./commands/eval')).runEval(options);
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
  if (command === 'scope' && args[0] === 'discard' && args.includes('--yes')) return true;
  if (command === 'scope' && args[0] === 'complete' && args.includes('--yes')) return true;
  if (command === 'scope' && args[0] === 'reopen' && args.includes('--yes')) return true;
  if (command === 'work' && args[0] === 'create') return true;
  return command === 'trace' && args.includes('--clear');
}

function lazyParseOptions(args: string[]): ReturnType<typeof import('./options').parseOptions> {
  return (require('./options') as typeof import('./options')).parseOptions(args);
}
