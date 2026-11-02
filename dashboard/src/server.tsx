import { createServer, type IncomingMessage } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { renderToString } from "react-dom/server";
import { App } from "./App.js";
import { PolicyCatalog } from "./PolicyCatalog.js";
import { RouteCatalog } from "./RouteCatalog.js";
import { ClientContracts } from "./ClientContracts.js";
import { ProductFlows } from "./ProductFlows.js";
import { ApiReference } from "./ApiReference.js";
import { cookieValue, OidcSessionStore } from "./oidc.js";

export interface DashboardOptions {
  apiUrl: string;
  apiToken: string;
  username?: string;
  password?: string;
  origin?: string;
  assetDirectory: string;
  oidc?: { issuer: string; clientId: string; clientSecret: string; redirectUri: string; sessionTtlMs?: number };
}
const hash = (value: string) => createHash("sha256").update(value).digest();
const allowed = /^\/api\/v1\/(?:suite|runs(?:\/[0-9a-f-]{36})?|comparisons|policies(?:\/import(?:\/preview)?)?|route-inventories(?:\/[a-z]+)?|product-contexts\/erp|client-contracts(?:\/[0-9a-f-]{36}\/history)?)$/;
export function createDashboard(options: DashboardOptions) {
  if (!options.apiToken.trim()) throw new Error("API token is required");
  const username = options.username?.trim() ?? "";
  const password = options.password ?? "";
  const authEnabled = Boolean(username || password);
  if (authEnabled && (!username || password.length < 16)) {
    throw new Error("When enabled, dashboard credentials require a username and password >= 16 characters");
  }
  const credentialHash = authEnabled ? hash(username + ":" + password) : undefined;
  const oidc = options.oidc ? new OidcSessionStore(options.oidc) : undefined;
  const configuredOrigin = options.origin;
  if (configuredOrigin !== undefined && (!["http:", "https:"].includes(new URL(configuredOrigin).protocol)
    || new URL(configuredOrigin).origin !== configuredOrigin)) throw new TypeError("Use an exact HTTP(S) origin");
  const server = createServer((req, res) => {
    const send = (status: number, value: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store, no-transform" });
      res.end(JSON.stringify(value));
    };
    void (async () => {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname === "/health") { send(200, { status: "ok" }); return; }
      if (oidc && req.method === "GET" && url.pathname === "/auth/login") { res.writeHead(302, { Location: oidc.login(url.searchParams.get("returnTo") ?? "/experiments/").toString(), "Cache-Control": "no-store" }); res.end(); return; }
      if (oidc && req.method === "GET" && url.pathname === "/auth/callback") {
        try {
          const result = await oidc.callback(url.searchParams.get("code") ?? "", url.searchParams.get("state") ?? "");
          res.writeHead(302, { Location: result.returnTo, "Set-Cookie": `avila_lab_session=${result.session.id}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.floor((result.session.expiresAt - Date.now()) / 1000)}`, "Cache-Control": "no-store" }); res.end();
        } catch { send(400, { error: { message: "Falha no retorno da autenticação." } }); }
        return;
      }
      if (oidc && req.method === "GET" && url.pathname === "/auth/logout") {
        const sessionId = cookieValue(req.headers.cookie, "avila_lab_session"); oidc.delete(sessionId);
        const logout = new URL(options.oidc!.issuer + "/api/auth/logout"); logout.searchParams.set("client_id", options.oidc!.clientId); logout.searchParams.set("post_logout_redirect_uri", options.oidc!.redirectUri.replace(/\/auth\/callback$/, "/experiments/"));
        res.writeHead(302, { Location: logout.toString(), "Set-Cookie": "avila_lab_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0", "Cache-Control": "no-store" }); res.end(); return;
      }
      const credential = req.headers.authorization?.match(/^Basic ([A-Za-z0-9+/=]+)$/)?.[1];
      const supplied = credential ? Buffer.from(credential, "base64").toString("utf8") : "";
      const session = oidc?.get(cookieValue(req.headers.cookie, "avila_lab_session"));
      if (oidc && !session && !url.pathname.startsWith("/assets/")) {
        res.writeHead(302, { Location: "/auth/login?returnTo=" + encodeURIComponent(url.pathname + url.search), "Cache-Control": "no-store" }); res.end(); return;
      }
      if (credentialHash && !timingSafeEqual(credentialHash, hash(supplied)) && !session) {
        res.setHeader("WWW-Authenticate", 'Basic realm="Avila Experiments", charset="UTF-8"');
        send(401, { error: { message: "Autenticação necessária." } }); return;
      }
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
      const pathname = url.pathname.replace(/^\/experiments(?=\/|$)/, "") || "/";
      if (allowed.test(pathname) || pathname === "/openapi.json") {
        // Compression proxies can rewrite strong ETags (for example "1-zstd").
        // Preserve the revision validator that the API expects in If-Match.
        res.setHeader("Cache-Control", "no-store, no-transform");
        if (!["GET", "POST", "PUT"].includes(req.method ?? "")) { send(405, { error: { message: "Método não permitido." } }); return; }
        if (pathname === "/api/v1/product-contexts/erp" && req.method !== "GET") { send(405, { error: { message: "Consulta de fluxos somente para leitura." } }); return; }
        const address = server.address();
        const localOrigin = typeof address === "object" && address && ["127.0.0.1", "::1"].includes(address.address)
          ? `http://${address.address === "::1" ? "[::1]" : address.address}:${address.port}` : undefined;
        if (req.headers.origin && req.headers.origin !== (configuredOrigin ?? localOrigin)) { send(403, { error: { message: "Origem não autorizada." } }); return; }
        let body: string | undefined;
        if (req.method !== "GET") {
          if (req.headers["content-type"]?.split(";")[0] !== "application/json") { send(415, { error: { message: "Envie JSON." } }); return; }
          body = await readBody(req);
        }
        const headers: Record<string, string> = { Authorization: "Bearer " + options.apiToken };
        if (body) headers["Content-Type"] = "application/json";
        if (req.headers["if-match"]) headers["If-Match"] = String(req.headers["if-match"]);
        const query = ["/api/v1/runs", "/api/v1/product-contexts/erp"].includes(pathname) || pathname.startsWith("/api/v1/client-contracts") ? url.search : "";
        const upstream = await fetch(options.apiUrl + pathname + query, { method: req.method, headers, ...(body === undefined ? {} : { body }), signal: AbortSignal.timeout(30000), redirect: "error" });
        const bytes = await upstream.text();
        res.statusCode = upstream.status;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("X-Evidence-SHA256", createHash("sha256").update(bytes).digest("hex"));
        const etag = upstream.headers.get("etag");
        if (etag) res.setHeader("ETag", etag);
        if (url.searchParams.get("download") === "1" && /^\/api\/v1\/runs\/[0-9a-f-]{36}$/.test(pathname)) res.setHeader("Content-Disposition", 'attachment; filename="evidence.json"');
        res.end(bytes); return;
      }
      if (req.method === "GET" && ["/assets/client.js", "/assets/style.css"].includes(pathname)) {
        const filename = pathname.endsWith(".js") ? "client.js" : "style.css";
        res.setHeader("Content-Type", filename.endsWith(".js") ? "text/javascript; charset=utf-8" : "text/css; charset=utf-8");
        res.end(await readFile(options.assetDirectory + "/" + filename)); return;
      }
      if (req.method === "GET" && ["/", "/policies", "/policies/", "/routes", "/routes/", "/contracts", "/contracts/", "/flows", "/flows/", "/docs", "/docs/"].includes(pathname)) {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end('<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Ávila Experiments | Laboratório</title><link rel="stylesheet" href="/experiments/assets/style.css"></head><body><div id="root">' + renderToString(pathname.startsWith("/docs") ? <ApiReference/> : pathname.startsWith("/flows") ? <ProductFlows/> : pathname.startsWith("/contracts") ? <ClientContracts/> : pathname.startsWith("/routes") ? <RouteCatalog/> : pathname.startsWith("/policies") ? <PolicyCatalog/> : <App/>) + '</div><script type="module" src="/experiments/assets/client.js"></script></body></html>'); return;
      }
      send(404, { error: { message: "Não encontrado." } });
    })().catch(error => { if (!res.headersSent) send(error instanceof RangeError ? 413 : 502, { error: { message: error instanceof RangeError ? "Corpo excede 1 MiB." : "Serviço indisponível. Tente novamente." } }); else res.end(); });
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  return server;
}
async function readBody(req: IncomingMessage) {
  const parts: Buffer[] = [];
  let size = 0;
  for await (const part of req) {
    size += part.length;
    if (size > 1024 * 1024) throw new RangeError("Too large");
    parts.push(part);
  }
  return Buffer.concat(parts).toString("utf8");
}
