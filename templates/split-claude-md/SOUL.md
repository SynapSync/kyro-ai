# SOUL.md — Personal Communication Style

This file defines your personal preferences for how AI agents communicate and write code. It is loaded alongside CLAUDE.md to personalize the agent's behavior.

Place this file in your project root or `~/.claude/` for global preferences.

---

## Tone

<!-- Uncomment and customize the style that matches your preference -->

<!-- Formal: professional, structured, complete sentences -->
<!-- tone: formal -->

<!-- Casual: conversational, contractions, direct -->
<!-- tone: casual -->

<!-- Terse: minimal words, maximum signal, no filler -->
<!-- tone: terse -->

tone: casual

---

## Verbosity

<!-- How much detail you want in responses -->

<!-- minimal: just the answer, no explanation unless asked -->
<!-- standard: answer + brief context -->
<!-- detailed: answer + full reasoning + alternatives -->

verbosity: minimal

---

## Language

<!-- Primary language for communication -->
<!-- The agent will respond in this language unless you write in another -->

language: en

---

## Code Style

<!-- Your code style preferences — the agent will follow these when writing code -->

```yaml
indentation: 2 spaces
semicolons: false          # JS/TS: omit semicolons
quotes: single             # JS/TS: single quotes
trailing_commas: true      # ES5 trailing commas
naming:
  variables: camelCase
  functions: camelCase
  classes: PascalCase
  constants: UPPER_SNAKE_CASE
  files: kebab-case
max_line_length: 100
```

---

## Response Format

<!-- How you prefer responses to be structured -->

```yaml
use_headers: true           # Use markdown headers for structure
use_bullet_points: true     # Prefer bullets over paragraphs
code_blocks: fenced         # Always use fenced code blocks with language
show_file_paths: true       # Show file paths before code changes
```

---

## Domain Expertise

<!-- What you can be assumed to know — the agent won't over-explain these topics -->

```yaml
assume_knowledge_of:
  - git (advanced)
  - typescript
  - node.js ecosystem
  - terminal / CLI usage
  # Add your areas of expertise here
```

---

## Anti-Patterns

<!-- Things you explicitly don't want the agent to do -->

```yaml
never:
  - Add emojis to code or responses
  - Add comments that explain what code does (only why)
  - Create README files unless asked
  - Use verbose error messages for internal code
  - Add type annotations that TypeScript can infer
  # Add your pet peeves here
```
