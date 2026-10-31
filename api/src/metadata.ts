import { randomUUID } from "node:crypto";
import { z } from "zod";
import { gameDetailsSchema, rosterSchema, statisticsSchema, defaultStatistics } from "../../shared/session.js";
import { requireAdmin, type LocalAccount } from "./auth.js";
import { fail } from "./errors.js";
import type { Repository, Row, Action } from "./repository.js";

export const competitionInputSchema = z.object({ name: z.string().trim().min(1).max(200) }).strict();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => {
  const d = new Date(`${v}T00:00:00Z`); return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
}, "Invalid calendar date");
export const gameInputSchema = gameDetailsSchema.extend({
  gameTitle: z.string().trim().min(1).max(200), teamName: z.string().trim().min(1).max(200), opponentName: z.string().trim().min(1).max(200),
  gameDate: date, gameTime: z.string().regex(/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/)
}).strict();
export const preferencesSchema = z.object({ roster: rosterSchema, statistics: statisticsSchema }).strict().superRefine((p, ctx) => {
  if (new Set(p.roster.map(v => v.id)).size !== p.roster.length || new Set(p.roster.map(v => v.number)).size !== p.roster.length) ctx.addIssue({ code: "custom", message: "Duplicate roster IDs or jersey numbers" });
});
export type Competition = { id: string; name: string; subscriberIds: string[]; archived: boolean; etag: string };
export type ScheduledGame = z.infer<typeof gameInputSchema> & { id: string; competitionId: string; archived: boolean; etag: string };
type StoredCompetition = { id: string; name: string; archived: boolean };
type StoredGame = Omit<ScheduledGame, "etag">;
const catalog = "catalog";
function userKey(id: string) { return Buffer.from(id).toString("base64url"); }
function encode(value: unknown): string {
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json, "utf16le") >= 48 * 1024 || Buffer.byteLength(json) >= 48 * 1024) return fail(413, "too_large", "Metadata must be smaller than 48 KiB");
  return json;
}
export function requireMatch(row: Row, supplied: string | null): void {
  if (!supplied || supplied === "*") fail(428, "etag_required", "Explicit If-Match ETag required");
  if (supplied !== row.etag) fail(412, "etag_mismatch", "Metadata changed; reload before retrying");
}
function replace(row: Row, value?: unknown): Action { return { type: "replace", etag: row.etag, row: { ...row, json: value === undefined ? row.json : encode(value) } }; }
export class Metadata {
  constructor(private readonly repo: Repository, private readonly accounts: LocalAccount[]) {}
  async competition(id: string): Promise<{ row: Row; value: StoredCompetition }> {
    const row = await this.repo.get("CompetitionData", catalog, `comp:${id}`);
    if (!row) return fail(404, "not_found", "Competition not found");
    return { row, value: JSON.parse(row.json) as StoredCompetition };
  }
  async game(id: string): Promise<{ row: Row; value: StoredGame }> {
    const row = await this.repo.get("CompetitionData", catalog, `game:${id}`);
    if (!row) return fail(404, "not_found", "Game not found");
    return { row, value: JSON.parse(row.json) as StoredGame };
  }
  async requireAccess(id: string, account: LocalAccount, allowArchived = false) {
    const comp = await this.competition(id);
    if (!allowArchived && comp.value.archived) fail(409, "archived", "Competition is archived");
    if (account.role !== "administrator" && (await this.repo.get("CompetitionData", catalog, `sub:${id}:${userKey(account.id)}`))?.kind !== "subscription") fail(403, "subscription_required", "Competition subscription required");
    return comp;
  }
  private async viewCompetition(row: Row, account: LocalAccount): Promise<Competition> {
    const value = JSON.parse(row.json) as StoredCompetition;
    const subscriptions = await this.repo.list("CompetitionData", { partitionKey: catalog, kind: "subscription" });
    const subscriberIds = subscriptions.map(s => JSON.parse(s.json) as { competitionId: string; userId: string }).filter(s => s.competitionId === value.id && this.accounts.some(a => a.id === s.userId) && (account.role === "administrator" || s.userId === account.id)).map(s => s.userId);
    return { ...value, subscriberIds, etag: row.etag! };
  }
  async listCompetitions(account: LocalAccount) {
    const rows = await this.repo.list("CompetitionData", { partitionKey: catalog, kind: "competition" });
    return Promise.all(rows.filter(r => !(JSON.parse(r.json) as StoredCompetition).archived).map(r => this.viewCompetition(r, account)));
  }
  async createCompetition(account: LocalAccount, input: unknown) {
    requireAdmin(account);
    const value = { id: randomUUID(), ...competitionInputSchema.parse(input), archived: false };
    await this.repo.transact("CompetitionData", [{ type: "insert", row: { partitionKey: catalog, rowKey: `comp:${value.id}`, kind: "competition", json: encode(value) } }]);
    return this.viewCompetition((await this.competition(value.id)).row, account);
  }
  async changeCompetition(id: string, account: LocalAccount, input: unknown, etag: string | null, archive: boolean) {
    requireAdmin(account);
    const { row, value } = await this.competition(id);
    requireMatch(row, etag);
    if (value.archived) fail(409, "archived", "Competition is archived");
    const next = archive ? { ...value, archived: true } : { ...value, ...competitionInputSchema.parse(input) };
    await this.repo.transact("CompetitionData", [replace(row, next)]);
    return this.viewCompetition((await this.competition(id)).row, account);
  }
  async listGames(id: string, account: LocalAccount) {
    await this.requireAccess(id, account);
    const rows = await this.repo.list("CompetitionData", { partitionKey: catalog, kind: "game" });
    return rows.map(row => ({ ...JSON.parse(row.json) as StoredGame, etag: row.etag! })).filter(g => g.competitionId === id && !g.archived);
  }
  async createGame(id: string, account: LocalAccount, input: unknown) {
    requireAdmin(account);
    const comp = await this.requireAccess(id, account);
    const value: StoredGame = { id: randomUUID(), competitionId: id, ...gameInputSchema.parse(input), archived: false };
    // Touch parent in same catalog partition to serialize with archive/subscription.
    await this.repo.transact("CompetitionData", [replace(comp.row), { type: "insert", row: { partitionKey: catalog, rowKey: `game:${value.id}`, kind: "game", json: encode(value) } }]);
    return { ...value, etag: (await this.game(value.id)).row.etag! };
  }
  async changeGame(id: string, account: LocalAccount, input: unknown, etag: string | null, archive: boolean) {
    requireAdmin(account);
    const { row, value } = await this.game(id);
    const comp = await this.requireAccess(value.competitionId, account);
    requireMatch(row, etag);
    if (value.archived) fail(409, "archived", "Game is archived");
    const changes = archive ? {} : gameInputSchema.partial().strict().refine(v => Object.keys(v).length > 0, "Empty game patch").parse(input);
    const next = { ...value, ...changes, archived: archive };
    await this.repo.transact("CompetitionData", [replace(comp.row), replace(row, next)]);
    return { ...next, etag: (await this.game(id)).row.etag! };
  }
  async subscribe(id: string, userId: string, account: LocalAccount, remove: boolean) {
    if (account.id !== userId) requireAdmin(account);
    if (!this.accounts.some(a => a.id === userId)) fail(404, "not_found", "Approved account not found");
    const { row, value } = await this.competition(id);
    // Removing subscriptions from archives is allowed; adding is not.
    if (!remove && value.archived) fail(409, "archived", "Competition is archived");
    const rowKey = `sub:${id}:${userKey(userId)}`;
    const old = await this.repo.get("CompetitionData", catalog, rowKey);
    const active = old?.kind === "subscription";
    if (remove ? !active : active) return;
    // Logical DELETE is a conditional update. The Tables SDK transaction delete
    // tuple has no ETag option, so never use its unconditional physical delete.
    const action: Action = { type: old ? "replace" : "insert", etag: old?.etag, row: { partitionKey: catalog, rowKey, kind: remove ? "revoked_subscription" : "subscription", json: encode({ competitionId: id, userId }) } };
    await this.repo.transact("CompetitionData", [replace(row), action]);
  }
  async preferences(account: LocalAccount) {
    const row = await this.repo.get("CompetitionData", `user:${userKey(account.id)}`, "preferences");
    return row ? { ...preferencesSchema.parse(JSON.parse(row.json)), etag: row.etag! } : { roster: [], statistics: defaultStatistics(), etag: null };
  }
  async savePreferences(account: LocalAccount, input: unknown, ifMatch: string | null, ifNoneMatch: string | null) {
    const value = preferencesSchema.parse(input), partitionKey = `user:${userKey(account.id)}`;
    const old = await this.repo.get("CompetitionData", partitionKey, "preferences");
    if (old) requireMatch(old, ifMatch);
    else if (ifNoneMatch !== "*") fail(428, "etag_required", "First preferences write requires If-None-Match: *");
    const row: Row = { partitionKey, rowKey: "preferences", kind: "preferences", json: encode(value) };
    await this.repo.transact("CompetitionData", [{ type: old ? "replace" : "insert", row, etag: old?.etag }]);
    return this.preferences(account);
  }
}