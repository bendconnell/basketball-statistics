import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/commands.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
});
const { suggestCommands, parseCommand, spaceAfterCompletedPoints } =
  await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

test("autocomplete matches words and fragments anywhere in command names", () => {
  for (const input of ["rebound", "bound", "REBOUND", "rebound "]) {
    const labels = suggestCommands(input, [], "defense").map(({ label }) => label);
    assert.deepEqual(labels, ["Defensive Rebound", "Opposition Rebound"]);
  }
  assert.deepEqual(suggestCommands("rebound", [], "offense").map(({ label }) => label), ["Offensive Rebound"]);
  assert.deepEqual(suggestCommands("possession", [], "defense"), []);
});

test("ambiguous fragments suggest commands but cannot record an event", () => {
  assert.equal(parseCommand("rebound", "defense"), null);
  assert.equal(parseCommand("bound 22", "defense"), null);
  assert.equal(parseCommand("Defensive Rebound 22", "defense")?.command.label, "Defensive Rebound");
});

test("selecting a matching command preserves staged jersey autocomplete", () => {
  const players = [{ id: "p-22", number: 22, name: "Player" }];
  const suggestions = suggestCommands("Defensive Rebound ", players, "defense");
  assert.equal(suggestions[0].value, "Defensive Rebound 22");
  assert.equal(suggestions[0].submit, true);
});

test("Assist is an offense-only player command with staged jersey suggestions", () => {
  const players = [{ id: "p-22", number: 22, name: "Player" }];
  assert.equal(parseCommand("Assist 22", "offense")?.command.label, "Assist");
  assert.equal(parseCommand("assisted by 22", "offense")?.canonical, "assist 22");
  assert.ok(suggestCommands("ass", players, "offense").some(({ label }) => label === "Assist"));
  assert.deepEqual(suggestCommands("assist", players, "defense"), []);
  const suggestions = suggestCommands("Assist ", players, "offense");
  assert.equal(suggestions[0].value, "Assist 22");
  assert.equal(suggestions[0].submit, true);
  assert.equal(parseCommand("Assist 22 5", "offense"), null);
});

test("jerseys appear for Assist and Score 2 without a trailing space", () => {
  const players = [{ id: "p-22", number: 22, name: "Player" }];
  for (const input of ["Assist", "Assist ", "Score 2", "Score 2 "]) {
    const suggestions = suggestCommands(input, players, "offense");
    assert.equal(suggestions[0].label, "#22", input);
    assert.equal(suggestions[0].submit, true, input);
  }
  assert.equal(suggestCommands("Score ", players, "offense")[0].label, "1");
  assert.equal(suggestCommands("Score 2", players, "defense")[0].label, "2");
  assert.deepEqual(suggestCommands("Assist", [], "offense"), []);
  assert.deepEqual(suggestCommands("Score 2", [], "offense"), []);
});

test("typing shot points inserts a separator before the jersey number", () => {
  let input = "Score ";
  for (const character of "235") {
    input = spaceAfterCompletedPoints(input + character, input, "offense");
  }
  assert.equal(input, "Score 2 35");
  assert.deepEqual(parseCommand(input, "offense")?.numbers, [2, 35]);
  for (const command of ["Score", "Miss"]) {
    for (const points of [1, 2, 3]) {
      assert.equal(spaceAfterCompletedPoints(`${command} ${points}`, `${command} `, "offense"), `${command} ${points} `);
    }
  }
  assert.equal(spaceAfterCompletedPoints("Score 2", "Score 2 ", "offense"), "Score 2");
  assert.equal(spaceAfterCompletedPoints("Score 2 ", "Score ", "offense"), "Score 2 ");
  assert.equal(spaceAfterCompletedPoints("Assist 2", "Assist ", "offense"), "Assist 2");
  assert.equal(spaceAfterCompletedPoints("Score 2", "Score ", "defense"), "Score 2");
  assert.equal(spaceAfterCompletedPoints("Score 4", "Score ", "offense"), "Score 4");
});

test("disabled statistics disappear at every autocomplete stage", () => {
  const players = [{ id: "p-22", number: 22, name: "Player" }];
  const statistics = { offense: { assist: false, shot_made: false }, defense: { opp_score: false } };
  for (const input of ["ass", "Assist", "Assist 22", "Score", "Score 2", "Score 2 "]) {
    assert.deepEqual(suggestCommands(input, players, "offense", statistics), [], input);
  }
  assert.deepEqual(suggestCommands("Score 2", players, "defense", statistics), []);
  assert.ok(suggestCommands("Miss", players, "offense", statistics).length);
  assert.equal(parseCommand("End Possession", "offense"), null);
  assert.ok(suggestCommands("Help", players, "defense", statistics).length);
  assert.equal(parseCommand("Assist 22", "offense")?.command.label, "Assist");
});