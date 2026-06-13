import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { PACKAGE_ROOT, WORKSPACE_ROOT } from './constants';
import type { OperationPlan } from './types';

export function applyPlan(plan: OperationPlan[]): void {
  for (const operation of plan) {
    const target = resolve(WORKSPACE_ROOT, operation.path);
    if (operation.action === 'mkdir') {
      mkdirSync(target, { recursive: true });
    } else if (operation.action === 'write') {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, operation.content ?? '', 'utf-8');
    } else if (operation.action === 'copy') {
      if (!operation.source) throw new Error(`Copy operation missing source for ${operation.path}`);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(resolve(PACKAGE_ROOT, operation.source), target);
    } else if (operation.action === 'remove') {
      rmSync(target, { recursive: true, force: true });
    } else if (operation.action === 'upsert-block') {
      if (!operation.blockName) throw new Error(`Block operation missing blockName for ${operation.path}`);
      mkdirSync(dirname(target), { recursive: true });
      const existing = existsSync(target) ? readFileSync(target, 'utf-8') : '';
      writeFileSync(target, upsertManagedBlock(existing, operation.blockName, operation.content ?? ''), 'utf-8');
    } else if (operation.action === 'remove-block') {
      if (!operation.blockName) throw new Error(`Block operation missing blockName for ${operation.path}`);
      if (existsSync(target)) {
        const existing = readFileSync(target, 'utf-8');
        writeFileSync(target, removeManagedBlock(existing, operation.blockName), 'utf-8');
      }
    }
  }
}

export function printPlan(title: string, plan: OperationPlan[]): void {
  console.log(title);
  for (const operation of plan) {
    const source = operation.source ? ` <= ${operation.source}` : '';
    const block = operation.blockName ? ` # ${operation.blockName}` : '';
    console.log(`- ${operation.action} ${operation.path}${block}${source}`);
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
  const path = resolve(WORKSPACE_ROOT, file);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8')) as T;
}

export function readPackageText(file: string): string {
  return readFileSync(resolve(PACKAGE_ROOT, file), 'utf-8');
}

export function workspaceFileExists(file: string): boolean {
  return existsSync(resolve(WORKSPACE_ROOT, file));
}

export function hasManagedBlock(file: string, blockName: string): boolean {
  const path = resolve(WORKSPACE_ROOT, file);
  if (!existsSync(path)) return false;
  return readFileSync(path, 'utf-8').includes(startMarker(blockName)) && readFileSync(path, 'utf-8').includes(endMarker(blockName));
}

function upsertManagedBlock(existing: string, blockName: string, content: string): string {
  const block = formatManagedBlock(blockName, content);
  const pattern = managedBlockPattern(blockName);
  if (pattern.test(existing)) {
    return existing.replace(pattern, block);
  }
  const separator = existing.trim().length === 0 ? '' : '\n\n';
  return `${existing.trimEnd()}${separator}${block}\n`;
}

function removeManagedBlock(existing: string, blockName: string): string {
  return existing.replace(managedBlockPattern(blockName), '').trimEnd() + '\n';
}

function formatManagedBlock(blockName: string, content: string): string {
  return `${startMarker(blockName)}\n${content.trim()}\n${endMarker(blockName)}`;
}

function managedBlockPattern(blockName: string): RegExp {
  return new RegExp(`${escapeRegExp(startMarker(blockName))}[\\s\\S]*?${escapeRegExp(endMarker(blockName))}\\n?`, 'm');
}

function startMarker(blockName: string): string {
  return `<!-- kyro-ai:${blockName}:start -->`;
}

function endMarker(blockName: string): string {
  return `<!-- kyro-ai:${blockName}:end -->`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
