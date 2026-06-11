import fs from 'node:fs';
import path from 'node:path';

const PACKAGE_NAME = '@synapsync/kyro-workflow';

const KYRO_SCRIPTS: Record<string, string> = {
  'check:post-edit': 'kyro-workflow run check:post-edit',
  'check:pre-commit': 'kyro-workflow run check:pre-commit',
  'kyro:gate': 'kyro-workflow run kyro:gate'
};

type PackageJson = {
  name?: string;
  private?: boolean;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
};

/**
 * Merges Kyro devDependency and npm scripts into a consumer package.json.
 */
export function mergePackageJson(projectRoot: string, packageVersion: string): void {
  const packageJsonPath = path.join(projectRoot, 'package.json');
  let pkg: PackageJson = {};

  if (fs.existsSync(packageJsonPath)) {
    pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as PackageJson;
  } else {
    pkg.private = true;
  }

  pkg.devDependencies = {
    ...pkg.devDependencies,
    [PACKAGE_NAME]: `^${packageVersion}`
  };

  pkg.scripts = {
    ...pkg.scripts,
    ...KYRO_SCRIPTS
  };

  fs.writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`);
}
