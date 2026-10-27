import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApiServer } from "../dist/lab/server.js";

const draft = (id = "CRM-IMPORT-001") => ({ id, product: "crm", title: "Ficha para conferência", category: "access", state: "proposed",
  rule: "Conferir autorização por empresa.", owner: "A definir", enforcement: "A mapear", verificationDate: "", sources: [] });
const fields = ({ version: _version, updatedAt: _updatedAt, ...policy }) => policy;

async function fixture(t, token) {
  const directory = await mkdtemp(path.join(tmpdir(), "avila-batch-import-"));
  const servers = [];
  async function open() {
    const server = await createApiServer({ dataDirectory: directory, ...(token ? { token } : {}) });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    servers.push(server);
    const base = "http://127.0.0.1:" + server.address().port;
    const send = (route = "", method = "GET", body, headers = {}) => fetch(base + "/api/v1/policies" + route, {
      method, headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { server, send, base };
  }
  t.after(async () => {
    for (const server of servers) if (server.listening) await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(directory), tmpdir());
    assert.ok(path.basename(directory).startsWith("avila-batch-import-"));
    await rm(directory, { recursive: true, force: true });
  });
  return { ...await open(), open, bytes: () => readFile(path.join(directory, "policies.json"), "utf8") };
}

test("preview is read-only and a batch creates new policies atomically while preserving existing records", async t => {
  const { send, bytes, server, open } = await fixture(t);
  const original = await (await send()).json();
  const before = await bytes();
  const document = [draft(), { ...fields(original.policies[0]), title: "Conflicting incoming title" }, draft("CRM-IMPORT-002")];
  const response = await send("/import/preview", "POST", { document });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("etag"), '"1"');
  const preview = await response.json();
  assert.equal(preview.createCount, 2);
  assert.equal(preview.preserveCount, 1);
  assert.equal(preview.items[1].different, true);
  assert.equal(await bytes(), before);
  const committed = await send("/import", "POST", { document, changeNote: "Inventário conferido" }, { "If-Match": '"1"' });
  assert.equal(committed.status, 200);
  assert.equal(committed.headers.get("etag"), '"2"');
  const result = await committed.json();
  assert.deepEqual(result.created, ["CRM-IMPORT-001", "CRM-IMPORT-002"]);
  assert.deepEqual(result.preserved, [original.policies[0].id]);
  assert.deepEqual(result.catalog.policies.slice(0, 8), original.policies);
  assert.equal(result.catalog.revision, 2);
  assert.equal(result.catalog.history.length, original.history.length + 2);
  for (const change of result.catalog.history.slice(-2)) {
    assert.equal(change.revision, 2);
    assert.equal(change.changeNote, "Inventário conferido");
    assert.equal(change.policy.version, 1);
  }
  await new Promise(resolve => server.close(resolve));
  const restarted = await open();
  assert.deepEqual(await (await restarted.send()).json(), result.catalog);
  const savedBytes = await bytes();
  const repeated = await restarted.send("/import", "POST", { document, changeNote: "Reimportar sem substituir" }, { "If-Match": '"2"' });
  assert.deepEqual((await repeated.json()).created, []);
  assert.equal(repeated.headers.get("etag"), '"2"');
  assert.equal(await bytes(), savedBytes);
});

test("one invalid record, duplicate code or unknown field rejects the complete file before any write", async t => {
  const { send, bytes } = await fixture(t);
  const before = await bytes();
  const cases = [[], [draft(), { ...draft("CRM-IMPORT-002"), state: "verified" }],
    [draft(), { ...draft(), product: "mail" }], [draft(), { ...draft("CRM-IMPORT-002"), extra: true }],
    [draft(), { ...draft("CRM-IMPORT-002"), sources: [{ kind: "code", location: "x", note: "", extra: true }] }],
    Array.from({ length: 501 }, (_, index) => draft(`CRM-IMPORT-${index}`)), { policies: [draft()] }];
  for (const document of cases) {
    assert.equal((await send("/import/preview", "POST", { document })).status, 400);
    assert.equal((await send("/import", "POST", { document, changeNote: "Invalid file" }, { "If-Match": '"1"' })).status, 400);
    assert.equal(await bytes(), before);
  }
  const invalid = await send("/import/preview", "POST", { document: [draft(), { ...draft("CRM-IMPORT-002"), state: "verified" }] });
  assert.match((await invalid.json()).error.message, /Ficha 2/);
});

