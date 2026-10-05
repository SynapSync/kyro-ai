---
name: organic-work
description: Execute an explicitly chosen Kyro Work using only the CLI-owned Work lifecycle.
license: Apache-2.0
metadata:
  author: synapsync
  version: "1.0"
  scope: [root]
---

# Organic Work

Activate only for `/kyro:work` or an explicit request to use Kyro Work. Never select Work automatically by complexity, duration, or task count. Forge, Idea, QA, status, and install keep their own routes.

## Context and state

Use `{{KYRO_CLI}}` for every Work operation. On a fresh session, run `{{KYRO_CLI}} --version`, `{{KYRO_CLI}} capabilities --json`, then `{{KYRO_CLI}} work status --work <id> --json` and `{{KYRO_CLI}} work context-pack --work <id> --json`. Stop if `work` is absent. Re-read status/context-pack after every mutation or conflict. The context pack is bounded continuation context; read only the brief, task files, and references it identifies.

Never write or repair `.agents/kyro/work/<id>/work.json` by hand. Prepare proposal, evidence, and review input files only as CLI inputs; the CLI validates their exact keys and owns the persisted state. Preview mutations where supported, pass the current `--expect-revision`, and use the returned next action. Do not turn a read-only preview into an apply without authorization.

## Task loop

1. Create from an explicitly supplied brief or Idea using `work create`; preserve its intent and bytes.
2. Use `work plan` for a task graph. Use `work amend-task` or `work amend-brief` for changes; approvals invalidated by a changed definition or brief must be redone.
3. For an eligible task, `work start`; implement and validate; `work record-evidence` from the exact evidence input; then `work review` from the exact review input with a distinct checker. A pass requires every current criterion and fresh material.
4. Use `work block`/`unblock` when necessary and `work dispose` only with an explicit reason. Dependencies on disposed tasks are not silently rewired.
5. Preview `work close`; complete only an active Work with planned tasks all verified or disposed. To discard an empty or obsolete draft, use `work close --outcome stopped` with an explicit reason and confirmation; never invent tasks just to enable closure or use Forge scope retirement for Work. A stopped Work lists unresolved tasks and preserves its brief and provenance. Reopen only through `work reopen` and its preserved closure history; taskless Work returns to draft, otherwise active.

Use `{{KYRO_CLI}} work --help` and `docs/work.md` for exact flags and input shapes. A Work task review is not independent Kyro QA or Forge scope certification. Work-to-Forge promotion is an explicit, separately authorized route: preview with `work promote --dry-run`, confirm with `--yes` against the current revision, and verify the reciprocal link before treating the destination as real. Promotion transfers only unfinished tasks as pending Forge tasks with no carried approval; it never turns a Work pass into Forge QA and never switches the active scope. An interrupted promotion blocks other Work mutations until the exact command is retried. Never mutate Forge state, install globally, or release as an incidental Work action.
