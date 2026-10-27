import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApiServer } from "../dist/lab/server.js";
import { parseRouteInventory } from "../dist/lab/route-inventories.js";

export const reportFixture = () => ({ schemaVersion: "route-inventory/2", runId: "11111111-1111-4111-8111-111111111111", recordedAt: "2026-10-27T20:00:00Z",
  source: { head: "a".repeat(40), fingerprint: "b".repeat(64), dirty: true, root: "private-root-sentinel" },
  web: { pages: [{ path: "/products", source: "products/page.tsx" }], handlers: [{ path: "/api/products", source: "api/products/route.ts", declaredMethods: ["GET"], exports: [{ method: "GET", status: "callable" }] }], review: [], conflicts: [] },
  api: { operations: [{ path: "/api/v1/products", method: "GET", operationId: "listProducts" }], review: [] },
  flows: [{ verdict: "passed" }], secret: "secret-sentinel",
});
async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "avila-route-catalog-"));
  let server;
  const close = async () => { if (server?.listening) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
  t.after(async () => {
    await close(); assert.equal(path.dirname(directory), tmpdir()); assert.ok(path.basename(directory).startsWith("avila-route-catalog-"));
    await rm(directory, { recursive: true, force: true });
  });
  const start = async () => {
    server = await createApiServer({ dataDirectory: directory, token: "catalog-test-token" });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    return "http://127.0.0.1:" + server.address().port;
  };
  let base = await start();
  const request = (route = "/erp", options = {}) => fetch(base + "/api/v1/route-inventories" + route, { ...options,
    headers: { Authorization: "Bearer catalog-test-token", ...options.headers } });
  const save = (body, revision = 0, product = "erp") => request("/" + product, { method: "PUT", headers: { "Content-Type": "application/json", "If-Match": `"${revision}"` }, body: JSON.stringify(body) });
  return { request, save, restart: async () => { await close(); base = await start(); } };
}
test("private route catalog requires authentication before reading or importing", async t => {
  const f = await fixture(t);
  assert.equal((await f.request("", { headers: { Authorization: "" } })).status, 401);
  assert.equal((await f.request("/erp", { method: "PUT", headers: { Authorization: "Bearer wrong" } })).status, 401);
  assert.equal((await f.request("/../unknown")).status, 404);
  assert.equal((await f.request("/unknown")).status, 404);
  const products = await (await f.request("")).json();
  assert.ok(products.products.some(product => product.id === "erp"));
});
test("import projects real rows, persists across restart and keeps other products pending", async t => {
  const f = await fixture(t);
  const pending = await f.request(); assert.equal(pending.headers.get("etag"), '"0"');
  assert.equal((await pending.json()).inventory, null);
  const response = await f.save(reportFixture()); assert.equal(response.status, 200); assert.equal(response.headers.get("etag"), '"1"');
  const saved = await response.json();
  assert.equal(saved.inventory.entries.length, 3);
  assert.ok(saved.inventory.entries.every(row => row.verification === "not_run"));
  assert.doesNotMatch(JSON.stringify(saved), /secret-sentinel|private-root-sentinel|"passed"/);
  await f.restart();
  assert.deepEqual(await (await f.request()).json(), saved);
  assert.equal((await (await f.request("/cms")).json()).inventory, null);
  assert.equal((await f.save(reportFixture(), 0)).status, 412);
  assert.deepEqual(await (await f.request()).json(), saved);
});
test("missing API and unresolved BFF exports remain visible without claiming zero API operations", async t => {
  const f = await fixture(t), report = reportFixture(); report.api = null;
  report.web.handlers[0].exports[0].status = "needs_review";
  const response = await f.save(report); assert.equal(response.status, 200);
  const { inventory } = await response.json();
  assert.equal(inventory.apiCaptured, false);
  assert.equal(inventory.entries.find(row => row.layer === "bff").handlerStatus, "needs_review");
});
test("invalid imports, unsafe products and missing revisions cannot replace the catalog", async t => {
  const f = await fixture(t);
  for (const mutate of [value => { value.source.fingerprint = "invalid"; }, value => { value.web.pages[0].path = "https://private"; },
    value => { value.web.handlers[0].declaredMethods = ["INVALID"]; }, value => { value.api.operations[0].method = "INVALID"; },
    value => { value.source.head = "a".repeat(41); }, value => { value.runId = "-".repeat(36); }]) {
    const report = reportFixture(); mutate(report);
    assert.equal((await f.save(report)).status, 400);
  }
  assert.equal((await f.request("/erp", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(reportFixture()) })).status, 428);
  assert.equal((await (await f.request()).json()).inventory, null);
  assert.throws(() => parseRouteInventory({ schemaVersion: "other" }));
});
