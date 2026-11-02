# 04 — local.json preference and CLI/MCP parity

- **Severity:** medium
- **Affected:** `src/cli/types.ts` (`KyroLocalProjectState` :187), `src/cli/artifacts/schema.ts` (`validateLocalProjectStateShape` :228), `src/cli/state.ts`, `src/cli/commands/close-sprint.ts`, `src/cli/mcp/handlers.ts`
- **Behavior:** `local.json` is gitignored personal state; CLI and MCP close share `buildClosePlan`/`applySprintCloseTransaction` but have separate post-apply code.
- **Recommendation:** add optional `git: { commitOnSprintClose?: boolean }` validated "when present"; implement the post-close commit once and call it from both surfaces; return the same structured `commit` result.
- **Validation:** invalid preference shapes rejected; same close via CLI and MCP yields identical commit result.
