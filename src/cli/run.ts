import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { resolvePackageRoot } from './paths';

const SCRIPT_ALIASES: Record<string, string> = {
  'check:post-edit': 'post-edit-scan.js',
  'check:pre-commit': 'pre-commit-checkpoint.js',
  'kyro:gate': 'gate-decision.js',
  'kyro:sprint-number': 'sprint-number.js',
  'kyro:debt-inherit': 'debt-inherit.js',
  'kyro:metrics': 'metrics-aggregate.js',
  'kyro:state': 'state.js',
  'kyro:migrate-state': 'migrate-state.js',
  'kyro:render-state': 'render-state.js',
  'kyro:worktree-task': 'worktree-task.js',
  'kyro:rules-memory': 'rules-memory.js',
  'kyro:harness-detect': 'harness-detect.js'
};

/**
 * Delegates a named Kyro script with project/package env vars set.
 */
export function runScript(projectRoot: string, alias: string, args: string[]): void {
  const scriptFile = SCRIPT_ALIASES[alias];

  if (!scriptFile) {
    console.error(`Unknown script alias: ${alias}`);
    console.error(`Available: ${Object.keys(SCRIPT_ALIASES).join(', ')}`);
    process.exit(1);
  }

  const packageRoot = resolvePackageRoot(projectRoot);
  const scriptPath = path.join(packageRoot, 'scripts', scriptFile);
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: projectRoot,
    env: {
      ...process.env,
      KYRO_PROJECT_DIR: projectRoot,
      KYRO_PACKAGE_ROOT: packageRoot
    },
    stdio: 'inherit'
  });

  process.exit(result.status ?? 1);
}
