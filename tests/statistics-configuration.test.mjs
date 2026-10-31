import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/statisticsConfiguration.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
});
const { loadStatisticsConfiguration, statisticOptions } =
  await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

test("all available stats default to enabled", () => {
  globalThis.localStorage = { getItem: () => null };
  const config = loadStatisticsConfiguration();
  for (const side of ["offense", "defense"]) {
    for (const { key } of statisticOptions[side]) assert.equal(config[side][key], true);
  }
});

test("saved selections are independent by side and malformed values use defaults", () => {
  globalThis.localStorage = { getItem: () => JSON.stringify({ offense: { assist: false, fast_break: false }, defense: { fast_break: true, foul: "false" } }) };
  const config = loadStatisticsConfiguration();
  assert.equal(config.offense.assist, undefined);
  assert.ok(!statisticOptions.offense.some(({ key }) => key === "assist"));
  assert.equal(config.offense.fast_break, false);
  assert.equal(config.defense.fast_break, true);
  assert.equal(config.defense.foul, true);
  assert.equal(config.offense.shot_made, true);
});

test("corrupt or unavailable storage safely restores defaults", () => {
  globalThis.localStorage = { getItem: () => "bad json" };
  assert.equal(loadStatisticsConfiguration().offense.shot_made, true);
  globalThis.localStorage = { getItem: () => { throw new Error("Unavailable"); } };
  assert.equal(loadStatisticsConfiguration().defense.foul, true);
});