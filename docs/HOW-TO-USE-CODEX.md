# Using Kyro Skills in Codex

This guide explains how to use kyro-workflow skills and agents in Codex (GitHub's AI assistant for code).

## Overview

Codex does not have a plugin system like Claude Code. Instead, you can use kyro-workflow skills by including them directly in your project and referencing them in your prompts.

---

## Quick Start

### 1. Copy Skills to Your Project

```bash
# Copy sprint-forge skill
cp -r kyro-workflow/skills/sprint-forge ./your-project/.skills/

# Copy qa-review skill
cp -r kyro-workflow/skills/qa-review ./your-project/.skills/
```

### 2. Copy Agents (Optional)

```bash
# Copy orchestrator and guardian agents
cp kyro-workflow/agents/*.md ./your-project/.agents/
```

### 3. Reference in Your Prompt

When asking Codex to help with code review or sprint planning, include a reference:

```
@skill qa-review
@skill sprint-forge

Please review this PR following the senior auditor skill guidelines.
```

Or manually include the skill:

```
Here's the QA Review Senior Auditor skill to follow:

[Include content of skills/qa-review/SKILL.md]

Now review these changes...
```

---

## Using Individual Skills

### qa-review Skill

**When to use:** Code review, architecture validation, security audit, sprint planning verification

**How to invoke:**

1. Copy `skills/qa-review/SKILL.md` content
2. Include in your Codex prompt:

```
You are a Senior QA Engineer following these guidelines:

[SKILL.md content here]

Please review this code change and provide feedback.
```

### sprint-forge Skill

**When to use:** Sprint planning, roadmap generation, task breakdown, progress tracking

**How to invoke:**

1. Copy `skills/sprint-forge/SKILL.md` content
2. Provide sprint context and task description
3. Let Codex generate your sprint document

---

## Working with kyro-workflow Artifacts

If you're using kyro-workflow's sprint system (`{cwd}/.agents/sprint-forge/{scope}/`), you can reference the artifacts:

```
I'm working on sprint-3 from .agents/sprint-forge/oauth-implementation/

Here are the current re-entry prompts:
[Include REENTRY-PROMPTS.md content]

Here are the findings so far:
[Include previous sprint's findings]

Based on this context, here's what needs review:
[Your code changes]
```

---

## Best Practices

1. **Copy the skill once, reference many times** — Keep a copy in `.skills/` and reference it in your workflow
2. **Include context** — Always provide sprint context, re-entry prompts, and previous decisions when available
3. **Use the severity classification** — When using qa-review, explicitly ask for CRITICAL/MAJOR/MINOR classification
4. **Verify the format** — qa-review provides a structured output format; ask Codex to follow it
5. **Keep artifacts in sync** — If using with kyro-workflow sprints, ensure Codex updates the sprint files after each review

---

## Example Workflow

**Setup:**
```bash
mkdir -p .skills .agents
cp -r kyro-workflow/skills/qa-review .skills/
cp -r kyro-workflow/skills/sprint-forge .skills/
cp kyro-workflow/agents/guardian.md .agents/
```

**Usage in Codex:**
```
I'm doing code review for my project. Here are the guidelines I follow:

@file .skills/qa-review/SKILL.md

Review this PR:
- Files changed: src/auth/login.ts, src/types/user.ts
- Description: Add OAuth2 support
- Context: Part of sprint-3

Provide your review following the APPROVED/CHANGES REQUIRED/REJECTED format.
```

---

## Limitations

- Codex doesn't automatically update sprint artifacts — you'll need to manage that manually
- No integration with kyro-workflow's persistent learning system (`.agents/sprint-forge/rules.md`)
- No automatic vault sync if you use Obsidian

To get the full kyro-workflow experience, consider using **Claude Code** (which has full plugin support).

---

## Need Help?

- **For skill documentation:** See `skills/qa-review/SKILL.md` and `skills/sprint-forge/SKILL.md`
- **For agent documentation:** See `agents/orchestrator.md` and `agents/guardian.md`
- **For architecture:** See main `README.md` and `CLAUDE.md`
