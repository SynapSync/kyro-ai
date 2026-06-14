import { chmodSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const cliPath = resolve('dist/cli.js');

if (!existsSync(cliPath)) {
  console.error('ERROR: dist/cli.js does not exist. Run tsc before make-cli-executable.');
  process.exit(1);
}

chmodSync(cliPath, 0o755);
console.log('Made dist/cli.js executable');
