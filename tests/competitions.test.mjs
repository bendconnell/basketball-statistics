import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/competitions.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
});
const { loginLocalAccount, loadCompetitions } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

test("prototype logins have distinct user and administrator roles", () => {
  assert.equal(loginLocalAccount("user", "user").role, "user");
  assert.equal(loginLocalAccount(" Admin ", "admin").role, "administrator");
  for (const [username, password] of [["user", "admin"], ["admin", "user"], ["unknown", "user"], ["user", ""]]) {
    assert.equal(loginLocalAccount(username, password), null);
  }
});

test("stored competitions preserve subscriptions and scheduled game details", () => {
  const store = { competitions: [{ id: "c1", name: "U18 Div1 Summer Season", subscriberIds: ["user"] }], games: [{ id: "g1", competitionId: "c1", gameTitle: "Round 1", teamName: "Home", opponentName: "Away", gameDate: "2026-11-01", gameTime: "18:00", venue: "Court 1", notes: "Arrive early" }] };
  globalThis.localStorage = { getItem: () => JSON.stringify(store) };
  assert.deepEqual(loadCompetitions(), store);
});

test("invalid records and orphan games are ignored", () => {
  globalThis.localStorage = { getItem: () => JSON.stringify({ competitions: [{ id: "c1", name: "Valid", subscriberIds: [] }, { id: "bad", name: "Bad", subscriberIds: [4] }], games: [{ id: "bad" }, { id: "orphan", competitionId: "missing", gameTitle: "Round", teamName: "A", opponentName: "B", gameDate: "", gameTime: "", venue: "", notes: "" }] }) };
  assert.deepEqual(loadCompetitions(), { competitions: [{ id: "c1", name: "Valid", subscriberIds: [] }], games: [] });
});

test("missing, corrupt or unavailable browser storage starts empty", () => {
  for (const value of [null, "bad json", "{}", "null"]) {
    globalThis.localStorage = { getItem: () => value };
    assert.deepEqual(loadCompetitions(), { competitions: [], games: [] });
  }
  globalThis.localStorage = { getItem: () => { throw Error("Unavailable"); } };
  assert.deepEqual(loadCompetitions(), { competitions: [], games: [] });
});