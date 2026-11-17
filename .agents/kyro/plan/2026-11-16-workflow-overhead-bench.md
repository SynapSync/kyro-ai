# Workflow overhead bench: Kyro Work, Kyro Forge, OpenSpec and no workflow

- **Date:** 2026-11-16
- **Roadmap:** phase 8 of `.agents/kyro/plan/2026-11-16-performance-packaging-roadmap.md`
- **Agent:** Claude Code headless (`claude -p`), model Haiku 5.5, one run per fresh copy of the project
- **Versions:** Kyro 6.5.0 (installed global runtime), OpenSpec 2.0.0
- **Tooling:** `~/.cache/kyro-tmp/bench8/` (`run.sh`, `summary.cjs`, `fixture/`, `tickets/`, `hidden/`, `results/`)

## What was measured

One small Node project (`stockroom`, 7 source files, no dependencies) and three tickets:

| Ticket | Kind | Hidden tests |
|---|---|---|
| T1 | Bug fix: negative stock, price rounding, invalid delta | 12 |
| T2 | Feature: `low-stock` report with flags and JSON output | 16 |
| T3 | Cross-cutting: item categories, file format v1 to v2, new command | 18 |

Four arms, three repetitions each, 36 runs. Every arm got the same ticket text and the same closing
note (no human available; approve gates yourself). Each run was scored with tests the agent never
saw. The untouched project passes 3 of 12, 2 of 16 and 4 of 18.

- **none:** "Implement the following ticket."
- **work:** `/kyro-work`, carried to a closed Work.
- **forge:** `/kyro-forge`, one sprint planned, executed, reviewed and closed.
- **openspec:** `openspec-propose`, then `openspec-apply-change`, then `openspec-archive-change`.

## Results

| Arm | Runs fully passing | Hidden tests passed | Median cost | Median turns | Median wall time | Median output tokens |
|---|---|---|---|---|---|---|
| No workflow | 9 of 9 | 100 % | $0.015 | 8 | 32 s | 5,918 |
| Kyro Work | 9 of 9 | 100 % | $0.063 | 26 | 110 s | 19,235 |
| Kyro Forge | 9 of 9 | 100 % | $0.085 | 27 | 106 s | 21,346 |
| OpenSpec | 8 of 9 | 89.9 % | $0.114 | 41 | 109 s | 20,481 |

Median cost per ticket:

| Ticket | No workflow | Kyro Work | Kyro Forge | OpenSpec |
|---|---|---|---|---|
| T1 | $0.014 | $0.080 | $0.073 | $0.114 |
| T2 | $0.014 | $0.037 | $0.052 | $0.067 |
| T3 | $0.019 | $0.068 | $0.125 | $0.154 |

Total spend for the 36 runs: $2.45.

Workflow compliance: all 9 Work runs ended with the Work `closed` and outcome `completed`; all 9
Forge runs ended with one ledger entry, one close checkpoint and no active sprint; 8 of 9 OpenSpec
runs archived their change.

## What the numbers say

1. **Quality did not differ.** Haiku solved all three tickets without a workflow, every time. The
   tickets are too easy to show a quality effect: this bench hit its ceiling. It measures overhead,
   not benefit.
2. **Overhead on small tickets.** Against no workflow, Kyro Work costs about 4 times as much and
   takes about 3.4 times as long; Kyro Forge about 5.7 times the cost; OpenSpec about 7.6 times.
   In absolute terms with Haiku that is 5 to 10 cents and about 75 seconds per ticket.
3. **Kyro against OpenSpec.** Kyro Work was 45 % cheaper than OpenSpec and Kyro Forge 25 % cheaper,
   with fewer turns (26 and 27 against 41) and the same wall time.
4. **Work is already the short path.** Work was cheaper than Forge on T2 and T3 (the T3 median is
   $0.068 against $0.125) and about the same on T1.
5. **The one failure was a headless-mode effect.** `openspec-T2-r3` stopped after the proposal
   because the propose skill says an apply instruction does not carry forward. With a human present
   it would have continued. It is not evidence about OpenSpec's output quality.

## Limits

- Three repetitions per cell. Costs within one cell vary by a factor of up to 3 (for example Work on
  T1: $0.042 to $0.114). Treat the ratios as rough.
- One model, one small project, tickets with complete acceptance criteria. Real tickets are vaguer
  and real codebases larger; that is where a workflow is supposed to pay off, and this bench does not
  test it.
- Gates were self-approved by the agent. In real use a person approves them, which adds time and is
  the point of the gate.
- Cost comes from the `total_cost_usd` field reported by Claude Code and includes the roughly 49,000
  tokens of host context every run loads.
- The Kyro runs used the installed 6.5.0 runtime, not the working tree of this repository.

## Decision

Recommendation by the orchestrator; the owner decides.

- **Do not build a new short path now.** Kyro Work already fills that role and its overhead on these
  tickets is a few cents and about a minute. Nothing here shows a need for a third, lighter path.
- **Say so in the docs:** for a fix with complete acceptance criteria that touches a few files, a
  workflow added cost and no measured quality in this bench. Recommend Work for small scoped changes
  and Forge when the work needs a plan, a review record and a reproducible close.
- **Next measurement, if wanted:** a harder set (a larger brownfield codebase, tickets with missing
  or conflicting requirements, work that spans several sessions) with at least 10 repetitions per
  cell, so that quality can differ between arms.
