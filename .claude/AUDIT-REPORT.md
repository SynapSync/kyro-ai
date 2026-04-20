# Kyro-Workflow Audit Report
**Date:** 2026-04-20  
**Project:** kyro-workflow (v3.1.0)  
**Status:** Plugin for Claude Code

---

## Executive Summary

✅ **Build Status:** Passes (TypeScript compiles successfully)  
⚠️ **Critical Issues:** 2  
🟡 **Warnings:** 3  
✅ **Code Quality:** Good (253 LOC, well-structured)

---

## 🔴 Critical Issues

### 1. Missing Agent Registration in Plugin Manifest
**Severity:** HIGH  
**File:** `.claude-plugin/plugin.json`

**Problem:**  
The `guardian.md` agent exists and is **heavily used** throughout the workflow but is **NOT declared** in the plugin manifest.

**Evidence:**
- File exists: `agents/guardian.md` (7.0 KB)
- Declared in plugin: ❌ Only `./agents/orchestrator.md` is listed
- Used in orchestrator: ✅ Referenced 11+ times in `agents/orchestrator.md`
- Used in config: ✅ 10 guardian events defined in `config.json`

**Impact:**  
The plugin may not load the guardian agent when installed, breaking the checkpoint/validation system.

**Fix:**
```json
{
  "agents": [
    "./agents/orchestrator.md",
    "./agents/guardian.md"
  ]
}
```

---

### 2. Dead Directories Listed in Package.json
**Severity:** HIGH  
**File:** `package.json`

**Problem:**  
The `files` array includes directories that don't exist:
- `"hooks"` → **Does not exist**
- `"scripts"` → **Does not exist**

**Evidence:**
```bash
✓ agents/          exists
✓ commands/        exists
✓ skills/          exists
✗ hooks/           missing (removed in commit a53ce5f)
✗ scripts/         missing (removed in commit a53ce5f)
```

**Historical Context:**  
Commit `a53ce5f` ("refactor: replace dead hooks/scripts with guardian agent") indicates these were intentionally replaced. However, the `package.json` entries weren't cleaned up.

**Impact:**  
- `npm pack` includes empty/broken entries
- Misleads users about what's included in the package
- Breaking change if someone depends on these directories

**Fix:**
Remove from `package.json` files array:
```json
"files": [
  "dist",
  // "hooks",     ← DELETE THIS
  // "scripts",   ← DELETE THIS
  "commands",
  "agents",
  "skills",
  ...
]
```

---

## 🟡 Warnings

### 3. Orphaned npm Script
**Severity:** MEDIUM  
**File:** `package.json` (line 13)

**Problem:**
```json
"check-sync": "node scripts/check-sync.js"
```

This npm script references a non-existent file. Since `scripts/` directory was removed, this script is broken.

**Impact:**
- Running `npm run check-sync` will fail with "file not found"
- Creates confusion about what verification tools are available

**Options:**
1. Delete the script entirely (if no longer needed)
2. Recreate the file if it's needed
3. Replace with an existing validation (e.g., checking version sync)

---

### 4. Empty `assets/` Directory at Root
**Severity:** LOW  
**File:** `assets/`

**Problem:**
- Directory exists but is completely empty
- Not referenced anywhere in code or documentation
- Different from `skills/sprint-forge/assets/` (which is properly populated)

**Impact:**
- Clutters the project structure
- Confuses new contributors about file organization

**Recommendation:**
Delete if unused, or clarify its purpose.

---

### 5. Version Synchronization (Partial)
**Severity:** LOW  
**Files:** `package.json`, `plugin.json`, `WORKFLOW.yaml`

**Status:** ✅ Mostly in sync (all show v3.1.0)

**Observation:**  
`marketplace.json` doesn't have a version field (which is fine), but if you add one in the future, remember to keep all four files synchronized.

---

## ✅ What's Working Well

### Strengths:
1. **Clean source code** (253 LOC, strict TypeScript)
2. **Well-documented** (2,800+ lines of guides and references)
3. **Proper build pipeline** (TypeScript → CommonJS with schema.sql copy)
4. **Comprehensive configuration** (10 guardian events, model preferences, quality gates)
5. **Good asset organization** (9 helpers, 3 modes, 4 templates under sprint-forge)
6. **Strong documentation coverage:**
   - Architecture guide
   - Commands reference
   - Context management guide
   - Model selection guide
   - Rules guide
   - Agent reference

### File Inclusion Verification:
✅ All referenced files exist:
- `src/db/schema.sql` → copied to `dist/db/schema.sql` in postbuild
- All context files (init.md, review.md, sprint.md)
- All command files (forge.md, status.md, wrap-up.md)
- All skill assets (helpers, modes, templates)

---

## 🔧 Recommended Action Plan

### Priority 1 (Do immediately):
1. Add `guardian.md` to `.claude-plugin/plugin.json` agents list
2. Remove `"hooks"` and `"scripts"` from `package.json` files array
3. Remove orphaned `"check-sync"` npm script from `package.json`

### Priority 2 (Check):
1. Delete empty `assets/` directory or document its purpose
2. Run `npm pack` and verify the tarball contents

### Priority 3 (Optional):
1. Add a `.npmignore` file if you want to be explicit about what's packaged
2. Consider adding a version verification script (e.g., `validate-versions.js`) if cross-file sync is important

---

## Build Verification

```bash
npm run build  ✅ Passes
npm run clean  ✅ Works
npm install    ✅ Dependencies resolve
```

---

## File Count Summary

| Category | Count | Status |
|----------|-------|--------|
| TypeScript sources | 4 | ✅ All referenced |
| Commands | 3 | ✅ All declared |
| Agents | 2 | ⚠️ 1 missing from plugin |
| Skills | 1 | ✅ Properly structured |
| Documentation files | 8 | ✅ All present |
| Config files | 5 | ✅ Synchronized |
| Dead files | 2 | 🔴 Still in package.json |
| Empty directories | 1 | 🟡 Needs cleanup |

---

## Conclusion

The plugin is **functionally sound** but has **packaging issues** that should be fixed before release:

1. **Guardian agent not registered** — This is the most critical issue
2. **Dead directories in manifest** — Creates false expectations
3. **Broken npm script** — Low impact but confusing

**Estimated Fix Time:** 15 minutes for all three Priority 1 items.
