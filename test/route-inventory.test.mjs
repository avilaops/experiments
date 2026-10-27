import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { analyzeHandlers, captureStableInventory, correlateRoutes, diagnostic, gitState, inventoryWeb, main, routePattern } from "../scripts/inventory-erp-routes.mjs";
import { inventoryOpenApi } from "../scripts/route-inventory/openapi.mjs";
import { InventoryError, stableFile } from "../scripts/route-inventory/source.mjs";
import { createServer } from "node:http";

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "route-capture-"));
  t.after(async () => {
    assert.equal(path.dirname(root), tmpdir());
    assert.ok(path.basename(root).startsWith("route-capture-"));
    await rm(root, { recursive: true, force: true });
  });
  const app = path.join(root, "apps", "web", "src", "app");
  await mkdir(app, { recursive: true });
  const write = async (file, contents = "export default function Page() { return null }") => {
    const target = path.join(app, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, contents);
    return target;
  };
  return { root, app, write };
}
const state = () => ({ head: "test-commit", dirty: true, statusSha256: "1".repeat(64) });
const contract = (version = "3.1.0") => ({ openapi: version, info: { title: "Fixture", version: "1" },
  paths: { "/products/{id}": { get: { operationId: "getProduct", responses: { 200: { description: "OK" } } } } } });

test("canonical patterns detect renamed parameters while preserving catch-all and optional catch-all", () => {
  assert.equal(routePattern("/products/[id]"), routePattern("/products/[slug]"));
  assert.equal(routePattern("/products/{id}", { openapi: true }), routePattern("/products/[slug]"));
  assert.equal(routePattern("/literal/{id}"), "/literal/{id}");
  assert.equal(routePattern("/files/{id}.json", { openapi: true }), routePattern("/files/{slug}.json", { openapi: true }));
  assert.equal(routePattern("/files/[...segments]"), "/files/[...]");
  assert.equal(routePattern("/files/[[...segments]]"), "/files/[[...]]");
  assert.notEqual(routePattern("/files/[id]"), routePattern("/files/[...id]"));
});

test("route groups and equivalent dynamic URLs are retained with explicit conflicts", async t => {
  const f = await fixture(t);
  await f.write("(first)/products/[id]/page.tsx");
  await f.write("(second)/products/[slug]/page.tsx");
  const result = await inventoryWeb(f.app);
  assert.equal(result.pages.length, 2);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].pattern, "/products/[]");
  assert.equal(result.conflicts[0].reason, "equivalent_url_patterns");
});

test("parallel, intercepted and symlinked directories are reviewed without following targets", async t => {
  const f = await fixture(t);
  await f.write("@modal/products/page.tsx");
  await f.write("(.)products/page.tsx");
  const outside = path.join(f.root, "outside");
  await mkdir(outside);
  await writeFile(path.join(outside, "page.tsx"), "outside-sentinel");
  await symlink(outside, path.join(f.app, "linked"), process.platform === "win32" ? "junction" : "dir");
  const result = await inventoryWeb(f.app);
  assert.equal(result.pages.length, 0);
  assert.equal(result.review.filter(row => row.reason === "parallel_or_intercepted_route").length, 2);
  assert.ok(result.review.some(row => row.reason === "symlink_not_followed"));
  assert.doesNotMatch(JSON.stringify(result), /outside-sentinel/);
});

test("static functions, local aliases, factories and non-functions have distinct handler states", () => {
  const result = analyzeHandlers(`
    const real = async () => new Response();
    const alias = real;
    export { alias as GET };
    export const POST = 42;
    export const PUT = withAuth(real);
    export { remove as DELETE } from './other';
    export const PATCH = imported;
    export type { HEAD } from './types';
    export * from './shared';
  `);
  assert.deepEqual(result.methods, ["GET"]);
  assert.deepEqual(result.declaredMethods, ["GET", "POST", "PUT", "PATCH", "DELETE"]);
  assert.equal(result.exports.find(row => row.method === "POST").status, "not_callable");
  assert.equal(result.exports.find(row => row.method === "PUT").reason, "computed_or_factory_handler");
  assert.equal(result.exports.find(row => row.method === "DELETE").reason, "external_reexport_not_resolved");
  assert.ok(result.review.some(row => row.reason === "wildcard_export_not_resolved"));
});

