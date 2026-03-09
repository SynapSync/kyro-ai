import Database from 'better-sqlite3';

export interface Learning {
  id?: number;
  created_at?: string;
  project: string;
  category: string;
  rule: string;
  mistake?: string;
  correction?: string;
  sprint?: string;
  times_applied?: number;
}

export interface Session {
  id?: number;
  project: string;
  started_at?: string;
  ended_at?: string;
  sprint?: string;
  edit_count?: number;
  corrections_count?: number;
  tasks_completed?: number;
  tasks_total?: number;
}

export interface DebtItem {
  id?: number;
  created_at?: string;
  project: string;
  item: string;
  origin: string;
  sprint_target?: string;
  status?: string;
  resolved_in?: string;
  directory?: string;
  severity?: string;
}

export function createStore(db: Database.Database) {
  return {
    // Learnings
    addLearning(learning: Learning): number {
      const stmt = db.prepare(`
        INSERT INTO learnings (project, category, rule, mistake, correction, sprint)
        VALUES (@project, @category, @rule, @mistake, @correction, @sprint)
      `);
      const result = stmt.run({
        mistake: null,
        correction: null,
        sprint: null,
        ...learning
      });
      return result.lastInsertRowid as number;
    },

    getLearnings(project?: string, limit = 50): Learning[] {
      if (project) {
        return db.prepare('SELECT * FROM learnings WHERE project = ? ORDER BY created_at DESC LIMIT ?')
          .all(project, limit) as Learning[];
      }
      return db.prepare('SELECT * FROM learnings ORDER BY created_at DESC LIMIT ?')
        .all(limit) as Learning[];
    },

    incrementApplied(id: number): void {
      db.prepare('UPDATE learnings SET times_applied = times_applied + 1 WHERE id = ?').run(id);
    },

    // Sessions
    startSession(project: string, sprint?: string): number {
      const stmt = db.prepare(`
        INSERT INTO sessions (project, sprint)
        VALUES (@project, @sprint)
      `);
      const result = stmt.run({ project, sprint: sprint ?? null });
      return result.lastInsertRowid as number;
    },

    endSession(id: number, stats: Partial<Session>): void {
      db.prepare(`
        UPDATE sessions SET
          ended_at = datetime('now'),
          edit_count = @edit_count,
          corrections_count = @corrections_count,
          tasks_completed = @tasks_completed,
          tasks_total = @tasks_total
        WHERE id = @id
      `).run({
        edit_count: 0,
        corrections_count: 0,
        tasks_completed: 0,
        tasks_total: 0,
        ...stats,
        id
      });
    },

    getRecentSessions(project?: string, limit = 10): Session[] {
      if (project) {
        return db.prepare('SELECT * FROM sessions WHERE project = ? ORDER BY started_at DESC LIMIT ?')
          .all(project, limit) as Session[];
      }
      return db.prepare('SELECT * FROM sessions ORDER BY started_at DESC LIMIT ?')
        .all(limit) as Session[];
    },

    // Debt Items
    addDebtItem(item: DebtItem): number {
      const stmt = db.prepare(`
        INSERT INTO debt_items (project, item, origin, sprint_target, status, directory, severity)
        VALUES (@project, @item, @origin, @sprint_target, @status, @directory, @severity)
      `);
      const result = stmt.run({
        sprint_target: null,
        status: 'open',
        resolved_in: null,
        directory: null,
        severity: 'medium',
        ...item
      });
      return result.lastInsertRowid as number;
    },

    resolveDebtItem(id: number, resolvedIn: string): void {
      db.prepare('UPDATE debt_items SET status = ?, resolved_in = ? WHERE id = ?')
        .run('resolved', resolvedIn, id);
    },

    getDebtItems(project: string, status?: string): DebtItem[] {
      if (status) {
        return db.prepare('SELECT * FROM debt_items WHERE project = ? AND status = ? ORDER BY created_at')
          .all(project, status) as DebtItem[];
      }
      return db.prepare('SELECT * FROM debt_items WHERE project = ? ORDER BY created_at')
        .all(project) as DebtItem[];
    },

    getAgedDebt(project: string, maxSprints = 3): DebtItem[] {
      // Returns items that have been open across multiple sprints
      return db.prepare(`
        SELECT * FROM debt_items
        WHERE project = ? AND status IN ('open', 'in-progress')
        ORDER BY created_at ASC
      `).all(project) as DebtItem[];
    }
  };
}
