import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadModule(path) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
}
const { changeLineup } = await loadModule("../src/lib/lineups.ts");
const { stintDifferential, individualDifferential } = await loadModule("../src/lib/metrics.ts");
const starting = ["a", "b", "c", "d", "e"];
const incoming = ["f", "b", "c", "d", "e"];

test("each changed combination starts a new stint, including returning lineups", () => {
  let stints = changeLineup([], starting, 1, "10:00", "s1");
  assert.equal(changeLineup(stints, [...starting].reverse(), 1, "09:00", "unused"), stints);
  stints = changeLineup(stints, incoming, 1, "08:00", "s2");
  assert.equal(stints[0].endClock, "08:00");
  assert.equal(stints[1].startClock, "08:00");
  stints = changeLineup(stints, starting, 1, "07:00", "s3");
  assert.equal(stints.length, 3);
  assert.deepEqual(stints[2].lineupIds, starting);
});

const stints = changeLineup(changeLineup([], starting, 1, "10:00", "s1"), incoming, 1, "08:00", "s2");
const events = [
  { id: "e1", type: "shot_made", points: 2, clock: "08:00", lineupStintId: "s1" },
  { id: "e2", type: "opp_score", points: 3, clock: "08:00", lineupStintId: "s2" },
  { id: "e3", type: "shot_made", points: 1, clock: "08:00", lineupStintId: "s2" }
];
const possessions = [{ id: "pos-01", quarter: 1, startClock: "10:00", events }];

test("mid-possession scores at the same clock belong only to their actual stint", () => {
  assert.deepEqual(stintDifferential(possessions, stints[0]), { possessions: 1, pointsFor: 2, pointsAgainst: 0, diff: 2 });
  assert.deepEqual(stintDifferential(possessions, stints[1]), { possessions: 1, pointsFor: 1, pointsAgainst: 3, diff: -2 });
});

test("individual plus-minus uses time on court, not the identity of the scorer", () => {
  assert.equal(individualDifferential(possessions, stints, "a").diff, 2);
  assert.equal(individualDifferential(possessions, stints, "f").diff, -2);
  assert.deepEqual(individualDifferential(possessions, stints, "b"), { possessions: 1, pointsFor: 3, pointsAgainst: 3, diff: 0 });
  assert.deepEqual(individualDifferential(possessions, stints, "bench"), { possessions: 0, pointsFor: 0, pointsAgainst: 0, diff: 0 });
});

test("deleted scores no longer contribute to lineup or individual differential", () => {
  const edited = [{ ...possessions[0], events: events.filter((event) => event.id !== "e2") }];
  assert.equal(stintDifferential(edited, stints[1]).diff, 1);
  assert.equal(individualDifferential(edited, stints, "f").diff, 1);
});

test("events before a known lineup are not invented as player contributions", () => {
  const unknown = [{ ...possessions[0], events: [{ type: "shot_made", points: 3 }] }];
  assert.equal(stintDifferential(unknown, stints[0]).diff, 0);
  assert.equal(individualDifferential(unknown, stints, "a").diff, 0);
});