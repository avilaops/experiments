import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { architecturePool, migrateArchitecture } from "../dist/lab/architecture/database.js";
import { ArchitectureStore } from "../dist/lab/architecture/store.js";
import { previewSources, importSources } from "../dist/lab/architecture/import.js";
import { parseRecord } from "../dist/lab/architecture/schema.js";
import { createApiServer } from "../dist/lab/server.js";

const app = id => ({ id, name: id, description: "Application catalog test", owner: null, lifecycle: "unknown", repository: null });
const connection = process.env.ARCHITECTURE_TEST_DATABASE_URL;

test("architecture validates malformed references without leaking URL parser errors", () => {
  assert.throws(() => parseRecord("applications", { ...app("bad"), repository: "https://[bad" }), error => error.status === 400);
  assert.throws(() => parseRecord("applications", { ...app("bad"), repository: "https://user:password@example.com" }), error => error.status === 400);
});

test("architecture PostgreSQL migration, constraints, revision, archive and API", { skip: !connection }, async t => {
  // This URL MUST point to a disposable, dedicated test database. No schema is dropped.
  const pool = architecturePool(connection);
  const dir = await mkdtemp(join(tmpdir(), "experiments-architecture-"));
  let server;
  t.after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    await pool.end();
    await rm(dir, { recursive: true, force: true });
  });
  await migrateArchitecture(pool);
  await migrateArchitecture(pool);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM experiments_architecture.schema_migrations")).rows[0].n, 1);
  const store = new ArchitectureStore(pool);
  let revision = (await store.list("applications", { q: "", limit: 25, offset: 0 })).revision;
  assert.equal(revision, 0, "requires a fresh test database");
  async function save(entity, record) {
    const result = await store.save(entity, { record, changeNote: "Integration test" }, revision);
    revision = result.revision;
    return result.record;
  }
  await save("applications", app("erp"));
  await save("applications", app("auth"));
  const parallel = await Promise.allSettled(["cms", "crm"].map(id => store.save("applications", { record: app(id), changeNote: "Concurrent insert" }, revision)));
  assert.equal(parallel.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(parallel.find(result => result.status === "rejected").reason.status, 412);
  revision++;
  await save("components", { id: "erp-api", applicationId: "erp", name: "ERP API", kind: "api", responsibility: "ERP business data" });
  await save("components", { id: "auth-api", applicationId: "auth", name: "Auth API", kind: "api", responsibility: "Identity" });
  await assert.rejects(save("data_assets", { id: "invalid-owner", applicationId: "erp", authorityComponentId: "auth-api", name: "Invalid", classification: "internal", description: "Wrong application" }), error => error.status === 400);
  assert.equal((await store.list("applications", { q: "", limit: 25, offset: 0 })).revision, revision);
  await save("data_assets", { id: "orders", applicationId: "erp", authorityComponentId: "erp-api", name: "Orders", classification: "internal", description: "ERP orders" });
  await save("interfaces", { id: "oidc", providerComponentId: "auth-api", name: "Identity", protocol: "http", contractVersion: "1", reference: "https://example.com/oidc" });
  await save("dependencies", { id: "erp-auth", consumerComponentId: "erp-api", interfaceId: "oidc", purpose: "Authentication", criticality: "high" });
  const dependencies = await store.report("dependency_map", 25, 0);
  assert.equal(dependencies.items[0].providerApplicationId, "auth");
  assert.equal(dependencies.items[0].consumerApplicationId, "erp");
  const standard = { id: "search", applicationId: null, title: "Search control", category: "interface", rule: "Use explicit search", owner: null, status: "documented", policyReference: null };
  await save("standards", standard);
  assert.ok((await store.report("coverage", 25, 0)).items.every(row => row.state === "not_assessed"));
  const evidence = { id: "erp-test", applicationId: "erp", kind: "test", location: "https://example.com/test", sourceCommit: "a".repeat(40), contentSha256: "b".repeat(64), observedAt: "2026-01-01T00:00:00.000Z", summary: "Recorded test result" };
  await save("evidence", evidence);
  await assert.rejects(save("evidence", evidence), error => error.status === 409);
  const assessment = { id: "search-erp", applicationId: "erp", standardId: "search", standardVersion: 1, evidenceId: "erp-test", outcome: "passed", notes: "Result from cited evidence" };
  await assert.rejects(save("assessments", { ...assessment, id: "wrong-app", applicationId: "auth" }), error => error.status === 400);
  await assert.rejects(save("assessments", { ...assessment, evidenceId: null }), error => error.status === 400);
  await save("assessments", assessment);
  assert.equal((await store.report("coverage", 25, 0)).items.find(row => row.applicationId === "erp").state, "passed");
  await save("standards", { ...standard, rule: "Changed search standard" });
  assert.equal((await store.report("coverage", 25, 0)).items.find(row => row.applicationId === "erp").state, "stale");
  await assert.rejects(save("assessments", { ...assessment, id: "old-version" }), error => error.status === 400);
  await save("evidence", { ...evidence, id: "deployment-evidence", kind: "deployment" });
  const deployment = { id: "release-1", applicationId: "erp", componentId: "erp-api", environment: "staging", sourceCommit: "a".repeat(40), artifactSha256: "c".repeat(64), evidenceId: "deployment-evidence", observedAt: evidence.observedAt };
  await assert.rejects(save("deployments", { ...deployment, sourceCommit: "d".repeat(40) }), error => error.status === 400);
  await save("deployments", deployment);
  const injection = "'; DROP SCHEMA experiments_architecture CASCADE; --";
  assert.equal((await store.list("applications", { q: injection, limit: 1, offset: 0 })).total, 0);
  assert.equal((await store.list("applications", { q: "", limit: 1, offset: 1 })).items.length, 1);
  assert.equal((await store.history("standards", "search", 25, 0)).items.length, 2);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM experiments_architecture.changes")).rows[0].n, revision);
  const original = '{"revision":1,"policies":[]}\n';
  await writeFile(join(dir, "policies.json"), original);
  const preview = await previewSources(dir);
  await assert.rejects(importSources(pool, dir, "bad", revision, "Import"), error => error.status === 412);
  const imported = await importSources(pool, dir, preview.sha256, revision, "Archive existing stores");
  assert.equal(imported.imported, 1);
  revision = imported.revision;
  assert.equal((await importSources(pool, dir, preview.sha256, revision, "Repeat import")).imported, 0);
  assert.equal(await readFile(join(dir, "policies.json"), "utf8"), original);
  await writeFile(join(dir, "policies.json"), '{"revision":2}');
  await writeFile(join(dir, "suite.json"), '{"invalid":"\\u0000"}');
  const invalidPreview = await previewSources(dir);
  await assert.rejects(importSources(pool, dir, invalidPreview.sha256, revision, "Reject invalid PostgreSQL JSON atomically"));
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM experiments_architecture.source_snapshots")).rows[0].n, 1);
  assert.equal((await store.list("applications", { q: "", limit: 25, offset: 0 })).revision, revision);
  // The API initializes its independent legacy store in a separate directory.
  server = await createApiServer({ dataDirectory: join(dir, "api"), token: "admin-test", contextReadToken: "context-test", architectureDatabaseUrl: connection });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/v1/architecture`;
  assert.equal((await fetch(base + "/applications")).status, 401);
  assert.equal((await fetch(base + "/applications", { headers: { authorization: "Bearer context-test" } })).status, 401);
  const headers = { authorization: "Bearer admin-test" };
  const page = await fetch(base + "/applications?limit=1&offset=1", { headers });
  assert.equal(page.headers.get("etag"), `"${revision}"`);
  assert.equal((await page.json()).items.length, 1);
  assert.equal((await fetch(base + "/applications?limit=101", { headers })).status, 400);
  assert.equal((await fetch(base + "/reports/coverage?q=ignored", { headers })).status, 400);
  assert.equal((await fetch(base + "/unknown", { headers })).status, 404);
  assert.equal((await fetch(base + "/schemas", { headers })).status, 200);
  assert.equal((await fetch(base + "/applications", { method: "PUT", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ record: app("new"), changeNote: "API test" }) })).status, 428);
  const update = await fetch(base + "/applications", { method: "PUT", headers: { ...headers, "content-type": "application/json", "if-match": `"${revision}"` }, body: JSON.stringify({ record: app("new"), changeNote: "API test" }) });
  assert.equal(update.status, 200);
  assert.equal((await new ArchitectureStore(pool).list("applications", { q: "new", limit: 25, offset: 0 })).total, 1);
  // Runtime role can append observations, but cannot overwrite them or migrate schemas.
  await pool.query("DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='architecture_test_runtime') THEN CREATE ROLE architecture_test_runtime NOLOGIN; END IF; END $$");
  const grants = await readFile(new URL("../migrations/architecture/grants.sql", import.meta.url), "utf8");
  await pool.query(grants.replaceAll(':"runtime_role"', '"architecture_test_runtime"'));
  const client = await pool.connect();
  try {
    await client.query("SET ROLE architecture_test_runtime");
    await assert.rejects(client.query("UPDATE experiments_architecture.evidence SET summary='changed'"), error => error.code === "42501");
    await assert.rejects(client.query("DELETE FROM experiments_architecture.changes"), error => error.code === "42501");
    await assert.rejects(client.query("CREATE TABLE experiments_architecture.unauthorized(id int)"), error => error.code === "42501");
  } finally { await client.query("RESET ROLE"); client.release(); }
  const runtimeUrl = new URL(connection);
  runtimeUrl.searchParams.set("options", "-c role=architecture_test_runtime");
  const runtimePool = architecturePool(runtimeUrl.href);
  try {
    const runtimeStore = new ArchitectureStore(runtimePool);
    const current = await runtimeStore.list("applications", { q: "", limit: 25, offset: 0 });
    await runtimeStore.save("evidence", { record: { ...evidence, id: "runtime-evidence" }, changeNote: "Append using least-privilege role" }, current.revision);
  } finally { await runtimePool.end(); }
  const cli = fileURLToPath(new URL("../dist/lab/architecture/cli.js", import.meta.url));
  const seed = () => spawnSync(process.execPath, [cli, "seed-applications"], { encoding: "utf8", env: { ...process.env, LAB_ARCHITECTURE_ADMIN_DATABASE_URL: connection } });
  const firstSeed = seed();
  assert.equal(firstSeed.status, 0, firstSeed.stderr);
  const repeatSeed = seed();
  assert.equal(repeatSeed.status, 0, repeatSeed.stderr);
  assert.equal(JSON.parse(repeatSeed.stdout).created, 0);
  assert.equal((await store.list("applications", { q: "", limit: 25, offset: 0 })).items.find(row => row.id === "erp").description, app("erp").description);
  const migration = await pool.query("SELECT sha256 FROM experiments_architecture.schema_migrations WHERE version=1");
  await pool.query("UPDATE experiments_architecture.schema_migrations SET sha256=$1 WHERE version=1", ["0".repeat(64)]);
  await assert.rejects(migrateArchitecture(pool), /checksum/);
  await pool.query("UPDATE experiments_architecture.schema_migrations SET sha256=$1 WHERE version=1", [migration.rows[0].sha256]);
});
