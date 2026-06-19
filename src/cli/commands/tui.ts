import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { AGENT, SCOPE } from '../constants';
import { doctor } from './doctor';
import { install } from './install';
import type { Agent, CliOptions } from '../types';

export async function runTui(): Promise<void> {
  const rl = createInterface({ input, output });
  try {
    console.log('Kyro — Multi-Agent Harness');
    console.log('1) Install standard .agents adapter in this workspace');
    console.log('2) Install OpenCode adapter in this workspace');
    console.log('3) Install Codex adapter in this workspace');
    console.log('4) Run doctor');
    console.log('5) Exit');
    const answer = await rl.question('Select an option: ');
    if (answer.trim() === '1') {
      install(tuiInstallOptions(AGENT.STANDARD));
    } else if (answer.trim() === '2') {
      install(tuiInstallOptions(AGENT.OPENCODE));
    } else if (answer.trim() === '3') {
      install(tuiInstallOptions(AGENT.CODEX));
    } else if (answer.trim() === '4') {
      doctor();
    } else {
      console.log('No changes made.');
    }
  } finally {
    rl.close();
  }
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
    kyroScope: null,
    json: false,
    purgeAdapterAssets: false,
    prune: false,
  };
}
