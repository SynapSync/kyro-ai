# Classification and Synthesis Helper

## Lane detection

This is the single canonical lane classifier. Count substantive dimensions among problem, audience, observable success, boundaries, decisions, and evidence.

1. If the input is solution detail only and lacks a causal problem and beneficiary, return `rough` regardless of length.
2. Otherwise, return `mature` when at least one readable reference is supplied or at least three dimensions are substantive.
3. Otherwise return `rough`.

Do not treat an unreadable reference as readable. User correction overrides the computed lane and must be recorded as an explicit decision.

## Evidence ledger

| Class | Required capture |
| --- | --- |
| evidence | claim, source, confidence |
| outcome | beneficiary, observable change, proof |
| invariant | rule, prevented failure |
| decision | choice, rationale, tradeoff, consequence |
| constraint | boundary, source, delivery effect |
| hypothesis | belief, validation needed |
| unknown | missing fact, decision impact |

Preserve user-supplied facts verbatim in meaning. Resolve duplicate claims into one stronger statement. Mark conflicting claims; do not average them or silently select one.

## Synthesis chain

For each important fact derive its implication, governing invariant, observable outcome, likely failure mode, and resulting decision. Reject statements that merely rephrase the source. Prefer causal language: because, therefore, unless, and proven by.

Build the execution blueprint only after the ledger is coherent. Order work by dependency and uncertainty reduction. Use behavior-level deliverables unless repository evidence proves exact interfaces or paths.
