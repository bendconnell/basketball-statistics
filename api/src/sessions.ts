import { createHash } from "node:crypto";
import { z } from "zod";
import { applyOperation, validateState } from "../../shared/reducer.js";
import { createInitialState, parseOperation, sessionMetadataSchema, type LoadedSession, type OperationInput, type SessionMetadata, type SessionState } from "../../shared/session.js";
import { requireMaster, type LocalAccount } from "./auth.js";
import { fail, HttpError } from "./errors.js";
import type { Repository, Row } from "./repository.js";

type StoredOperation = { kind: "operation"; actorUserId: string; timestamp: string; input: OperationInput };
type Initialization = { kind: "initialization"; actorUserId: string; timestamp: string; operationId: string; gameId: string; state: SessionState };
export function stableSessionId(gameId: string, actorId: string, operationId: string): string {
  const hash = createHash("sha256").update(JSON.stringify([gameId, actorId, operationId])).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
// Stable canonical comparison avoids object-key-order false conflicts; stored JSON
// retains the complete validated payload, including expectedRevision.
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(value);
}
function contextIds(state: Pick<SessionState, "roster" | "lineupStints" | "substitutions">): string[] {
  return [...state.roster.map(p => p.id), ...state.lineupStints.map(s => s.id), ...state.substitutions.map(s => s.id)];
}
function claimedIds(op: OperationInput): string[] {
  if (op.type === "event.add") return [op.payload.event.id];
  if (op.type === "score.assist") return [op.payload.assistEventId];
  if (op.type === "possession.toggle") return [op.payload.endEventId, op.payload.nextPossessionId];
  if (op.type === "context.replace") return contextIds({ roster: op.payload.roster ?? [], lineupStints: op.payload.lineupStints ?? [], substitutions: op.payload.substitutions ?? [] });
  return [];
}
export class Sessions {
  constructor(private readonly repo: Repository, private readonly onCheckpointFailure: () => void = () => {}) {}
  async head(id: string): Promise<{ row: Row; metadata: SessionMetadata }> {
    const row = await this.repo.get("SessionOperations", id, "head");
    if (!row) return fail(404, "not_found", "Session not found");
    return { row, metadata: sessionMetadataSchema.parse(JSON.parse(row.json)) };
  }
  async list(gameId: string, account: LocalAccount): Promise<SessionMetadata[]> {
    const rows = await this.repo.list("SessionOperations", { kind: "head", gameId, masterUserId: account.id });
    return rows.map(row => sessionMetadataSchema.parse(JSON.parse(row.json))).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async create(game: { id: string; competitionId: string } & SessionState["gameDetails"], account: LocalAccount, raw: unknown): Promise<SessionMetadata> {
    const { operationId } = z.object({ operationId: z.string().uuid() }).strict().parse(raw);
    const id = stableSessionId(game.id, account.id, operationId);
    const old = await this.repo.get("SessionOperations", id, "head");
    if (old) return sessionMetadataSchema.parse(JSON.parse(old.json));
    const timestamp = new Date().toISOString();
    const { gameTitle, teamName, opponentName, gameDate, venue, notes } = game;
    const state = createInitialState({ gameTitle, teamName, opponentName, gameDate, venue, notes });
    const metadata: SessionMetadata = { id, gameId: game.id, competitionId: game.competitionId, masterUserId: account.id, revision: 0, status: "setup", createdAt: timestamp, updatedAt: timestamp };
    const initialization: Initialization = { kind: "initialization", actorUserId: account.id, timestamp, operationId, gameId: game.id, state };
    // Initial state is in the SAME atomic log/head transaction, not only Blob.
    // No separate metadata index can leave partially readable orphan sessions.
    try {
      await this.repo.transact("SessionOperations", [
        { type: "insert", row: { partitionKey: id, rowKey: "head", kind: "head", gameId: game.id, masterUserId: account.id, revision: 0, json: JSON.stringify(metadata) } },
        { type: "insert", row: { partitionKey: id, rowKey: `op:${operationId}`, kind: "initialization", revision: 0, json: JSON.stringify(initialization) } }
      ]);
    } catch (e) {
      if (e instanceof HttpError && e.status === 409) {
        const existing = await this.repo.get("SessionOperations", id, "head");
        if (existing) return sessionMetadataSchema.parse(JSON.parse(existing.json));
      }
      throw e;
    }
    await this.checkpoint({ session: metadata, state });
    return metadata;
  }
  async load(id: string, account: LocalAccount): Promise<LoadedSession> {
    const { metadata } = await this.head(id);
    requireMaster(account, metadata.masterUserId); // Admin is NOT a session member.
    const rows = (await this.repo.list("SessionOperations", { partitionKey: id })).filter(row => row.kind === "initialization" || row.kind === "operation").filter(row => row.revision !== undefined && row.revision <= metadata.revision).sort((a, b) => a.revision! - b.revision!);
    const initial = rows.shift();
    if (!initial || initial.kind !== "initialization" || initial.revision !== 0) throw new Error("Session initialization missing");
    const init = JSON.parse(initial.json) as Initialization;
    if (init.actorUserId !== metadata.masterUserId || init.gameId !== metadata.gameId) throw new Error("Invalid initialization identity");
    let state = validateState(init.state), revision = 0;
    for (const row of rows) {
      if (row.revision !== revision + 1) throw new Error("Noncontiguous operation log");
      const entry = JSON.parse(row.json) as StoredOperation;
      if (entry.actorUserId !== metadata.masterUserId) throw new Error("Invalid operation actor");
      state = applyOperation(state, entry.input, { sessionId: id, actorUserId: entry.actorUserId, revision: row.revision, timestamp: entry.timestamp });
      revision = row.revision;
    }
    if (revision !== metadata.revision) throw new Error("Incomplete committed operation log");
    return { session: metadata, state };
  }
  async write(id: string, account: LocalAccount, raw: unknown): Promise<{ revision: number }> {
    const op = parseOperation(raw);
    const { row: head, metadata } = await this.head(id);
    requireMaster(account, metadata.masterUserId);
    const dedup = async () => {
      const existing = await this.repo.get("SessionOperations", id, `op:${op.operationId}`);
      if (!existing) return null;
      const entry = JSON.parse(existing.json) as StoredOperation;
      if (entry.kind !== "operation" || entry.actorUserId !== account.id || canonical(entry.input) !== canonical(op)) return fail(409, "operation_id_reused", "Operation ID was already used with different content or actor");
      return { revision: existing.revision! };
    };
    const already = await dedup(); // BEFORE expected revision check.
    if (already) return already;
    if (op.expectedRevision !== metadata.revision) return fail(409, "stale_revision", "Revision changed; reload before retrying");
    if (metadata.status === "archived") return fail(409, "session_archived", "Session is archived");
    const loaded = await this.load(id, account);
    if (loaded.session.revision !== metadata.revision) return fail(409, "stale_revision", "Revision changed; reload before retrying");
    // Deleted events / undone boundaries remain claimed in the immutable log.
    // Reducer alone can detect live duplicates; server also rejects lifetime reuse.
    const priorRows = (await this.repo.list("SessionOperations", { partitionKey: id })).filter(row => row.revision !== undefined && row.revision <= metadata.revision);
    const used = new Set<string>();
    for (const old of priorRows) {
      if (old.kind === "operation") claimedIds((JSON.parse(old.json) as StoredOperation).input).forEach(value => used.add(value));
      if (old.kind === "initialization") {
        const initial = (JSON.parse(old.json) as Initialization).state;
        [...contextIds(initial), ...initial.possessions.flatMap(p => [p.id, ...p.events.map(e => e.id)])].forEach(value => used.add(value));
      }
    }
    for (const value of claimedIds(op)) {
      const retained = op.type === "context.replace" && (
        op.payload.roster?.some(p => p.id === value) && loaded.state.roster.some(p => p.id === value)
        || op.payload.lineupStints?.some(s => s.id === value) && loaded.state.lineupStints.some(s => s.id === value)
        || op.payload.substitutions?.some(s => s.id === value) && loaded.state.substitutions.some(s => s.id === value)
      );
      if (used.has(value) && !retained) return fail(400, "id_reused", "Entity IDs cannot be reused, including deleted events or undone boundaries");
    }
    const revision = metadata.revision + 1, timestamp = new Date().toISOString();
    const state = applyOperation(loaded.state, op, { sessionId: id, actorUserId: account.id, revision, timestamp });
    const next: SessionMetadata = { ...metadata, revision, updatedAt: timestamp, status: state.sessionStarted ? "active" : "setup" };
    const entry: StoredOperation = { kind: "operation", actorUserId: account.id, timestamp, input: op };
    const json = JSON.stringify(entry);
    if (Buffer.byteLength(json, "utf16le") >= 64 * 1024) return fail(413, "too_large", "Stored operation exceeds Table property limit");
    try {
      await this.repo.transact("SessionOperations", [
        { type: "replace", etag: head.etag, row: { ...head, revision, json: JSON.stringify(next) } },
        { type: "insert", row: { partitionKey: id, rowKey: `op:${op.operationId}`, kind: "operation", revision, json } }
      ]);
    } catch (e) {
      if (e instanceof HttpError && e.status === 409) { const retry = await dedup(); if (retry) return retry; }
      throw e;
    }
    await this.checkpoint({ session: next, state });
    return { revision };
  }
  private async checkpoint(snapshot: LoadedSession) {
    try { await this.repo.checkpoint(snapshot); } catch { this.onCheckpointFailure(); }
  }
}