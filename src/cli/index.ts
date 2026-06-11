#!/usr/bin/env node

import { runDoctor } from './doctor';
import { runInit } from './init';
import { runScript } from './run';

const [, , command, ...rest] = process.argv;
const projectRoot = process.cwd();

function hasFlag(flag: string): boolean {
  return rest.includes(flag);
}

function argsWithoutFlags(): string[] {
  return rest.filter((arg) => !arg.startsWith('--'));
}

switch (command) {
  case 'init':
    runInit(projectRoot, {
      force: hasFlag('--force'),
      cursor: hasFlag('--cursor')
    });
    break;
  case 'doctor':
    runDoctor(projectRoot);
    break;
  case 'run': {
    const [alias, ...scriptArgs] = argsWithoutFlags();

    if (!alias) {
      console.error('Usage: kyro-workflow run <script-alias> [args...]');
      process.exit(1);
    }

    runScript(projectRoot, alias, scriptArgs);
    break;
  }
  default:
    console.log('Usage: kyro-workflow <command>');
    console.log('');
    console.log('Commands:');
    console.log('  init [--force] [--cursor]   Install Kyro into the current project');
    console.log('  doctor                      Verify Kyro installation');
    console.log('  run <alias> [args...]       Run a bundled Kyro script');
    process.exit(command ? 1 : 0);
}
