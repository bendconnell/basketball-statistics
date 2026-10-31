import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

async function load(entry) {
  const result = await build({ entryPoints: [new URL(entry, import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')], bundle: true, write: false, format: "esm", platform: "node", target: "es2022" });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
const { SessionSync } = await load("../src/lib/sessionSync.ts");
const { createInitialState } = await load("../shared/session.ts");
const { request, ApiError } = await load("../src/lib/api.ts");
function storage() {
  const map = new Map();
  return { getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), removeItem: k => map.delete(k) };
}
function initial() {
  return { session: { id: "session-1", gameId: "game-1", competitionId: "comp-1", masterUserId: "master", revision: 0, status: "setup", createdAt: "2026-10-31T00:00:00Z", updatedAt: "2026-10-31T00:00:00Z" }, state: createInitialState({ gameTitle: "Round 1", teamName: "Home", opponentName: "Away", gameDate: "2026-10-31", venue: "Court", notes: "" }) };
}
const setup = { type: "context.replace", payload: {
  roster: Array.from({ length: 5 }, (_, n) => ({ id: `player-${n}`, number: n, name: `Player ${n}` })),
  onCourtLineup: ["player-0", "player-1", "player-2", "player-3", "player-4"],
  lineupStints: [{ id: "stint-1", label: "Lineup 1", quarter: 1, startClock: "10:00", endClock: "10:00", lineupIds: ["player-0", "player-1", "player-2", "player-3", "player-4"] }], sessionStarted: true
} };

test("cloud queue persists before optimistic updates and sends operations in revision order", async () => {
  const store = storage(), writes = [];
  const sync = new SessionSync(initial(), "master", store, async (_id, op) => { writes.push(op); return { revision: op.expectedRevision + 1 }; });
  try {
    sync.enqueue(setup);
    sync.enqueue({ type: "event.add", payload: { possessionId: "pos-01", event: { id: "miss-1", type: "shot_miss", playerId: "player-0", clock: "10:00", points: 3 } } });
    assert.equal(sync.state.possessions[0].pointsFor, 0);
    assert.equal(sync.state.possessions[0].events[0].points, 3);
    assert.equal(JSON.parse(store.getItem(sync.key)).operations.length, 2);
    assert.equal(await sync.flush(), true);
    assert.deepEqual(writes.map(op => op.expectedRevision), [0, 1]);
    assert.equal(new Set(writes.map(op => op.operationId)).size, 2);
    assert.equal(sync.status, "saved"); assert.equal(sync.pending, 0);
  } finally { sync.dispose(); }
});

test("offline recovery reuses the exact committed-retry envelope rather than creating another event", async () => {
  const store = storage(); let sent;
  const first = new SessionSync(initial(), "master", store, async (_id, op) => { sent = op; throw TypeError("Network unavailable"); });
  first.enqueue(setup); assert.equal(await first.flush(), false); assert.equal(first.status, "offline"); first.dispose();
  // Server may already have accepted the write before the network error.
  const server = initial(); server.session.revision = 1;
  const recovered = new SessionSync(server, "master", store, async (_id, op) => { assert.deepEqual(op, sent); return { revision: 1 }; });
  try { assert.equal(recovered.state.sessionStarted, true); assert.equal(await recovered.flush(), true); assert.equal(recovered.pending, 0); }
  finally { recovered.dispose(); }
});

test("a conflicting save preserves local operations and prevents further edits", async () => {
  const store = storage();
  const sync = new SessionSync(initial(), "master", store, async () => { throw { status: 409, message: "Stale revision" }; });
  try {
    sync.enqueue(setup); await sync.flush();
    assert.equal(sync.status, "conflict"); assert.equal(sync.pending, 1);
    assert.equal(JSON.parse(sync.exportPending()).operations.length, 1);
    assert.throws(() => sync.enqueue({ type: "context.replace", payload: { clockSeconds: 590 } }));
    assert.equal(await sync.retry(), false);
    sync.discardPending(); assert.equal(store.getItem(sync.key), null);
  } finally { sync.dispose(); }
});

test("storage failure cannot claim a successful mutation or lose the previous state", () => {
  const store = { ...storage(), setItem: () => { throw Error("Storage full"); } };
  const sync = new SessionSync(initial(), "master", store, async () => ({ revision: 1 }));
  try { assert.throws(() => sync.enqueue(setup), /Storage full/); assert.equal(sync.state.sessionStarted, false); assert.equal(sync.pending, 0); assert.equal(sync.status, "error"); assert.equal(sync.blocked, true); }
  finally { sync.dispose(); }
});

test("user/session identity isolation rejects a foreign outbox", () => {
  const store = storage(); const sync = new SessionSync(initial(), "master", store, async () => ({ revision: 1 }));
  sync.enqueue(setup); const raw = JSON.parse(store.getItem(sync.key)); raw.base.session.masterUserId = "someone-else"; store.setItem(sync.key, JSON.stringify(raw)); sync.dispose();
  assert.throws(() => new SessionSync(initial(), "master", store, async () => ({ revision: 1 })), /identity/);
  assert.throws(() => new SessionSync(initial(), "another", store, async () => ({ revision: 1 })), /signed-in master/);
});

test("writes enqueued during a save are serialized and overlapping flushes share one flight", async () => {
  let release; const writes = [];
  const sync = new SessionSync(initial(), "master", storage(), async (_id, op) => { writes.push(op); if (writes.length === 1) await new Promise(resolve => { release = resolve; }); return { revision: op.expectedRevision + 1 }; });
  try {
    sync.enqueue(setup); const flight = sync.flush();
    sync.enqueue({ type: "context.replace", payload: { clockSeconds: 599 } });
    assert.equal(sync.flush(), flight); release(); assert.equal(await flight, true);
    assert.deepEqual(writes.map(op => op.expectedRevision), [0, 1]); assert.equal(sync.pending, 0);
  } finally { sync.dispose(); }
});

test("API requests use the protected same-origin routes and expose structured failures", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url, options) => { assert.equal(url, "/api/v1/competitions/id"); assert.equal(options.credentials, "same-origin"); assert.equal(options.headers["If-Match"], "etag-1"); return new Response(JSON.stringify({ id: "id" }), { status: 200 }); };
    assert.deepEqual(await request("competitions/id", "PATCH", { name: "New" }, "etag-1"), { id: "id" });
    globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: "stale_revision", message: "Reload required" } }), { status: 409 });
    await assert.rejects(request("sessions/id/operations", "POST", {}), e => e instanceof ApiError && e.status === 409 && e.code === "stale_revision" && e.message === "Reload required");
    globalThis.fetch = async () => new Response(null, { status: 204 }); assert.equal(await request("subscriptions/id", "DELETE"), undefined);
    globalThis.fetch = async (_url, options) => { assert.equal(options.headers["If-None-Match"], "*"); assert.equal(options.headers["If-Match"], undefined); return new Response("{}"); };
    await request("me/preferences", "PUT", {}, undefined, true);
  } finally { globalThis.fetch = original; }
});

