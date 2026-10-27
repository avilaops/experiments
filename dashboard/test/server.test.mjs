import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { gzipSync } from "node:zlib";
import { createApiServer } from "../../dist/lab/server.js";
import { createDashboard } from "../dist/server.mjs";
import { validatePublicExport } from "../public-export.mjs";
const listen = async server => { await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); return "http://127.0.0.1:" + server.address().port; };
const close = server => new Promise(resolve => server.close(resolve));
test("BFF authenticates, withholds the API token, preserves ETag and protects mutations", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "avila-bff-"));
  const api = await createApiServer({ dataDirectory: directory, token: "private-upstream-token-for-test" });
  const apiUrl = await listen(api);
  const bff = createDashboard({ apiUrl, apiToken: "private-upstream-token-for-test", username: "tester", password: "long-test-password-123", origin: "https://lab.example", assetDirectory: new URL("../dist/", import.meta.url).pathname });
  const url = await listen(bff);
  const auth = { Authorization: "Basic " + Buffer.from("tester:long-test-password-123").toString("base64") };
  try {
    assert.equal((await fetch(url + "/experiments/")).status, 401);
    assert.equal((await fetch(url + "/experiments/api/v1/suite")).status, 401);
    assert.equal((await fetch(url + "/experiments/policies")).status, 401);
    assert.equal((await fetch(url + "/experiments/api/v1/policies")).status, 401);
    assert.equal((await fetch(url + "/experiments/policies", { headers: auth })).status, 200);
    const policyResponse = await fetch(url + "/experiments/api/v1/policies", { headers: auth });
    assert.equal(policyResponse.status, 200);
    assert.equal(policyResponse.headers.get("etag"), '"1"');
    const policyCatalog = await policyResponse.json();
    const { version, updatedAt, ...policy } = policyCatalog.policies[0];
    const updatePolicy = () => fetch(url + "/experiments/api/v1/policies", { method: "PUT", headers: { ...auth, "Content-Type": "application/json", "If-Match": '"1"', Origin: "https://lab.example" }, body: JSON.stringify({ policy, changeNote: "Conferir encaminhamento autenticado" }) });
    assert.equal((await updatePolicy()).status, 200);
    assert.equal((await updatePolicy()).status, 412);
    assert.equal((await fetch(url + "/experiments/api/v1/suite", { headers: { Authorization: "Basic wrong" } })).status, 401);
    const html = await (await fetch(url + "/experiments/", { headers: auth })).text();
    assert.ok(html.includes("O resultado importa"));
    assert.ok(!html.includes("private-upstream-token"));
    const response = await fetch(url + "/experiments/api/v1/suite", { headers: auth });
    assert.equal(response.status, 200); assert.equal(response.headers.get("etag"), '"1"');
    const suite = await response.json();
    const draft = { hypothesis: suite.hypothesis, cases: suite.dataset.cases, settings: suite.settings };
    const put = headers => fetch(url + "/experiments/api/v1/suite", { method: "PUT", headers: { ...auth, "Content-Type": "application/json", "If-Match": '"1"', ...headers }, body: JSON.stringify(draft) });
    assert.equal((await put({ Origin: "https://evil.example" })).status, 403);
    assert.equal((await put({ Origin: "https://lab.example" })).status, 200);
    assert.equal((await put({})).status, 412);
    assert.equal((await fetch(url + "/experiments/../../.env", { headers: auth })).status, 404);
  } finally { await close(bff); await close(api); await rm(directory, { recursive: true, force: true }); }
});
test("public export contains only allowlisted synthetic evidence", async () => {
  const root = new URL("../", import.meta.url);
  const allowed = JSON.parse(await readFile(new URL("evidence.allowlist.json", root)));
  await validatePublicExport(new URL("public/", root), allowed);
  assert.deepEqual((await readdir(new URL("public/data/", root))).sort(), [...allowed].sort());
  const manifest = JSON.parse(await readFile(new URL("public/manifest.json", root)));
  assert.equal(manifest.artifacts.length, allowed.length);
  const html = await readFile(new URL("public/index.html", root), "utf8");
  assert.ok(html.includes("Não medido"));
  assert.ok(html.includes("Inconclusivos"));
  assert.ok(!html.includes("Executar suíte"));
  assert.ok(!html.includes("LAB_API_TOKEN"));
});

