import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
const DEFAULT_DB_DIR = path.join(process.cwd(), '.agents', 'kyro');
const DEFAULT_DB_PATH = path.join(DEFAULT_DB_DIR, 'data.db');

export function getDbPath(): string {
  return process.env.KYRO_DB_PATH || DEFAULT_DB_PATH;
}

export function initDatabase(dbPath?: string): Database.Database {
  const resolvedPath = dbPath || getDbPath();
  const dir = path.dirname(resolvedPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(resolvedPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  db.exec(schema);

  return db;
}
