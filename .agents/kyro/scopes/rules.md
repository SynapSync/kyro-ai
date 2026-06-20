# Learned Rules — 00-p0-reproducibility-and-ci

> Persistent rules discovered while executing sprints in this scope.

## Generated Runtime

1. **Always rebuild `dist/` from `src/` before claiming runtime parity.** The generated runtime can lag behind source for multiple modules (options, commands, adapters, drift, injectors, pipeline) even when core checks still pass.
2. **Verify generated CLI behavior with direct commands, not just build exit code.** After `npm run build`, run `node dist/cli.js doctor --adapters`, `node dist/cli.js detect`, and `npm run check:adapters` to prove adapter support is present in the runtime.
3. **`dist/` is `.gitignore`d.** Do not rely on `git diff --stat dist` for review evidence; use file listings, module counts, and command outputs instead.

## Checks and CI

4. **`npm run check:tokens` may report pre-existing adapter-block warnings** for agents not installed in the current workspace (e.g., Codex). Classify these as pre-existing and non-blocking unless the current sprint installs that adapter.
5. **Package checks (`npm run check`, `npm run check:tokens`, `npm pack --dry-run`) must pass or have documented pre-existing warnings before a sprint closes.**

## Documentation

9. **Keep release docs and checklists in sync with actual scripts.** When `package.json`, CI, or validation commands change, update `docs/release-checklist.md`, `docs/cli.md`, and release notes so maintainers see the current gate ordering.
10. **Run `npm run check:links` after any documentation change that adds or moves links.** A relative path that looks correct from one file may be wrong from another file's perspective.
11. **Reference real commands in documentation, not prose approximations.** Copy the exact `package.json` script names and CI ordering into checklists and release notes.

## Sprint Closure

6. **Close a sprint by setting `state.json` to `activeSprint: null` and `nextAction: plan_sprint`**; never jump to the next sprint before it is generated.
7. **Refresh all summaries (`state.json`, `index.json`, sprint summary, roadmap summary, debt summary, re-entry prompts) at close.** Markdown is the durable evidence; summaries are the routing cache.
8. **Update `index.json`'s `nextTask` to be a verbatim substring of the active sprint Markdown.** The artifact doctor validates this consistency, including backticks and bold formatting.
9. **When closing the final sprint in a roadmap, set the scope `status` to `completed` and `nextAction` to `wrap_up`.** Mark the roadmap summary and re-entry prompts as completed as well.
