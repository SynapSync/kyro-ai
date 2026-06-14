import type { Agent, CheckResult, InstallScope, KyroInstalledAdapter, KyroManifest, OperationPlan } from '../types';

export type AdapterStatus = 'implemented' | 'planned';

export interface AdapterDefinition {
  agent: Agent;
  displayName: string;
  status: AdapterStatus;
  buildProjection(plan: OperationPlan[]): void;
  buildManagedFiles(): string[];
  buildManagedBlocks(): string[];
  buildInstalledAdapter(scope: InstallScope, installedAt: string): KyroInstalledAdapter;
  doctor(manifest: KyroManifest | null): CheckResult;
}
