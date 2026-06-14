#!/usr/bin/env node
import { runCli } from './cli/app';

void runCli().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`ERROR: ${message}`);
  process.exit(1);
});
