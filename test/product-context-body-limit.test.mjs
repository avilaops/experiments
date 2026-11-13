import test from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { canonicalContextJson, contextHash, parseProductContext } from "../dist/lab/product-contexts.js";
import { createApiServer } from "../dist/lab/server.js";

const endpoint = "/api/v1/product-contexts/erp";
const contextHeaders = { Authorization: "Bearer context-fixture", "If-Match": '"0"' };

// Complete protocol fixture, never evidence of an ERP publication or execution.
function contextBody(bytes) {
  const payload = {
    schemaVersion: "erp-product-context/1", product: "erp",
    source: { repository: "avilaops/erp-next", commit: "1".repeat(40), dirty: false, gitStatusSha256: "2".repeat(64), catalogSha256: "3".repeat(64), inventorySha256: "4".repeat(64), contextFiles: [{ path: "verification/contracts.json", sha256: "5".repeat(64) }] },
    selection: { targetFlow: null, includedFlows: ["users"] },
    flows: [{ definition: { id: "users", title: "Usuários", goal: "Fixture de importação", kind: "product", dependencies: [], actionGroups: ["users"], nextStep: "Executar um fluxo real separadamente" }, definitionState: "actions_mapped", actionIds: ["list-users"], pages: [], permissions: [], assessment: { code: { implementedDeclarations: 1, blockedDeclarations: 0 }, interface: { state: "not_mapped", mappedActionIds: [], unmappedActionIds: ["list-users"] }, publication: "not_observed", execution: "not_observed" } }],
    actions: [{ id: "list-users", flow: "users", status: "implemented", operation: { method: "GET", path: "/api/v1/users" }, verification: { status: "not_verified_by_catalog", criteria: ["execução separada"] } }],
    authActions: [], pendingFlows: [], limits: ["Fixture de protocolo; não é evidência de execução.", "padding"],
  };
  const envelope = () => ({ context: { ...payload, contentSha256: contextHash(canonicalContextJson(payload)) }, confirmPublication: false });
  payload.limits[1] += "x".repeat(bytes - Buffer.byteLength(JSON.stringify(envelope())));
  const value = envelope();
  parseProductContext(value.context);
  const body = Buffer.from(JSON.stringify(value));
  assert.equal(body.length, bytes);
  return { body, context: value.context };
}

async function start(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "avila-context-body-"));
  const server = await createApiServer({ dataDirectory: directory, token: "admin-fixture", contextToken: "context-fixture", contextReadToken: "reader-fixture" });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });
  return `http://127.0.0.1:${server.address().port}`;
}

function send(url, route, body, streamed, headers = contextHeaders) {
  return new Promise((resolve, reject) => {
    const outgoing = request(url + route, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...headers,
        ...(streamed ? { "Transfer-Encoding": "chunked" } : { "Content-Length": String(body.length) }) },
    }, incoming => {
      const chunks = [];
      incoming.on("data", chunk => chunks.push(chunk));
      incoming.on("error", reject);
      incoming.on("end", () => resolve({ status: incoming.statusCode, headers: incoming.headers, json: JSON.parse(Buffer.concat(chunks).toString("utf8")) }));
    });
    outgoing.on("error", reject);
    if (streamed) {
      for (let offset = 0; offset < body.length; offset += 32768) outgoing.write(body.subarray(offset, offset + 32768));
      outgoing.end();
    } else outgoing.end(body);
  });
}

for (const streamed of [false, true]) {
  const framing = streamed ? "chunked" : "Content-Length";
  for (const bytes of [1343758, 2097152]) {
    test(`complete context ${bytes} bytes imports with ${framing} and retains its receipt and snapshot`, async t => {
      const url = await start(t);
      const { body, context } = contextBody(bytes);
      const saved = await send(url, endpoint, body, streamed);
      assert.equal(saved.status, 200);
      assert.equal(saved.headers.etag, '"1"');
      assert.equal(saved.json.currentRevision, 1);
      assert.equal(saved.json.reused, false);
      assert.equal(saved.json.receipt.contentSha256, context.contentSha256);
      assert.equal(saved.json.receipt.sourceCommit, "1".repeat(40));
      assert.equal(saved.json.receipt.sourceDirty, false);
      assert.equal(saved.json.receipt.execution, "not_observed");
      assert.deepEqual(saved.json.receipt.publication, { state: "not_observed" });
      const readHeaders = { Authorization: "Bearer reader-fixture" };
      const read = await fetch(`${url}${endpoint}?sha256=${context.contentSha256}`, { headers: readHeaders });
      assert.equal(read.status, 200);
      assert.deepEqual(await read.json(), context);
      const receipt = await fetch(`${url}${endpoint}?requestId=${saved.json.receipt.requestId}`, { headers: readHeaders });
      assert.deepEqual(await receipt.json(), saved.json.receipt);
      const retry = await send(url, endpoint, body, streamed);
      assert.equal(retry.status, 200);
      assert.equal(retry.json.reused, true);
      assert.equal(retry.json.currentRevision, 1);
      assert.deepEqual(retry.json.receipt, saved.json.receipt);
    });
  }

  test(`context rejects 2097153 bytes with ${framing} without changing the catalog`, async t => {
    const url = await start(t);
    const { body } = contextBody(2097153);
    const rejected = await send(url, endpoint, body, streamed);
    assert.equal(rejected.status, 413);
    assert.equal(rejected.json.error.code, "BODY_TOO_LARGE");
    const state = await fetch(url + endpoint, { headers: { Authorization: "Bearer reader-fixture" } });
    assert.equal(state.headers.get("etag"), '"0"');
    assert.equal((await state.json()).revision, 0);
  });

  test(`ordinary suite endpoint preserves its 1 MiB limit with ${framing}`, async t => {
    const url = await start(t);
    const headers = { Authorization: "Bearer admin-fixture", "If-Match": '"1"' };
    const suite = await (await fetch(url + "/api/v1/suite", { headers })).json();
    const draft = { hypothesis: suite.hypothesis, cases: suite.dataset.cases, settings: suite.settings };
    const base = Buffer.byteLength(JSON.stringify(draft));
    // JSON whitespace keeps the real draft valid without changing its fields.
    const exact = Buffer.from(JSON.stringify(draft) + " ".repeat(1048576 - base));
    const saved = await send(url, "/api/v1/suite", exact, streamed, headers);
    assert.equal(saved.status, 200);
    assert.equal(saved.headers.etag, '"2"');
    const rejected = await send(url, "/api/v1/suite", Buffer.concat([exact, Buffer.from(" ")]), streamed, { ...headers, "If-Match": '"2"' });
    assert.equal(rejected.status, 413);
    assert.equal(rejected.json.error.code, "BODY_TOO_LARGE");
    const state = await fetch(url + "/api/v1/suite", { headers });
    assert.equal(state.headers.get("etag"), '"2"');
  });
}
