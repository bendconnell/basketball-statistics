import { z } from "zod";
import { authenticate, requireAdmin, requireMaster, type LocalAccount } from "./auth.js";
import { fail } from "./errors.js";
import { Metadata } from "./metadata.js";
import { Sessions } from "./sessions.js";
import type { Repository } from "./repository.js";

export type ApiResponse = { status: number; body?: unknown };
export class ApiService {
  readonly metadata: Metadata;
  readonly sessions: Sessions;
  constructor(repo: Repository, private readonly accounts: LocalAccount[], checkpointWarning?: () => void) {
    this.metadata = new Metadata(repo, accounts); this.sessions = new Sessions(repo, checkpointWarning);
  }
  async handle(method: string, path: string, headers: Headers, body?: unknown): Promise<ApiResponse> {
    if (method === "GET" && path === "v1/health") return { status: 200, body: { status: "ok" } };
    const account = authenticate(headers.get("x-ms-client-principal"), this.accounts);
    const ok = (body: unknown, status = 200) => ({ status, body });
    if (path === "v1/me" && method === "GET") return ok(account);
    if (path === "v1/users" && method === "GET") { requireAdmin(account); return ok(this.accounts); }
    if (path === "v1/me/preferences") {
      if (method === "GET") return ok(await this.metadata.preferences(account));
      if (method === "PUT") return ok(await this.metadata.savePreferences(account, body, headers.get("if-match"), headers.get("if-none-match")));
    }
    if (path === "v1/competitions") {
      if (method === "GET") return ok(await this.metadata.listCompetitions(account));
      if (method === "POST") return ok(await this.metadata.createCompetition(account, body), 201);
    }
    const parts = path.split("/").map(v => decodeURIComponent(v));
    const [, resource, id, child, childId] = parts;
    if (parts[0] !== "v1" || !id || id.length > 256) return fail(404, "not_found", "Route not found");
    // IDs in route parameters are only ever escaped by the repository's odata
    // helper; no raw client string is concatenated into a query expression.
    if (resource === "competitions") {
      if (parts.length === 3 && (method === "PATCH" || method === "DELETE")) return ok(await this.metadata.changeCompetition(id, account, body, headers.get("if-match"), method === "DELETE"));
      if (child === "games" && parts.length === 4) {
        if (method === "GET") return ok(await this.metadata.listGames(id, account));
        if (method === "POST") return ok(await this.metadata.createGame(id, account, body), 201);
      }
      if (child === "subscriptions" && childId && parts.length === 5 && (method === "PUT" || method === "DELETE")) {
        if (body !== undefined && (typeof body !== "object" || body === null || Object.keys(body).length)) fail(400, "invalid_body", "Subscription route does not accept a payload");
        await this.metadata.subscribe(id, childId, account, method === "DELETE"); return { status: 204 };
      }
    }
    if (resource === "games") {
      if (parts.length === 3 && (method === "PATCH" || method === "DELETE")) return ok(await this.metadata.changeGame(id, account, body, headers.get("if-match"), method === "DELETE"));
      if (child === "sessions" && parts.length === 4 && (method === "GET" || method === "POST")) {
        const { value: game } = await this.metadata.game(id);
        await this.metadata.requireAccess(game.competitionId, account, method === "GET");
        if (method === "GET") return ok(await this.sessions.list(id, account));
        z.object({ operationId: z.string().uuid() }).strict().parse(body);
        if (game.archived) fail(409, "archived", "Game is archived");
        return ok(await this.sessions.create(game, account, body), 201);
      }
    }
    if (resource === "sessions" && parts.length === 4 && ((child === "snapshot" && method === "GET") || (child === "operations" && method === "POST"))) {
      const { metadata } = await this.sessions.head(id);
      requireMaster(account, metadata.masterUserId);
      await this.metadata.requireAccess(metadata.competitionId, account, true);
      const { value: game } = await this.metadata.game(metadata.gameId);
      if (game.competitionId !== metadata.competitionId) throw new Error("Invalid session game reference");
      return child === "snapshot" ? ok(await this.sessions.load(id, account)) : ok(await this.sessions.write(id, account, body));
    }
    return fail(404, "not_found", "Route not found");
  }
}