---
name: deslop
description: >
  AI slop detection and removal. Identifies and cleans up unnecessary comments,
  over-engineered abstractions, defensive code for impossible conditions,
  premature generalization, and verbose patterns introduced by AI coding assistants.
---

# Deslop — AI Slop Detection & Removal

## Purpose

Identifies and removes AI-generated boilerplate that adds complexity without value. AI assistants tend to over-engineer, over-comment, and over-defend — this skill systematically detects and proposes removal of these patterns.

## When to Use

- After AI-assisted code generation sessions
- Before code review / PR creation
- When files feel bloated or hard to read
- As part of `/kyro-workflow:wrap-up` session closure

## Detection Categories

### 1. Unnecessary Comments

Comments that describe **what** the code does instead of **why**:

```typescript
// BAD — describes the obvious
const users = []; // Initialize empty array
if (user.isAdmin) { // Check if user is admin

// GOOD — explains intent or non-obvious behavior
// Cache expires after 5min to balance freshness vs DB load
const CACHE_TTL = 300_000;
```

**Rule**: Remove comments that restate the code. Keep comments that explain *why*, *context*, or *non-obvious behavior*.

### 2. Over-Engineered Abstractions

Wrappers, factories, or indirection layers that serve a single call site:

```typescript
// BAD — wrapper that adds nothing
function createUserService() {
  return new UserService();
}

// BAD — generic where specific is fine
function processEntity<T extends BaseEntity>(entity: T): T { ... }
// Only ever called with User
```

**Rule**: If an abstraction has one consumer, inline it. Abstractions earn their existence through reuse.

### 3. Defensive Code for Impossible Conditions

Guards against states that the type system or framework already prevents:

```typescript
// BAD — TypeScript already enforces this
if (typeof name !== 'string') throw new Error('name must be string');

// BAD — framework guarantees non-null
if (!req.body) return res.status(400).send('No body');
// Express always provides req.body with body-parser
```

**Rule**: Trust internal code and framework guarantees. Only validate at system boundaries (user input, external APIs, file I/O).

### 4. Premature Generalization

Configuration, feature flags, or extensibility for requirements that don't exist:

```typescript
// BAD — only one notification type exists
const NOTIFICATION_STRATEGIES = {
  email: new EmailNotifier(),
  // sms: new SmsNotifier(),     // TODO: future
  // push: new PushNotifier(),   // TODO: future
};

// GOOD — just send the email
await sendEmail(user, message);
```

**Rule**: Build for current requirements. Three similar lines of code is better than a premature abstraction.

### 5. Verbose Error Handling

Try-catch blocks that add no recovery logic, or error messages that duplicate the stack trace:

```typescript
// BAD — catch just to rethrow
try {
  await db.query(sql);
} catch (error) {
  console.error('Database query failed:', error);
  throw error;
}

// GOOD — let it propagate naturally
await db.query(sql);
```

**Rule**: Only catch errors when you can handle them (retry, fallback, user message). Don't catch-log-rethrow.

### 6. Redundant Type Annotations

Types that TypeScript can infer:

```typescript
// BAD — TypeScript infers these
const count: number = 0;
const name: string = 'hello';
const users: User[] = getUsers(); // getUsers() returns User[]

// GOOD — let inference work
const count = 0;
const name = 'hello';
const users = getUsers();
```

**Rule**: Only annotate when inference fails or when the annotation adds clarity (function signatures, complex types).

### 7. Wrapper Functions That Add No Value

Functions that pass through to another function without transformation:

```typescript
// BAD — pure passthrough
function fetchUser(id: string) {
  return api.get(`/users/${id}`);
}

// Unless it's at a module boundary or adds a meaningful abstraction layer
```

**Rule**: If the wrapper doesn't transform, validate, cache, or abstract, remove it.

## Workflow

### Step 1 — Identify Targets

Determine what to scan:
- **Specific file**: Scan the provided file path
- **Directory**: Recursively scan all source files
- **Changed files**: Scan files modified in the current branch (`git diff --name-only`)

### Step 2 — Scan & Categorize

For each file, identify slop instances and categorize them:
- Read the file
- Apply each detection category
- Group findings by category
- Rate confidence: **high** (obvious slop), **medium** (likely slop, context needed), **low** (borderline)

### Step 3 — Present Findings

Show findings grouped by category with file locations:

```
Deslop Report — {target}
═══════════════════════

Category 1: Unnecessary Comments (5 found)
  HIGH  src/auth/login.ts:12    — "// Check if user exists"
  HIGH  src/auth/login.ts:25    — "// Return the token"
  MED   src/utils/format.ts:8   — "// Format the date string"

Category 3: Defensive Code (2 found)
  HIGH  src/api/users.ts:45     — typeof guard on typed param
  MED   src/api/users.ts:62     — null check after required field

Total: 7 items (5 high, 2 medium)
Estimated reduction: ~30 lines
```

### Step 4 — Apply with Confirmation

For each category:
1. Show the proposed removals
2. Ask for approval: "Remove all 5 unnecessary comments? (yes/no/select)"
3. Apply approved removals
4. Skip declined items

### Step 5 — Summary

Show before/after metrics:
- Lines removed
- Lines added (if any replacements)
- Net delta
- Categories addressed

## Safety Rules

1. **Never remove business logic** — only remove wrapping, comments, and guards
2. **Preserve error handling at system boundaries** — input validation, API responses, file I/O
3. **Keep comments that explain why** — remove only those that explain what
4. **Don't remove abstractions with multiple consumers** — only single-use wrappers
5. **Preserve test assertions** — verbose tests are fine
6. **Ask before removing** — never auto-apply; always present findings first
