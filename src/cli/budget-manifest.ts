import { readJsonFromPackage } from './fs';
import type { BudgetClassDefinition, BudgetClassId, BudgetManifest, ContextPackMode } from './types';

const REQUIRED_CLASS_IDS: BudgetClassId[] = ['brief', 'execute', 'review', 'close'];

interface PackageConfig {
  budgetClasses?: Record<string, BudgetClassDefinition>;
}

export function loadBudgetManifest(): BudgetManifest {
  const config = readJsonFromPackage<PackageConfig>('config.json');
  const classes = config.budgetClasses;
  if (!classes) {
    throw new Error('config.json is missing budgetClasses');
  }

  const manifest = {} as BudgetManifest;
  for (const id of REQUIRED_CLASS_IDS) {
    const definition = classes[id];
    if (!definition) {
      throw new Error(`config.json budgetClasses.${id} is missing`);
    }
    manifest[id] = definition;
  }
  return manifest;
}

export function selectBudgetClass(packMode: ContextPackMode, nextAction: string | null): BudgetClassId {
  if (nextAction === 'close_sprint' || nextAction === 'wrap_up') return 'close';
  if (nextAction === 'review_task') return 'review';
  if (packMode === 'task' || nextAction === 'execute_task') return 'execute';
  if (nextAction === 'plan_sprint' || nextAction === 'status') return 'brief';
  return 'brief';
}

export function resolveBudgetRouting(
  packMode: ContextPackMode,
  nextAction: string | null,
): { budgetClass: BudgetClassId; reasoningTier: string; maxContextTokens: number; budgetGuidance: string } {
  const manifest = loadBudgetManifest();
  const budgetClass = selectBudgetClass(packMode, nextAction);
  const definition = manifest[budgetClass];
  return {
    budgetClass,
    reasoningTier: definition.reasoningTier,
    maxContextTokens: definition.maxContextTokens,
    budgetGuidance: definition.guidance,
  };
}