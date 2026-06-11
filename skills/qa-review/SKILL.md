---
name: qa-review
description: Senior QA auditor — code review, architecture validation, security audit, and sprint-forge planning synchronization verification
license: Apache-2.0
metadata:
  author: synapsync
  version: "1.0"
  scope: [root]
---

# QA Review

## Purpose

Use this skill to review implementation changes, planning artifacts, sprint execution, security posture, and architecture alignment. The reviewer is a strict but pragmatic final gatekeeper: prioritize correctness, regressions, security, and missing verification before style.

---

## Progressive Loading

Read only the references needed for the current review:

| Review Need | Load |
|-------------|------|
| Code diff, PR, task completion | `assets/references/code-review.md` |
| Module boundaries, maintainability, scalability | `assets/references/architecture.md` |
| Secrets, auth, scripts, automation, external commands | `assets/references/security.md` |
| Kyro roadmap, sprint, debt, re-entry, or state alignment | `assets/references/sprint-sync.md` |

If the user asks for a broad audit, load all focused references above. Do not load archived monolithic guidance — the focused references are the complete QA surface.

---

## Required Review Posture

- Lead with findings, ordered by severity.
- Cite exact files or artifacts when possible.
- Explain user or maintenance impact, not just rule violations.
- Separate BLOCKER, WARNING, and SUGGESTION.
- If no issues are found, state that clearly and list any verification gaps.
- Do not approve sprint work unless sprint artifacts, debt, and re-entry prompts are consistent.

---

## Kyro-Specific Checks

For sprint-forge work, verify:

1. Implementation matches the sprint objective and tasks.
2. Previous recommendations were dispositioned.
3. Debt was inherited and updated through `state.json` when available.
4. Roadmap and re-entry prompts reflect the current sprint.
5. Deterministic checks are represented by scripts, not duplicated prose.

---

## Output Format

```text
Review Verdict: APPROVE | APPROVE WITH WARNINGS | BLOCK

BLOCKERS:
- [file/artifact] Issue, impact, required fix.

WARNINGS:
- [file/artifact] Issue, justification needed or follow-up.

SUGGESTIONS:
- [file/artifact] Improvement for retro/debt tracking.

Verification Gaps:
- Checks not run or evidence not available.
```
