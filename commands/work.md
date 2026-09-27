---
description: Run an explicitly selected Kyro Work through its CLI-owned task lifecycle
argument-hint: [work id or brief path]
---

# /kyro:work — Router

Work is an explicit alternative workflow, not a heuristic for small or easy plans. Enter this router only when the user invokes Work. Do not redirect `/kyro:forge`, `/kyro:idea`, `/kyro:qa`, status, or installation requests here.

## Startup

1. Read `skills/organic-work/SKILL.md`. Check `{{KYRO_CLI}} --version` and `{{KYRO_CLI}} capabilities --json`; stop if `work` is unavailable. Do not hand-write `work.json`.
2. If the user provided a Work ID, run `{{KYRO_CLI}} work status --work <id> --json` and `{{KYRO_CLI}} work context-pack --work <id> --json` before taking any action. A fresh context pack, not prior chat context, supplies the revision, task, blockers, and next CLI recipe.
3. If the user explicitly requests a new Work from a brief or Idea, inspect that input and preview `{{KYRO_CLI}} work create --id <slug> --from <path> --dry-run --json`. Apply only when the user has authorized creation. No plan-size or difficulty filter applies.
4. Follow the Work skill's task loop and the command-specific `{{KYRO_CLI}} work --help`. Keep all Work state writes in the CLI, including task plans, amendments, evidence, reviews, dispositions, closure, and promotion.
5. Promote Work to Forge only through the explicit preview-then-confirm path: preview `{{KYRO_CLI}} work promote --work <id> --to-scope <fresh-scope> --expect-revision <n> --by <actor> --dry-run --json`, inspect the deterministic task mapping and reciprocal identities, then confirm in a separate command with `--yes`. A pending promotion blocks other mutations; retry the exact command to recover.

## Boundaries

- Work task review is not independent Forge QA. A promoted Work starts every Forge task as pending with no carried approval; certification still requires the Forge workflow and its independent QA. Never close a Forge sprint or mutate `project.json`, `local.json`, or `sprint.json` as a side effect of Work, except for the explicitly promoted destination scope.
- A stale revision, brief mismatch, pending amendment, pending promotion, missing or mismatched reciprocal link, or corrupt Work is a blocker. Refresh the Work context and follow the reported remedy; do not repair managed JSON by hand.
- Do not install globally, publish a release, or promote Work to Forge without separate authorization and a supported CLI operation. An installed runtime may not yet expose `work promote`; use the workspace build (`node dist/cli.js`) until a separately authorized release updates it.
