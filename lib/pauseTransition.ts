/**
 * Practice-app pause/resume transitions (migration 0010).
 *
 * Freezes whichever clock is active (module or break) until the student explicitly
 * resumes from home. Intentionally diverges from real Bluebook timing.
 */
import type Database from "better-sqlite3";
import { getAttemptState, resolveCurrentPosition } from "./attemptState";
import {
  PAUSED_AT_COLUMN,
  PAUSED_PHASE_COLUMN,
  parseSqliteTimestamp,
  pathForPosition,
  pausePhaseFromPosition,
  pauseSecondsColumn,
  type PausePhase,
} from "./testFlow";

export interface PauseAttemptResult {
  attemptId: number;
  pausedPhase: PausePhase;
  pausedAt: string;
  /** False when an earlier delivery had already paused this attempt. */
  pausedNow: boolean;
}

export interface ResumeAttemptResult {
  attemptId: number;
  /** D11 path string for where the student should go next. */
  next: string;
  /** False when the attempt was not paused. */
  resumedNow: boolean;
}

function readPause(db: Database.Database, attemptId: number): {
  pausedAt: string | null;
  pausedPhase: PausePhase | null;
} {
  const row = db
    .prepare(`SELECT ${PAUSED_AT_COLUMN} AS pausedAt, ${PAUSED_PHASE_COLUMN} AS pausedPhase FROM test_attempts WHERE id = ?`)
    .get(attemptId) as { pausedAt: string | null; pausedPhase: PausePhase | null } | undefined;

  if (!row) {
    throw new Error(`Attempt ${attemptId} does not exist`);
  }
  return row;
}

/**
 * Pauses the attempt at its current position, freezing the active clock.
 *
 * Idempotent: a second call while already paused returns the existing stamp unchanged.
 */
export function pauseAttempt(db: Database.Database, attemptId: number): PauseAttemptResult {
  const run = db.transaction((): PauseAttemptResult => {
    const state = getAttemptState(db, attemptId);
    const position = resolveCurrentPosition(state);
    const phase = pausePhaseFromPosition(position);

    if (phase == null) {
      throw new Error(`Attempt ${attemptId} is finished and cannot be paused`);
    }

    const existing = readPause(db, attemptId);
    if (existing.pausedAt != null && existing.pausedPhase != null) {
      return {
        attemptId,
        pausedPhase: existing.pausedPhase,
        pausedAt: existing.pausedAt,
        pausedNow: false,
      };
    }

    db.prepare(
      `UPDATE test_attempts
       SET ${PAUSED_AT_COLUMN} = datetime('now'), ${PAUSED_PHASE_COLUMN} = ?
       WHERE id = ? AND ${PAUSED_AT_COLUMN} IS NULL`,
    ).run(phase, attemptId);

    const after = readPause(db, attemptId);
    if (after.pausedAt == null || after.pausedPhase == null) {
      throw new Error(`Failed to pause attempt ${attemptId}`);
    }

    return {
      attemptId,
      pausedPhase: after.pausedPhase,
      pausedAt: after.pausedAt,
      pausedNow: true,
    };
  });

  return run();
}

/**
 * Resumes a paused attempt: accumulates the pause segment and clears pause stamps.
 *
 * Idempotent: if not paused, returns the current `next` path without changing anything.
 */
export function resumeAttempt(
  db: Database.Database,
  attemptId: number,
  now: number = Date.now(),
): ResumeAttemptResult {
  const run = db.transaction((): ResumeAttemptResult => {
    const state = getAttemptState(db, attemptId);
    const next = pathForPosition(attemptId, resolveCurrentPosition(state));

    const existing = readPause(db, attemptId);
    if (existing.pausedAt == null || existing.pausedPhase == null) {
      return { attemptId, next, resumedNow: false };
    }

    const pauseStart = parseSqliteTimestamp(existing.pausedAt);
    const elapsedSeconds = Math.max(0, Math.floor((now - pauseStart) / 1000));
    const column = pauseSecondsColumn(existing.pausedPhase);

    db.prepare(
      `UPDATE test_attempts
       SET ${column} = ${column} + ?,
           ${PAUSED_AT_COLUMN} = NULL,
           ${PAUSED_PHASE_COLUMN} = NULL
       WHERE id = ?`,
    ).run(elapsedSeconds, attemptId);

    return { attemptId, next, resumedNow: true };
  });

  return run();
}
