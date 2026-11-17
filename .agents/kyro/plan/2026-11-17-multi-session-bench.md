# Multi-session bench: one feature over four clean-context sessions

Date: 2026-11-17. Model under test: Claude Haiku (`--model haiku`), headless, real HOME. Material and raw results: `~/.cache/kyro-tmp/bench9/` (not versioned).

## Design

- Fixture: a warehouse-order CLI (60 source files, 2,509 lines, 91 own tests, written conventions in `docs/`).
- One feature, four tickets (S1..S4), each run in a fresh `claude -p` with no memory of the others, in one workspace.
- 164 scoring tests (S1: 29, S2..S4: 45 each), tagged core / carry / change / convention / regression, plus 19 `pre` regression tests. Built by Sonnet 5.5, audited by running `verify.sh` independently: each reference state scores 100%, a careless S4 passes all core tests and fails 42%.
- Arms: no workflow, Kyro Work, Kyro Forge, OpenSpec 2.0.0. 13 complete runs (4 / 3 / 3 / 3), 52 sessions, $31.10 at API-equivalent prices. Four runs cut by the account usage limit were discarded and rerun.

## Results (medians per run of four sessions; S4 = the final state)

| Arm | Runs | S4 hidden tests passed (mean, range) | Cost | Turns | Wall time | Input tokens |
| --- | --- | --- | --- | --- | --- | --- |
| No workflow | 4 | 92.8% (89–96) | $1.76 | 137 | 18 min | 17.0 M |
| Kyro Work | 3 | 91.1% (91–91) | $2.60 | 243 | 23 min | 33.0 M |
| OpenSpec | 3 | 88.9% (87–91) | $2.46 | 280 | 20 min | 29.4 M |
| Kyro Forge | 3 | 85.9% (84–87) | $2.72 | 234 | 24 min | 34.0 M |

No arm reached 100%. No workflow was best on score and cheapest. Differences between the first three arms are inside the run-to-run spread with three runs per arm; Forge is lower on every run.

Where they lose points at S4 (mean failed tests per run): carry-over constraints 2.0 (none), 2.3 (Work), 3.0 (Forge), 2.0 (OpenSpec); regressions 0 everywhere. Most frequent failures, runs failing / runs:

- `backorderQty` not used when the allocation reports owed units: 3/4, 3/3, 3/3, 3/3.
- The three-shipment limit not enforced when it must be (S1 and again in `fulfil`): 3/4, 3/3, 3/3, 2/3.
- Docs still call `backordered` a status after the rename: 0/4, 2/3, 3/3, 3/3.
- Unknown customer error code in the new filter: 0/4, 0/3, 3/3, 3/3.

## What this shows

1. On this task, the workflows did not improve the outcome and added 40–55% cost, 1.7–2× the turns and about 1.7–2× the input tokens.
2. The expected benefit mechanism did not appear. Every arm, including no workflow, wrote the S1 decisions into `docs/decisions/` because S1 asks for it ("write the decisions down in the repository"). Later sessions then had the same written memory in all arms. The carry-over failures are not forgetting but not applying what is written, and the workflows' own state did not change that.
3. Forge and OpenSpec lose more on convention and docs checks. A plausible reading is that following a process consumes attention that Haiku then does not spend on the repository's own conventions; this is a hypothesis, not tested.

## Limits of this bench

- The S1 ticket asks for recording decisions. That hands the memory to every arm and removes the situation where state outside the repository's docs would matter. A bench without that sentence would be a fairer test of persistent workflow state, and a worse test of everything else.
- Three runs per arm, one task, one model, headless with self-approval at every gate. Human gates, review by a different model and multi-person handoff are not measured.
- Haiku only. A larger model may use a workflow differently.
- The scoring tests were audited for attainability, not for fairness between arms; two validation-code tests (`WH-VAL-001` for a bad `--line`, a negative `--min-age`) are arguable readings.

## Consequence

No performance or cost claim for Kyro belongs in the README on this evidence. The README keeps the Footprint section without a comparison. Kyro's argument stays the record it keeps (validated state, checkpoints, separate review), which this bench did not measure.
