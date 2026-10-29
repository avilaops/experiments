import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ProductContextStore, canonicalContextJson, contextHash, parseProductContext } from "../dist/lab/product-contexts.js";
import { createApiServer } from "../dist/lab/server.js";

// Protocol fixture only: no ERP operation was executed to produce this context.
function fixture(commit = "1".repeat(40), dirty = false) {
  const payload = {
    schemaVersion: "erp-product-context/1", product: "erp",
    source: { repository: "avilaops/erp-next", commit, dirty, gitStatusSha256: "2".repeat(64), catalogSha256: "3".repeat(64), inventorySha256: "4".repeat(64), contextFiles: [{ path: "verification/contracts.json", sha256: "5".repeat(64) }] },
    selection: { targetFlow: null, includedFlows: ["users"] },
    flows: [{ definition: { id: "users", title: "Usuários", goal: "Fixture de importação", kind: "product", dependencies: [], actionGroups: ["users"], nextStep: "Executar um fluxo real separadamente" }, definitionState: "actions_mapped", actionIds: ["list-users"], pages: [], permissions: [], assessment: { code: { implementedDeclarations: 1, blockedDeclarations: 0 }, interface: { state: "not_mapped", mappedActionIds: [], unmappedActionIds: ["list-users"] }, publication: "not_observed", execution: "not_observed" } }],
    actions: [{ id: "list-users", flow: "users", status: "implemented", operation: { method: "GET", path: "/api/v1/users" }, verification: { status: "not_verified_by_catalog", criteria: ["execução separada"] } }],
    authActions: [], pendingFlows: [], limits: ["Fixture de protocolo; não é evidência de execução."],
  };
  return { ...payload, contentSha256: contextHash(canonicalContextJson(payload)) };
}
async function directory(t) {
  const value = await mkdtemp(path.join(tmpdir(), "avila-context-"));
  t.after(() => rm(value, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }));
  return value;
}

test("imports survive restart; retries return the original receipt without replacing a newer head", async t => {
  const root = await directory(t), store = new ProductContextStore(root);
  const first = fixture(), second = fixture("6".repeat(40));
  const imported = await store.save({ context: first, confirmPublication: false }, 0);
  assert.equal(imported.receipt.revision, 1);
  await store.save({ context: second, confirmPublication: false }, 1);
  const restarted = new ProductContextStore(root);
  const retried = await restarted.save({ context: first, confirmPublication: false }, 0);
  assert.equal(retried.reused, true);
  assert.deepEqual(retried.receipt, imported.receipt);
  assert.equal(retried.currentRevision, 2);
  assert.equal((await restarted.state()).latest.contentSha256, second.contentSha256);
  assert.deepEqual(await restarted.snapshot(first.contentSha256), first);
});

test("hash tampering, fabricated runtime verdicts and conflicting revisions cannot change the catalog", async t => {
  const store = new ProductContextStore(await directory(t));
  const context = fixture();
  const tampered = structuredClone(context); tampered.flows[0].definition.goal = "changed";
  assert.throws(() => parseProductContext(tampered), error => error.code === "INVALID_PRODUCT_CONTEXT");
  const fabricated = structuredClone(context); fabricated.flows[0].assessment.execution = "passed";
  assert.throws(() => parseProductContext(fabricated), error => error.code === "INVALID_PRODUCT_CONTEXT");
  const { contentSha256, ...malformed } = structuredClone(context);
  malformed.actions[0].ui = { pages: "invalid" };
  assert.throws(() => parseProductContext({ ...malformed, contentSha256: contextHash(canonicalContextJson(malformed)) }), error => error.code === "INVALID_PRODUCT_CONTEXT");
  await store.save({ context, confirmPublication: false }, 0);
  await assert.rejects(store.save({ context: fixture("7".repeat(40)), confirmPublication: false }, 0), error => error.status === 412);
  assert.equal((await store.state()).revision, 1);
});

test("a stored divergent snapshot is preserved and never acknowledged as a retry", async t => {
  const root = await directory(t), store = new ProductContextStore(root), context = fixture();
  await store.save({ context, confirmPublication: false }, 0);
  const file = path.join(root, "product-contexts/erp", context.contentSha256 + ".json");
  await writeFile(file, "corrupt");
  await assert.rejects(store.save({ context, confirmPublication: false }, 0), error => error.code === "CONTEXT_CONTENT_CONFLICT");
  await assert.rejects(store.snapshot(context.contentSha256), error => error.code === "CONTEXT_STORAGE_INVALID");
  assert.equal(await readFile(file, "utf8"), "corrupt");
});

