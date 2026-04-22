import initSqlJs from "sql.js";
import type { Database as SqlJsDatabase } from "sql.js";
import fs from "node:fs";
import path from "node:path";

const DB_PATH = path.resolve(__dirname, "../../voicepool.db");

let db: SqlJsDatabase;

function save(): void {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

/**
 * Initialize the SQLite database (loads WASM, reads file if exists, runs migrations).
 * Must be called once at startup before any queries.
 */
export async function initDatabase(): Promise<void> {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  // Run migrations
  db.run(`
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL,
      api_key TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS usage_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      character_count INTEGER NOT NULL,
      character_limit INTEGER NOT NULL,
      next_reset_unix INTEGER NOT NULL,
      tier TEXT NOT NULL,
      status TEXT NOT NULL,
      fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
    );
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_snapshots_account_id
      ON usage_snapshots(account_id);
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_snapshots_fetched_at
      ON usage_snapshots(fetched_at);
  `);

  db.run("PRAGMA foreign_keys = ON;");

  save();
}

/**
 * Run a statement that modifies data (INSERT, UPDATE, DELETE).
 * Returns the last inserted row id.
 */
export function run(sql: string, params: unknown[] = []): number {
  db.run(sql, params);
  save();
  // Get last insert rowid
  const result = db.exec("SELECT last_insert_rowid() as id");
  return result.length > 0 ? (result[0].values[0][0] as number) : 0;
}

/**
 * Run a statement that modifies data and return number of changed rows.
 */
export function runChanges(sql: string, params: unknown[] = []): number {
  db.run(sql, params);
  save();
  const result = db.exec("SELECT changes() as c");
  return result.length > 0 ? (result[0].values[0][0] as number) : 0;
}

/**
 * Query rows. Returns an array of objects.
 */
export function query<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): T[] {
  const stmt = db.prepare(sql);
  stmt.bind(params);

  const rows: T[] = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as T);
  }
  stmt.free();
  return rows;
}

export function pruneOldSnapshots(accountId: number): void {
  db.run(
    `DELETE FROM usage_snapshots
     WHERE account_id = ?
     AND fetched_at < datetime('now', '-30 days')
     AND id NOT IN (
       SELECT id FROM usage_snapshots WHERE account_id = ? ORDER BY fetched_at DESC LIMIT 1
     )`,
    [accountId, accountId]
  );
  save();
}

/**
 * Query a single row. Returns the row or undefined.
 */
export function queryOne<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): T | undefined {
  const rows = query<T>(sql, params);
  return rows[0];
}
