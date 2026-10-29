import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApiServer } from "../../dist/lab/server.js";
import { createDashboard } from "../dist/server.mjs";

test("contract BFF protects HTML and data, preserves revisions and forwards history pagination", async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "avila-contract-bff-"));
  const api = await createApiServer({ dataDirectory: directory, token: "private-contract-upstream" });
  let bff;
  t.after(async () => {
    if (bff?.listening) { bff.closeAllConnections(); await new Promise(resolve => bff.close(resolve)); }
    api.closeAllConnections(); await new Promise(resolve => api.close(resolve));
    assert.equal(path.dirname(directory), tmpdir()); assert.ok(path.basename(directory).startsWith("avila-contract-bff-"));
    await rm(directory, { recursive: true, force: true });
  });
  await new Promise(resolve => api.listen(0, "127.0.0.1", resolve));
  bff = createDashboard({ apiUrl: "http://127.0.0.1:" + api.address().port, apiToken: "private-contract-upstream", username: "tester", password: "long-contract-test-password", origin: "https://lab.example", assetDirectory: "unused" });
  await new Promise(resolve => bff.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + bff.address().port;
  const auth = { Authorization: "Basic " + Buffer.from("tester:long-contract-test-password").toString("base64") };
  const endpoint = base + "/experiments/api/v1/client-contracts";
  assert.equal((await fetch(base + "/experiments/contracts")).status, 401);
  assert.equal((await fetch(endpoint)).status, 401);
  const html = await (await fetch(base + "/experiments/contracts/", { headers: auth })).text();
  assert.match(html, /Contratos com clientes/); assert.doesNotMatch(html, /private-contract-upstream/);
  const initial = await fetch(endpoint, { headers: auth });
  assert.equal(initial.status, 200); assert.equal(initial.headers.get("etag"), '"0"'); assert.equal(initial.headers.get("cache-control"), "no-store, no-transform");
  const contract = { code: "BFF-1", title: "Teste BFF", clientName: "Cliente sintético", clientReference: "", product: "erp", status: "draft", startDate: "2026-10-28", endDate: "", amount: "12.34", billingCycle: "one_time", notes: "" };
  const save = (id, revision, headers = {}) => fetch(endpoint, { method: "PUT", headers: { ...auth, "Content-Type": "application/json", "If-Match": `"${revision}"`, ...headers }, body: JSON.stringify({ id, contract, changeNote: "Teste do BFF" }) });
  assert.equal((await save(null, 0, { Origin: "https://evil.example" })).status, 403);
  const saved = await save(null, 0); assert.equal(saved.status, 200); assert.equal(saved.headers.get("etag"), '"1"');
  const first = await saved.json(); assert.equal((await save(first.contract.id, 0)).status, 412);
  contract.status = "active"; assert.equal((await save(first.contract.id, 1)).status, 200);
  const historyUrl = endpoint + "/" + first.contract.id + "/history?limit=1&offset=1";
  assert.equal((await fetch(historyUrl)).status, 401);
  const history = await (await fetch(historyUrl, { headers: auth })).json();
  assert.equal(history.total, 2); assert.equal(history.limit, 1); assert.equal(history.offset, 1); assert.equal(history.items[0].contract.status, "draft");
  assert.equal((await fetch(endpoint + "?unexpected=1", { headers: auth })).status, 400);
  assert.equal((await fetch(endpoint + "/" + first.contract.id + "/history?limit=101", { headers: auth })).status, 400);
});
