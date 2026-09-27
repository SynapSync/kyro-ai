# Organic Work Sprint 2 QA Remediation

## Scope

Resolve the two blocking findings from the Sprint 2 Kyro QA review without changing the Work v1 stored contract or installing a different global runtime. Add CLI-owned emergent tasks to the active Sprint 2, implement each correction, run focused and aggregate checks, then rerun read-only Kyro QA. Do not close the sprint as part of this plan.

## E6: Accurate Work command help

- Make `work --help` mark `--by <actor>` as required for `record-evidence` and `review`, matching runtime validation and `docs/work.md`.
- Keep `--by` optional for create, plan, start, block, and unblock.
- Add a CLI regression asserting the two required forms and the trust-boundary explanation. Unknown or missing actor behavior must remain unchanged.

## E7: Hermetic integrity-repair fixture

- Keep the production doctor capability check strict. The integrity-repair fixture must not treat an unrelated, older installed CLI as evidence that a repair transition corrupted the fixture.
- Evaluate doctor results structurally: all integrity checks must pass; any accepted nonzero doctor result may contain only the known external CLI-capability skew. Any other `FAIL`, missing integrity PASS, or unexpected exit must fail the fixture.
- Do not update the global installation, alter the fixture's repair state, or weaken the production doctor result.
- Run `check:repair-integrity`, the Work-focused checks, and the aggregate `npm run check`. Record exact results in Kyro evidence; if another aggregate failure appears, diagnose it rather than claiming the suite passed.

## QA gate

After E6 and E7 have current evidence and passing task reviews, run `kyro-qa` read-only against the active Sprint 2. An approving QA verdict permits a later, separately confirmed sprint-close decision; this plan does not close or release anything.
