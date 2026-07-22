import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { PACKAGE_ROOT } from './constants';
import { resolveBudgetRouting } from './budget-manifest';
import type { ContextPackMode, NextAction } from './types';

export interface RouteDefinition {
  modes: string[];
}

export interface ResolvedRoute extends RouteDefinition {
  budgetClass: ReturnType<typeof resolveBudgetRouting>['budgetClass'];
  reasoningTier: ReturnType<typeof resolveBudgetRouting>['reasoningTier'];
  maxContextTokens: ReturnType<typeof resolveBudgetRouting>['maxContextTokens'];
  budgetGuidance: ReturnType<typeof resolveBudgetRouting>['budgetGuidance'];
}

export const ROUTING_TABLE = {
  init: { modes: ['INIT.md'] },
  clarify: { modes: ['SPRINT.md', 'clarify.md'] },
  plan_sprint: { modes: ['SPRINT.md', 'plan-sprint.md'] },
  execute_task: { modes: ['SPRINT.md', 'execute-task.md'] },
  review_task: { modes: ['SPRINT.md', 'review-task.md'] },
  close_sprint: { modes: ['SPRINT.md', 'close-sprint.md'] },
  /** Terminal: scope complete — no work mode to load. */
  done: { modes: [] },
} as const satisfies Record<NextAction, RouteDefinition>;

export function resolveRoute(nextAction: NextAction, packMode: ContextPackMode = 'scope'): ResolvedRoute {
  return {
    ...ROUTING_TABLE[nextAction],
    ...resolveBudgetRouting(packMode, nextAction),
  };
}

export function routeModePath(mode: string): string {
  return join(PACKAGE_ROOT, 'skills/sprint-forge/assets/modes', mode);
}

export function validateRoutingTableModes(): string[] {
  const missing: string[] = [];
  for (const [nextAction, route] of Object.entries(ROUTING_TABLE)) {
    for (const mode of route.modes) {
      if (!existsSync(routeModePath(mode))) missing.push(`${nextAction}:${mode}`);
    }
  }
  return missing;
}
