#!/usr/bin/env node
import { writeSync } from 'node:fs';
import { runCli } from './cli/app';
import { KyroCoreError } from './cli/core/errors';
import { emitMachineError, emitMachineSuccess, prepareMachineInvocation, startOutputCapture } from './cli/core/cli-envelope';

const originalArgv = process.argv.slice(2);
const invocation = prepareMachineInvocation(originalArgv);
process.argv = [...process.argv.slice(0, 2), ...invocation.argv];

if (invocation.enabled) {
  const capture = startOutputCapture();
  void runCli().then(() => {
    emitMachineSuccess(invocation.command, invocation.argv, capture.stop());
  }).catch((error: unknown) => {
    capture.stop();
    emitMachineError(invocation.command, error);
    process.exitCode = 1;
  });
} else void runCli().catch((error: unknown) => {
  const lines = [`ERROR: ${error instanceof Error ? error.message : String(error)}`];
  if (error instanceof KyroCoreError) lines.push(`Code: ${error.code}`);
  if (error instanceof KyroCoreError && error.remedy) lines.push(`Remedy: ${error.remedy}`);
  // Written to fd 2 synchronously: on Windows a piped stderr is async, and the process.exit below
  // would discard a console.error still sitting in the buffer, hiding the failure from CI logs.
  try { writeSync(2, `${lines.join('\n')}\n`); } catch { console.error(lines.join('\n')); }
  process.exit(1);
});
