// LOOPBACK-ONLY integration fixture. Never deploy this server or its test identities.
// Build api and frontend with VITE_BACKEND_MODE=azure before running this file.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { MemoryRepository } from "../api/dist/api/src/repository.js";
import { ApiService } from "../api/dist/api/src/service.js";
const accounts = [{ id: "test-admin", name: "Test Administrator", role: "administrator" }, { id: "test-user", name: "Test User", role: "user" }];
const service = new ApiService(new MemoryRepository(), accounts);
const root = resolve(fileURLToPath(new URL("../dist/", import.meta.url)));
createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1:5179");
  if (url.pathname === "/test/login/admin" || url.pathname === "/test/login/user") {
    res.writeHead(302, { "Set-Cookie": `test-role=${url.pathname.endsWith("admin") ? "admin" : "user"}; HttpOnly; SameSite=Strict; Path=/`, Location: "/" }); return res.end();
  }
  if (url.pathname.startsWith("/.auth/logout")) { res.writeHead(302, { "Set-Cookie": "test-role=; Max-Age=0; Path=/", Location: "/" }); return res.end(); }
  if (url.pathname.startsWith("/api/")) {
    try {
      const role = req.headers.cookie?.includes("test-role=admin") ? "admin" : req.headers.cookie?.includes("test-role=user") ? "user" : null;
      const account = role === "admin" ? accounts[0] : accounts[1];
      const headers = new Headers();
      if (role) headers.set("x-ms-client-principal", Buffer.from(JSON.stringify({ identityProvider: "externalid", userId: account.id, userDetails: account.name, userRoles: ["authenticated"] })).toString("base64"));
      for (const name of ["if-match", "if-none-match"]) if (req.headers[name]) headers.set(name, req.headers[name]);
      let text = ""; for await (const chunk of req) { text += chunk; if (text.length > 65536) throw { status: 413, message: "Too large" }; }
      const response = await service.handle(req.method, url.pathname.slice(5), headers, text ? JSON.parse(text) : undefined);
      res.writeHead(response.status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); return res.end(response.body === undefined ? undefined : JSON.stringify(response.body));
    } catch (e) { res.writeHead(e.status ?? 400, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ error: { code: e.code ?? "test_error", message: e.message ?? "Fixture error" } })); }
  }
  try {
    const candidate = resolve(root, `.${decodeURIComponent(url.pathname)}`);
    if (candidate !== root && !candidate.startsWith(root + sep)) { res.writeHead(403); return res.end(); }
    const file = extname(candidate) ? candidate : resolve(root, "index.html");
    const data = await readFile(file);
    res.writeHead(200, { "Content-Type": ({ ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".json": "application/json" })[extname(file)] ?? "application/octet-stream" }); res.end(data);
  } catch { res.writeHead(404); res.end(); }
}).listen(5179, "127.0.0.1", () => console.log("Test-only cloud fixture: http://127.0.0.1:5179/test/login/admin (or /user). Memory data only."));