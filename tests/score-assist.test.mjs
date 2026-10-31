import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/scoreAssist.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
});
const { updateScoreAssist } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
const score = { id: "score-1", type: "shot_made", playerId: "scorer", points: 2, clock: "08:42", lineupStintId: "lineup-1", assist: { status: "unknown" } };

test("Unknown and Not Applicable are distinct score details without credited assists", () => {
  const unknown = updateScoreAssist([score], score.id, { status: "unknown" }, "assist-1");
  const notApplicable = updateScoreAssist(unknown, score.id, { status: "not_applicable" }, "assist-2");
  assert.equal(unknown[0].assist.status, "unknown");
  assert.equal(notApplicable[0].assist.status, "not_applicable");
  assert.equal(notApplicable.length, 1);
  assert.equal(notApplicable[0].points, 2);
});

test("a selected teammate receives one assist attributed to the score clock and lineup", () => {
  const events = updateScoreAssist([score], score.id, { status: "player", playerId: "teammate" }, "assist-1");
  assert.deepEqual(events[0].assist, { status: "player", playerId: "teammate" });
  assert.deepEqual(events[1], { id: "assist-1", type: "assist", playerId: "teammate", clock: "08:42", lineupStintId: "lineup-1", linkedScoreId: score.id });
  const changed = updateScoreAssist(events, score.id, { status: "player", playerId: "another" }, "assist-2");
  assert.equal(changed.length, 2);
  assert.equal(changed[1].playerId, "another");
});

test("resetting an assist removes only that score's linked assist", () => {
  const unrelated = { id: "old-assist", type: "assist", playerId: "other", clock: "09:00" };
  const events = updateScoreAssist([score, unrelated], score.id, { status: "player", playerId: "teammate" }, "assist-1");
  for (const status of ["unknown", "not_applicable"]) {
    const reset = updateScoreAssist(events, score.id, { status }, "unused");
    assert.equal(reset.length, 2);
    assert.equal(reset[0].assist.status, status);
    assert.equal(reset[1], unrelated);
  }
});

test("missing scores and self-assists cannot create assist entries", () => {
  const events = [score];
  assert.equal(updateScoreAssist(events, "missing", { status: "player", playerId: "other" }, "unused"), events);
  assert.equal(updateScoreAssist(events, score.id, { status: "player", playerId: "scorer" }, "unused"), events);
});