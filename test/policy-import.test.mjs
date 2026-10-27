import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { importPolicies } from "../scripts/import-policies.mjs";

const inventory = JSON.parse(await readFile(new URL("../examples/policies/lojas-fiscal.json", import.meta.url)));
const response = (revision, policies) => Response.json({ revision, policies }, { headers: { ETag: `"${revision}"` } });

test("fiscal inventory imports five valid scoped records while preserving existing policies", async () => {
  let policies = [{ ...inventory[0], owner: "Responsável já atribuído" }];
  let revision = 12;
  let writes = 0;
  const fetcher = async (_url, options) => {
    assert.equal(options.redirect, "error");
    if (options.method === "PUT") {
      assert.equal(options.headers["If-Match"], `"${revision}"`);
      policies = [...policies, JSON.parse(options.body).policy]; revision++; writes++;
    }
    return response(revision, policies);
  };
  const result = await importPolicies({ baseUrl: "http://127.0.0.1:3310", token: "test-only", policies: inventory, fetcher });
  assert.equal(result.results[0].action, "preserved");
  assert.equal(writes, 4);
  assert.equal(policies[0].owner, "Responsável já atribuído");
  const repeated = await importPolicies({ baseUrl: "http://127.0.0.1:3310", token: "test-only", policies: inventory, fetcher });
  assert.equal(repeated.results.every(item => item.action === "preserved"), true);
  assert.equal(writes, 4);
});

test("invalid import records and duplicate IDs fail before any HTTP request", async () => {
  let calls = 0;
  const options = { baseUrl: "http://localhost:3310", token: "test-only", fetcher: async () => { calls++; throw new Error("Must not request"); } };
  await assert.rejects(importPolicies({ ...options, policies: [inventory[0], { ...inventory[1], verificationDate: "" }] }));
  await assert.rejects(importPolicies({ ...options, policies: [inventory[0], inventory[0]] }), /duplicados/);
  await assert.rejects(importPolicies({ ...options, baseUrl: "http://external.example", policies: inventory }), /HTTPS/);
  assert.equal(calls, 0);
});

test("a revision conflict stops the import without silently retrying", async () => {
  let writes = 0;
  await assert.rejects(importPolicies({ baseUrl: "http://localhost:3310", token: "test-only", policies: inventory, fetcher: async (_url, options) => {
    if (options.method !== "PUT") return response(1, []);
    writes++; return Response.json({ error: "conflict" }, { status: 412 });
  } }), /HTTP 412/);
  assert.equal(writes, 1);
});
