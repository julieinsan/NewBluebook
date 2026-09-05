"use client";

import { useCallback, useEffect, useRef } from "react";
import { postDrillTime, postDrillTimeKeepalive } from "./clientApi";

const PERIODIC_FLUSH_MS = 15_000;

export function useDrillTimeTracker(
  sessionId: number,
  activeQuestionId: string | undefined,
  disabled: boolean,
) {
  const segmentStartRef = useRef<number | null>(null);
  const trackedQuestionIdRef = useRef<string | null>(null);
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
      const delta = pendingDeltaRef.current.get(questionId) ?? 0;
      if (delta <= 0) return;
      pendingDeltaRef.current.delete(questionId);

      try {
        if (keepalive) {
          postDrillTimeKeepalive(sessionId, questionId, delta);
        } else {
          await postDrillTime(sessionId, questionId, delta);
        }
      } catch (err) {
        console.error("Failed to save drill question time:", err);
        pendingDeltaRef.current.set(
          questionId,
          (pendingDeltaRef.current.get(questionId) ?? 0) + delta,
        );
      }
    },
    [sessionId],
  );

  const endSegment = useCallback(() => {
    const qid = trackedQuestionIdRef.current;
    if (qid) accrueSegment(qid);
    segmentStartRef.current = null;
  }, [accrueSegment]);

  const flushAll = useCallback(async (): Promise<void> => {
    endSegment();
    for (const qid of new Set(pendingDeltaRef.current.keys())) {
      await flushQuestion(qid);
    }
  }, [endSegment, flushQuestion]);

  useEffect(() => {
    const prevId = trackedQuestionIdRef.current;
    if (prevId && prevId !== activeQuestionId) {
      endSegment();
      void flushQuestion(prevId);
    }

    trackedQuestionIdRef.current = activeQuestionId ?? null;

    if (!disabled && activeQuestionId && !document.hidden) {
      segmentStartRef.current = Date.now();
    } else {
      segmentStartRef.current = null;
    }
  }, [activeQuestionId, disabled, endSegment, flushQuestion]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden) {
        endSegment();
        const qid = trackedQuestionIdRef.current;
        if (qid) void flushQuestion(qid);
      } else if (!disabled && activeQuestionId) {
        segmentStartRef.current = Date.now();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [activeQuestionId, disabled, endSegment, flushQuestion]);

  useEffect(() => {
    if (disabled || !activeQuestionId) return;
    const id = window.setInterval(() => {
      const qid = trackedQuestionIdRef.current;
      if (!qid || document.hidden) return;
      accrueSegment(qid);
      void flushQuestion(qid);
    }, PERIODIC_FLUSH_MS);
    return () => window.clearInterval(id);
  }, [activeQuestionId, disabled, accrueSegment, flushQuestion]);

  useEffect(() => {
    const onBeforeUnload = () => {
      endSegment();
      for (const [questionId, delta] of pendingDeltaRef.current.entries()) {
        if (delta > 0) {
          postDrillTimeKeepalive(sessionId, questionId, delta);
        }
      }
      pendingDeltaRef.current.clear();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [sessionId, endSegment]);

  return { flushAll };
}
