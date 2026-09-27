---
title: 'organic-work — Sprint 5: Work Artifact Doctor Hardening'
date: '2026-09-27'
scope: 'organic-work'
sprint: 5
slug: 'work-artifact-doctor-hardening'
outcome: 'shipped'
type: 'sprint-archive'
---

# Sprint 5: Work Artifact Doctor Hardening

> Closed: 2026-09-27
> Outcome: shipped

## Objective

Make artifact doctor fail closed for unsafe Work roots and audit Work-only workspaces without changing Work or Forge state contracts.

## Definition of Done

- T5.1 has CLI-recorded evidence and a passing checker review.
- The new disposable fixture and aggregate checks pass without Forge-state changes.
- Independent read-only Kyro QA approves the Work-root remediation before Sprint 5 closes.

## Phases

### P1 — Fail-closed Work discovery

> Correct Work-root discovery and certify it with disposable workspaces.

#### T5.1: Audit Work roots independently of Forge scopes

**Status**: done

**Description**: Distinguish a genuinely absent Work root from an unsafe or unreadable one, include Work checks in Work-only workspaces, and add regression coverage for discovery and isolation.

**Evidence**:
- Summary: Aligned the active task context with the approved unsafe-ancestor behavior; the Work-root doctor implementation and regression suite remain unchanged and passing.
- Validation: The independent seven-configuration S31 probe passed. npm run check:work-doctor passed after the context correction. Earlier build, full npm run check, adapters, installed artifact doctor, package dry-run, and git diff --check passed on the unchanged source; analyze will be repeated after review.
- Files changed: `.agents/kyro/plan/2026-09-27-organic-work-sprint-5-context-correction.json`, `.agents/kyro/plan/2026-09-27-organic-work-sprint-5.json`, `src/cli/commands/artifact-doctor.ts`, `scripts/check-work-doctor.mjs`

**Verdict**: pass

---

## Unfinished work

_None — every task is done with a passing verdict._

## Learnings

- Optional artifact roots must distinguish genuine absence from present but unsafe or unreadable paths.
- When an upstream managed-path guard rejects an unsafe ancestor before artifact checks, active task context must describe that earlier failure consistently with acceptance criteria.

## Resolved Debt

- **debt-1**: Harden work create source ingestion to reject malformed UTF-8 and preserve original brief bytes
- **debt-2**: Add schema-valid promoted Work reopen rejection regression

## Recommendations for Sprint 6

- Review the scope-completion preview and decide whether to complete organic-work; defer commit, push, version bump, release, and global installation to separate authorization.
