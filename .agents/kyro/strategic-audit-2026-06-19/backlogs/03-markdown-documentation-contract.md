# Backlog: Markdown and Documentation Contract

Markdown is not the weakness. Unvalidated Markdown ownership is. This backlog gives every important document a clear role, owner, source-of-truth status, and validation path.

## Evidence

- Docs, commands, skills, rules, contexts, and templates already use Markdown heavily.
- Generated templates include frontmatter, but general docs do not consistently encode ownership or derivation metadata.
- `scripts/check-markdown-links.mjs` validates links, but there is no doc drift or ownership validator.

## Technical correction

Add a documentation contract: frontmatter fields, derived/manual classification, validators, and doc impact checks.

## Tasks

| ID | Priority | Size | Task | Likely files | Acceptance criteria | Validation |
|----|----------|------|------|--------------|---------------------|------------|
| MDC-001 | P1 | S | Define documentation frontmatter schema | `docs/documentation-contract.md`, `scripts/*` | Required fields include `owner`, `source_of_truth`, `derived_from`, `last_verified`, `validator` | Markdown/schema check |
| MDC-002 | P1 | M | Add doc metadata to core docs | `README.md`, `docs/*.md` | Core docs identify manual/mixed/derived status | `npm run check:links`, new doc check |
| MDC-003 | P1 | M | Implement `check:docs-contract` | `scripts/check-docs-contract.mjs`, `package.json` | Fails missing required metadata for selected docs | `npm run check:docs-contract` |
| MDC-004 | P1 | M | Generate `docs-index.json` | `src/cli/commands/docs-index.ts` or script | Index lists docs, owners, source files, derived status, validators, stale status | Fixture/golden output |
| MDC-005 | P1 | M | Implement doc impact check | script/CLI | Given changed files, reports docs likely affected | Test with known source/doc mappings |
| MDC-006 | P2 | M | Derive command reference from command files | `commands/*.md`, `docs/commands-reference.md`, script | Command docs cannot drift from command frontmatter/routes | Generated docs check |

## Document policy

| Document kind | Manual edit? | Notes |
|---------------|--------------|-------|
| Product README | Yes | Validate command examples and version-sensitive claims |
| Architecture docs | Yes, with source refs | Must name code/docs inputs |
| Command reference | Prefer derived | Source should be `commands/*.md` |
| Skill registry | Derived | Source should be skill frontmatter/manifests |
| Summary JSON | No manual edits | Generated from Markdown evidence |
| Changelog/release notes | Mixed | Generated base with manual release framing |
