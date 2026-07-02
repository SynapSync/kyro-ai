#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(fileURLToPath(import.meta.url), '../..');
const cli = resolve(repo, 'dist/cli.js');
const result = spawnSync(process.execPath, [cli, 'eval', '--json'], { cwd: repo, encoding: 'utf-8' });
if (result.status !== 0) {
  console.error(result.stdout || result.stderr || 'kyro eval failed with no output');
  process.exit(result.status ?? 1);
}
const report = JSON.parse(result.stdout);
if (report.evalReportSchemaVersion !== 1 || report.failed !== 0 || report.selected < 15) {
  console.error(`Unexpected eval report: ${result.stdout}`);
  process.exit(1);
}
console.log(`check:eval — ${report.passed}/${report.selected} behavioral evals passed`);
