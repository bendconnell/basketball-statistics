import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/possessionToggle.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
});
const { undoEmptyPossessionToggle } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
const score = { id: "score", type: "shot_made", playerId: "p1", clock: "09:30", points: 2, lineupStintId: "stint-1" };
const boundary = { id: "end", type: "possession_end", playerId: "", clock: "09:20", lineupStintId: "stint-1" };
const previous = { id: "pos-01", quarter: 1, startClock: "10:00", endClock: "09:20", lineupIds: ["p1"], events: [score, boundary], pointsFor: 2, pointsAgainst: 0, side: "offense", completed: true };
const active = { id: "pos-02", quarter: 1, startClock: "09:20", endClock: "09:20", lineupIds: ["p1"], events: [], pointsFor: 0, pointsAgainst: 0, side: "defense", completed: false };

test("toggling an empty possession reopens the previous one and removes its end marker", () => {
  const restored = undoEmptyPossessionToggle([previous, active], "09:15", "stint-1");
  assert.equal(restored.length, 1);
  assert.equal(restored[0].id, previous.id);
  assert.equal(restored[0].completed, false);
  assert.equal(restored[0].side, "offense");
  assert.equal(restored[0].endClock, "09:15");
  assert.equal(restored[0].pointsFor, 2);
  assert.deepEqual(restored[0].events, [score]);
  assert.equal(previous.events.length, 2);
});

test("stats, score totals, explicit details, or substitutions retain the boundary", () => {
  for (const change of [{ events: [score] }, { pointsAgainst: 2 }, { passCount: 0 }, { hadPaintTouch: false }, { wasFastBreak: false }]) {
    assert.equal(undoEmptyPossessionToggle([previous, { ...active, ...change }], "09:15", "stint-1"), null);
  }
  assert.equal(undoEmptyPossessionToggle([previous, active], "09:15", "stint-2"), null);
});

test("only the immediately preceding valid boundary can be undone", () => {
  assert.equal(undoEmptyPossessionToggle([active], "09:15", "stint-1"), null);
  assert.equal(undoEmptyPossessionToggle([{ ...previous, events: [score] }, active], "09:15", "stint-1"), null);
  assert.equal(undoEmptyPossessionToggle([previous, { ...active, quarter: 2 }], "09:15", "stint-1"), null);
  const older = { ...previous, id: "pos-00" };
  const restored = undoEmptyPossessionToggle([older, previous, active], "09:15", "stint-1");
  assert.equal(restored.length, 2);
  assert.equal(restored[0], older);
});