test("publication observations are separate receipts and never promote product execution", async t => {
  let observations = 0;
  const store = new ProductContextStore(await directory(t), async commit => {
    observations++;
    return { state: "version_observed", origin: "https://erp.avilaops.com", servedCommit: commit, observedAt: "2026-10-28T00:00:00.000Z" };
  });
  const context = fixture();
  await store.save({ context, confirmPublication: false }, 0);
  const observed = await store.save({ context, confirmPublication: true }, 1);
  assert.equal(observed.receipt.publication.state, "version_observed");
  assert.equal(observed.receipt.execution, "not_observed");
  assert.equal((await store.snapshot(context.contentSha256)).flows[0].assessment.publication, "not_observed");
  await store.save({ context, confirmPublication: true }, 0);
  assert.equal(observations, 1);
  await assert.rejects(store.save({ context: fixture("8".repeat(40), true), confirmPublication: true }, 2), error => error.code === "DIRTY_PUBLICATION");
  assert.equal(observations, 1);
});

test("the integration token is restricted to ERP context; ETags and readback work over HTTP", async t => {
  const server = await createApiServer({ dataDirectory: await directory(t), token: "admin-fixture", contextToken: "context-fixture", contextReadToken: "reader-fixture" });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const endpoint = `http://127.0.0.1:${server.address().port}/api/v1/product-contexts/erp`;
  const headers = { Authorization: "Bearer context-fixture", "Content-Type": "application/json" };
  assert.equal((await fetch(endpoint)).status, 401);
  assert.equal((await fetch(endpoint.replace("product-contexts/erp", "suite"), { headers })).status, 401);
  const state = await fetch(endpoint, { headers }); assert.equal(state.headers.get("etag"), '"0"');
  const context = fixture(), body = JSON.stringify({ context, confirmPublication: false });
  assert.equal((await fetch(endpoint, { method: "PUT", headers, body })).status, 428);
  const saved = await fetch(endpoint, { method: "PUT", headers: { ...headers, "If-Match": '"0"' }, body });
  assert.equal(saved.status, 200);
  assert.equal(saved.headers.get("etag"), '"1"');
  const result = await saved.json();
  assert.deepEqual(await (await fetch(endpoint + "?sha256=" + context.contentSha256, { headers })).json(), context);
  assert.deepEqual(await (await fetch(endpoint + "?requestId=" + result.receipt.requestId, { headers })).json(), result.receipt);
  assert.equal((await fetch(endpoint + "?sha256=../private", { headers })).status, 400);
  const reader = { Authorization: "Bearer reader-fixture" };
  assert.equal((await fetch(endpoint + "?view=index", { headers: reader })).status, 200);
  assert.equal((await fetch(endpoint, { method: "PUT", headers: { ...reader, "Content-Type": "application/json", "If-Match": '"1"' }, body })).status, 401);
  assert.equal((await fetch(endpoint.replace("product-contexts/erp", "suite"), { headers: reader })).status, 401);
  const selected = await (await fetch(endpoint + "?view=context&sha256=" + context.contentSha256 + "&flow=users", { headers: reader })).json();
  assert.deepEqual(selected.selection.includedFlows, ["users"]);
  assert.equal(selected.capture.contentSha256, context.contentSha256);
  assert.equal((await fetch(endpoint + "?view=context&flow=users", { headers: reader })).status, 400);
  assert.equal((await fetch(endpoint + "?view=flows&mode=published", { headers: reader })).status, 404);
});

test("flow views retain pinned captures, transitive dependencies and separate publication observations", async t => {
  const store = new ProductContextStore(await directory(t));
  const original = fixture();
  const { contentSha256, ...payload } = structuredClone(original);
  payload.flows[0].definition.dependencies = ["roles"];
  const role = structuredClone(payload.flows[0]);
  role.definition = { ...role.definition, id: "roles", title: "Papéis", actionGroups: ["roles"], dependencies: [] };
  role.actionIds = ["read-roles"];
  payload.flows.push(role);
  payload.actions.push({ ...payload.actions[0], id: "read-roles", flow: "roles" });
  payload.selection.includedFlows = ["users", "roles"];
  const context = { ...payload, contentSha256: contextHash(canonicalContextJson(payload)) };
  await store.save({ context, confirmPublication: false }, 0);
  const selected = await store.view({ digest: context.contentSha256, flow: "users" });
  assert.deepEqual(selected.selection.includedFlows, ["users", "roles"]);
  assert.deepEqual(selected.edges, [{ from: "users", to: "roles", relation: "depends_on" }]);
  assert.equal(selected.actions.length, 2);
  assert.equal(selected.capture.publication.state, "not_observed");
  assert.deepEqual((await store.view({ indexOnly: true })).actions, []);
  await assert.rejects(store.view({ flow: "unknown" }), error => error.code === "FLOW_NOT_FOUND");
  await store.save({ context: fixture("9".repeat(40)), confirmPublication: false }, 1);
  assert.equal((await store.view({ digest: context.contentSha256 })).capture.sourceCommit, context.source.commit);
  assert.equal((await store.view()).capture.sourceCommit, "9".repeat(40));
});
