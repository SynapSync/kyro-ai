import Database from 'better-sqlite3';

export interface SearchResult {
  id: number;
  project: string;
  category: string;
  rule: string;
  mistake: string | null;
  correction: string | null;
  sprint: string | null;
  times_applied: number;
  rank: number;
}

export function searchLearnings(
  db: Database.Database,
  query: string,
  options: {
    project?: string;
    category?: string;
    limit?: number;
  } = {}
): SearchResult[] {
  const limit = options.limit || 10;

  let sql = `
    SELECT
      l.*,
      bm25(learnings_fts) AS rank
    FROM learnings_fts fts
    JOIN learnings l ON l.id = fts.rowid
    WHERE learnings_fts MATCH ?
  `;

  const params: (string | number)[] = [query];

  if (options.project) {
    sql += ' AND l.project = ?';
    params.push(options.project);
  }

  if (options.category) {
    sql += ' AND l.category = ?';
    params.push(options.category);
  }

  sql += ' ORDER BY rank LIMIT ?';
  params.push(limit);

  return db.prepare(sql).all(...params) as SearchResult[];
}
