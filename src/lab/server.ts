import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { compareExperiments } from "../comparison.js";
import { ApiError, parseDraft, positiveInteger, record, runId, type SuiteDraft } from "./contracts.js";
import { LabStore } from "./store.js";
import { OPENAPI } from "./openapi.js";
import { LANDING_HTML } from "./landing.js";
import { PolicyStore, parsePolicyUpdate } from "./policies.js";
import { ROUTE_PRODUCTS, RouteInventoryStore } from "./route-inventories.js";
import { ProductContextStore } from "./product-contexts.js";
import { ClientContractStore } from "./client-contracts.js";

export interface ApiOptions {
  dataDirectory: string;
  seed?: SuiteDraft;
  token?: string;
  contextToken?: string;
  contextReadToken?: string;
  allowedOrigins?: string[];
}

const MAX_BODY = 1024 * 1024;

function respond(response: ServerResponse, status: number, value: unknown, headers: Record<string, string> = {}) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Content-Type-Options": "nosniff", ...headers });
  response.end(status === 204 ? undefined : JSON.stringify(value));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  if (request.headers["content-type"]?.split(";")[0]?.trim() !== "application/json") {
    throw new ApiError(415, "JSON_REQUIRED", "Envie Content-Type: application/json.");
  }
  if (Number(request.headers["content-length"] ?? 0) > MAX_BODY) {
    request.resume();
    throw new ApiError(413, "BODY_TOO_LARGE", "O corpo excede 1 MiB.");
  }
  const text = await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let exceeded = false;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) { exceeded = true; chunks.length = 0; }
      else if (!exceeded) chunks.push(chunk);
    });
    request.on("end", () => exceeded ? reject(new ApiError(413, "BODY_TOO_LARGE", "O corpo excede 1 MiB.")) : resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
    request.on("aborted", () => reject(new ApiError(400, "ABORTED_REQUEST", "Requisição interrompida.")));
  });
  try { return JSON.parse(text); }
  catch { throw new ApiError(400, "INVALID_JSON", "JSON inválido."); }
}

function exactFields(value: Record<string, unknown>, names: string[]) {
  if (Object.keys(value).length !== names.length || names.some((name) => !(name in value))) {
    throw new ApiError(400, "INVALID_INPUT", `Campos esperados: ${names.join(", ")}.`);
  }
}

function selector(value: unknown): { id: string; variant: "baseline" | "candidate" } {
  const selection = record(value, "selection");
  exactFields(selection, ["runId", "variant"]);
  if (selection.variant !== "baseline" && selection.variant !== "candidate") throw new ApiError(400, "INVALID_INPUT", "variant deve ser baseline ou candidate.");
  return { id: runId(selection.runId), variant: selection.variant };
}