test("export import ignores old revisions, versions and history and assigns new audit records", async t => {
  const { send } = await fixture(t);
  const original = await (await send()).json();
  const document = { ...original, revision: 999, updatedAt: "2000-01-01T00:00:00.000Z",
    policies: [{ ...draft(), version: 99, updatedAt: "2000-01-01T00:00:00.000Z" }],
    history: [{ revision: 999, at: "2000-01-01T00:00:00.000Z", changeNote: "FORGED-HISTORY-MUST-NOT-BE-RESTORED", policy: original.policies[0] }] };
  const preview = await send("/import/preview", "POST", { document });
  assert.equal((await preview.json()).createCount, 1);
  const response = await send("/import", "POST", { document, changeNote: "Importar somente campos atuais" }, { "If-Match": '"1"' });
  const result = await response.json();
  assert.equal(result.catalog.revision, 2);
  assert.equal(result.catalog.policies.at(-1).version, 1);
  assert.notEqual(result.catalog.policies.at(-1).updatedAt, document.updatedAt);
  assert.equal(result.catalog.history.length, 9);
  assert.doesNotMatch(JSON.stringify(result.catalog.history), /FORGED-HISTORY/);
  const before = JSON.stringify(result.catalog);
  const noChanges = await send("/import", "POST", { document: result.catalog, changeNote: "Conferência de exportação própria" }, { "If-Match": '"2"' });
  assert.equal(JSON.stringify((await noChanges.json()).catalog), before);
});

test("a stale preview and simultaneous batches never produce a partial import", async t => {
  const { send } = await fixture(t);
  const document = [draft(), draft("CRM-IMPORT-002")];
  await send("/import/preview", "POST", { document });
  const parallel = await Promise.all([
    send("/import", "POST", { document, changeNote: "Primeiro lote" }, { "If-Match": '"1"' }),
    send("/import", "POST", { document: [draft("CRM-IMPORT-003"), draft("CRM-IMPORT-004")], changeNote: "Segundo lote" }, { "If-Match": '"1"' }),
  ]);
  assert.deepEqual(parallel.map(response => response.status).sort(), [200, 412]);
  const catalog = await (await send()).json();
  assert.equal(catalog.policies.length, 10);
  assert.equal(catalog.history.length, 10);
  assert.equal(catalog.revision, 2);
  const refresh = await (await send("/import/preview", "POST", { document })).json();
  assert.equal(refresh.revision, 2);
  assert.ok(refresh.createCount === 0 || refresh.createCount === 2);
});

test("catalog capacity is checked for the entire batch and preserved codes do not consume new capacity", async t => {
  const { send, bytes } = await fixture(t);
  const document = Array.from({ length: 492 }, (_, index) => draft(`CRM-CAPACITY-${index}`));
  const imported = await send("/import", "POST", { document, changeNote: "Preencher capacidade de teste" }, { "If-Match": '"1"' });
  assert.equal(imported.status, 200);
  const before = await bytes();
  const excess = [document[0], draft("CRM-EXCESS-001")];
  assert.equal((await send("/import/preview", "POST", { document: excess })).status, 400);
  assert.equal((await send("/import", "POST", { document: excess, changeNote: "Overflow" }, { "If-Match": '"2"' })).status, 400);
  assert.equal(await bytes(), before);
  const preview = await (await send("/import/preview", "POST", { document: [document[0]] })).json();
  assert.equal(preview.createCount, 0);
  assert.equal(preview.preserveCount, 1);
});

test("imports require a reason, exact payload and current If-Match, and retain the 1 MiB transport limit", async t => {
  const { send, bytes, base } = await fixture(t);
  const before = await bytes();
  const body = { document: [draft()], changeNote: "Teste" };
  assert.equal((await send("/import", "POST", body)).status, 428);
  assert.equal((await send("/import", "POST", body, { "If-Match": "1" })).status, 400);
  assert.equal((await send("/import", "POST", { ...body, changeNote: " " }, { "If-Match": '"1"' })).status, 400);
  assert.equal((await send("/import", "POST", { ...body, overwrite: true }, { "If-Match": '"1"' })).status, 400);
  assert.equal((await send("/import/preview", "POST", { document: [draft()], extra: true })).status, 400);
  assert.equal((await fetch(base + "/api/v1/policies/import/preview", { method: "POST", body: "{}" })).status, 415);
  const oversized = await fetch(base + "/api/v1/policies/import/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: "x".repeat(1024 * 1024 + 1) });
  assert.equal(oversized.status, 413);
  assert.equal(await bytes(), before);
});

test("preview and commit require the API credential and reject foreign origins", async t => {
  const { send } = await fixture(t, "private-test-token");
  assert.equal((await send("/import/preview", "POST", { document: [draft()] })).status, 401);
  assert.equal((await send("/import", "POST", { document: [draft()], changeNote: "Unauthorized" }, { "If-Match": '"1"' })).status, 401);
  const headers = { Authorization: "Bearer private-test-token" };
  assert.equal((await send("/import/preview", "POST", { document: [draft()] }, headers)).status, 200);
  assert.equal((await send("/import/preview", "POST", { document: [draft()] }, { ...headers, Origin: "https://evil.example" })).status, 403);
});
