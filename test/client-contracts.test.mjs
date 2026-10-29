import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApiServer } from "../dist/lab/server.js";
import { ClientContractStore } from "../dist/lab/client-contracts.js";
import SwaggerParser from "@apidevtools/swagger-parser";
import { OPENAPI } from "../dist/lab/openapi.js";

const draft = () => ({ code: "LAB-001", title: "Contrato de teste", clientName: "Cliente sintético", clientReference: "CRM-TEST-1", product: "erp", status: "draft", startDate: "2026-10-28", endDate: "2027-10-28", amount: "1234.56", billingCycle: "monthly", notes: "Somente teste automatizado" });
const update = (contract = draft(), id = null, changeNote = "Cadastro inicial") => ({ id, contract, changeNote });

test("the published OpenAPI contract remains valid with the customer contract schemas", async () => {
  await SwaggerParser.validate(structuredClone(OPENAPI));
});
async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "avila-contracts-"));
  let server, base;
  const close = async () => { if (server?.listening) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
  const start = async () => {
    server = await createApiServer({ dataDirectory: directory, token: "contracts-admin-test", contextToken: "erp-context-restricted-test" });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); base = "http://127.0.0.1:" + server.address().port;
  };
  t.after(async () => { await close(); assert.equal(path.dirname(directory), tmpdir()); assert.ok(path.basename(directory).startsWith("avila-contracts-")); await rm(directory, { recursive: true, force: true }); });
  await start();
  const request = (suffix = "", options = {}) => fetch(base + "/api/v1/client-contracts" + suffix, { ...options, headers: { Authorization: "Bearer contracts-admin-test", ...options.headers } });
  const save = (body = update(), revision = 0) => request("", { method: "PUT", headers: { "Content-Type": "application/json", "If-Match": `"${revision}"` }, body: JSON.stringify(body) });
  return { directory, request, save, restart: async () => { await close(); await start(); }, bytes: () => readFile(path.join(directory, "client-contracts.json"), "utf8") };
}

test("contracts begin empty, remain private and reject the restricted ERP token", async t => {
  const f = await fixture(t);
  for (const Authorization of ["", "Bearer invalid", "Bearer erp-context-restricted-test"]) {
    assert.equal((await f.request("", { headers: { Authorization } })).status, 401);
    assert.equal((await f.request("", { method: "PUT", headers: { Authorization } })).status, 401);
    assert.equal((await f.request(`/${randomUUID()}/history`, { headers: { Authorization } })).status, 401);
  }
  const response = await f.request();
  assert.equal(response.status, 200); assert.equal(response.headers.get("etag"), '"0"');
  assert.equal(response.headers.get("cache-control"), "no-store, no-transform");
  assert.deepEqual(await response.json(), { revision: 0, contracts: [] });
  assert.ok(!(await readdir(f.directory)).includes("client-contracts.json"));
});

test("creation, update, snapshots and pagination survive a server restart", async t => {
  const f = await fixture(t);
  const original = draft(); original.code = " lab-001 ";
  const response = await f.save(update(original)); assert.equal(response.status, 200); assert.equal(response.headers.get("etag"), '"1"');
  const first = await response.json();
  assert.match(first.contract.id, /^[a-f0-9-]{36}$/); assert.equal(first.contract.version, 1); assert.equal(first.contract.code, "LAB-001");
  assert.equal(first.contract.amount, "1234.56"); assert.equal(first.contract.createdAt, first.contract.updatedAt);
  assert.equal(first.catalog.contracts.length, 1); assert.ok(!("history" in first.catalog));
  const revised = { ...draft(), status: "active", amount: "1500.00", endDate: "" };
  const secondResponse = await f.save(update(revised, first.contract.id, "Ativação revisada"), 1);
  assert.equal(secondResponse.status, 200);
  const second = await secondResponse.json();
  assert.equal(second.contract.version, 2); assert.equal(second.contract.id, first.contract.id); assert.equal(second.contract.createdAt, first.contract.createdAt);
  await f.restart(); assert.deepEqual(await (await f.request()).json(), second.catalog);
  const history = await (await f.request(`/${first.contract.id}/history?limit=1&offset=1`)).json();
  assert.equal(history.total, 2); assert.equal(history.offset, 1); assert.deepEqual(history.items[0].contract, first.contract);
  assert.equal(history.items[0].changeNote, "Cadastro inicial");
  const latest = await (await f.request(`/${first.contract.id}/history`)).json();
  assert.deepEqual(latest.items[0].contract, second.contract); assert.equal(latest.items[0].changeNote, "Ativação revisada");
  assert.ok(!(await readdir(f.directory)).some(name => name.endsWith(".tmp")));
});