export async function createApiServer(options: ApiOptions): Promise<Server> {
  if (options.token !== undefined && !options.token.trim()) throw new TypeError("The API token cannot be empty");
  if (options.contextToken !== undefined && (!options.contextToken.trim() || !options.token || options.contextToken === options.token)) throw new TypeError("The context token must be nonempty, distinct, and paired with the API token");
  if (options.contextReadToken !== undefined && (!options.contextReadToken.trim() || !options.token || options.contextReadToken === options.token || options.contextReadToken === options.contextToken)) throw new TypeError("The read token must be nonempty, distinct, and paired with the API token");
  const origins = new Set((options.allowedOrigins ?? []).map((origin) => {
    const url = new URL(origin);
    if (!["http:", "https:"].includes(url.protocol) || url.origin !== origin) throw new TypeError("Allowed origins must be exact HTTP(S) origins");
    return origin;
  }));
  const tokenHash = options.token === undefined ? null : createHash("sha256").update(options.token).digest();
  const contextTokenHash = options.contextToken === undefined ? null : createHash("sha256").update(options.contextToken).digest();
  const contextReadHash = options.contextReadToken === undefined ? null : createHash("sha256").update(options.contextReadToken).digest();
  const store = new LabStore(options.dataDirectory);
  await store.initialize(options.seed);
  const policies = new PolicyStore(options.dataDirectory);
  await policies.initialize();
  const routeInventories = new RouteInventoryStore(options.dataDirectory);
  const productContexts = new ProductContextStore(options.dataDirectory);
  const clientContracts = new ClientContractStore(options.dataDirectory);

  const server = createServer((request, response) => {
    void (async () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 3300;
      const origin = request.headers.origin;
      if (origin !== undefined) {
        if (!origins.has(origin) && ![`http://127.0.0.1:${port}`, `http://localhost:${port}`, `http://[::1]:${port}`].includes(origin)) {
          throw new ApiError(403, "ORIGIN_DENIED", "Origem não autorizada.");
        }
        response.setHeader("Access-Control-Allow-Origin", origin);
        response.setHeader("Vary", "Origin");
        response.setHeader("Access-Control-Expose-Headers", "ETag, Location");
      }
      if (request.method === "OPTIONS") {
        response.setHeader("Access-Control-Allow-Methods", "GET, PUT, POST, OPTIONS");
        response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, If-Match");
        respond(response, 204, null);
        return;
      }
      const url = new URL(request.url ?? "/", "http://localhost");
      if (request.method === "GET" && url.pathname === "/") {
        response.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
        });
        response.end(LANDING_HTML);
        return;
      }
      if (request.method === "GET" && url.pathname === "/health") {
        respond(response, 200, { status: "ok", service: "avila-experiments", authRequired: tokenHash !== null });
        return;
      }
      if (request.method === "GET" && url.pathname === "/openapi.json") {
        respond(response, 200, OPENAPI);
        return;
      }
      if (tokenHash !== null) {
        const supplied = request.headers.authorization?.match(/^Bearer (.+)$/)?.[1] ?? "";
        const suppliedHash = createHash("sha256").update(supplied).digest();
        const contextAccess = contextTokenHash !== null && timingSafeEqual(contextTokenHash, suppliedHash)
          && url.pathname === "/api/v1/product-contexts/erp" && ["GET", "PUT"].includes(request.method ?? "");
        const contextReadAccess = contextReadHash !== null && timingSafeEqual(contextReadHash, suppliedHash)
          && url.pathname === "/api/v1/product-contexts/erp" && request.method === "GET";
        if (!timingSafeEqual(tokenHash, suppliedHash) && !contextAccess && !contextReadAccess) {
          throw new ApiError(401, "UNAUTHORIZED", "Token de acesso necessário.");
        }
      }
      if (url.pathname === "/api/v1/client-contracts" && ["GET", "PUT"].includes(request.method ?? "")) {
        if (url.search) throw new ApiError(400, "INVALID_INPUT", "O cadastro não aceita parâmetros de consulta.");
        if (request.method === "GET") {
          const catalog = await clientContracts.catalog();
          respond(response, 200, catalog, { ETag: `"${catalog.revision}"` });
        } else {
          const match = request.headers["if-match"];
          if (match === undefined) throw new ApiError(428, "REVISION_REQUIRED", "Envie If-Match com a revisão do cadastro.");
          if (typeof match !== "string" || !/^"(?:0|[1-9][0-9]*)"$/.test(match) || !Number.isSafeInteger(Number(match.slice(1, -1)))) throw new ApiError(400, "INVALID_INPUT", "If-Match inválido.");
          const result = await clientContracts.save(await readJson(request), Number(match.slice(1, -1)));
          respond(response, 200, result, { ETag: `"${result.catalog.revision}"` });
        }
        return;
      }
      const contractHistory = url.pathname.match(/^\/api\/v1\/client-contracts\/([^/]+)\/history$/);
      if (contractHistory && request.method === "GET") {
        if ([...url.searchParams.keys()].some(key => !["limit", "offset"].includes(key) || url.searchParams.getAll(key).length !== 1)) throw new ApiError(400, "INVALID_INPUT", "Use apenas limit e offset, uma vez cada.");
        const limit = url.searchParams.get("limit") ?? "20", offset = url.searchParams.get("offset") ?? "0";
        if (!/^[1-9]\d*$/.test(limit) || !/^(?:0|[1-9]\d*)$/.test(offset)) throw new ApiError(400, "INVALID_INPUT", "Paginação inválida.");
        respond(response, 200, await clientContracts.history(contractHistory[1]!, Number(limit), Number(offset)));
        return;
      }
      if (url.pathname === "/api/v1/product-contexts/erp") {
        if (request.method === "GET") {
          const view = url.searchParams.get("view");
          if (view !== null) {
            if (!["flows", "index", "context"].includes(view) || [...url.searchParams.keys()].some(key => !["view", "sha256", "mode", "flow"].includes(key))
                || [...new Set(url.searchParams.keys())].length !== [...url.searchParams.keys()].length) throw new ApiError(400, "INVALID_INPUT", "Seleção de contexto inválida.");
            if (view === "context" && (!url.searchParams.has("sha256") || !url.searchParams.has("flow"))) throw new ApiError(400, "INVALID_INPUT", "Informe sha256 e flow para fixar a captura da funcionalidade.");
            const result = await productContexts.view({ ...(url.searchParams.has("sha256") ? { digest: url.searchParams.get("sha256")! } : {}),
              ...(url.searchParams.has("mode") ? { mode: url.searchParams.get("mode")! } : {}),
              ...(url.searchParams.has("flow") ? { flow: url.searchParams.get("flow")! } : {}), indexOnly: view === "index" });
            respond(response, 200, result, { ETag: `"${result.revision}"` });
            return;
          }
          const keys = [...url.searchParams.keys()];
          if (keys.length > 1 || keys.some(key => !["sha256", "requestId"].includes(key))) throw new ApiError(400, "INVALID_INPUT", "Use apenas sha256 ou requestId.");
          const digest = url.searchParams.get("sha256"), id = url.searchParams.get("requestId");
          if (digest !== null) respond(response, 200, await productContexts.snapshot(digest));
          else if (id !== null) respond(response, 200, await productContexts.receipt(id));
          else { const state = await productContexts.state(); respond(response, 200, state, { ETag: `"${state.revision}"` }); }
          return;
        }
        if (request.method === "PUT") {
          if (url.search) throw new ApiError(400, "INVALID_INPUT", "A importação não aceita parâmetros de consulta.");
          const match = request.headers["if-match"];
          if (match === undefined) throw new ApiError(428, "REVISION_REQUIRED", "Envie If-Match com a revisão do contexto.");
          if (typeof match !== "string" || !/^"(?:0|[1-9][0-9]*)"$/.test(match) || !Number.isSafeInteger(Number(match.slice(1, -1)))) throw new ApiError(400, "INVALID_INPUT", "If-Match inválido.");
          const result = await productContexts.save(await readJson(request), Number(match.slice(1, -1)));
          respond(response, 200, result, { ETag: `"${result.currentRevision}"` });
          return;
        }
      }
      if (url.pathname === "/api/v1/policies/import/preview" && request.method === "POST") {
        const input = record(await readJson(request), "preview");
        exactFields(input, ["document"]);
        const preview = await policies.previewImport(input.document);
        respond(response, 200, preview, { ETag: `"${preview.revision}"` });
        return;
      }
      if (url.pathname === "/api/v1/policies/import" && request.method === "POST") {
        const match = request.headers["if-match"];
        if (match === undefined) throw new ApiError(428, "REVISION_REQUIRED", "Envie If-Match com a revisão da prévia.");
        if (typeof match !== "string" || !/^"[1-9][0-9]*"$/.test(match)) throw new ApiError(400, "INVALID_INPUT", "If-Match inválido.");
        const input = record(await readJson(request), "import");
        exactFields(input, ["document", "changeNote"]);
        const result = await policies.importPolicies(input.document, input.changeNote, positiveInteger(Number(match.slice(1, -1)), "revision"));
        respond(response, 200, result, { ETag: `"${result.catalog.revision}"` });
        return;
      }
      if (url.pathname === "/api/v1/route-inventories" && request.method === "GET") {
        respond(response, 200, { products: ROUTE_PRODUCTS });
        return;
      }
      const inventoryMatch = url.pathname.match(/^\/api\/v1\/route-inventories\/([a-z]+)$/);
      if (inventoryMatch && request.method === "GET") {
        const result = await routeInventories.get(inventoryMatch[1]!);
        respond(response, 200, result, { ETag: `"${result.revision}"` });
        return;
      }
      if (inventoryMatch && request.method === "PUT") {
        const match = request.headers["if-match"];
        if (match === undefined) throw new ApiError(428, "REVISION_REQUIRED", "Envie If-Match com a revisão do inventário.");
        if (typeof match !== "string" || !/^"(?:0|[1-9][0-9]*)"$/.test(match) || !Number.isSafeInteger(Number(match.slice(1, -1)))) throw new ApiError(400, "INVALID_INPUT", "If-Match inválido.");
        const result = await routeInventories.save(inventoryMatch[1]!, await readJson(request), Number(match.slice(1, -1)));
        respond(response, 200, result, { ETag: `"${result.revision}"` });
        return;
      }
      if (url.pathname === "/api/v1/policies" && request.method === "GET") {
        const catalog = await policies.catalog();
        respond(response, 200, catalog, { ETag: `"${catalog.revision}"` });
        return;
      }
      if (url.pathname === "/api/v1/policies" && request.method === "PUT") {
        const match = request.headers["if-match"];
        if (match === undefined) throw new ApiError(428, "REVISION_REQUIRED", "Envie If-Match com a revisão do caderno.");
        if (typeof match !== "string" || !/^"[1-9][0-9]*"$/.test(match)) throw new ApiError(400, "INVALID_INPUT", "If-Match inválido.");
        const update = parsePolicyUpdate(await readJson(request));
        const catalog = await policies.update(update.policy, update.changeNote, positiveInteger(Number(match.slice(1, -1)), "revision"));
        respond(response, 200, catalog, { ETag: `"${catalog.revision}"` });
        return;
      }
      if (url.pathname === "/api/v1/suite" && request.method === "GET") {
        const suite = await store.suite();
        respond(response, 200, suite, { ETag: `"${suite.revision}"` });
        return;
      }
      if (url.pathname === "/api/v1/suite" && request.method === "PUT") {
        const match = request.headers["if-match"];
        if (match === undefined) throw new ApiError(428, "REVISION_REQUIRED", "Envie If-Match com o ETag recebido ao carregar a suíte.");
        if (typeof match !== "string" || !/^"[1-9][0-9]*"$/.test(match)) throw new ApiError(400, "INVALID_INPUT", "If-Match inválido.");
        const suite = await store.update(parseDraft(await readJson(request)), positiveInteger(Number(match.slice(1, -1)), "revision"));
        respond(response, 200, suite, { ETag: `"${suite.revision}"` });
        return;
      }
      if (url.pathname === "/api/v1/runs" && request.method === "GET") {
        const limit = positiveInteger(Number(url.searchParams.get("limit") ?? 25), "limit", 100);
        const offset = Number(url.searchParams.get("offset") ?? 0);
        if (!Number.isSafeInteger(offset) || offset < 0) throw new ApiError(400, "INVALID_INPUT", "offset deve ser um inteiro não negativo.");
        respond(response, 200, await store.runs(limit, offset));
        return;
      }
      if (url.pathname === "/api/v1/runs" && request.method === "POST") {
        const input = record(await readJson(request), "run");
        exactFields(input, ["revision"]);
        const result = await store.execute(positiveInteger(input.revision, "revision"));
        respond(response, 201, result, { Location: `/api/v1/runs/${result.id}` });
        return;
      }
      const runMatch = url.pathname.match(/^\/api\/v1\/runs\/([^/]+)$/);
      if (request.method === "GET" && runMatch) {
        respond(response, 200, await store.run(runMatch[1]!));
        return;
      }
      if (url.pathname === "/api/v1/comparisons" && request.method === "POST") {
        const input = record(await readJson(request), "comparison");
        exactFields(input, ["baseline", "candidate"]);
        const before = selector(input.baseline);
        const after = selector(input.candidate);
        respond(response, 200, compareExperiments((await store.run(before.id))[before.variant], (await store.run(after.id))[after.variant]));
        return;
      }
      throw new ApiError(404, "NOT_FOUND", "Endpoint não encontrado.");
    })().catch((error: unknown) => {
      if (response.headersSent || response.destroyed) return;
      const known = error instanceof ApiError;
      respond(response, known ? error.status : 500, { error: { code: known ? error.code : "INTERNAL_ERROR", message: known ? error.message : "Não foi possível concluir a operação." } });
    });
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  return server;
}
