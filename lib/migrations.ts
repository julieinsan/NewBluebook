import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";

const MIGRATIONS_DIR = path.join(process.cwd(), "migrations");

interface MigrationRow {
  name: string;
}

/**
 * Applies any `.sql` files in /migrations that aren't yet recorded in `_migrations`,
 * in filename order, each inside its own transaction. Safe to call on every app start
 * and from the `migrate` CLI script — already-applied migrations are skipped, so
 * running this twice in a row is a no-op the second time.
 *
 * Returns the list of migration filenames that were newly applied.
 */
export function runMigrations(db: Database.Database): string[] {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const alreadyApplied = new Set(
    (db.prepare("SELECT name FROM _migrations").all() as MigrationRow[]).map(
      (row) => row.name,
    ),
  );

  const migrationFiles = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  const newlyApplied: string[] = [];

  for (const file of migrationFiles) {
    if (alreadyApplied.has(file)) continue;

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf-8");

    const applyMigration = db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO _migrations (name) VALUES (?)").run(file);
    });

    applyMigration();
    newlyApplied.push(file);
  }

  return newlyApplied;
}
