import fs from 'node:fs';
import path from 'node:path';
import { resolvePackageRoot } from './paths';

const REQUIRED_PATHS = [
  '.agents/orchestrator.md',
  '.skills/sprint-forge/SKILL.md',
  '.skills/qa-review/SKILL.md',
  'config.json',
  '.kyro/install.json'
];

/**
 * Verifies that Kyro was installed correctly in the consumer project.
 */
export function runDoctor(projectRoot: string): void {
  const failures: string[] = [];

  for (const relativePath of REQUIRED_PATHS) {
    const absolutePath = path.join(projectRoot, relativePath);

    if (!fs.existsSync(absolutePath)) {
      failures.push(`Missing ${relativePath}`);
    }
  }

  try {
    resolvePackageRoot(projectRoot);
  } catch {
    failures.push('Could not resolve Kyro package root');
  }

  if (failures.length > 0) {
    console.error('Kyro doctor found issues:');
    for (const failure of failures) {
      console.error(`  - ${failure}`);
    }
    process.exit(1);
  }

  console.log('Kyro doctor: all checks passed.');
}
