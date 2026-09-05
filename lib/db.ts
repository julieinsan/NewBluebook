import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { runMigrations } from "./migrations";

export const DB_DIR = path.join(process.cwd(), "data");
export const DB_PATH = path.join(DB_DIR, "bluebook.db");

/**
 * Opens (creating on first run, including the `data/` directory) a connection to the
 * local SQLite database with the pragmas this app relies on: WAL for concurrent
 * reads/writes from the dev server, and foreign keys enforced (SQLite disables FK
 * enforcement by default per-connection).
 */
export function openDatabase(): Database.Database {
  fs.mkdirSync(DB_DIR, { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

declare global {
  var __bluebookDb: Database.Database | undefined;
}

/**
 * Returns a process-wide singleton database connection, running any pending
 * migrations the first time it's opened. Cached on `globalThis` so Next.js's dev-mode
 * module reloading doesn't open a new connection (and re-run migrations) per request.
 */
export function getDb(): Database.Database {
  if (!globalThis.__bluebookDb) {
    const db = openDatabase();
    runMigrations(db);
    globalThis.__bluebookDb = db;
  }
  return globalThis.__bluebookDb;
}