test("cyclic aliases, duplicate exports and syntax errors do not become callable handlers", () => {
  assert.equal(analyzeHandlers("const a = b; const b = a; export { a as GET };").exports[0].reason, "cyclic_local_alias");
  const duplicate = analyzeHandlers("const a = () => null; export { a as GET }; export { a as GET };");
  assert.deepEqual(duplicate.methods, []);
  assert.ok(duplicate.review.some(row => row.reason === "duplicate_method_export"));
  assert.equal(analyzeHandlers("export const GET = (").review[0].reason, "handler_syntax_error");
});

test("a default function named GET is not a named HTTP export", () => {
  const result = analyzeHandlers("export default function GET() { return null }");
  assert.deepEqual(result.methods, []);
  assert.deepEqual(result.declaredMethods, []);
  assert.ok(result.review.some(row => row.reason === "no_supported_http_handler_exports"));
  assert.deepEqual(analyzeHandlers("export default function GET() {} export { GET };").methods, ["GET"]);
});

test("fetch option overrides cannot confirm an unknown method", async t => {
  const f = await fixture(t);
  await f.write("page.tsx", `export default function Page() {
    fetch('/api/products', { method: 'POST', ...options });
    fetch('/api/products', { method: 'POST', [key]: value });
    fetch('/api/products', { method: 'POST', method });
    fetch('/api/products', { ...options, method: 'POST' });
    return null;
  }`);
  await f.write("api/products/route.ts", "export const POST = () => null;");
  const web = await inventoryWeb(f.app);
  assert.deepEqual(web.pages[0].literalRequests.map(row => row.method), [null, null, null, "POST"]);
  assert.deepEqual(correlateRoutes(web, null).pageToBff[0].candidates.map(row => row.confidence), ["probable", "probable", "probable", "confirmed"]);
});

test("per-file metadata detects replacement or edits during a read", async t => {
  const f = await fixture(t);
  const file = await f.write("page.tsx");
  await assert.rejects(stableFile(file, { afterRead: () => writeFile(file, "different length and content") }), error => error.code === "SOURCE_CHANGED");
});

test("the second and final scans detect changed or restored source content", async t => {
  const f = await fixture(t);
  const original = "export default function Page() { return null }";
  const file = await f.write("page.tsx", original);
  await assert.rejects(captureStableInventory(f.root, { readState: state, checkpoint: async checkpoint => {
    if (checkpoint === "before-validation") await writeFile(file, "changed");
    if (checkpoint === "before-final-read") await writeFile(file, original);
  } }), error => error.code === "SOURCE_CHANGED");
});

test("Git state is read before and after, including changes outside route files", async t => {
  const f = await fixture(t);
  const git = args => execFileSync("git", ["-C", f.root, ...args], { stdio: "pipe" });
  git(["init", "-q"]);
  await f.write("page.tsx");
  git(["add", "."]);
  git(["-c", "user.name=Inventory Test", "-c", "user.email=inventory@example.test", "commit", "-qm", "Fixture"]);
  assert.equal(gitState(f.root).dirty, false);
  await assert.rejects(captureStableInventory(f.root, { checkpoint: async checkpoint => {
    if (checkpoint === "before-validation") await writeFile(path.join(f.root, "outside-routes.txt"), "changed");
  } }), error => error.code === "GIT_STATE_CHANGED");
});

test("an unchanged capture records both Git states without claiming atomicity", async t => {
  const f = await fixture(t); await f.write("page.tsx");
  const result = await captureStableInventory(f.root, { readState: state });
  assert.deepEqual(result.git.before, result.git.after);
  assert.equal(result.consistency.atomicFilesystemSnapshot, false);
  assert.match(result.consistency.limitation, /outside/);
});

test("a changed API contract invalidates an otherwise stable source capture", async t => {
  const f = await fixture(t); await f.write("page.tsx");
  let capture = 0;
  await assert.rejects(captureStableInventory(f.root, { readState: state, captureApi: async () => ({ sha256: String(++capture), fileMetadata: null }) }), error => error.code === "API_CONTRACT_CHANGED");
});

test("OpenAPI 3.0/3.1 schemas are validated beyond just paths and methods", async () => {
  for (const version of ["3.0.3", "3.1.0"]) {
    const result = await inventoryOpenApi(contract(version));
    assert.equal(result.validation.schema, "passed");
    assert.deepEqual(result.operations[0], { path: "/products/{id}", pattern: "/products/[]", method: "GET", operationId: "getProduct", verification: "not_run" });
    const invalid = contract(version); delete invalid.info;
    await assert.rejects(inventoryOpenApi(invalid), error => error.code === "INVALID_OPENAPI_CONTRACT");
  }
});

