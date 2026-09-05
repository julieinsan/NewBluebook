/**
 * Migration CLI: `npm run migrate`.
 *
 * Opens (creating on first run) data/bluebook.db and applies any migrations in
 * /migrations that haven't run yet, tracked in the `_migrations` table. Idempotent —
 * running it again with nothing new to apply just reports "up to date" and exits 0.
 */
import { openDatabase } from "../lib/db";
import { runMigrations } from "../lib/migrations";

function main() {
  const db = openDatabase();

  try {
    const applied = runMigrations(db);

    if (applied.length === 0) {
      console.log("Database already up to date. No migrations applied.");
    } else {
      console.log(`Applied ${applied.length} migration(s):`);
      for (const name of applied) {
        console.log(`  - ${name}`);
      }
    }
  } finally {
    db.close();
  }
}

main();
