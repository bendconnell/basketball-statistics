import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/metrics.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
});
const { countPasses, countPaintTouches, averagePasses, averagePaintTouches } =
  await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

const possession = (details = {}) => ({
  id: "pos-01", quarter: 1, startClock: "10:00", endClock: "09:30",
  lineupIds: [], events: [], pointsFor: 0, pointsAgainst: 0,
  side: "offense", completed: true, ...details
});

test("unanswered details and empty averages are unknown, not zero", () => {
  assert.equal(countPasses(possession()), null);
  assert.equal(countPaintTouches(possession()), null);
  assert.equal(averagePasses([]), null);
  assert.equal(averagePaintTouches([possession()]), null);
});

test("explicit zero and no remain known values", () => {
  const known = possession({ passCount: 0, hadPaintTouch: false });
  assert.equal(countPasses(known), 0);
  assert.equal(countPaintTouches(known), 0);
  assert.equal(averagePasses([known, possession()]), 0);
  assert.equal(averagePaintTouches([known, possession()]), 0);
});

test("averages use only known offensive values, independently per field", () => {
  const possessions = [
    possession({ passCount: 2, hadPaintTouch: true }),
    possession({ passCount: 4 }),
    possession({ hadPaintTouch: false }),
    possession(),
    possession({ side: "defense", passCount: 0, hadPaintTouch: false })
  ];
  assert.equal(averagePasses(possessions), 3);
  assert.equal(averagePaintTouches(possessions), 0.5);
});

test("resetting a detail to unknown removes it from the denominator", () => {
  assert.equal(averagePasses([possession({ passCount: null })]), null);
  assert.equal(averagePaintTouches([possession({ hadPaintTouch: null })]), null);
});

test("legacy observed events remain evidence, unless explicitly reset to unknown", () => {
  const events = [{ type: "pass" }, { type: "paint_touch" }, { type: "paint_touch" }];
  assert.equal(countPasses(possession({ events })), 1);
  assert.equal(countPaintTouches(possession({ events })), 1);
  assert.equal(countPasses(possession({ events, passCount: null })), null);
  assert.equal(countPaintTouches(possession({ events, hadPaintTouch: null })), null);
});