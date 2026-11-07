// Development-only: no Azure configuration, credentials or network storage.
import { randomUUID } from "node:crypto";

export function uiPreviewPlugin() {
  return {
    name: "loopback-ui-preview",
    configureServer(server) {
      if (server.config.server.host !== "127.0.0.1") throw Error("UI preview must bind to 127.0.0.1 only.");
      let instance;
      async function seed() {
        const { ApiService } = await server.ssrLoadModule("/api/src/service.ts");
        const { MemoryRepository } = await server.ssrLoadModule("/api/src/repository.ts");
        const { players } = await server.ssrLoadModule("/src/data/seed.ts");
        const account = { id: `ui-preview-${randomUUID()}`, name: "UI Preview", role: "administrator" };
        const service = new ApiService(new MemoryRepository(), [account]);
        const headers = new Headers({ "x-ms-client-principal": Buffer.from(JSON.stringify({ identityProvider: "preview", userId: account.id, userRoles: ["authenticated"] })).toString("base64") });
        const competition = (await service.handle("POST", "v1/competitions", headers, { name: "UI design sandbox" })).body;
        const game = (await service.handle("POST", `v1/competitions/${competition.id}/games`, headers, {
          gameTitle: "Sample game", teamName: "Home", opponentName: "Away", gameDate: "2026-11-02", gameTime: "15:00", venue: "Preview court", notes: "Disposable local UI sample"
        })).body;
        async function session(started) {
          const created = (await service.handle("POST", `v1/games/${game.id}/sessions`, headers, { operationId: randomUUID() })).body;
          const ids = players.slice(0, 5).map(p => p.id);
          await service.handle("POST", `v1/sessions/${created.id}/operations`, headers, {
            operationId: randomUUID(), expectedRevision: 0, type: "context.replace", payload: {
              roster: players, startingLineupsByQuarter: { 1: ids },
              ...(started ? { sessionStarted: true, onCourtLineup: ids, lineupStints: [{ id: randomUUID(), label: "Lineup 1", quarter: 1, startClock: "10:00", endClock: "10:00", lineupIds: ids }] } : {})
            }
          });
          if (started) await service.handle("POST", `v1/sessions/${created.id}/operations`, headers, {
            operationId: randomUUID(), expectedRevision: 1, type: "event.add", payload: { possessionId: "pos-01", event: { id: randomUUID(), type: "shot_made", playerId: ids[0], clock: "10:00", points: 2 } }
          });
          return (await service.handle("GET", `v1/sessions/${created.id}/snapshot`, headers)).body.session;
        }
        return { service, headers, account, competition, game, session: await session(true), setup: await session(false) };
      }
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        if (!url.pathname.startsWith("/api/") && !url.pathname.startsWith("/__ui/")) return next();
        // Reject cross-origin writes and unexpected Host headers as well as LAN binding.
        if (!/^127\.0\.0\.1(?::\d+)?$/.test(req.headers.host ?? "") || (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`)) {
          res.writeHead(403); res.end(); return;
        }
        try {
          instance ??= seed();
          if (url.pathname === "/__ui/reset" && req.method === "POST") instance = seed();
          const data = await instance;
          res.setHeader("Content-Type", "application/json"); res.setHeader("Cache-Control", "no-store");
          if (url.pathname === "/__ui/bootstrap" || url.pathname === "/__ui/reset") {
            res.end(JSON.stringify({ account: data.account, competition: data.competition, game: data.game, session: data.session, setup: data.setup })); return;
          }
          let text = "";
          for await (const chunk of req) { text += chunk; if (text.length > 65536) throw Error("Preview request too large"); }
          const headers = new Headers(data.headers);
          for (const key of ["if-match", "if-none-match"]) if (req.headers[key]) headers.set(key, req.headers[key]);
          const result = await data.service.handle(req.method, url.pathname.slice(5), headers, text ? JSON.parse(text) : undefined);
          res.statusCode = result.status; res.end(result.body === undefined ? undefined : JSON.stringify(result.body));
        } catch (error) {
          res.statusCode = error.status ?? 500;
          res.end(JSON.stringify({ error: { code: error.code ?? "preview_error", message: error.message } }));
        }
      });
    }
  };
}