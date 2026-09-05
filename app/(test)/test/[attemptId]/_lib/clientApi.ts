import type { ModuleNumber, Section } from "@/lib/blueprint";

async function parseJsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed with status ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export interface AnswerPayload {
  section: Section;
  module: ModuleNumber;
  questionId: string;
  userAnswer: string | null;
}

export async function postAnswer(
  attemptId: number,
  payload: AnswerPayload,
  init?: RequestInit,
): Promise<{ saved: boolean; isLate: boolean }> {
  const response = await fetch(`/api/attempts/${attemptId}/answers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    ...init,
  });
  return parseJsonResponse(response);
}

/** Body for `POST .../questions/:qid/state` — Epic 3 flagging plus Epic 4 tools. */
export interface QuestionStatePayload {
  section: Section;
  module: ModuleNumber;
  flagged?: boolean;
  /** Raw JSON text for crossed-out choice letters (D2). */
  crossedOut?: string | null;
  /** Raw JSON text for passage highlight ranges (D4). */
  highlights?: string | null;
}

export async function postQuestionState(
  attemptId: number,
  questionId: string,
  payload: QuestionStatePayload,
): Promise<{ ok: boolean }> {
  const response = await fetch(`/api/attempts/${attemptId}/questions/${questionId}/state`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJsonResponse(response);
}

export async function postEndModule(
  attemptId: number,
  payload: { section: Section; module: ModuleNumber },
): Promise<{ next: string }> {
  const response = await fetch(`/api/attempts/${attemptId}/end-module`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJsonResponse(response);
}

export async function postEndBreak(attemptId: number): Promise<{ next: string }> {
  const response = await fetch(`/api/attempts/${attemptId}/end-break`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  return parseJsonResponse(response);
}

export async function postSubmit(attemptId: number): Promise<{ ok: boolean }> {
  const response = await fetch(`/api/attempts/${attemptId}/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  return parseJsonResponse(response);
}

export async function postStartAttempt(practiceTest: 1 | 2 = 1): Promise<{
  attemptId: number;
  practiceTest: 1 | 2;
  next: string;
}> {
  const response = await fetch("/api/attempts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ practiceTest }),
  });
  return parseJsonResponse(response);
}

export async function postPause(attemptId: number): Promise<{ ok: boolean }> {
  const response = await fetch(`/api/attempts/${attemptId}/pause`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  return parseJsonResponse(response);
}

export async function postResume(attemptId: number): Promise<{ next: string }> {
  const response = await fetch(`/api/attempts/${attemptId}/resume`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  return parseJsonResponse(response);
}

/** Fire-and-forget save for unload — uses keepalive so the browser may complete it. */
export function postAnswerKeepalive(attemptId: number, payload: AnswerPayload): void {
  void fetch(`/api/attempts/${attemptId}/answers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    keepalive: true,
  });
}
