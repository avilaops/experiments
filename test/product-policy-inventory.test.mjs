import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApiServer } from "../dist/lab/server.js";
import { parsePolicyImportDocument } from "../dist/lab/policies.js";
import { gitSourceReader, sourceLocation, verifyPolicyInventory } from "../scripts/verify-policy-inventory.mjs";

const inventory = JSON.parse(await readFile(new URL("../examples/policies/product-inventory.json", import.meta.url)));
const manifest = JSON.parse(await readFile(new URL("../evidencias/inventario-produtos-fontes-20261027.json", import.meta.url)));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");

async function temporary(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "avila-inventory-"));
  t.after(async () => {
    assert.equal(path.dirname(directory), tmpdir());
    assert.ok(path.basename(directory).startsWith("avila-inventory-"));
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}

test("product inventory has eight scoped implementation records backed by fifteen pinned source blobs", () => {
  assert.equal(parsePolicyImportDocument(inventory).length, 8);
  assert.deepEqual(Object.fromEntries(["mail", "cms", "crm", "tms"].map(product => [product, inventory.filter(policy => policy.product === product).length])),
    { mail: 2, cms: 2, crm: 2, tms: 2 });
  const locations = new Set(manifest.sources.map(sourceLocation));
  assert.equal(locations.size, 15);
  const used = new Set();
  for (const policy of inventory) {
    assert.equal(policy.state, "implemented");
    assert.equal(policy.verificationDate, "");
    assert.equal(policy.owner, policy.product === "crm" ? "Nícolas Ávila (responsável técnico no README)" : "A definir");
    for (const reference of policy.sources) {
      assert.ok(locations.has(reference.location));
      used.add(reference.location);
    }
  }
  assert.deepEqual(used, locations);
});

test("inventory batch preserves edited records, persists new records and reimports without another revision", async t => {
  const directory = await temporary(t);
  const servers = [];
  async function open() {
    const api = await createApiServer({ dataDirectory: directory });
    await new Promise(resolve => api.listen(0, "127.0.0.1", resolve));
    servers.push(api);
    const endpoint = `http://127.0.0.1:${api.address().port}/api/v1/policies`;
    return (route = "", method = "GET", document, etag) => fetch(endpoint + route, { method,
      headers: { "Content-Type": "application/json", ...(etag ? { "If-Match": etag } : {}) },
      ...(document === undefined ? {} : { body: JSON.stringify(document) }),
    });
  }
  t.after(async () => {
    for (const api of servers) if (api.listening) await new Promise(resolve => api.close(resolve));
  });
  const send = await open();
  const first = await send("", "PUT", { policy: { ...inventory[0], owner: "Responsável já atribuído" }, changeNote: "Edição anterior ao inventário" }, '"1"');
  assert.equal(first.status, 200);
  const before = await first.json();
  const preview = await send("/import/preview", "POST", { document: inventory });
  assert.equal(preview.status, 200);
  const plan = await preview.json();
  assert.equal(plan.createCount, 7);
  assert.equal(plan.preserveCount, 1);
  assert.equal(plan.items[0].different, true);
  const committed = await send("/import", "POST", { document: inventory, changeNote: "Inspeção de fontes dos quatro produtos" }, preview.headers.get("etag"));
  assert.equal(committed.status, 200);
  const result = await committed.json();
  assert.equal(result.catalog.policies.length, 16);
  assert.equal(result.catalog.revision, 3);
  assert.equal(result.catalog.history.length, before.history.length + 7);
  assert.deepEqual(result.catalog.policies.slice(0, before.policies.length), before.policies);
  await new Promise(resolve => servers[0].close(resolve));
  const restarted = await open();
  const bytes = await readFile(path.join(directory, "policies.json"));
  const repeated = await restarted("/import", "POST", { document: inventory, changeNote: "Reimportação conferida" }, '"3"');
  assert.equal(repeated.status, 200);
  assert.deepEqual((await repeated.json()).catalog, result.catalog);
  assert.deepEqual(await readFile(path.join(directory, "policies.json")), bytes);
});

test("source verification measures bytes without presenting them as product runtime evidence", async () => {
  const bytes = Buffer.from("Isolated source verification fixture\n");
  const fixtureManifest = { ...manifest, sources: manifest.sources.map(source => ({ ...source, sha256: hash(bytes) })) };
  let reads = 0;
  const result = await verifyPolicyInventory({ policies: inventory, manifest: fixtureManifest, readBlob: async () => { reads++; return bytes; } });
  assert.equal(reads, 15);
  assert.equal(result.sources, 15);
  assert.equal(result.policies, 8);
  assert.equal(result.repositories, 4);
  assert.equal(result.sourceIntegrityVerified, true);
  assert.equal(result.productRuntimeVerified, false);
  await assert.rejects(verifyPolicyInventory({ policies: inventory, manifest: fixtureManifest,
    readBlob: async () => Buffer.from("altered source") }), /SHA-256 divergente/);
});

test("invalid paths, ambiguous manifests and uncovered references fail before source reads", async () => {
  for (const file of ["../outside.ts", "/outside.ts", "src/../outside.ts", "C:/outside.ts", "src\\outside.ts", "src/file.ts#L1"]) {
    assert.throws(() => sourceLocation({ ...manifest.sources[0], path: file }), /Fonte inválida/);
  }
  let reads = 0;
  const readBlob = async () => { reads++; throw new Error("Unexpected read"); };
  const badManifests = [
    { ...manifest, sources: [...manifest.sources, manifest.sources[0]] },
    { ...manifest, sources: manifest.sources.slice(1) },
    { ...manifest, sources: [...manifest.sources, { ...manifest.sources[0], path: "unused.ts" }] },
    { ...manifest, sources: manifest.sources.map((source, index) => index === 0 ? { ...source, revision: "a".repeat(40) } : source) },
  ];
  for (const value of badManifests) await assert.rejects(verifyPolicyInventory({ policies: inventory, manifest: value, readBlob }));
  await assert.rejects(verifyPolicyInventory({ policies: [inventory[0], inventory[0]], manifest, readBlob }), /duplicado/);
  assert.equal(reads, 0);
});

test("Git source reader uses the pinned blob and origin without changing a dirty working file or HEAD", async t => {
  const directory = await temporary(t);
  const git = (...args) => execFileSync("git", ["-C", directory, ...args], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  git("init");
  git("config", "user.name", "Inventory test");
  git("config", "user.email", "inventory@example.test");
  git("config", "core.autocrlf", "false");
  git("config", "commit.gpgsign", "false");
  git("remote", "add", "origin", "https://github.com/avilaops/crm.avilaops.com.git");
  const bytes = Buffer.from("Pinned source bytes\n");
  await writeFile(path.join(directory, "source.txt"), bytes);
  git("add", "source.txt");
  git("-c", "core.autocrlf=false", "commit", "-m", "fixture");
  const revision = git("rev-parse", "HEAD").toString().trim();
  const source = { repository: "crm", remote: "https://github.com/avilaops/crm.avilaops.com", revision, path: "source.txt", sha256: hash(bytes) };
  const dirty = "Uncommitted work must survive.\n";
  await writeFile(path.join(directory, "source.txt"), dirty);
  const reader = gitSourceReader({ crm: directory });
  assert.deepEqual(await reader(source), bytes);
  assert.equal(await readFile(path.join(directory, "source.txt"), "utf8"), dirty);
  assert.equal(git("rev-parse", "HEAD").toString().trim(), revision);
  await assert.rejects(gitSourceReader({})(source), /Informe o checkout/);
  await assert.rejects(gitSourceReader({ crm: directory })({ ...source, remote: "https://github.com/avilaops/TMS" }), /não foi possível conferir/);
});
