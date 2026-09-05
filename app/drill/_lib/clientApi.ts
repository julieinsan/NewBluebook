import type { DrillRunnerState } from "@/lib/drillContract";

async function parseJsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed with status ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export async function postStartDrillSession(filters: {
  domain: string;
  skill?: string | null;
  difficulty?: string;
}): Promise<{ sessionId: number; next: string; state: DrillRunnerState }> {
  const response = await fetch("/api/drill/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(filters),
  });
  return parseJsonResponse(response);
}

export async function postDrillAnswer(
  sessionId: number,
  questionId: string,
  userAnswer: string | null,
): Promise<{ state: DrillRunnerState }> {
  const response = await fetch(`/api/drill/sessions/${sessionId}/answers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ questionId, userAnswer }),
  });
  return parseJsonResponse(response);
}

export async function postDrillNext(sessionId: number): Promise<{ state: DrillRunnerState }> {
  const response = await fetch(`/api/drill/sessions/${sessionId}/next`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  return parseJsonResponse(response);
}

export async function postDrillTime(
  sessionId: number,
  questionId: string,
  timeSpentDelta: number,
  init?: RequestInit,
): Promise<{ ok: boolean }> {
  const response = await fetch(`/api/drill/sessions/${sessionId}/time`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ questionId, timeSpentDelta }),
    ...init,
  });
  return parseJsonResponse(response);
}

export function postDrillTimeKeepalive(
  sessionId: number,
  questionId: string,
  timeSpentDelta: number,
): void {
  void postDrillTime(sessionId, questionId, timeSpentDelta, { keepalive: true });
}
