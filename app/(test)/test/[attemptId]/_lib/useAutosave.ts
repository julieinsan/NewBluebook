"use client";

import type { ModuleNumber, Section } from "@/lib/blueprint";
import { useCallback, useEffect, useRef } from "react";
import { postAnswer, postAnswerKeepalive, type AnswerPayload } from "./clientApi";

export function useAutosave(attemptId: number, section: Section, module: ModuleNumber) {
  const inFlightRef = useRef(new Map<string, Promise<void>>());
  const pendingRef = useRef(new Map<string, string | null>());

  const queueSave = useCallback(
    (questionId: string, userAnswer: string | null) => {
      const executeSave = async (qid: string, answer: string | null): Promise<void> => {
        await postAnswer(attemptId, { section, module, questionId: qid, userAnswer: answer });

        const pending = pendingRef.current.get(qid);
        if (pending !== undefined) {
          pendingRef.current.delete(qid);
          await executeSave(qid, pending);
        }
      };

      if (inFlightRef.current.has(questionId)) {
        pendingRef.current.set(questionId, userAnswer);
        return;
      }

      const promise = executeSave(questionId, userAnswer)
        .catch((err) => {
          console.error("Failed to save answer:", err);
        })
        .finally(() => {
          inFlightRef.current.delete(questionId);
        });

      inFlightRef.current.set(questionId, promise);
    },
    [attemptId, module, section],
  );

  const flushAll = useCallback(async () => {
    while (inFlightRef.current.size > 0) {
      await Promise.all([...inFlightRef.current.values()]);
    }
    for (const [questionId, userAnswer] of pendingRef.current.entries()) {
      pendingRef.current.delete(questionId);
      await postAnswer(attemptId, { section, module, questionId, userAnswer });
    }
  }, [attemptId, module, section]);

  useEffect(() => {
    const onBeforeUnload = () => {
      for (const [questionId, userAnswer] of pendingRef.current.entries()) {
        const payload: AnswerPayload = { section, module, questionId, userAnswer };
        postAnswerKeepalive(attemptId, payload);
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [attemptId, module, section]);

  return { queueSave, flushAll };
}
