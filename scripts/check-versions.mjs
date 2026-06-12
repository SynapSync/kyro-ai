import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function readJson(file) {
  return JSON.parse(readFileSync(resolve(root, file), 'utf-8'));
}

function readYamlVersion(file) {
  const text = readFileSync(resolve(root, file), 'utf-8');
  const match = text.match(/^version:\s*["']?([^"'\n]+)["']?$/m);
  if (!match) throw new Error(`Could not parse version from ${file}`);
  return match[1];
}

const pkg = readJson('package.json');
const plugin = readJson('.claude-plugin/plugin.json');
const workflowVersion = readYamlVersion('WORKFLOW.yaml');

const pkgVersion = pkg.version;
const pluginVersion = plugin.version;

let failed = false;

if (pkgVersion !== pluginVersion) {
  console.error(`ERROR: Version mismatch`);
  console.error(`  package.json:                  ${pkgVersion}`);
  console.error(`  .claude-plugin/plugin.json:    ${pluginVersion}`);
  failed = true;
}

if (pkgVersion !== workflowVersion) {
  console.error(`ERROR: Version mismatch`);
  console.error(`  package.json:     ${pkgVersion}`);
  console.error(`  WORKFLOW.yaml:    ${workflowVersion}`);
  failed = true;
}

if (failed) {
  console.error(`\nFix: update all version fields to match before committing.`);
  process.exit(1);
}

console.log(`All versions match: ${pkgVersion}`);
