#!/usr/bin/env node

const fs = require('node:fs');
const { fail, pass, resolveRoot } = require('./lib/workflow-utils');
const {
  buildApplyPreview,
  detectHarness,
  mergeHarnessConfig
} = require('./lib/harness-profiles');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const apply = args.includes('--apply');

if (dryRun && apply) {
  fail('Use either --dry-run or --apply, not both.', []);
}

const detected = detectHarness();

if (dryRun || apply) {
  const configPath = resolveRoot('config.json');

  if (!fs.existsSync(configPath)) {
    fail('config.json not found in project root.', [{ path: configPath }]);
  }

  const existingConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const preview = buildApplyPreview(existingConfig, detected.harness);
  const merged = mergeHarnessConfig(existingConfig, detected.harness);

  if (apply) {
    fs.writeFileSync(configPath, `${JSON.stringify(merged, null, 2)}\n`);

    pass('Harness config applied.', [
      {
        path: configPath,
        detected_harness: detected.harnessId,
        changed: preview.changed,
        harness: preview.after
      }
    ]);
  } else {
    pass('Harness apply preview.', [
      {
        path: configPath,
        detected_harness: detected.harnessId,
        changed: preview.changed,
        before: preview.before,
        after: preview.after
      }
    ]);
  }
} else {
  pass('Harness detection completed.', [
    {
      detected_harness: detected.harnessId,
      signals: detected.signals,
      suggested_config: {
        harness: detected.harness
      }
    }
  ]);
}
