-- Kyro Database Schema

CREATE TABLE IF NOT EXISTS learnings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT DEFAULT (datetime('now')),
  project TEXT NOT NULL,
  category TEXT NOT NULL,
  rule TEXT NOT NULL,
  mistake TEXT,
  correction TEXT,
  sprint TEXT,
  times_applied INTEGER DEFAULT 0
);

CREATE VIRTUAL TABLE IF NOT EXISTS learnings_fts USING fts5(
  rule,
  category,
  mistake,
  correction,
  content='learnings',
  content_rowid='id',
  tokenize='porter'
);

-- Keep FTS index in sync
CREATE TRIGGER IF NOT EXISTS learnings_ai AFTER INSERT ON learnings BEGIN
  INSERT INTO learnings_fts(rowid, rule, category, mistake, correction)
  VALUES (new.id, new.rule, new.category, new.mistake, new.correction);
END;

CREATE TRIGGER IF NOT EXISTS learnings_ad AFTER DELETE ON learnings BEGIN
  INSERT INTO learnings_fts(learnings_fts, rowid, rule, category, mistake, correction)
  VALUES ('delete', old.id, old.rule, old.category, old.mistake, old.correction);
END;

CREATE TRIGGER IF NOT EXISTS learnings_au AFTER UPDATE ON learnings BEGIN
  INSERT INTO learnings_fts(learnings_fts, rowid, rule, category, mistake, correction)
  VALUES ('delete', old.id, old.rule, old.category, old.mistake, old.correction);
  INSERT INTO learnings_fts(rowid, rule, category, mistake, correction)
  VALUES (new.id, new.rule, new.category, new.mistake, new.correction);
END;

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project TEXT NOT NULL,
  started_at TEXT DEFAULT (datetime('now')),
  ended_at TEXT,
  sprint TEXT,
  edit_count INTEGER DEFAULT 0,
  corrections_count INTEGER DEFAULT 0,
  tasks_completed INTEGER DEFAULT 0,
  tasks_total INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS debt_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT DEFAULT (datetime('now')),
  project TEXT NOT NULL,
  item TEXT NOT NULL,
  origin TEXT NOT NULL,
  sprint_target TEXT,
  sprint_created TEXT,
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'in-progress', 'resolved', 'deferred')),
  resolved_in TEXT,
  directory TEXT,
  severity TEXT DEFAULT 'medium' CHECK (severity IN ('critical', 'high', 'medium', 'low'))
);