test("BFF protects import preview and commit, forwards ETags and preserves batches on conflicts", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "avila-bff-import-"));
  const api = await createApiServer({ dataDirectory: directory, token: "private-import-token" });
  const apiUrl = await listen(api);
  const bff = createDashboard({ apiUrl, apiToken: "private-import-token", username: "tester", password: "long-test-password-123", origin: "https://lab.example", assetDirectory: "unused" });
  const url = await listen(bff);
  const endpoint = url + "/experiments/api/v1/policies/import";
  const auth = { Authorization: "Basic " + Buffer.from("tester:long-test-password-123").toString("base64"), "Content-Type": "application/json", Origin: "https://lab.example" };
  const document = [{ id: "CRM-BFF-001", product: "crm", title: "Importação BFF", category: "access", state: "proposed", rule: "Regra de teste", owner: "A definir", enforcement: "", verificationDate: "", sources: [] }];
  try {
    assert.equal((await fetch(endpoint + "/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ document }) })).status, 401);
    assert.equal((await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ document, changeNote: "Unauthorized" }) })).status, 401);
    const preview = await fetch(endpoint + "/preview", { method: "POST", headers: auth, body: JSON.stringify({ document }) });
    assert.equal(preview.status, 200);
    assert.equal(preview.headers.get("etag"), '"1"');
    assert.equal((await preview.json()).createCount, 1);
    const save = headers => fetch(endpoint, { method: "POST", headers: { ...auth, ...headers }, body: JSON.stringify({ document, changeNote: "Conferência no BFF" }) });
    assert.equal((await save({ Origin: "https://evil.example", "If-Match": '"1"' })).status, 403);
    assert.equal((await save({})).status, 428);
    const committed = await save({ "If-Match": '"1"' });
    assert.equal(committed.status, 200);
    assert.equal(committed.headers.get("etag"), '"2"');
    assert.deepEqual((await committed.json()).created, ["CRM-BFF-001"]);
    assert.equal((await save({ "If-Match": '"1"' })).status, 412);
  } finally {
    await close(bff); await close(api);
    assert.equal(path.dirname(directory), tmpdir());
    assert.ok(path.basename(directory).startsWith("avila-bff-import-"));
    await rm(directory, { recursive: true, force: true });
  }
});

test("a compression proxy preserves revision ETags and If-Match round trips for the suite and imports", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "avila-compression-test-"));
  const api = await createApiServer({ dataDirectory: directory, token: "private-compression-token" });
  const apiUrl = await listen(api);
  const bff = createDashboard({ apiUrl, apiToken: "private-compression-token", username: "tester", password: "long-test-password-123", origin: "https://lab.example", assetDirectory: "unused" });
  const bffUrl = await listen(bff);
  // Reproduce the intermediary behavior: gzip creates a distinct representation
  // and changes its ETag unless Cache-Control prohibits transformation.
  const proxy = createServer((request, response) => {
    void (async () => {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const headers = {};
      for (const name of ["authorization", "content-type", "if-match", "origin"]) {
        if (request.headers[name]) headers[name] = request.headers[name];
      }
      const upstream = await fetch(bffUrl + request.url, { method: request.method, headers,
        ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) });
      const outgoing = Object.fromEntries(upstream.headers);
      for (const name of ["content-length", "transfer-encoding", "connection", "keep-alive"]) delete outgoing[name];
      let bytes = Buffer.from(await upstream.arrayBuffer());
      if (!(outgoing["cache-control"] ?? "").includes("no-transform")) {
        bytes = gzipSync(bytes);
        outgoing["content-encoding"] = "gzip";
        if (outgoing.etag) outgoing.etag = outgoing.etag.replace(/"$/, '-gzip"');
      }
      response.writeHead(upstream.status, outgoing);
      response.end(bytes);
    })().catch(error => { response.statusCode = 502; response.end(error.message); });
  });
  const url = await listen(proxy);
  const auth = { Authorization: "Basic " + Buffer.from("tester:long-test-password-123").toString("base64") };
  try {
    const suiteResponse = await fetch(url + "/experiments/api/v1/suite", { headers: auth });
    assert.equal(suiteResponse.headers.get("etag"), '"1"');
    assert.match(suiteResponse.headers.get("cache-control"), /no-transform/);
    const suite = await suiteResponse.json();
    const saved = await fetch(url + "/experiments/api/v1/suite", { method: "PUT", headers: { ...auth, "Content-Type": "application/json", "If-Match": suiteResponse.headers.get("etag") },
      body: JSON.stringify({ hypothesis: suite.hypothesis, cases: suite.dataset.cases, settings: suite.settings }) });
    assert.equal(saved.status, 200);
    const catalogResponse = await fetch(url + "/experiments/api/v1/policies", { headers: auth });
    assert.equal(catalogResponse.headers.get("etag"), '"1"');
    const document = await catalogResponse.json();
    const preview = await fetch(url + "/experiments/api/v1/policies/import/preview", { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ document }) });
    assert.equal(preview.headers.get("etag"), '"1"');
    assert.match(preview.headers.get("cache-control"), /no-transform/);
    assert.equal(preview.headers.get("content-encoding"), null);
    const committed = await fetch(url + "/experiments/api/v1/policies/import", { method: "POST", headers: { ...auth, "Content-Type": "application/json", "If-Match": preview.headers.get("etag") }, body: JSON.stringify({ document, changeNote: "Conferência pelo proxy" }) });
    assert.equal(committed.status, 200);
    assert.deepEqual((await committed.json()).created, []);
    assert.equal(committed.headers.get("etag"), '"1"');
  } finally {
    await close(proxy); await close(bff); await close(api);
    assert.equal(path.dirname(directory), tmpdir());
    assert.ok(path.basename(directory).startsWith("avila-compression-test-"));
    await rm(directory, { recursive: true, force: true });
  }
});
