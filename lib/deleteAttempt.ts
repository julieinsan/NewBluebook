import type Database from "better-sqlite3";

export function deleteAttempt(db: Database.Database, attemptId: number): void {
  const exists = db.prepare("SELECT 1 AS ok FROM test_attempts WHERE id = ?").get(attemptId);
  if (!exists) {
    throw new Error(`Attempt ${attemptId} does not exist`);
  }

  db.transaction(() => {
    db.prepare("DELETE FROM test_attempt_questions WHERE attempt_id = ?").run(attemptId);
    db.prepare("DELETE FROM question_serve_log WHERE attempt_id = ?").run(attemptId);
    db.prepare("DELETE FROM test_attempts WHERE id = ?").run(attemptId);
  })();
}
