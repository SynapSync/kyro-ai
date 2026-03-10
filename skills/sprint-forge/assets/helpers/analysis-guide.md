# Analysis Guide

This helper guides the agent through deep analysis for different types of work. The analysis phase is the foundation of the entire sprint workflow — thoroughness here determines the quality of everything that follows.

---

## Core Principle

> **The analysis dictates the structure, not the reverse.**
>
> Do NOT start with a fixed list of categories. Explore the project first, then let the findings define the categories. If the project has 3 problem areas, there are 3 finding files. If it has 15, there are 15.

---

## Step 1 — Detect Work Type

Before analyzing, identify what kind of work this is:

| Work Type | Signals | Focus |
|-----------|---------|-------|
| **Audit / Refactor** | "analyze", "audit", "refactor", "review" | Comprehensive codebase exploration |
| **New Feature** | "add", "implement", "create feature" | Current state + gap analysis |
| **Bugfix** | "fix", "broken", "error", "regression" | Root cause analysis |
| **New Project** | "start from scratch", "new project", "build" | Scope definition + planning |
| **Tech Debt** | "clean up", "deprecated", "missing tests" | Debt inventory + prioritization |

---

## Step 2 — Analysis by Work Type

### Audit / Refactor

This is the most comprehensive analysis type. Explore the **entire** codebase systematically.

**Exploration Strategy**:
1. Start with the project root: directory structure, configuration files, entry points
2. Read key architectural files: main entry, routing, state management, data layer
3. Explore each major directory/module
4. Check test coverage and quality
5. Review dependencies and their versions
6. Look for patterns and anti-patterns

**What to look for** (examples — the actual areas emerge from the project):
- Architecture: layer separation, dependency direction, coupling
- API surface: public interfaces, consistency, documentation
- Component quality: reuse, composition, prop drilling, state management
- Type safety: any usage, missing types, type assertions
- Error handling: consistency, coverage, user-facing messages
- Testing: coverage, quality, missing tests, test patterns
- Documentation: inline docs, README, API docs
- Dependencies: outdated, unused, security vulnerabilities
- Performance: obvious bottlenecks, unnecessary re-renders, heavy computations
- Accessibility: semantic HTML, ARIA, keyboard navigation

**DO NOT** use this list as a checklist. Let the project tell you what matters.

### New Feature

Focus on understanding what exists and what needs to change.

**Exploration Strategy**:
1. Understand the current architecture relevant to the feature
2. Identify where the feature will integrate
3. Map existing patterns the feature should follow
4. Identify gaps between current state and requirements

**What to document**:
- Current state of related functionality
- Integration points (APIs, components, data flows)
- Patterns to follow (existing conventions)
- Requirements and acceptance criteria
- Technical risks and unknowns

### Bugfix

Focus on reproducing, understanding, and scoping the fix.

**Exploration Strategy**:
1. Reproduce the bug (or understand the reproduction steps)
2. Trace the code path involved
3. Identify the root cause
4. Assess blast radius (what else could be affected)

**What to document**:
- Bug description and reproduction steps
- Root cause analysis
- Affected code paths and files
- Related code that may have the same pattern (similar bugs)
- Proposed fix approach
- Testing strategy

### New Project

Focus on defining what will be built and how.

**Exploration Strategy**:
1. Understand the requirements / product idea
2. Research comparable projects or solutions
3. Define the technical stack
4. Plan the project structure

**What to document**:
- Project scope and boundaries
- Technical stack decisions (with justification)
- Proposed architecture
- Key design decisions
- Risks and unknowns
- Initial structure / scaffolding plan

### Tech Debt

Focus on inventorying and prioritizing existing debt.

**Exploration Strategy**:
1. Scan the codebase for debt indicators
2. Categorize debt by type and location
3. Assess impact of each debt item
4. Prioritize by impact vs effort

**What to document**:
- Debt inventory (categorized)
- Impact assessment per item
- Dependency relationships (which debt blocks other work)
- Prioritized resolution order
- Quick wins vs long-term refactors

---

## Step 3 — Document Findings

Each finding becomes a separate file. This is important for:
- **Granularity**: Each area can be addressed independently
- **Sprint mapping**: Each finding maps to one or more sprints
- **Progress tracking**: As sprints complete, findings are resolved

### Finding File Format

**Filename**: `NN-descriptive-slug.md` (e.g., `01-architecture-layers.md`, `02-api-inconsistencies.md`)

**Content**:

```
---
title: "Finding: {Title}"
date: "{date}"
updated: "{date}"
project: "{project_name}"
type: "analysis"
status: "active"
version: "1.0"
severity: "{critical | high | medium | low}"
agents:
  - "{agent_model}"
tags:
  - "{project_name}"
  - "analysis"
  - "finding"
changelog:
  - version: "1.0"
    date: "{date}"
    changes: ["Finding documented"]
related:
  - "[[ROADMAP]]"
---

# Finding: {Title}

## Summary

{2-3 sentence summary of the finding}

## Severity / Impact

{critical | high | medium | low} — {Why this level}

## Details

{Detailed description of the finding. Include specific examples from the code.}

## Affected Files

- `path/to/file1.dart`
- `path/to/file2.dart`

## Recommendations

1. {Specific, actionable recommendation}
2. {Another recommendation}
```

### Numbering

- Use sequential numbering: `01-`, `02-`, `03-`, ...
- The number determines the default sprint order (finding 01 → Sprint 1)
- This is a suggestion, not a rule — the roadmap may reorder based on dependencies

---

## Step 4 — Determine Sprint Count

The number of sprints emerges from the number of distinct finding areas:

- **Small project / bugfix**: 1-3 findings → 1-3 sprints
- **Medium refactor**: 5-8 findings → 5-8 sprints
- **Major audit**: 10-20 findings → 10-20 sprints

Some findings may be grouped into a single sprint if they are small and related. Some large findings may be split across multiple sprints. The roadmap makes these decisions.
