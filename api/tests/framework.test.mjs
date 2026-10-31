import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { authenticate, approvedAccounts, requireMaster } from "../dist/api/src/auth.js";
import { MemoryRepository, AzureRepository } from "../dist/api/src/repository.js";
import { ApiService } from "../dist/api/src/service.js";
import { createInitialState, parseOperation, sessionStateSchema } from "../dist/shared/session.js";
import { applyOperation, validateState } from "../dist/shared/reducer.js";
import { readBody } from "../dist/api/src/http.js";
import { Readable } from "node:stream";

const admin = { id: "admin-subject", name: "Admin", role: "administrator" };
const user = { id: "user-subject", name: "User", role: "user" };
const other = { id: "other-subject", name: "Other", role: "user" };
const accounts = [admin, user, other];
const details = { gameTitle: "Round 1", teamName: "Home", opponentName: "Away", gameDate: "2026-10-31", venue: "Court", notes: "" };
const gameInput = { ...details, gameTime: "15:00" };
const headers = (account, extra = {}, roles = ["authenticated"]) => new Headers({ "x-ms-client-principal": Buffer.from(JSON.stringify({ userId: account.id, userRoles: roles, userDetails: "Untrusted name" })).toString("base64"), ...extra });
const operation = (type, payload, expectedRevision = 0, operationId = randomUUID()) => ({ operationId, expectedRevision, type, payload });
const context = revision => ({ sessionId: "session-id", actorUserId: user.id, revision, timestamp: "2026-10-31T00:00:00.000Z" });
const setup = {
  roster: Array.from({ length: 6 }, (_, i) => ({ id: `p-${i + 1}`, number: i + 1, name: `Player ${i + 1}` })),
  onCourtLineup: ["p-1", "p-2", "p-3", "p-4", "p-5"], sessionStarted: true,
  lineupStints: [{ id: "stint-1", label: "Lineup 1", quarter: 1, startClock: "10:00", endClock: "10:00", lineupIds: ["p-1", "p-2", "p-3", "p-4", "p-5"] }]
};
function started() { return applyOperation(createInitialState(details), operation("context.replace", setup), context(1)); }
function apply(state, type, payload, revision = 2) { return applyOperation(state, operation(type, payload, revision - 1), context(revision)); }
async function fixture() {
  const repo = new MemoryRepository(), service = new ApiService(repo, accounts);
  const comp = (await service.handle("POST", "v1/competitions", headers(admin), { name: "League" })).body;
  const game = (await service.handle("POST", `v1/competitions/${comp.id}/games`, headers(admin), gameInput)).body;
  await service.handle("PUT", `v1/competitions/${comp.id}/subscriptions/${user.id}`, headers(user));
  return { repo, service, comp, game };
}
async function createSession(f) {
  return (await f.service.handle("POST", `v1/games/${f.game.id}/sessions`, headers(user), { operationId: randomUUID() })).body;
}

