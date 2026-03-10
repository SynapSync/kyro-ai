---
description: Analyze sprint tasks for parallel execution via git worktrees
argument-hint: [sprint number]
---

# /kyro-workflow:parallel — Parallel Sprint Execution

Analyze the current sprint's tasks for dependencies, group independent tasks into parallel lanes, and set up git worktrees for concurrent execution by multiple agents or sessions.

## Execution

> **IMPORTANT**: Before analyzing tasks, read the current sprint file from
> `.agents/kyro/{project}/` to understand task definitions and dependencies.
> No agent spawn required — this command operates directly on sprint data.

## Sprint: $ARGUMENTS

### Step 1: Dependency Analysis

Read the current sprint file and analyze task dependencies:

1. For each task, identify:
   - **Input files**: Files the task reads
   - **Output files**: Files the task creates or modifies
   - **Blocking dependencies**: Tasks that must complete before this one can start
2. Build a dependency graph:
   ```
   T1.1 → T1.2 → T1.3    (sequential — same files)
   T2.1 ──────────────     (independent — different files)
   T3.1 → T3.2            (sequential — T3.2 reads T3.1 output)
   ```

### Step 2: Task Grouping

Group tasks into parallel lanes based on the dependency graph:

| Lane | Tasks | Files Touched | Dependencies |
|------|-------|---------------|-------------|
| A | T1.1, T1.2, T1.3 | `src/auth/*` | Sequential within lane |
| B | T2.1 | `src/api/*` | Independent |
| C | T3.1, T3.2 | `commands/*` | Sequential within lane |

**Rules**:
- Tasks modifying the same files must be in the same lane
- Tasks with explicit dependencies must be in the same lane (in order)
- Maximize the number of lanes (more parallelism)
- Balance work across lanes when possible

### Step 3: Worktree Setup

For each parallel lane, create a git worktree:

```bash
# From the main repository
git worktree add ../{project}-lane-A -b sprint-N-lane-A
git worktree add ../{project}-lane-B -b sprint-N-lane-B
git worktree add ../{project}-lane-C -b sprint-N-lane-C
```

**Worktree conventions**:
- Branch naming: `sprint-{N}-lane-{letter}`
- Directory: sibling to main repo (`../{project}-lane-{X}`)
- Each lane gets its own Claude Code session

### Step 4: Execution Plan

Generate a plan for each lane:

```
Lane A (agent/session 1):
  1. Execute T1.1 in worktree lane-A
  2. Execute T1.2 in worktree lane-A
  3. Execute T1.3 in worktree lane-A
  4. Commit and push lane-A branch

Lane B (agent/session 2):
  1. Execute T2.1 in worktree lane-B
  2. Commit and push lane-B branch

Merge sequence (after all lanes complete):
  1. Merge lane-A → main
  2. Merge lane-B → main (resolve conflicts if any)
  3. Merge lane-C → main (resolve conflicts if any)
  4. Run full build + tests on merged result
```

### Step 5: Agent Assignment

Suggest which agent type handles each lane:
- **explorer agent**: Read-only analysis lanes (no code changes)
- **orchestrator agent**: Lanes with code changes and quality gates
- **reviewer agent**: Cross-lane validation after merge

Reference `config.json` parallel settings:
```json
{
  "parallel_sessions": {
    "suggest_worktrees": true,
    "native_worktree": true
  }
}
```

### Step 6: Cross-Lane Validation

After all lanes merge:
1. Run `npm run build` on the merged result
2. Run the full test suite
3. Use the **reviewer agent** to check for cross-lane conflicts:
   - Duplicate imports or definitions
   - Inconsistent naming conventions
   - Broken cross-references
4. Update the sprint file with results from all lanes

### Output

```
Parallel Execution Plan — Sprint {N}
═════════════════════════════════════

Tasks analyzed: {total}
Lanes identified: {count}
Max parallelism: {count} concurrent sessions
Estimated speedup: ~{X}x vs sequential

Lane A: {task list} → worktree lane-A
Lane B: {task list} → worktree lane-B
...

Setup commands:
  git worktree add ...
  git worktree add ...

Ready to execute? Each lane needs its own Claude Code session.
```
