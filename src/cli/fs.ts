import {
  existsSync,
  readdirSync,
  readFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { PACKAGE_ROOT, WORKSPACE_ROOT } from './constants';
import { hasManagedBlockContent } from './injectors/managed-block';
import { applyOperationPlan } from './pipeline/operation-steps';
import type { OperationPlan } from './types';

export function applyPlan(plan: OperationPlan[]): void {
  applyOperationPlan(plan, { packageRoot: PACKAGE_ROOT, resolveManagedPath });
}

export function printPlan(title: string, plan: OperationPlan[]): void {
  console.log(title);
  for (const operation of plan) {
    const source = operation.source ? ` <= ${operation.source}` : '';
    const block = operation.blockName ? ` # ${operation.blockName}` : '';
    const jsonPath = operation.jsonPath ? ` # ${operation.jsonPath}` : '';
    console.log(`- ${operation.action} ${operation.path}${block}${jsonPath}${source}`);
  }
}

export function addCopyDirectoryPlan(plan: OperationPlan[], sourceDir: string, targetDir: string): void {
  for (const file of listRelativeFiles(sourceDir)) {
    addCopyFilePlan(plan, `${sourceDir}/${file}`, `${targetDir}/${file}`);
  }
}

export function addCopyFilePlan(plan: OperationPlan[], source: string, target: string): void {
  plan.push({ action: 'copy', source, path: target });
}

export function listRelativeFiles(sourceDir: string): string[] {
  const absolute = resolve(PACKAGE_ROOT, sourceDir);
  const files: string[] = [];
  walkFiles(absolute, files, absolute);
  return files.sort();
}

function walkFiles(current: string, files: string[], root: string): void {
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const full = join(current, entry.name);
    if (entry.isDirectory()) {
      walkFiles(full, files, root);
    } else if (entry.isFile()) {
      files.push(relative(root, full));
    }
  }
}

export function readJsonFromPackage<T>(file: string): T {
  return JSON.parse(readFileSync(resolve(PACKAGE_ROOT, file), 'utf-8')) as T;
}

export function readJsonFromWorkspace<T>(file: string): T | null {
  return readJsonFromManagedPath<T>(file);
}

export function readJsonFromManagedPath<T>(file: string): T | null {
  const path = resolveManagedPath(file);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8')) as T;
}

export function readPackageText(file: string): string {
  return readFileSync(resolve(PACKAGE_ROOT, file), 'utf-8');
}

export function workspaceFileExists(file: string): boolean {
  return existsSync(resolveManagedPath(file));
}

export function managedPathExists(file: string): boolean {
  return existsSync(resolveManagedPath(file));
}

export function resolveManagedPath(file: string): string {
  if (file === '~') return homedir();
  if (file.startsWith('~/')) return resolve(homedir(), file.slice(2));
  return resolve(WORKSPACE_ROOT, file);
}

export function hasManagedBlock(file: string, blockName: string): boolean {
  const path = resolveManagedPath(file);
  if (!existsSync(path)) return false;
  const text = readFileSync(path, 'utf-8');
  return hasManagedBlockContent(text, blockName);
}
