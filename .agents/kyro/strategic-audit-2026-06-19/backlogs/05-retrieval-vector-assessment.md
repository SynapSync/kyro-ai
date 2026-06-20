# Backlog: Retrieval and Vector Database Assessment

Do not add a vector database yet. The current corpus is local, structured, and small enough for path, frontmatter, heading, grep, and optional FTS retrieval. This backlog builds the evidence needed before any semantic retrieval decision.

## Evidence

- Kyro artifacts are organized under predictable paths.
- Markdown files have headings and many templates include frontmatter.
- JSON summaries already give routing state.
- No measured retrieval failure currently proves vector search is necessary.

## Technical correction

Build local indexing first. Only test vector retrieval after local metadata/text indexing shows measurable gaps.

## Tasks

| ID | Priority | Size | Task | Likely files | Acceptance criteria | Validation |
|----|----------|------|------|--------------|---------------------|------------|
| RET-001 | P1 | M | Implement local artifact index | `src/cli/commands/index-artifacts.ts`, `src/cli/artifacts/*` | Produces an index of paths, frontmatter, headings, source hashes, and document type | Fixture/golden index |
| RET-002 | P2 | M | Add search over local index | `src/cli/commands/search.ts` | Can search by scope, doc type, status, heading, path, and keyword | Search fixture tests |
| RET-003 | P2 | M | Evaluate SQLite FTS or JSONL index | docs/proposal | Decision record compares grep, JSON index, SQLite FTS | ADR accepted |
| RET-004 | P3 | L | Design vector retrieval experiment only if needed | future proposal | Defines corpus size, embedding cost, invalidation, eval set, precision target | Retrieval evaluation report |

## Vector DB decision gate

Vector retrieval may proceed only if all are true:

- Local index/keyword/FTS cannot answer a documented class of questions well.
- Corpus size and update frequency justify embedding cost.
- There is a benchmark set with expected answers.
- Stale document invalidation is designed before implementation.
- Retrieval quality has target metrics such as precision@k or answer correctness.
