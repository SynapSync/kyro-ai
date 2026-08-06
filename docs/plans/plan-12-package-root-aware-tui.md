# Plan 12 — Package-root-aware TUI

> **Status:** Implemented and locally certified; remote delivery remains authorization-gated.
>
> **Branch:** `feature/projected-runtime-tui`
>
> **Release target:** `4.43.2`.

## 1. Outcome

The no-argument Kyro TUI must advertise only operations that its current CLI root can execute. The projected runtime remains the canonical operational entrypoint, but package installation and synchronization remain exclusive to the full npm package.

## 2. Verified defect

The projected invocation:

```bash
node ~/.agents/kyro/current/dist/cli.js
```

opens the same installer menu as the full package. Options 1–3 call `install()`, which correctly rejects projected roots through `requireFullPackageFor('install')`. The result is a dead-end menu that instructs the user to choose an operation the surface cannot perform.

This reproduces under the installed 4.43.1 runtime.

## 3. Behavioral contract

| CLI root mode | No-argument TUI |
| --- | --- |
| `full-package` | Show standard, OpenCode, and Codex installation options; Doctor; Exit |
| `projected-runtime` | Explain that package management requires the full npm package; show the canonical remedy; offer Doctor and Exit only |
| `unknown` | Explain that the CLI root is unrecognized or corrupt; show the canonical remedy; offer Doctor and Exit only |

The TUI must determine the mode through `detectPackageRootMode()`. It must not infer from filesystem path strings.

## 4. Safety invariants

1. Never bypass `requireFullPackageFor`.
2. Never expose package-install actions from projected or unknown roots.
3. Do not acquire the state-writer lock merely to reject an unavailable package operation.
4. Explicit projected `install` and `sync` commands continue to fail with `INVALID_INPUT` and the full-package remedy.
5. Doctor remains available from projected and unknown modes so the user can diagnose the root.

## 5. Work unit

One atomic behavior unit:

1. Add full-package and projected-runtime TUI integration regressions to `check:cli-bundle`.
2. Make `runTui()` mode-aware.
3. Document the two TUI surfaces.
4. Bump synchronized release metadata to 4.43.2.
5. Ship tests, code, docs, and version metadata together.

Recommended commit:

```text
fix(tui): hide package actions in projected runtime
```

## 6. Acceptance criteria

- [x] Full-package TUI still advertises all three adapter installation options.
- [x] Full-package TUI exits cleanly without writes when Exit is selected.
- [x] Projected-runtime TUI does not display adapter installation options.
- [x] Projected-runtime TUI displays `FULL_PACKAGE_INSTALL_REMEDY`.
- [x] Projected-runtime TUI offers Doctor and Exit.
- [x] Projected-runtime Doctor runs successfully from the TUI in a healthy workspace.
- [x] Explicit projected `install` and `sync` remain blocked.
- [x] Unknown roots do not expose package actions.
- [x] Versions and changelog are synchronized at 4.43.2.
- [x] Full repository checks, adapters, tokens, package dry-run, and clean-export artifacts pass.

## 7. Certification evidence

| Gate | Result |
| --- | --- |
| Regression before TUI fix | RED: projected option 2 invoked `install()` and failed with `INVALID_INPUT` |
| `check:cli-bundle` after fix | PASS for full-package, projected-runtime, corrupt projected, and unknown roots |
| Restricted TUI lock probe | PASS: Exit did not publish the state-writer lock readiness marker |
| Projected TUI Doctor | PASS with projected-runtime packaging mode |
| `npm run check` | PASS, including 29/29 behavioral evals |
| Adapters / tokens / package dry-run | PASS; tarball `kyro-ai-4.43.2.tgz` |
| Clean-export `check:artifacts` | PASS with expected no-project-state warnings |

The globally installed runtime remains 4.43.1. Candidate evidence uses the locally built 4.43.2
full package and its temporary projected runtime; no global synchronization was performed.

## 8. Delivery boundary

Local implementation, validation, and commit are authorized. Push, PR, npm publish, runtime synchronization, and consumer changes remain separately authorization-gated.
