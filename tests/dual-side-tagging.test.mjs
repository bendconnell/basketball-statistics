import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { createServer } from "vite";
import { uiPreviewPlugin } from "../dev/ui-preview-plugin.mjs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MessageChannel } from "node:worker_threads";

test("both tagging sides infer possession boundaries and preserve score assists", async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), "bball-dual-side-"));
  const server = await createServer({ configFile: false, cacheDir, plugins: [uiPreviewPlugin()], server: { host: "127.0.0.1", port: 0, open: false } });
  const saved = new Map(["window", "document", "navigator", "localStorage", "fetch", "MessageChannel", "IS_REACT_ACT_ENVIRONMENT"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const nativeFetch = globalThis.fetch;
  let root, dom, act;
  const channels = [];
  class TestMessageChannel extends MessageChannel {
    constructor() { super(); channels.push(this); }
  }
  try {
    await server.listen();
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
    const data = await (await nativeFetch(origin + "/__ui/bootstrap")).json();
    dom = new JSDOM('<div id="root"></div>', { url: origin + "/tagging", pretendToBeVisual: true });
    for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, localStorage: dom.window.localStorage, MessageChannel: TestMessageChannel, fetch: (url, options) => nativeFetch(new URL(url, origin), options), IS_REACT_ACT_ENVIRONMENT: true })) {
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    }
    Object.defineProperty(navigator, "locks", { value: { request: async (_name, _options, callback) => callback({}) } });
    localStorage.setItem("bball-stats.tagging-mode.v1", "buttons");
    const bundle = await build({ stdin: { contents: 'export { CloudGameTracker } from "./src/CloudGameTracker"; export { default as React, act } from "react"; export { createRoot } from "react-dom/client"; export { MemoryRouter } from "react-router-dom";', resolveDir: fileURLToPath(new URL("..", import.meta.url)), loader: "tsx" }, bundle: true, write: false, format: "esm", platform: "node", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' } });
    const ui = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
    act = ui.act;
    root = ui.createRoot(document.getElementById("root"));
    await act(async () => root.render(ui.React.createElement(ui.MemoryRouter, { initialEntries: ["/tagging"] }, ui.React.createElement(ui.CloudGameTracker, { ...data, onExit() {} }))));
    const waitFor = async check => {
      const deadline = Date.now() + 5000;
      while (!check() && Date.now() < deadline) await act(async () => { await new Promise(resolve => setImmediate(resolve)); });
      assert.ok(check(), document.body.textContent);
    };
    await waitFor(() => document.querySelectorAll(".tagging-side-section").length === 2);
    const section = side => document.querySelector(`.tagging-side-section.${side}`);
    const click = async (side, text) => {
      const button = [...section(side).querySelectorAll("button")].find(b => b.textContent.trim() === text);
      assert.ok(button, `Missing ${side} button: ${text}`);
      assert.equal(button.disabled, false);
      await act(async () => button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
    };
    assert.equal(document.querySelector(".tagging-side-toggle"), null);
    assert.match(section("offense").textContent, /Offensive Rebound/);
    assert.match(section("defense").textContent, /Opposition Rebound/);

    await click("defense", "Opposition Rebound");
    assert.match(document.querySelector(".side-indicator").textContent, /Defense/);
    await click("defense", "Score");
    await click("defense", "2");
    await click("offense", "Score");
    assert.match(document.querySelector(".side-indicator").textContent, /Offense/);
    await click("offense", "3");
    await click("offense", "#1Jay Carter");
    assert.match(section("offense").textContent, /Assist/);
    // The other section remains usable while the original score awaits its assist.
    await click("defense", "Opposition Rebound");
    await click("offense", "#3Miles Boone");
    assert.ok(!document.querySelector('[role="alert"]'), document.querySelector('[role="alert"]')?.textContent);
    await waitFor(() => document.querySelector(".save-status").classList.contains("saved"));
    const snapshot = await (await nativeFetch(origin + `/api/v1/sessions/${data.session.id}/snapshot`)).json();
    assert.equal(snapshot.state.currentSide, "defense");
    assert.equal(snapshot.state.possessions.length, 4);
    assert.deepEqual(snapshot.state.possessions.map(p => p.side), ["offense", "defense", "offense", "defense"]);
    assert.equal(snapshot.state.possessions[1].events.filter(e => e.type === "possession_end").length, 1, "same-side actions do not close possessions");
    assert.ok(snapshot.state.possessions[1].events.some(e => e.type === "opp_score" && e.points === 2));
    const score = snapshot.state.possessions[2].events.find(e => e.type === "shot_made");
    assert.equal(score.points, 3);
    assert.equal(score.assist.playerId, snapshot.state.roster.find(p => p.number === 3).id, JSON.stringify({ score, offenseUI: section("offense").textContent }));
    assert.ok(snapshot.state.possessions[2].events.some(e => e.type === "assist" && e.linkedScoreId === score.id));
    assert.ok(snapshot.state.possessions[3].events.some(e => e.type === "opposition_rebound"));
  } catch (error) {
    // Bundled data-URI stack frames are enormous; keep failures readable.
    console.error("Dual-side test failure:", error.message);
    throw new Error(error.message);
  } finally {
    if (root) await act(async () => root.unmount());
    dom?.window.close();
    for (const channel of channels) { channel.port1.close(); channel.port2.close(); }
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    await server.close();
    await rm(cacheDir, { recursive: true, force: true });
  }
});