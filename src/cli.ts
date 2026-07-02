#!/usr/bin/env node
import { runCli } from './cli/app';
import { KyroCoreError } from './cli/core/errors';

void runCli().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`ERROR: ${message}`);
  if (error instanceof KyroCoreError && error.remedy) console.error(`Remedy: ${error.remedy}`);
  process.exit(1);
});
