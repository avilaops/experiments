import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApiServer } from "../dist/lab/server.js";
import { parsePolicy } from "../dist/lab/policies.js";

const draft = () => ({ id: "CRM-ACCESS-001", product: "crm", title: "Proposta de teste", category: "access", state: "proposed", rule: "Exigir contexto de empresa.", owner: "Equipe de teste", enforcement: "A mapear", verificationDate: "", sources: [] });
async function start(t, token) {
  const directory = await mkdtemp(path.join(tmpdir(), "avila-policies-"));
  const servers = [];
  async function open() {
    const server = await createApiServer({ dataDirectory: directory, ...(token ? { token } : {}) });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    servers.push(server);
    const base = `http://127.0.0.1:${server.address().port}`;
    const send = (method = "GET", body, headers = {}) => fetch(base + "/api/v1/policies", { method,
      headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { server, send };
  }
  t.after(async () => {
    for (const server of servers) if (server.listening) await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(directory), tmpdir());
    assert.ok(path.basename(directory).startsWith("avila-policies-"));
    await rm(directory, { recursive: true, force: true });
  });
  return { ...await open(), open, directory };
}

test("policy inventory distinguishes proposals, source-backed records and uninventoried products", async t => {
  const { send } = await start(t);
  const response = await send();
  assert.equal(response.headers.get("etag"), '"1"');
  const catalog = await response.json();
  assert.equal(catalog.products.length, 9);
  assert.equal(catalog.policies.length, 8);
  assert.equal(catalog.policies.filter(policy => policy.state === "verified").length, 0);
  assert.equal(catalog.policies.filter(policy => policy.product === "lojas").every(policy => policy.state === "proposed"), true);
  assert.equal(catalog.policies.some(policy => policy.product === "mail"), false);
  assert.equal(catalog.history.length, 8);
});

test("existing policy volumes expose Auth without rewriting history and persist its policies", async t => {
  const { send, open, directory } = await start(t);
  const file = path.join(directory, "policies.json");
  const original = JSON.parse(await readFile(file, "utf8"));
  const legacy = { ...original, products: original.products.filter(product => product.id !== "auth") };
  await writeFile(file, JSON.stringify(legacy));
  const bytes = await readFile(file, "utf8");
  const catalog = await (await send()).json();
  assert.deepEqual(catalog.products.find(product => product.id === "auth"), { id: "auth", name: "Ávila Auth" });
  assert.equal(catalog.revision, legacy.revision);
  assert.deepEqual(catalog.history, legacy.history);
  assert.deepEqual(catalog.policies, legacy.policies);
  assert.equal(await readFile(file, "utf8"), bytes);
  const policy = { ...draft(), id: "AUTH-ACCESS-001", product: "auth" };
  const response = await send("PUT", { policy, changeNote: "Registrar proposta de Auth" }, { "If-Match": '"1"' });
  assert.equal(response.status, 200);
  const saved = await response.json();
  assert.equal(saved.policies.at(-1).product, "auth");
  assert.equal(saved.policies.at(-1).state, "proposed");
  const restarted = await open();
  assert.deepEqual(await (await restarted.send()).json(), saved);
});

test("policy revisions, complete snapshots and retirement survive a service restart", async t => {
  const { send, server, open } = await start(t);
  const policy = draft();
  const create = await send("PUT", { policy, changeNote: "Registrar proposta" }, { "If-Match": '"1"' });
  assert.equal(create.status, 200);
  assert.equal(create.headers.get("etag"), '"2"');
  const created = await create.json();
  assert.equal(created.policies.at(-1).version, 1);
  const retire = await send("PUT", { policy: { ...policy, state: "retired", rule: "Proposta substituída." }, changeNote: "Retirar sem apagar a origem" }, { "If-Match": '"2"' });
  assert.equal(retire.status, 200);
  const result = await retire.json();
  const changes = result.history.filter(change => change.policy.id === policy.id);
  assert.deepEqual(changes.map(change => change.policy.version), [1, 2]);
  assert.equal(changes[0].policy.rule, policy.rule);
  assert.equal(changes[1].policy.state, "retired");
  await new Promise(resolve => server.close(resolve));
  const restarted = await open();
  assert.deepEqual(await (await restarted.send()).json(), result);
});

test("concurrent edits have one winner and stale updates cannot replace its policy", async t => {
  const { send } = await start(t);
  const body = { policy: draft(), changeNote: "Criar com revisão explícita" };
  assert.equal((await send("PUT", body)).status, 428);
  const responses = await Promise.all([send("PUT", body, { "If-Match": '"1"' }), send("PUT", body, { "If-Match": '"1"' })]);
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 412]);
  const catalog = await (await send()).json();
  assert.equal(catalog.revision, 2);
  assert.equal(catalog.history.filter(change => change.policy.id === body.policy.id).length, 1);
});

test("invalid claims, dates, identifiers and foreign product changes fail before saving", async t => {
  const { send } = await start(t);
  for (const policy of [
    { ...draft(), id: "../../private" }, { ...draft(), product: "unknown" },
    { ...draft(), state: "documented" }, { ...draft(), state: "implemented" },
    { ...draft(), state: "verified" }, { ...draft(), verificationDate: "2026-02-30" },
    { ...draft(), verificationDate: "2999-01-01" }, { ...draft(), unexpected: true },
    { ...draft(), sources: [{ kind: "unknown", location: "example", note: "" }] },
  ]) assert.equal((await send("PUT", { policy, changeNote: "Invalid input" }, { "If-Match": '"1"' })).status, 400);
  assert.equal((await send("PUT", { policy: draft(), changeNote: "" }, { "If-Match": '"1"' })).status, 400);
  assert.equal((await (await send()).json()).revision, 1);
  const catalog = await (await send()).json();
  const { version, updatedAt, ...existing } = catalog.policies[0];
  assert.equal((await send("PUT", { policy: { ...existing, product: "mail" }, changeNote: "Trocar produto" }, { "If-Match": '"1"' })).status, 400);
});

test("verified is a documented declaration requiring code, test, evidence and a valid date", () => {
  const policy = { ...draft(), state: "verified", verificationDate: new Date().toISOString().slice(0, 10), sources: [
    { kind: "code", location: "source.ts", note: "Fonte" },
    { kind: "test", location: "source.test.ts", note: "Teste" },
    { kind: "evidence", location: "reports/run.json", note: "Execução registrada" },
  ] };
  assert.equal(parsePolicy(policy).state, "verified");
  assert.throws(() => parsePolicy({ ...policy, sources: policy.sources.slice(0, 2) }), /evidência/);
});

test("policy reads and writes require the API credential when configured", async t => {
  const { send } = await start(t, "policy-test-credential");
  assert.equal((await send()).status, 401);
  assert.equal((await send("PUT", { policy: draft(), changeNote: "Unauthorized" }, { "If-Match": '"1"' })).status, 401);
  assert.equal((await send("GET", undefined, { Authorization: "Bearer policy-test-credential" })).status, 200);
});
