import type { Competition, LocalAccount, ScheduledGame } from "./competitions";
import type { LoadedSession, OperationInput, SessionMetadata } from "../../shared/session";
import type { Player, StatisticsConfiguration } from "../types";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export async function request<T>(path: string, method = "GET", body?: unknown, etag?: string, createOnly = false): Promise<T> {
  const response = await fetch(`/api/v1/${path}`, {
    method, credentials: "same-origin", cache: "no-store",
    headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(etag ? { "If-Match": etag } : {}), ...(createOnly ? { "If-None-Match": "*" } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new ApiError(response.status, error.code ?? error.error?.code ?? "request_failed",
      typeof error.message === "string" ? error.message : error.error?.message ?? `Request failed (${response.status}).`);
  }
  return response.status === 204 ? undefined as T : response.json();
}
export type CloudCompetition = Competition & { archived: boolean; etag: string };
export type CloudGame = ScheduledGame & { archived: boolean; etag: string };
export const api = {
  me: () => request<LocalAccount>("me"),
  users: () => request<LocalAccount[]>("users"),
  preferences: () => request<{ roster: Player[]; statistics: StatisticsConfiguration; etag: string | null }>("me/preferences"),
  competitions: () => request<CloudCompetition[]>("competitions"),
  games: (id: string) => request<CloudGame[]>(`competitions/${encodeURIComponent(id)}/games`),
  sessions: (gameId: string) => request<SessionMetadata[]>(`games/${encodeURIComponent(gameId)}/sessions`),
  createSession: (gameId: string, operationId: string) => request<SessionMetadata>(`games/${encodeURIComponent(gameId)}/sessions`, "POST", { operationId }),
  loadSession: (id: string) => request<LoadedSession>(`sessions/${encodeURIComponent(id)}/snapshot`),
  writeOperation: (id: string, operation: OperationInput) => request<{ revision: number }>(`sessions/${encodeURIComponent(id)}/operations`, "POST", operation)
};