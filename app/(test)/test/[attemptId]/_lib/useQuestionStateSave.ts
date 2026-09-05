"use client";

import type { ModuleNumber, Section } from "@/lib/blueprint";
import { useCallback, useRef } from "react";
import { postQuestionState } from "./clientApi";

export interface QuestionStatePatch {
  crossedOut?: string | null;
  highlights?: string | null;
}

export function useQuestionStateSave(attemptId: number, section: Section, module: ModuleNumber) {
  const inFlightRef = useRef(new Map<string, Promise<void>>());
  const pendingRef = useRef(new Map<string, QuestionStatePatch>());

  const saveQuestionState = useCallback(
    (questionId: string, patch: QuestionStatePatch): Promise<void> => {
      const executeSave = async (qid: string, payload: QuestionStatePatch): Promise<void> => {
        await postQuestionState(attemptId, qid, { section, module, ...payload });

        const pending = pendingRef.current.get(qid);
        if (pending !== undefined) {
          pendingRef.current.delete(qid);
          await executeSave(qid, pending);
        }
      };

      if (inFlightRef.current.has(questionId)) {
        const existing = pendingRef.current.get(questionId) ?? {};
        pendingRef.current.set(questionId, { ...existing, ...patch });
        return inFlightRef.current.get(questionId)!;
      }

      const promise = executeSave(questionId, patch)
        .catch((err) => {
          console.error("Failed to save question state:", err);
          throw err;
        })
        .finally(() => {
          inFlightRef.current.delete(questionId);
        });

      inFlightRef.current.set(questionId, promise);
      return promise;
    },
    [attemptId, module, section],
  );

  const flushAll = useCallback(async () => {
    while (inFlightRef.current.size > 0) {
      await Promise.all([...inFlightRef.current.values()]);
    }
    for (const [questionId, patch] of pendingRef.current.entries()) {
      pendingRef.current.delete(questionId);
      await postQuestionState(attemptId, questionId, { section, module, ...patch });
    }
  }, [attemptId, module, section]);

  return { saveQuestionState, flushAll };
}
