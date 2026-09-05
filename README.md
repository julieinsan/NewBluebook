# Bluebook Clone

A single-user, locally-run clone of the College Board Bluebook digital SAT
testing app. See [`PRD.md`](./PRD.md) for the full product spec and delivery
plan; this README covers the developer-facing setup for the current build
(Epic 0: project foundation).

## Tech stack

- [Next.js](https://nextjs.org) (App Router) + TypeScript
- Tailwind CSS v4 for styling (Bluebook palette wired up as theme tokens —
  see `app/globals.css`)
- [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3) for a local
  SQLite database — no separate backend/API layer; server components and
  server actions talk to SQLite directly, since Next.js server code runs in
  Node.js
- Plain `.sql` migration files + a small custom runner (no ORM) — see
  [Migrations](#migrations) below
- ESLint + Prettier

## Requirements

- Node.js 20+ (tested on Node 25)
- npm

## Setup

```bash
npm install
npm run migrate   # creates data/bluebook.db and applies all pending migrations
npm run dev       # starts the dev server at http://localhost:3000
```

The home page queries the database on render, so the first `npm run dev`
request will also lazily create/migrate `data/bluebook.db` if you skip the
explicit `npm run migrate` step — but running migrations explicitly first is
recommended so you can see what got applied.

## Available scripts

| Command                | What it does                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------ |
| `npm run dev`          | Start the Next.js dev server                                                         |
| `npm run build`        | Production build                                                                     |
| `npm run start`        | Run the production build                                                             |
| `npm run migrate`      | Apply any pending SQL migrations to `data/bluebook.db` (idempotent — safe to re-run) |
| `npm run lint`         | ESLint                                                                               |
| `npm run format`       | Prettier, write mode                                                                 |
| `npm run format:check` | Prettier, check mode (no writes)                                                     |

## Migrations

Schema changes live as plain, numbered `.sql` files in [`/migrations`](./migrations)
(e.g. `0001_create_questions.sql`). The runner (`lib/migrations.ts`, invoked by
`scripts/migrate.ts` for the CLI and automatically by `lib/db.ts` when the app
opens its database connection):

1. Ensures a `_migrations` tracking table exists.
2. Reads all `.sql` files in `/migrations`, sorted by filename.
3. Skips any file whose name is already recorded in `_migrations`.
4. Applies each remaining file inside its own transaction, then records it.

This makes the runner idempotent: running `npm run migrate` twice in a row
applies nothing the second time. To add a new migration, add a new
`NNNN_description.sql` file with the next number — never edit an already-applied
migration file.

The database file `data/bluebook.db` is created on first run and is
gitignored, along with `node_modules`, `.next`, and WAL/journal side-files.

### Schema

The schema implements the data model in PRD Section 5:

- `questions` — the R&W/Math question bank (populated by Epic 1 ingestion)
- `test_attempts` — one row per full-length practice test
- `test_attempt_questions` — which questions appeared in which attempt/module,
  in what order, with the user's answers/flags/highlights
- `drill_sessions` / `drill_session_questions` — untimed targeted practice
- `question_serve_log` — powers least-recently-used question recycling once a
  domain's fresh pool is exhausted
- `difficulty_recalibrations` — standalone reference data from
  `Copy of difficulty_changes.csv` (Story 1.4), not currently joined to
  `questions` since the supplied CSV's IDs don't overlap with the bank

Enum-like columns (`section`, `difficulty`, `question_type`,
`test_attempts.status`, the `*_difficulty_path` columns) are enforced with
`CHECK` constraints, since SQLite has no native enum type. Foreign keys are
real foreign keys, enforced via `PRAGMA foreign_keys = ON` (set on every
connection in `lib/db.ts`).

## Project layout

```
app/                 Next.js App Router pages/layout
lib/db.ts            SQLite connection (singleton, foreign_keys pragma, runs migrations)
lib/migrations.ts     Migration runner
migrations/*.sql      Versioned schema migrations
scripts/migrate.ts    CLI entry point for `npm run migrate`
data/bluebook.db      Local database file (gitignored, created on first run)
```

## Not in scope for this build

No accounts/auth, no hosted backend, no proctoring — this is a local,
single-user practice tool. See `PRD.md` Section 2 for the full goals/non-goals.
