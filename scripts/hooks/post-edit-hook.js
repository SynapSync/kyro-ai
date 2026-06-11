#!/usr/bin/env node

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { getPackageRoot } = require('../lib/workflow-utils');

const packageRoot = getPackageRoot();
const scriptPath = path.join(packageRoot, 'scripts', 'post-edit-scan.js');
const result = spawnSync(process.execPath, [scriptPath, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: {
    ...process.env,
    KYRO_PACKAGE_ROOT: packageRoot,
    CLAUDE_PLUGIN_ROOT: packageRoot
  }
});

process.exit(result.status ?? 1);
