---
description: Generate and optionally execute the next sprint
argument-hint: [generate|execute|generate and execute]
---

# /kyro-workflow:sprint — Sprint Generation & Execution

Generate the next sprint from the roadmap, previous sprint retro, and accumulated debt. Optionally execute it immediately.

## Action: $ARGUMENTS

### Generate Workflow

1. **Locate output directory** — resolve `{output_kyro_dir}` from re-entry prompts, explicit path, or auto-discovery
2. **Determine sprint number** — scan existing sprint files
3. **Gather inputs** — roadmap section, previous sprint retro/recommendations, finding files
4. **Build disposition table** — every recommendation from Sprint N-1 must be addressed
5. **Build phases** — from roadmap suggestions + recommendations + debt items
6. **Write sprint file** — using the sprint template with YAML frontmatter

### Execute Workflow

If "execute" is specified:

1. Read sprint file and set execution metadata
2. Execute task by task with checkpoint persistence per phase
3. Run **reviewer** checklist after each task
4. Handle emergent work (add phases as needed)
5. Close sprint:
   - Consolidate findings
   - Fill retrospective
   - Update debt table
   - Update frontmatter
6. Update re-entry prompts
7. Update roadmap if execution revealed changes

### Quick Reference

```
/kyro-workflow:sprint generate          → Generate Sprint N without executing
/kyro-workflow:sprint execute           → Execute the current (already generated) sprint
/kyro-workflow:sprint generate and execute → Generate Sprint N and execute immediately
/kyro-workflow:sprint                   → Same as "generate and execute"
```
