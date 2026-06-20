import { existsSync, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import type { Agent } from '../types';
import type { AdapterPaths, DetectionContext, DetectionResult } from './registry-types';

export function detectFromPaths(agent: Agent, binaryName: string | null, paths: AdapterPaths, context: DetectionContext, fallbackDetail: string): DetectionResult {
  const binaryPath = binaryName ? findExecutable(binaryName, context.envPath ?? process.env.PATH ?? '') : null;
  const configPath = paths.globalConfigDir ?? null;
  const configFound = configPath ? directoryExists(configPath) : false;
  const installed = binaryName ? binaryPath !== null : configFound;
  const detail = configPath
    ? `config=${configPath}; binary=${binaryPath ?? 'not-found'}`
    : fallbackDetail;

  return {
    agent,
    installed,
    binaryPath,
    configFound,
    configPath,
    detail,
  };
}

export function directoryExists(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function findExecutable(binaryName: string, envPath: string): string | null {
  const extensions = process.platform === 'win32' ? ['', '.exe', '.cmd', '.bat'] : [''];
  for (const directory of envPath.split(delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = join(directory, `${binaryName}${extension}`);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}
