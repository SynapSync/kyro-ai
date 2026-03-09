---
description: Detect and remove AI-generated slop — unnecessary comments, over-engineering, defensive code
argument-hint: <file path | directory | "changed">
---

# /deslop — AI Slop Removal

Scan target files for AI-generated boilerplate and propose removals. Uses the `deslop` skill for detection and categorization.

## Target: $ARGUMENTS

### Step 1: Identify Target Files

Resolve the scan target:
- **File path**: Scan the specified file
- **Directory**: Recursively scan all source files in the directory
- **"changed"**: Scan files modified in the current branch (`git diff --name-only main`)
- **No argument**: Scan files modified in the working tree (`git diff --name-only`)

Filter to source files only (`.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.go`, `.rs`, etc.). Skip generated files, `node_modules`, `dist/`, lock files.

### Step 2: Scan with Deslop Skill

For each target file, invoke the deslop skill to detect:
1. Unnecessary comments (explain *what* not *why*)
2. Over-engineered abstractions (single-use wrappers, premature generalization)
3. Defensive code for impossible conditions (type guards on typed params)
4. Premature generalization (unused config, feature flags for nonexistent features)
5. Verbose error handling (catch-log-rethrow)
6. Redundant type annotations (TypeScript inference handles it)
7. Wrapper functions that add no value (pure passthrough)

Rate each finding: **HIGH** (obvious), **MEDIUM** (likely), **LOW** (borderline).

### Step 3: Present Report

Display findings grouped by category:

```
Deslop Report — {target}
═══════════════════════

[1] Unnecessary Comments (N found)
    HIGH  file:line — "the comment text"

[2] Over-Engineered Abstractions (N found)
    ...

Total: N items (H high, M medium, L low)
Estimated line reduction: ~N lines
```

### Step 4: Apply Removals

For each category with findings:
1. Show proposed changes (diff preview)
2. Ask: "Apply these removals? (yes / no / select individually)"
3. Apply approved changes
4. Skip declined items

### Step 5: Summary

```
Deslop Complete
───────────────
Files scanned:  N
Items found:    N
Items removed:  N
Lines before:   N
Lines after:    N
Net reduction:  -N lines (X%)
```

### Learning Capture

If patterns repeat across files, suggest a `[LEARN]` rule:
```
[LEARN] code-style: Always use TypeScript inference for simple assignments — don't annotate obvious types
```