test("auth rejects absent, malformed, anonymous and unapproved principals", () => {
  for (const value of [null, "!", Buffer.from("{}").toString("base64"), headers(user, {}, ["anonymous"]).get("x-ms-client-principal")]) assert.throws(() => authenticate(value, accounts), e => e.status === 401);
  assert.throws(() => authenticate(headers({ id: "unknown" }).get("x-ms-client-principal"), accounts), e => e.status === 403);
});
test("approved configuration fails closed; role/name are never trusted from headers", () => {
  for (const raw of [undefined, "{}", "[]", JSON.stringify([user, user]), JSON.stringify([{ ...user, role: "owner" }])]) assert.throws(() => approvedAccounts(raw), e => e.status === 503);
  assert.deepEqual(authenticate(headers(user, {}, ["authenticated", "administrator"]).get("x-ms-client-principal"), accounts), user);
  assert.throws(() => requireMaster(admin, user.id), e => e.status === 403);
  assert.throws(() => requireMaster(other, user.id), e => e.status === 403);
});
test("reducer scoring, default points, deterministic replay and provenance", () => {
  const original = started(), frozen = JSON.stringify(original);
  const op = operation("event.add", { possessionId: "pos-01", event: { id: "score-1", type: "shot_made", playerId: "p-1", clock: "09:50", points: 3 } }, 1);
  const next = applyOperation(original, op, context(2));
  assert.deepEqual(next, applyOperation(original, op, context(2)));
  assert.equal(JSON.stringify(original), frozen);
  assert.equal(next.possessions[0].pointsFor, 3);
  assert.deepEqual(next.possessions[0].events[0].provenance, context(2));
  assert.equal(next.possessions[0].events[0].lineupStintId, "stint-1");
  const against = apply(next, "event.add", { possessionId: "pos-01", event: { id: "opp-1", type: "opp_score", playerId: "", clock: "09:45" } }, 3);
  assert.equal(against.possessions[0].pointsAgainst, 2);
});
test("linked assists update authoritatively; deleting score or assist clears linkage/totals", () => {
  const scored = apply(started(), "event.add", { possessionId: "pos-01", event: { id: "score-1", type: "shot_made", playerId: "p-1", clock: "09:50" } });
  const assisted = apply(scored, "score.assist", { possessionId: "pos-01", scoreId: "score-1", assist: { status: "player", playerId: "p-2" }, assistEventId: "assist-1" }, 3);
  const score = assisted.possessions[0].events[0], assist = assisted.possessions[0].events[1];
  assert.deepEqual(score.provenance, context(2)); assert.deepEqual(score.updatedProvenance, context(3));
  assert.equal(assist.linkedScoreId, score.id); assert.deepEqual(assist.provenance, context(3));
  const removedAssist = apply(assisted, "event.delete", { possessionId: "pos-01", eventId: "assist-1" }, 4);
  assert.equal(removedAssist.possessions[0].pointsFor, 2);
  assert.equal(removedAssist.possessions[0].events[0].assist.status, "unknown");
  const removedScore = apply(assisted, "event.delete", { possessionId: "pos-01", eventId: "score-1" }, 4);
  assert.equal(removedScore.possessions[0].pointsFor, 0); assert.equal(removedScore.possessions[0].events.length, 0);
});
test("same-clock substitution/context preserves score stint attribution and historical assists", () => {
  const scored = apply(started(), "event.add", { possessionId: "pos-01", event: { id: "score-1", type: "shot_made", playerId: "p-1", clock: "09:50" } });
  const nextIds = ["p-1", "p-3", "p-4", "p-5", "p-6"];
  assert.throws(() => apply(scored, "context.replace", { onCourtLineup: nextIds }, 3));
  const substituted = apply(scored, "context.replace", {
    onCourtLineup: nextIds,
    lineupStints: [{ ...setup.lineupStints[0], endClock: "09:50" }, { id: "stint-2", label: "Lineup 2", quarter: 1, startClock: "09:50", endClock: "09:50", lineupIds: nextIds }],
    substitutions: [{ id: "sub-1", quarter: 1, clock: "09:50", playerOutId: "p-2", playerInId: "p-6" }]
  }, 3);
  const scoredAgain = apply(substituted, "event.add", { possessionId: "pos-01", event: { id: "score-2", type: "shot_made", playerId: "p-6", clock: "09:50" } }, 4);
  assert.equal(scoredAgain.possessions[0].events[0].lineupStintId, "stint-1");
  assert.equal(scoredAgain.possessions[0].events[1].lineupStintId, "stint-2");
  const assisted = apply(scoredAgain, "score.assist", { possessionId: "pos-01", scoreId: "score-1", assist: { status: "player", playerId: "p-2" }, assistEventId: "assist-1" }, 5);
  assert.equal(assisted.possessions[0].events[2].lineupStintId, "stint-1");
});
test("self/off-lineup assists, duplicate IDs, unknown players and points on passes fail", () => {
  const state = started();
  for (const event of [
    { id: "p-1", type: "shot_made", playerId: "p-1", clock: "09:50" },
    { id: "e-1", type: "pass", playerId: "unknown", clock: "09:50" },
    { id: "e-1", type: "pass", playerId: "p-6", clock: "09:50" },
    { id: "e-1", type: "pass", playerId: "p-1", clock: "09:50", points: 2 },
    { id: "e-1", type: "shot_made", playerId: "p-1", clock: "09:50", points: 4 }
  ]) assert.throws(() => apply(state, "event.add", { possessionId: "pos-01", event }));
  const scored = apply(state, "event.add", { possessionId: "pos-01", event: { id: "score-1", type: "shot_made", playerId: "p-1", clock: "09:50" } });
  for (const playerId of ["p-1", "p-6", "unknown"]) assert.throws(() => apply(scored, "score.assist", { possessionId: "pos-01", scoreId: "score-1", assist: { status: "player", playerId }, assistEventId: "assist-1" }, 3));
});
test("possession toggle closes/flips and empty toggle restores previous boundary", () => {
  const payload = { clock: "09:30", lineupStintId: "stint-1", lineupIds: setup.onCourtLineup, endEventId: "boundary-1", nextPossessionId: "pos-02" };
  const closed = apply(started(), "possession.toggle", payload);
  assert.equal(closed.possessions.length, 2); assert.equal(closed.currentSide, "defense");
  assert.equal(closed.possessions[0].completed, true);
  assert.deepEqual(closed.possessions[0].events[0].provenance, context(2));
  assert.throws(() => apply(closed, "event.delete", { possessionId: "pos-01", eventId: "boundary-1" }, 3));
  const reopened = apply(closed, "possession.toggle", { ...payload, clock: "09:20", endEventId: "boundary-2", nextPossessionId: "pos-03" }, 3);
  assert.equal(reopened.possessions.length, 1); assert.equal(reopened.currentSide, "offense"); assert.equal(reopened.possessions[0].events.length, 0);
});
test("details round trip null/false/zero; toggle after known details cannot undo", () => {
  const payload = { clock: "09:30", lineupStintId: "stint-1", lineupIds: setup.onCourtLineup, endEventId: "boundary-1", nextPossessionId: "pos-02" };
  let state = apply(started(), "possession.toggle", payload);
  state = apply(state, "possession.details", { possessionId: "pos-02", data: { passCount: 0, paintTouch: false, fastBreak: null } }, 3);
  assert.equal(state.possessions[1].passCount, 0); assert.equal(state.possessions[1].hadPaintTouch, false); assert.equal(state.possessions[1].wasFastBreak, null);
  assert.equal(apply(state, "possession.toggle", { ...payload, endEventId: "boundary-2", nextPossessionId: "pos-03" }, 4).possessions.length, 3);
});
test("context validation excludes possessions, invalid bounds/references and tampered provenance", () => {
  const state = started();
  for (const payload of [{ possessions: [] }, { clockSeconds: -1 }, { clockSeconds: 3601 }, { roster: [] }, { onCourtLineup: ["p-1", "p-1"] }, { startingLineupsByQuarter: { 21: [] } }, { statistics: { offense: { fake: true }, defense: {} } }, { substitutions: [{ id: "s-1", quarter: 1, clock: "10:00", playerOutId: "p-1", playerInId: "p-1" }] }]) assert.throws(() => apply(state, "context.replace", payload));
  assert.throws(() => apply(state, "event.add", { possessionId: "pos-01", event: { id: "e-1", playerId: "p-1", type: "pass", clock: "10:00", provenance: context(1) } }));
  assert.throws(() => validateState({ ...state, possessions: [{ ...state.possessions[0], pointsFor: 2 }] }));
  assert.throws(() => apply(state, "context.replace", { lineupStints: [{ ...setup.lineupStints[0], lineupIds: ["p-2"] }] }));
});
test("operation payload bound covers UTF-16 and UTF-8; strict envelope", () => {
  assert.throws(() => parseOperation(operation("context.replace", { roster: Array.from({ length: 100 }, (_, i) => ({ id: `p-${i}`, name: "x".repeat(120), number: i })), substitutions: Array.from({ length: 200 }, (_, i) => ({ id: `s-${i}`, quarter: 1, clock: "10:00", playerOutId: "p-1", playerInId: "p-2" })) })));
  assert.throws(() => parseOperation({ ...operation("possession.details", { possessionId: "pos-01", data: {} }), actorUserId: admin.id }));
  assert.throws(() => parseOperation(operation("context.replace", { clockSeconds: NaN })));
  const input = operation("context.replace", { roster: [{ id: "p-1", number: 1, name: "  Player name  " }] });
  assert.deepEqual(parseOperation(input), input); // Validate, never silently normalize log payload.
});
test("metadata authorization, discovery privacy, schedule gameTime and ETag guards", async () => {
  const f = await fixture();
  await assert.rejects(f.service.handle("POST", "v1/competitions", headers(user), { name: "No" }), e => e.status === 403);
  await assert.rejects(f.service.handle("GET", "v1/users", headers(user)), e => e.status === 403);
  await assert.rejects(f.service.handle("PUT", `v1/competitions/${f.comp.id}/subscriptions/${other.id}`, headers(user)), e => e.status === 403);
  await assert.rejects(f.service.handle("GET", `v1/competitions/${f.comp.id}/games`, headers(other)), e => e.status === 403);
  assert.equal((await f.service.handle("GET", `v1/competitions/${f.comp.id}/games`, headers(user))).body[0].gameTime, "15:00");
  assert.deepEqual((await f.service.handle("GET", "v1/competitions", headers(other))).body[0].subscriberIds, []);
  assert.deepEqual((await f.service.handle("GET", "v1/competitions", headers(user))).body[0].subscriberIds, [user.id]);
  await assert.rejects(f.service.handle("PATCH", `v1/games/${f.game.id}`, headers(admin), { gameTime: "16:00" }), e => e.status === 428);
  await assert.rejects(f.service.handle("PATCH", `v1/games/${f.game.id}`, headers(admin, { "if-match": "wrong" }), { gameTime: "16:00" }), e => e.status === 412);
  const patched = (await f.service.handle("PATCH", `v1/games/${f.game.id}`, headers(admin, { "if-match": f.game.etag }), { gameTime: "16:00" })).body;
  assert.equal(patched.gameTime, "16:00"); assert.notEqual(patched.etag, f.game.etag);
  await assert.rejects(f.service.handle("PATCH", `v1/games/${f.game.id}`, headers(admin, { "if-match": patched.etag }), { competitionId: "evil" }));
});
test("subscription revocation blocks sessions; self/admin assignment only to approved IDs", async () => {
  const f = await fixture(), session = await createSession(f);
  await assert.rejects(f.service.handle("PUT", `v1/competitions/${f.comp.id}/subscriptions/unknown`, headers(admin)), e => e.status === 404);
  await f.service.handle("DELETE", `v1/competitions/${f.comp.id}/subscriptions/${user.id}`, headers(user));
  await assert.rejects(f.service.handle("GET", `v1/sessions/${session.id}/snapshot`, headers(user)), e => e.status === 403);
  await f.service.handle("PUT", `v1/competitions/${f.comp.id}/subscriptions/${user.id}`, headers(admin));
  assert.equal((await f.service.handle("GET", `v1/sessions/${session.id}/snapshot`, headers(user))).body.session.id, session.id);
});
test("archiving preserves authorized history, blocks new sessions/schedule/subscriptions", async () => {
  const f = await fixture(), session = await createSession(f);
  const comp = (await f.service.handle("GET", "v1/competitions", headers(admin))).body[0];
  await f.service.handle("DELETE", `v1/competitions/${comp.id}`, headers(admin, { "if-match": comp.etag }));
  assert.equal((await f.service.handle("GET", "v1/competitions", headers(admin))).body.length, 0);
  await assert.rejects(createSession(f), e => e.status === 409);
  await assert.rejects(f.service.handle("PUT", `v1/competitions/${comp.id}/subscriptions/${other.id}`, headers(other)), e => e.status === 409);
  assert.equal((await f.service.handle("GET", `v1/games/${f.game.id}/sessions`, headers(user))).body[0].id, session.id);
  assert.equal((await f.service.handle("GET", `v1/sessions/${session.id}/snapshot`, headers(user))).body.session.id, session.id);
});
test("session creation idempotency, blank roster, prefill, own lists and admin isolation", async () => {
  const f = await fixture(), input = { operationId: randomUUID() }, path = `v1/games/${f.game.id}/sessions`;
  const created = (await f.service.handle("POST", path, headers(user), input)).body;
  const retry = (await f.service.handle("POST", path, headers(user), input)).body;
  assert.deepEqual(retry, created);
  const snapshot = (await f.service.handle("GET", `v1/sessions/${created.id}/snapshot`, headers(user))).body;
  assert.deepEqual(snapshot.state.roster, []); assert.deepEqual(snapshot.state.gameDetails, details);
  assert.equal(snapshot.state.statistics.offense.shot_made, true);
  assert.equal(snapshot.state.sessionStarted, false); assert.equal(snapshot.state.clockRunning, false);
  assert.equal((await f.service.handle("GET", path, headers(admin))).body.length, 0);
  for (const a of [admin, other]) {
    await assert.rejects(f.service.handle("GET", `v1/sessions/${created.id}/snapshot`, headers(a)), e => e.status === 403);
    await assert.rejects(f.service.handle("POST", `v1/sessions/${created.id}/operations`, headers(a), operation("context.replace", setup)), e => e.status === 403);
  }
});
test("committed retries dedup before revision; changed payload/actor and stale writes rejected", async () => {
  const f = await fixture(), session = await createSession(f), path = `v1/sessions/${session.id}/operations`;
  const op = operation("context.replace", setup);
  assert.deepEqual((await f.service.handle("POST", path, headers(user), op)).body, { revision: 1 });
  assert.deepEqual((await f.service.handle("POST", path, headers(user), op)).body, { revision: 1 });
  await assert.rejects(f.service.handle("POST", path, headers(user), { ...op, payload: { clockSeconds: 590 } }), e => e.code === "operation_id_reused");
  await assert.rejects(f.service.handle("POST", path, headers(admin), op), e => e.status === 403);
  await assert.rejects(f.service.handle("POST", path, headers(user), operation("context.replace", { clockSeconds: 590 })), e => e.code === "stale_revision");
  const head = await f.repo.get("SessionOperations", session.id, "head");
  assert.equal(head.revision, 1); assert.equal("state" in JSON.parse(head.json), false);
});
test("concurrent duplicate retries commit once; different concurrent writes conflict atomically", async () => {
  const f = await fixture(), session = await createSession(f);
  const op = operation("context.replace", setup);
  const same = await Promise.all([f.service.sessions.write(session.id, user, op), f.service.sessions.write(session.id, user, op)]);
  assert.deepEqual(same, [{ revision: 1 }, { revision: 1 }]);
  const writes = await Promise.allSettled([f.service.sessions.write(session.id, user, operation("context.replace", { clockSeconds: 590 }, 1)), f.service.sessions.write(session.id, user, operation("context.replace", { clockSeconds: 580 }, 1))]);
  assert.equal(writes.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(writes.filter(r => r.status === "rejected").length, 1);
  const rows = await f.repo.list("SessionOperations", { partitionKey: session.id, kind: "operation" });
  assert.equal(rows.length, 2);
  assert.equal((await f.service.sessions.load(session.id, user)).session.revision, 2);
});
test("checkpoint failure during creation/write is recoverable entirely from atomic log", async () => {
  const f = await fixture(); f.repo.checkpointFailure = true;
  const session = await createSession(f);
  assert.equal(f.repo.snapshots.size, 0);
  await f.service.sessions.write(session.id, user, operation("context.replace", setup));
  const loaded = await f.service.sessions.load(session.id, user);
  assert.equal(loaded.session.revision, 1); assert.equal(loaded.state.roster.length, 6);
  f.repo.checkpointFailure = false;
  await f.service.sessions.write(session.id, user, operation("context.replace", { clockSeconds: 590 }, 1));
  assert.equal(f.repo.snapshots.get(session.id).session.revision, 2);
  await f.repo.checkpoint({ ...loaded, session: { ...loaded.session, revision: 0 } });
  assert.equal(f.repo.snapshots.get(session.id).session.revision, 2);
});
test("deleted entity ID cannot be reused and failed mutation cannot advance head", async () => {
  const f = await fixture(), session = await createSession(f);
  await f.service.sessions.write(session.id, user, operation("context.replace", setup));
  const add = operation("event.add", { possessionId: "pos-01", event: { id: "score-1", type: "shot_made", playerId: "p-1", clock: "09:50" } }, 1);
  await f.service.sessions.write(session.id, user, add);
  await f.service.sessions.write(session.id, user, operation("event.delete", { possessionId: "pos-01", eventId: "score-1" }, 2));
  await assert.rejects(f.service.sessions.write(session.id, user, { ...add, operationId: randomUUID(), expectedRevision: 3 }), e => e.code === "id_reused");
  assert.equal((await f.service.sessions.load(session.id, user)).session.revision, 3);
});
test("fake transaction never exposes a head if initialization insert fails", async () => {
  const repo = new MemoryRepository();
  const row = { partitionKey: "p", rowKey: "existing", kind: "init", json: "{}" };
  await repo.transact("SessionOperations", [{ type: "insert", row }]);
  await assert.rejects(repo.transact("SessionOperations", [{ type: "insert", row: { ...row, rowKey: "head" } }, { type: "insert", row }]));
  assert.equal(await repo.get("SessionOperations", "p", "head"), null);
});
test("preferences are user scoped, strict and conditionally updated", async () => {
  const f = await fixture();
  assert.equal((await f.service.handle("GET", "v1/me/preferences", headers(user))).body.etag, null);
  const input = { roster: setup.roster, statistics: createInitialState(details).statistics };
  await assert.rejects(f.service.handle("PUT", "v1/me/preferences", headers(user), input), e => e.status === 428);
  const saved = (await f.service.handle("PUT", "v1/me/preferences", headers(user, { "if-none-match": "*" }), input)).body;
  assert.equal(saved.roster.length, 6);
  assert.equal((await f.service.handle("GET", "v1/me/preferences", headers(other))).body.roster.length, 0);
  await assert.rejects(f.service.handle("PUT", "v1/me/preferences", headers(user, { "if-match": saved.etag }), { ...input, role: "administrator" }));
});
test("Azure adapter sends conditional Replace tuple for head and subscription revocation", async () => {
  const repo = new AzureRepository("DefaultEndpointsProtocol=https;AccountName=example;AccountKey=YWJjZA==;EndpointSuffix=core.windows.net");
  let actions;
  repo.tables.CompetitionData.submitTransaction = async value => { actions = value; return {}; };
  const row = { partitionKey: "catalog", rowKey: "s", kind: "revoked_subscription", json: "{}", etag: 'W/"1"' };
  await repo.transact("CompetitionData", [{ type: "replace", row, etag: row.etag }]);
  assert.equal(actions[0][0], "update"); assert.equal(actions[0][2], "Replace"); assert.deepEqual(actions[0][3], { etag: row.etag });
  await assert.rejects(repo.transact("CompetitionData", [{ type: "replace", row, etag: "*" }]));
});
test("Azure adapter escapes quotes in all OData filter values", async () => {
  const repo = new AzureRepository("DefaultEndpointsProtocol=https;AccountName=example;AccountKey=YWJjZA==;EndpointSuffix=core.windows.net");
  let filter;
  repo.tables.SessionOperations.listEntities = options => { filter = options.queryOptions.filter; return { async *[Symbol.asyncIterator]() {} }; };
  await repo.list("SessionOperations", { partitionKey: "x' or true or 'y", masterUserId: "id'withquote" });
  assert.equal(filter, "PartitionKey eq 'x'' or true or ''y' and masterUserId eq 'id''withquote'");
});
test("Azure checkpoint CAS retry cannot regress a concurrently newer checkpoint", async () => {
  const repo = new AzureRepository("DefaultEndpointsProtocol=https;AccountName=example;AccountKey=YWJjZA==;EndpointSuffix=core.windows.net");
  const metadata = { id: "session-id", gameId: "game-id", competitionId: "comp-id", masterUserId: user.id, revision: 0, status: "setup", createdAt: context(1).timestamp, updatedAt: context(1).timestamp };
  let stored = { session: metadata, state: createInitialState(details) }, uploads = 0, downloads = 0;
  repo.blobs.getBlockBlobClient = () => ({
    async download() { downloads++; return { etag: `etag-${stored.session.revision}`, readableStreamBody: Readable.from([Buffer.from(JSON.stringify(stored))]) }; },
    async upload(bytes, length, options) {
      uploads++;
      assert.equal(options.conditions.ifMatch, "etag-0");
      assert.equal(length, bytes.length);
      // A concurrent revision 2 writer wins immediately before revision 1 CAS.
      stored = { ...stored, session: { ...metadata, revision: 2 } };
      throw Object.assign(new Error("Condition not met"), { statusCode: 412 });
    }
  });
  await repo.checkpoint({ ...stored, session: { ...metadata, revision: 1 } });
  assert.equal(uploads, 1); assert.equal(downloads, 2); assert.equal(stored.session.revision, 2);
});
test("HTTP reader bounds chunked bodies and rejects malformed JSON, media type and UTF-8", async () => {
  const request = (chunks, extra = {}) => ({ headers: new Headers({ "content-type": "application/json", ...extra }), body: new ReadableStream({ start(controller) { chunks.forEach(chunk => controller.enqueue(Buffer.from(chunk))); controller.close(); } }) });
  assert.deepEqual(await readBody(request(['{"name":', '"ok"}'])), { name: "ok" });
  await assert.rejects(readBody(request(["{}"], { "content-length": String(48 * 1024) })), e => e.status === 413);
  await assert.rejects(readBody(request(["x".repeat(24 * 1024), "x".repeat(24 * 1024)])), e => e.status === 413);
  await assert.rejects(readBody(request(["{"])), e => e.status === 400);
  await assert.rejects(readBody(request(["{}"], { "content-type": "text/json" })), e => e.status === 415);
  await assert.rejects(readBody(request([Buffer.from([0xff])])), e => e.status === 400);
});
test("health reveals no configuration; unknown route and anonymous protected calls fail", async () => {
  const api = new ApiService(new MemoryRepository(), accounts);
  assert.deepEqual(await api.handle("GET", "v1/health", new Headers()), { status: 200, body: { status: "ok" } });
  await assert.rejects(api.handle("GET", "v1/me", new Headers()), e => e.status === 401);
  await assert.rejects(api.handle("GET", "v1/sessions/id", headers(user)), e => e.status === 404);
});
test("OpenAPI parses and includes all implemented paths and operation discriminators", async () => {
  const spec = parseYaml(await readFile(new URL("../openapi.yaml", import.meta.url), "utf8"), { merge: true });
  assert.equal(spec.openapi, "3.1.0");
  for (const path of ["/v1/me", "/v1/users", "/v1/competitions", "/v1/competitions/{id}", "/v1/competitions/{id}/games", "/v1/games/{id}", "/v1/competitions/{id}/subscriptions/{userId}", "/v1/me/preferences", "/v1/games/{id}/sessions", "/v1/sessions/{id}/snapshot", "/v1/sessions/{id}/operations", "/v1/health"]) assert.ok(spec.paths[path]);
  assert.equal(spec.components.schemas.OperationInput.oneOf.length, 6);
  assert.ok(spec.components.schemas.SessionState.properties.roster);
  function checkRefs(value) {
    if (!value || typeof value !== "object") return;
    if (value.$ref) {
      const target = value.$ref.slice(2).split("/").reduce((current, key) => current?.[key], spec);
      assert.ok(target, `Unresolved contract reference: ${value.$ref}`);
    }
    Object.values(value).forEach(checkRefs);
  }
  checkRefs(spec);
  assert.ok(sessionStateSchema.safeParse(createInitialState(details)).success);
});