---
description: Run the sprint retrospective ritual
argument-hint: [sprint number]
---

# /kyro-workflow:retro — Sprint Retrospective Ritual

Formal retrospective that captures learnings, proposes rules, and feeds forward into the next sprint.

## Execution

> **IMPORTANT**: Spawn the `orchestrator` agent to run the retrospective.
> Do not execute the ritual directly — the orchestrator loads the sprint-forge
> skill and kyro-learner skill to ensure proper rule capture and debt tracking.

## Sprint: $ARGUMENTS

### Ritual Steps

#### 1. Gather Data

Automatically collect:
- Tasks completed vs. planned
- Tasks blocked or skipped (with reasons)
- Emergent phases added during execution
- Time estimates vs. actual (if tracked)
- Quality gate results per task

#### 2. What Went Well

Identify patterns that worked:
- Effective approaches
- Good estimation accuracy
- Smooth task execution
- Helpful learned rules that prevented mistakes

#### 3. What Didn't Go Well

Identify pain points:
- Underestimated tasks
- Blocked work
- Repeated corrections from the user
- Quality gate failures
- Missing context that caused rework

#### 4. Surprises

Document unexpected discoveries:
- Hidden dependencies
- Undocumented behaviors
- Performance characteristics
- Security concerns found during implementation

#### 5. New Technical Debt Detected

Items discovered during execution that need tracking:
- Workarounds introduced
- Incomplete implementations
- TODOs left in code
- Known shortcuts taken under time pressure

#### 6. Recommendations for Sprint N+1

Numbered recommendations that MUST be addressed in the next sprint's disposition table:
- Tasks to carry over
- Approaches to adjust
- New areas to investigate
- Estimation adjustments

#### 7. Rule Proposals

Based on corrections and learnings:

```text
Proposed rules for .agents/sprint-forge/rules.md:

[RULE-XXX] Category: One-line rule
  Context: Why this rule exists (from this sprint's experience)
  Confirm? (yes/no)
```

#### 8. LEARNED Section

Formal capture of learnings:

```markdown
## LEARNED (Sprint N)
- [RULE-007] Always validate version compatibility before adding dependencies
- [RULE-008] Auth tasks usually reveal hidden dependencies — add 20% buffer
```

### Output

Write the retro directly into the sprint file's Retro section, then:
1. Update re-entry prompts
2. Update roadmap if recommendations affect future sprints
3. Save confirmed rules to `.agents/sprint-forge/rules.md`
