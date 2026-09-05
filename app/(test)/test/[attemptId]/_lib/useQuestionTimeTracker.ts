"use client";

import type { ModuleNumber, Section } from "@/lib/blueprint";
import { useCallback, useEffect, useRef } from "react";
import { postQuestionState, postQuestionStateKeepalive } from "./clientApi";

/** How often to flush in-progress time so a mid-question refresh does not lose much. */
const PERIODIC_FLUSH_MS = 15_000;

export function useQuestionTimeTracker(
  attemptId: number,
  section: Section,
  module: ModuleNumber,
  activeQuestionId: string | undefined,
  paused: boolean,
  disabled: boolean,
) {
  const segmentStartRef = useRef<number | null>(null);
  const trackedQuestionIdRef = useRef<string | null>(null);
  const inFlightRef = useRef(new Map<string, Promise<void>>());
  const pendingDeltaRef = useRef(new Map<string, number>());

  const accrueSegment = useCallback((questionId: string) => {
    const start = segmentStartRef.current;
    if (start == null) return;
    const elapsed = Math.floor((Date.now() - start) / 1000);
    if (elapsed <= 0) return;
    pendingDeltaRef.current.set(
      questionId,
      (pendingDeltaRef.current.get(questionId) ?? 0) + elapsed,
    );
    segmentStartRef.current = Date.now();
  }, []);

  const flushQuestion = useCallback(
    async (questionId: string, keepalive = false): Promise<void> => {
      const executeFlush = async (delta: number): Promise<void> => {
        if (keepalive) {
          postQuestionStateKeepalive(attemptId, questionId, {
            section,
            module,
            timeSpentDelta: delta,
          });
          return;
        }
        await postQuestionState(attemptId, questionId, {
          section,
          module,
          timeSpentDelta: delta,
        });

        const pending = pendingDeltaRef.current.get(questionId);
        if (pending !== undefined) {
          pendingDeltaRef.current.delete(questionId);
          await executeFlush(pending);
        }
      };

      let delta = pendingDeltaRef.current.get(questionId) ?? 0;
      if (delta <= 0) return;

      if (inFlightRef.current.has(questionId)) {
        await inFlightRef.current.get(questionId);
        delta = pendingDeltaRef.current.get(questionId) ?? 0;
        if (delta <= 0) return;
      }

      pendingDeltaRef.current.delete(questionId);

      const promise = executeFlush(delta)
        .catch((err) => {
          console.error("Failed to save question time:", err);
          pendingDeltaRef.current.set(
            questionId,
            (pendingDeltaRef.current.get(questionId) ?? 0) + delta,
          );
        })
        .finally(() => {
          inFlightRef.current.delete(questionId);
        });

      inFlightRef.current.set(questionId, promise);
      await promise;
    },
    [attemptId, module, section],
  );

  const endSegment = useCallback(() => {
    const qid = trackedQuestionIdRef.current;
    if (qid) accrueSegment(qid);
    segmentStartRef.current = null;
  }, [accrueSegment]);

  const flushAll = useCallback(async (): Promise<void> => {
    endSegment();
    const questionIds = new Set(pendingDeltaRef.current.keys());
    const active = trackedQuestionIdRef.current;
    if (active) questionIds.add(active);

    for (const qid of questionIds) {
      await flushQuestion(qid);
    }
    while (inFlightRef.current.size > 0) {
      await Promise.all([...inFlightRef.current.values()]);
    }
  }, [endSegment, flushQuestion]);

  useEffect(() => {
    const prevId = trackedQuestionIdRef.current;
    if (prevId && prevId !== activeQuestionId) {
      endSegment();
      void flushQuestion(prevId);
    }

    trackedQuestionIdRef.current = activeQuestionId ?? null;

    if (!disabled && !paused && activeQuestionId && !document.hidden) {
      segmentStartRef.current = Date.now();
    } else {
      segmentStartRef.current = null;
    }
  }, [activeQuestionId, disabled, paused, endSegment, flushQuestion]);

  useEffect(() => {
    if (disabled || paused) {
      endSegment();
      const qid = trackedQuestionIdRef.current;
      if (qid) void flushQuestion(qid);
    } else if (activeQuestionId && !document.hidden) {
      segmentStartRef.current = Date.now();
    }
  }, [disabled, paused, activeQuestionId, endSegment, flushQuestion]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden) {
        endSegment();
        const qid = trackedQuestionIdRef.current;
        if (qid) void flushQuestion(qid);
      } else if (!disabled && !paused && activeQuestionId) {
        segmentStartRef.current = Date.now();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [activeQuestionId, disabled, paused, endSegment, flushQuestion]);

  useEffect(() => {
    if (disabled || paused || !activeQuestionId) return;

    const id = window.setInterval(() => {
      const qid = trackedQuestionIdRef.current;
      if (!qid || document.hidden) return;
      accrueSegment(qid);
      void flushQuestion(qid);
    }, PERIODIC_FLUSH_MS);

    return () => window.clearInterval(id);
  }, [activeQuestionId, disabled, paused, accrueSegment, flushQuestion]);

  useEffect(() => {
    const onBeforeUnload = () => {
      endSegment();
      for (const [questionId, delta] of pendingDeltaRef.current.entries()) {
        if (delta > 0) {
          postQuestionStateKeepalive(attemptId, questionId, {
            section,
            module,
            timeSpentDelta: delta,
          });
        }
      }
      pendingDeltaRef.current.clear();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [attemptId, section, module, endSegment]);

  return { flushAll };
}
