import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { DiscoveredEvalCase } from './discovery';

export interface EvalSandbox {
  root: string;
  home: string;
  cleanup(): void;
}

export function createEvalSandbox(item: DiscoveredEvalCase, keep: boolean): EvalSandbox {
  const root = mkdtempSync(join(tmpdir(), `kyro-eval-${item.case.id}-`));
  const home = join(root, '.home');
  mkdirSync(home, { recursive: true });
  const stateDir = join(item.dir, 'state');
  if (existsSync(stateDir)) cpSync(stateDir, root, { recursive: true });
  return {
    root,
    home,
    cleanup() {
      if (!keep) rmSync(root, { recursive: true, force: true });
    },
  };
}