test("duplicate codes, missing records and stale writes preserve the previous file", async t => {
  const f = await fixture(t), first = await (await f.save()).json(), bytes = await f.bytes();
  assert.equal((await f.save(update({ ...draft(), code: "lab-001" }), 1)).status, 409);
  assert.equal((await f.save(update(draft(), randomUUID()), 1)).status, 404);
  assert.equal((await f.save(update({ ...draft(), title: "Lost update" }, first.contract.id), 0)).status, 412);
  assert.equal(await f.bytes(), bytes);
  const other = await (await f.save(update({ ...draft(), code: "LAB-002" }), 1)).json();
  const bytes2 = await f.bytes();
  assert.equal((await f.save(update({ ...draft(), code: "LAB-002" }, first.contract.id), 2)).status, 409);
  assert.equal(await f.bytes(), bytes2); assert.equal(other.catalog.contracts.length, 2);
});

test("simultaneous writes with the same revision have exactly one winner", async t => {
  const f = await fixture(t);
  const responses = await Promise.all([f.save(update({ ...draft(), code: "FIRST" })), f.save(update({ ...draft(), code: "SECOND" }))]);
  assert.deepEqual(responses.map(item => item.status).sort(), [200, 412]);
  const catalog = await (await f.request()).json(); assert.equal(catalog.revision, 1); assert.equal(catalog.contracts.length, 1);
  assert.equal((await (await f.request(`/${catalog.contracts[0].id}/history`)).json()).total, 1);
});

test("calendar, money, enum and shape validation reject invalid changes without mutation", async t => {
  const f = await fixture(t); await f.save(); const bytes = await f.bytes();
  const invalid = [
    { code: "" }, { code: "../bad code" }, { code: "ß".repeat(40) }, { title: " " }, { clientName: "" }, { clientReference: "x".repeat(121) },
    { product: "shared" }, { status: "__proto__" }, { billingCycle: "weekly" }, { startDate: "2026-02-29" }, { startDate: "2026-04-31" },
    { startDate: "0000-01-01" }, { endDate: "2026-10-27" }, { endDate: "2027-13-01" }, { amount: 12.34 }, { amount: "12,34" },
    { amount: "1.234" }, { amount: "01.00" }, { amount: "1e3" }, { amount: "-1.00" }, { amount: "10000000000.00" }, { amount: "NaN" },
    { notes: "x".repeat(4001) }, { injected: "unexpected" },
  ];
  for (const changes of invalid) assert.equal((await f.save(update({ ...draft(), code: "NEW", ...changes }), 1)).status, 400, JSON.stringify(changes).slice(0, 150));
  for (const body of [{ ...update(), changeNote: " " }, { ...update(), id: "../outside" }, { ...update(), id: undefined }, { ...update(), extra: true }]) assert.equal((await f.save(body, 1)).status, 400);
  assert.equal(await f.bytes(), bytes);
  const valid = await f.save(update({ ...draft(), code: "LEAP", startDate: "2028-02-29", endDate: "2028-02-29", amount: "0.00" }), 1);
  assert.equal(valid.status, 200);
});

test("revision headers, content type and pagination are validated strictly", async t => {
  const f = await fixture(t);
  const put = headers => f.request("", { method: "PUT", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(update()) });
  assert.equal((await put({})).status, 428);
  for (const value of ['0', '"01"', 'W/"0"', '"-1"', '"9007199254740992"']) assert.equal((await put({ "If-Match": value })).status, 400);
  assert.equal((await put({ "If-Match": '"0"', "Content-Type": "text/plain" })).status, 415);
  assert.equal((await f.request("?unknown=1")).status, 400);
  const first = await (await f.save()).json();
  for (const query of ["limit=0", "limit=101", "limit=1.5", "offset=-1", "offset=9007199254740992", "limit=1&limit=2", "unknown=1"]) assert.equal((await f.request(`/${first.contract.id}/history?${query}`)).status, 400, query);
  assert.equal((await f.request(`/${randomUUID()}/history`)).status, 404);
  assert.equal((await f.request("/not-a-uuid/history")).status, 400);
});

test("corrupt or inconsistent storage cannot be overwritten by a save", async t => {
  const f = await fixture(t); await f.save(); const original = JSON.parse(await f.bytes());
  for (const corrupted of ["{broken", JSON.stringify({ ...original, revision: 12 }), JSON.stringify({ ...original, history: [] }), JSON.stringify({ ...original, contracts: [{ ...original.contracts[0], title: "Divergent snapshot" }] })]) {
    await writeFile(path.join(f.directory, "client-contracts.json"), corrupted);
    assert.equal((await f.request()).status, 500); assert.equal((await f.save(update({ ...draft(), code: "OTHER" }), 1)).status, 500);
    assert.equal(await f.bytes(), corrupted);
  }
});

test("the store owns input snapshots before asynchronous writes", async t => {
  const f = await fixture(t), store = new ClientContractStore(f.directory), body = update();
  const pending = store.save(body, 0); body.contract.title = "Mutated after call"; body.changeNote = "Mutated reason";
  const result = await pending; assert.equal(result.contract.title, "Contrato de teste");
  assert.equal((await store.history(result.contract.id, 20, 0)).items[0].changeNote, "Cadastro inicial");
});