test("local path/response references resolve, while external references never load", async () => {
  const value = contract();
  value.components = { pathItems: { product: value.paths["/products/{id}"] }, responses: { success: { description: "OK" } } };
  value.components.pathItems.product.get.responses[200] = { $ref: "#/components/responses/success" };
  value.paths["/products/{id}"] = { $ref: "#/components/pathItems/product" };
  assert.equal((await inventoryOpenApi(value)).operations[0].operationId, "getProduct");
  for (const ref of ["file:///private/secret", "http://127.0.0.1/private", "./secret.json"]) {
    const invalid = contract(); invalid.paths["/products/{id}"] = { $ref: ref };
    await assert.rejects(inventoryOpenApi(invalid), error => error.code === "EXTERNAL_REFERENCE_DISABLED");
  }
  const missing = contract(); missing.paths["/products/{id}"] = { $ref: "#/components/pathItems/missing" };
  await assert.rejects(inventoryOpenApi(missing), error => error.code === "INVALID_OPENAPI_CONTRACT");
});

test("operation IDs are unique and equivalent API path patterns require review", async () => {
  const value = contract();
  value.paths["/products/{slug}"] = { get: { operationId: "other", responses: { 200: { description: "OK" } } } };
  assert.ok((await inventoryOpenApi(value)).review.some(row => row.reason === "equivalent_api_path_patterns"));
  value.paths["/products/{slug}"].get.operationId = "getProduct";
  await assert.rejects(inventoryOpenApi(value), error => error.code === "DUPLICATE_OPERATION_ID");
});

test("OpenAPI paths extensions are metadata, not API routes", async () => {
  const value = contract();
  value.paths["x-owner"] = "engineering";
  value.paths["x-inventory"] = { get: { operationId: "notAnOperation" } };
  const result = await inventoryOpenApi(value);
  assert.equal(result.paths.length, 1);
  assert.equal(result.operations.length, 1);
  assert.equal(result.operations[0].operationId, "getProduct");
});

test("source links distinguish literal references, heuristics and unidentified relationships", async t => {
  const f = await fixture(t);
  await f.write("products/page.tsx", "export default function Page() { fetch('/api/erp/products'); return null }");
  await f.write("unknown/page.tsx");
  await f.write("api/erp/products/route.ts", "export const GET = request => forwardErp(request, '/products');");
  const api = await inventoryOpenApi({ openapi: "3.1.0", info: { title: "Test", version: "1" }, paths: {
    "/api/v1/products": { get: { operationId: "listProducts", responses: { 200: { description: "OK" } } } },
  } });
  const links = correlateRoutes(await inventoryWeb(f.app), api);
  assert.equal(links.pageToBff.find(row => row.page === "/products").confidence, "confirmed");
  assert.equal(links.pageToBff.find(row => row.page === "/unknown").confidence, "unidentified");
  assert.equal(links.bffToApi[0].confidence, "probable");
  assert.equal(links.assurance, "source_relationships_only");
});

test("diagnostics preserve stage/code and safe system codes without exposing raw exceptions", () => {
  const cause = new Error("token=secret-sentinel url=http://private"); cause.code = "ECONNREFUSED";
  const result = diagnostic(new InventoryError("openapi-read", "OPENAPI_READ_FAILED", { cause }));
  assert.equal(result.stage, "openapi-read");
  assert.equal(result.systemCode, "ECONNREFUSED");
  assert.doesNotMatch(JSON.stringify(result), /secret-sentinel|http:\/\/private/);
});

test("CLI rejects unsafe endpoints before attempting source capture", async () => {
  for (const value of ["https://example.com/openapi.json", "http://127.0.0.1/openapi.json?token=secret", "http://user:secret@127.0.0.1/openapi.json"]) {
    await assert.rejects(main(["unused", "--openapi-url", value]), error => error.code === "UNSAFE_OPENAPI_URL");
  }
});

