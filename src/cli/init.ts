import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { copyRecursive } from './fs-utils';
import { mergePackageJson } from './merge-package';
import { resolvePackageRoot } from './paths';

type InitOptions = {
  force: boolean;
  cursor: boolean;
};

/**
 * Installs Kyro workflow files into the consumer project directory.
 */
export function runInit(projectRoot: string, options: InitOptions): void {
  const packageRoot = resolvePackageRoot(projectRoot);
  const orchestratorPath = path.join(projectRoot, '.agents', 'orchestrator.md');

  if (fs.existsSync(orchestratorPath) && !options.force) {
    console.error('Kyro is already initialized (.agents/orchestrator.md exists). Use --force to overwrite.');
    process.exit(1);
  }

  const packageJson = JSON.parse(
    fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8')
  ) as { version: string };

  const dirs = [
    path.join(projectRoot, '.agents'),
    path.join(projectRoot, '.agents', 'sprint-forge'),
    path.join(projectRoot, '.skills')
  ];

  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true });
  }

  copyRecursive(
    path.join(packageRoot, 'agents', 'orchestrator.md'),
    orchestratorPath
  );
  copyRecursive(
    path.join(packageRoot, 'skills', 'sprint-forge'),
    path.join(projectRoot, '.skills', 'sprint-forge')
  );
  copyRecursive(
    path.join(packageRoot, 'skills', 'qa-review'),
    path.join(projectRoot, '.skills', 'qa-review')
  );
  copyRecursive(
    path.join(packageRoot, 'commands'),
    path.join(projectRoot, '.agents', 'kyro-commands')
  );

  const configTemplate = path.join(packageRoot, 'templates', 'config.default.json');
  const configTarget = path.join(projectRoot, 'config.json');

  if (!fs.existsSync(configTarget) || options.force) {
    fs.copyFileSync(configTemplate, configTarget);
  }

  mergePackageJson(projectRoot, packageJson.version);

  const harnessScript = path.join(packageRoot, 'scripts', 'harness-detect.js');
  const harnessResult = spawnSync(process.execPath, [harnessScript, '--apply'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      KYRO_PROJECT_DIR: projectRoot,
      KYRO_PACKAGE_ROOT: packageRoot
    },
    encoding: 'utf8'
  });

  if (harnessResult.status !== 0) {
    console.error('Warning: harness-detect --apply did not succeed; config.harness left at defaults.');
    if (harnessResult.stdout) {
      console.error(harnessResult.stdout);
    }
    if (harnessResult.stderr) {
      console.error(harnessResult.stderr);
    }
  }

  const shouldInstallCursorRule =
    options.cursor || Boolean(process.env.CURSOR_AGENT || process.env.CURSOR_TRACE_ID);

  if (shouldInstallCursorRule) {
    const cursorRuleSource = path.join(packageRoot, 'adapters', 'cursor', 'kyro-workflow.mdc');
    const cursorRuleTarget = path.join(projectRoot, '.cursor', 'rules', 'kyro-workflow.mdc');

    fs.mkdirSync(path.dirname(cursorRuleTarget), { recursive: true });
    fs.copyFileSync(cursorRuleSource, cursorRuleTarget);
  }

  const kyroDir = path.join(projectRoot, '.kyro');
  fs.mkdirSync(kyroDir, { recursive: true });
  fs.writeFileSync(
    path.join(kyroDir, 'install.json'),
    `${JSON.stringify(
      {
        version: packageJson.version,
        installed_at: new Date().toISOString(),
        package_root: packageRoot
      },
      null,
      2
    )}\n`
  );

  console.log('Kyro initialized successfully.');
  console.log('');
  console.log('Next step — start a forge cycle in your agent:');
  console.log('');
  console.log('  Use Kyro forge for <scope>.');
  console.log('  Read .agents/orchestrator.md and .skills/sprint-forge/SKILL.md');
  console.log('  Persist artifacts under .agents/sprint-forge/<scope>/');
  console.log('');
  console.log('Optional: add stack-specific commands to config.json → quality_gates when ready.');
}