test("recovery blocks new edits until exact retries finish and requires reload for newer remote changes", async () => {
  const store = storage(); let original;
  const first = new SessionSync(initial(), "master", store, async (_id, op) => { original = op; throw Error("Response lost"); });
  first.enqueue(setup); await first.flush(); await first.dispose();
  const server = initial(); server.session.revision = 3;
  const recovered = new SessionSync(server, "master", store, async (_id, op) => { assert.deepEqual(op, original); return { revision: 1 }; });
  try {
    assert.equal(recovered.blocked, true);
    assert.throws(() => recovered.enqueue({ type: "context.replace", payload: { clockSeconds: 580 } }));
    assert.equal(await recovered.flush(), false);
    assert.equal(recovered.pending, 0); assert.equal(recovered.status, "conflict"); assert.match(recovered.error, /newer changes/);
  } finally { await recovered.dispose(); }
});

test("failed acknowledgement persistence retains the exact retry envelope and blocks the clock", async () => {
  const backing = storage(); let full = false; const writes = [];
  const store = { ...backing, setItem: (key, value) => { if (full) throw Error("Device storage full"); backing.setItem(key, value); } };
  const sync = new SessionSync(initial(), "master", store, async (_id, op) => { writes.push(op); return { revision: 1 }; });
  try {
    sync.enqueue(setup); full = true; assert.equal(await sync.flush(), false);
    assert.equal(sync.status, "error"); assert.equal(sync.blocked, true); assert.equal(sync.pending, 1);
    full = false; assert.equal(await sync.retry(), true); assert.deepEqual(writes[0], writes[1]);
  } finally { await sync.dispose(); }
});

test("disposing waits for the current save but does not upload later queued edits", async () => {
  let release; let count = 0;
  const sync = new SessionSync(initial(), "master", storage(), async (_id, op) => { count++; await new Promise(resolve => { release = resolve; }); return { revision: op.expectedRevision + 1 }; });
  sync.enqueue(setup); const flight = sync.flush(); sync.enqueue({ type: "context.replace", payload: { clockSeconds: 590 } });
  const closed = sync.dispose(); release(); assert.equal(await flight, false); await closed;
  assert.equal(count, 1); assert.equal(sync.pending, 1); assert.equal(sync.blocked, true);
});

test("invalid server snapshots and malformed journal sequences fail without overwriting recovery data", () => {
  const store = storage(); const loaded = initial(); loaded.state.clockSeconds = -10;
  assert.throws(() => new SessionSync(loaded, "master", store, async () => ({ revision: 1 })));
  const sync = new SessionSync(initial(), "master", store, async () => ({ revision: 1 })); sync.enqueue(setup); sync.dispose();
  const bad = JSON.parse(store.getItem(sync.key)); bad.operations[0].expectedRevision = 10; store.setItem(sync.key, JSON.stringify(bad));
  assert.throws(() => new SessionSync(initial(), "master", store, async () => ({ revision: 1 })), /revision sequence/);
  assert.equal(JSON.parse(store.getItem(sync.key)).operations[0].expectedRevision, 10);
});