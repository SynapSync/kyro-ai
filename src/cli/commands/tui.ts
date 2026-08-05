import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { AGENT, SCOPE } from '../constants';
import { doctor } from './doctor';
import { install } from './install';
import type { Agent, CliOptions } from '../types';
import { withStateWriterLockAsync } from '../pipeline/state-writer-lock';
import { detectPackageRootMode, FULL_PACKAGE_INSTALL_REMEDY } from '../package-root-mode';

export async function runTui(): Promise<void> {
  const rl = createInterface({ input, output });
  try {
    console.log('Kyro — Multi-Agent Harness');
    const rootMode = detectPackageRootMode();
    if (rootMode !== 'full-package') {
      const rootLabel = rootMode === 'projected-runtime'
        ? 'the projected runtime CLI'
        : 'an unrecognized or corrupt CLI root';
      console.log(`Package management is unavailable from ${rootLabel}.`);
      console.log(`Remedy: ${FULL_PACKAGE_INSTALL_REMEDY}`);
      console.log('1) Run doctor');
      console.log('2) Exit');
      const answer = await rl.question('Select an option: ');
      if (answer.trim() === '1') doctor();
      else console.log('No changes made.');
      return;
    }

    console.log('1) Install standard .agents adapter in this workspace');
    console.log('2) Install OpenCode adapter in this workspace');
    console.log('3) Install Codex adapter in this workspace');
    console.log('4) Run doctor');
    console.log('5) Exit');
    const answer = await rl.question('Select an option: ');
    if (answer.trim() === '1') {
      await runLockedInstall(AGENT.STANDARD);
    } else if (answer.trim() === '2') {
      await runLockedInstall(AGENT.OPENCODE);
    } else if (answer.trim() === '3') {
      await runLockedInstall(AGENT.CODEX);
    } else if (answer.trim() === '4') {
      doctor();
    } else {
      console.log('No changes made.');
    }
  } finally {
    rl.close();
  }
}

async function runLockedInstall(agent: Agent): Promise<void> {
  await withStateWriterLockAsync(() => install(tuiInstallOptions(agent)));
}

function tuiInstallOptions(agent: Agent): CliOptions {
  return {
    agents: [agent],
    scope: SCOPE.WORKSPACE,
    dryRun: false,
    yes: true,
    help: false,
    tokens: false,
    artifacts: false,
    adapters: false,
    trace: false,
    kyroScope: null,
    task: null,
    json: false,
    verbosity: 'detailed',
    verbose: false,
    purgeAdapterAssets: false,
    prune: false,
    initWorkspace: true,
    noInitWorkspace: false,
    evalCases: [],
    evalTags: [],
    evalList: false,
    keepSandbox: false,
  };
}
