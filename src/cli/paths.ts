import fs from 'node:fs';
import path from 'node:path';

const PACKAGE_NAMES = ['@synapsync/kyro-workflow', 'kyro-workflow'] as const;

/**
 * Returns the directory containing the compiled CLI entry file.
 */
export function getCliDir(): string {
  return __dirname;
}

/**
 * Resolves the installed Kyro package root from the running CLI location.
 */
export function getPackageRootFromCli(): string {
  return path.resolve(__dirname, '..', '..');
}

/**
 * Attempts to resolve the package root via Node module resolution.
 */
export function resolvePackageRootFromModule(): string | null {
  for (const packageName of PACKAGE_NAMES) {
    try {
      const packageJsonPath = require.resolve(`${packageName}/package.json`) as string;
      return path.dirname(packageJsonPath);
    } catch {
      // try next name
    }
  }

  return null;
}

/**
 * Reads the consumer install manifest when present.
 */
export function readInstallManifest(projectRoot: string): { package_root?: string } | null {
  const manifestPath = path.join(projectRoot, '.kyro', 'install.json');

  if (!fs.existsSync(manifestPath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { package_root?: string };
}

/**
 * Resolves Kyro package root for CLI operations.
 */
export function resolvePackageRoot(projectRoot = process.cwd()): string {
  const fromManifest = readInstallManifest(projectRoot)?.package_root;

  if (fromManifest && fs.existsSync(fromManifest)) {
    return path.resolve(fromManifest);
  }

  const fromModule = resolvePackageRootFromModule();

  if (fromModule) {
    return fromModule;
  }

  return getPackageRootFromCli();
}
