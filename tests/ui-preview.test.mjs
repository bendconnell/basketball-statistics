import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";
import { uiPreviewPlugin } from "../dev/ui-preview-plugin.mjs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("UI sandbox seeds hosted sessions without login and isolates memory data", async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), "bball-ui-test-"));
  const server = await createServer({ configFile: false, cacheDir, plugins: [uiPreviewPlugin()], server: { host: "127.0.0.1", port: 0, open: false } });
  try {
    await server.listen();
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
    const json = async path => { const response = await fetch(origin + path); assert.equal(response.status, 200); return response.json(); };
    const data = await json("/__ui/bootstrap");
    assert.equal((await json("/api/v1/me")).id, data.account.id);
    const game = await json(`/api/v1/sessions/${data.session.id}/snapshot`);
    assert.equal(game.state.sessionStarted, true);
    assert.equal(game.state.roster.length, 11);
    assert.equal(game.state.possessions[0].pointsFor, 2);
    const setup = await json(`/api/v1/sessions/${data.setup.id}/snapshot`);
    assert.equal(setup.state.sessionStarted, false);
    assert.equal(setup.state.startingLineupsByQuarter[1].length, 5);
    const blocked = await fetch(origin + "/__ui/reset", { method: "POST", headers: { Origin: "https://example.com" } });
    assert.equal(blocked.status, 403);
    const reset = await (await fetch(origin + "/__ui/reset", { method: "POST" })).json();
    assert.notEqual(reset.session.id, data.session.id);
    assert.equal((await fetch(origin + `/api/v1/sessions/${data.session.id}/snapshot`)).status, 404);
  } finally { await server.close(); await rm(cacheDir, { recursive: true, force: true }); }
});

test("UI sandbox refuses network-accessible binding", () => {
  assert.throws(() => uiPreviewPlugin().configureServer({ config: { server: { host: "0.0.0.0" } } }), /127.0.0.1 only/);
});