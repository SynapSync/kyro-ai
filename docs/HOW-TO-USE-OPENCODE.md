# Using Kyro Skills in OpenCode

This guide explains how to use kyro-workflow skills and agents in OpenCode.

## Overview

OpenCode (formerly Replit AI) does not have a plugin system. You can use kyro-workflow skills by including them as part of your project or by copying skill content into your prompts.

---

## Quick Start

### 1. Copy Skills to Your Project

```bash
# In your OpenCode project, create a .skills directory
mkdir -p .skills

# Copy from kyro-workflow
cp -r kyro-workflow/skills/qa-review .skills/
cp -r kyro-workflow/skills/sprint-forge .skills/
```

### 2. Reference in Your Prompts

In OpenCode's AI panel, when prompting the assistant:

```
I want to use the QA Review skill to check my code.

@file .skills/qa-review/SKILL.md

Please review this implementation...
```

Or manually paste the skill content into your message.

---

## Using Individual Skills

### qa-review Skill

**Best for:** Code review, architecture validation, security checks

**Example prompt:**

```
You are a Senior QA Engineer. Follow these guidelines:

@file .skills/qa-review/SKILL.md

Now please review my changes to src/api/auth.ts and provide:
- Critical issues
- Major issues  
- Minor improvements
- Architecture alignment
- Security review

Output as: # Code Review Result
```

### sprint-forge Skill

**Best for:** Sprint planning, task breakdown, progress tracking

**Example workflow:**

1. Create `.agents/sprint-forge/{scope}/SPRINT-1.md` in your project
2. Ask OpenCode to help execute the sprint:

```
I'm using the sprint-forge skill for my project. Here's my setup:

@file .skills/sprint-forge/SKILL.md
@file .agents/sprint-forge/oauth/ROADMAP.md
@file .agents/sprint-forge/oauth/REENTRY-PROMPTS.md

Based on this context, let's start SPRINT-1. Here's what we need to do:
[Your task list]
```

---

## Project Structure

Recommended organization in OpenCode:

```
your-project/
├── .skills/
│   ├── qa-review/
│   │   ├── SKILL.md
│   │   └── manifest.json
│   └── sprint-forge/
│       ├── SKILL.md
│       └── manifest.json
├── .agents/
│   ├── sprint-forge/
│   │   ├── {scope}/
│   │   │   ├── ROADMAP.md
│   │   │   ├── SPRINT-1.md
│   │   │   └── REENTRY-PROMPTS.md
├── src/
└── package.json
```

---

## Integration with OpenCode's AI Panel

### Using with Replit AI

1. **Open the AI panel** (Cmd+Shift+A or Ctrl+Shift+A)
2. **Reference your skill:**

```
@file .skills/qa-review/SKILL.md

Perform a code review of:
@file src/main.ts
```

3. **Get structured feedback** — The skill provides a consistent format (APPROVED/CHANGES REQUIRED/REJECTED)

### Saving Reviews

Ask OpenCode to save the review:

```
Please save this code review to `.agents/sprint-forge/{scope}/REVIEWS.md`
under the section "Review {date} - {filename}"
```

---

## Workflow Examples

### Example 1: Quick Code Review

```
I'm using the QA Review skill. Please review:

@file .skills/qa-review/SKILL.md

File to review:
@file src/auth/oauth.ts

Format: # Code Review Result
```

### Example 2: Sprint Planning

```
Using sprint-forge skill:

@file .skills/sprint-forge/SKILL.md
@file .agents/sprint-forge/api-redesign/REENTRY-PROMPTS.md

Let's plan SPRINT-2 with:
- Scope: api-redesign
- Previous sprint context: [paste findings]
- New requirements: [list them]

Generate SPRINT-2.md following the template.
```

### Example 3: Planning + Review

```
1. Use sprint-forge to plan the sprint
2. Get the implementation working
3. Use qa-review to validate the work
4. Update REENTRY-PROMPTS.md for next session
```

---

## Best Practices

1. **Keep skills visible** — Store `.skills/` at project root for easy reference
2. **Use @file references** — OpenCode's @file directive is cleaner than copying content
3. **Reference re-entry prompts** — Always include `REENTRY-PROMPTS.md` for context continuity
4. **Manual artifact updates** — You'll need to manage sprint files manually (no automatic sync)
5. **Chain skills logically** — Use sprint-forge for planning, qa-review for validation

---

## Limitations

- No plugin system — skills are referenced manually in prompts
- No automatic artifact persistence — you manage sprint files
- No integration with kyro-workflow's learning system (`.agents/sprint-forge/rules.md`)
- No Obsidian vault sync (need to copy files manually if using vault)

---

## Tips & Tricks

### Auto-include Skill in Every Message

Create a `.opencode-context` file in your project (if supported):

```
Default skill context:
@file .skills/qa-review/SKILL.md
```

### Keep Sprint Context Available

Store key files at the project root:

```
.agents/
├── CURRENT-SPRINT.md (symlink or copy of active sprint)
├── REENTRY-PROMPTS.md (always accessible)
```

### Batch Reviews

Ask OpenCode to review multiple files:

```
@file .skills/qa-review/SKILL.md

Please review these files for architecture alignment:
- @file src/api/routes.ts
- @file src/api/middleware.ts
- @file src/api/handlers.ts

Then summarize the architecture issues across all three.
```

---

## Next Steps

1. Copy `.skills/` and `.agents/` to your OpenCode project
2. Start with a simple code review using qa-review
3. Graduate to sprint planning with sprint-forge
4. Extend the system based on your workflow

---

## Support

- **Skill docs:** See `skills/qa-review/SKILL.md` and `skills/sprint-forge/SKILL.md`
- **Main README:** See root `README.md`
- **For full features:** Consider upgrading to **Claude Code** with plugin support