test("an end-to-end file capture preserves exact contract bytes, plain URL and untested flow states", async t => {
  const f = await fixture(t);
  const git = args => execFileSync("git", ["-C", f.root, ...args], { stdio: "pipe" });
  git(["init", "-q"]);
  await f.write("products/page.tsx");
  const bytes = Buffer.from(JSON.stringify(contract(), null, 4) + "\n\n");
  const input = path.join(f.root, "contract.json");
  await writeFile(input, bytes);
  git(["add", "."]);
  git(["-c", "user.name=Inventory Test", "-c", "user.email=inventory@example.test", "commit", "-qm", "Fixture"]);
  const report = await main([f.root, "--openapi-file", input]);
  const outputRoot = fileURLToPath(new URL("../reports/flow-verification/", import.meta.url));
  const output = path.join(outputRoot, report.runId);
  t.after(async () => {
    assert.equal(path.dirname(output), path.resolve(outputRoot));
    assert.match(path.basename(output), /^[a-f0-9-]{36}$/);
    await rm(output, { recursive: true, force: true });
  });
  assert.equal(report.schemaVersion, "route-inventory/2");
  assert.equal(report.reference, "https://linear.app/avilaops/document/027651cb-8e29-4917-8bc6-0c442eaf8985");
  assert.equal(new URL(report.reference).protocol, "https:");
  const artifact = await readFile(path.join(output, "openapi.json"));
  assert.deepEqual(artifact, bytes);
  assert.equal(createHash("sha256").update(artifact).digest("hex"), report.api.sha256);
  assert.equal(report.flows[0].verdict, "not_run");
  assert.equal(report.machineLearningModelExecuted, false);
  assert.equal(report.source.git.before.dirty, false);
  assert.equal(report.source.git.after.dirty, false);
  assert.equal(report.source.head, git(["rev-parse", "HEAD"]).toString("utf8").trim());
  assert.equal(report.counts.pages, 1);
  assert.equal(report.counts.apiMethods, 1);
  assert.equal(report.api.operations[0].operationId, "getProduct");
  assert.doesNotMatch(await readFile(path.join(output, "inventory.json"), "utf8"), /rawBytes/);
  assert.deepEqual(JSON.parse(await readFile(path.join(output, "inventory.json"), "utf8")), report);
});

test("invalid contract JSON yields a safe parse-stage diagnostic", async t => {
  const f = await fixture(t);
  const git = args => execFileSync("git", ["-C", f.root, ...args], { stdio: "pipe" });
  git(["init", "-q"]);
  await f.write("page.tsx");
  git(["add", "."]);
  git(["-c", "user.name=Inventory Test", "-c", "user.email=inventory@example.test", "commit", "-qm", "Fixture"]);
  const input = path.join(f.root, "bad.json");
  await writeFile(input, "token=secret-sentinel");
  await assert.rejects(main([f.root, "--openapi-file", input]), error => {
    const info = diagnostic(error);
    assert.equal(info.stage, "openapi-parse");
    assert.equal(info.code, "INVALID_OPENAPI_JSON");
    assert.equal(info.causeType, "SyntaxError");
    assert.doesNotMatch(JSON.stringify(info), /secret-sentinel/);
    return true;
  });
});

test("HTTP capture refuses invalid responses, redirects, oversized bodies and timeouts", { timeout: 25_000 }, async t => {
  const f = await fixture(t);
  const git = args => execFileSync("git", ["-C", f.root, ...args], { stdio: "pipe" });
  git(["init", "-q"]); await f.write("page.tsx"); git(["add", "."]);
  git(["-c", "user.name=Inventory Test", "-c", "user.email=inventory@example.test", "commit", "-qm", "Fixture"]);
  let mode, redirectRequests = 0;
  const server = createServer((request, response) => {
    if (request.url !== "/openapi.json") { redirectRequests++; response.end(); return; }
    if (mode === "timeout") return;
    if (mode === "redirect") { response.writeHead(302, { Location: "/private" }); response.end(); return; }
    response.setHeader("Content-Type", mode === "content-type" ? "text/html" : "application/json");
    if (mode === "status") response.statusCode = 503;
    response.end(mode === "oversized" ? "x".repeat(4 * 1024 * 1024 + 1) : "{}");
  });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/openapi.json`;
  for (const [value, code] of [["status", "OPENAPI_HTTP_RESPONSE_INVALID"], ["content-type", "OPENAPI_HTTP_RESPONSE_INVALID"],
    ["redirect", "OPENAPI_READ_FAILED"], ["oversized", "OPENAPI_TOO_LARGE"], ["timeout", "OPENAPI_READ_FAILED"]]) {
    mode = value;
    await assert.rejects(main([f.root, "--openapi-url", url]), error => error.code === code && error.stage === "openapi-read");
  }
  assert.equal(redirectRequests, 0);
});
