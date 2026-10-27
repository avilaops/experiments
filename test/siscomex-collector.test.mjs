import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ORIGIN, collect, discoverLinks, inventoryContract, normalizeLink } from "../scripts/collect-siscomex.mjs";
import { parsePolicy } from "../dist/lab/policies.js";

test("repeated captures compare bytes and produce valid proposed policies", async () => {
  const output = await mkdtemp(path.join(tmpdir(), "siscomex-contract-"));
  try {
    let version = "1";
    const fetcher = async () => Response.json({ openapi: "3.0.0", info: { title: "Example", version },
      paths: { "/test": { get: { responses: { 200: {} } } } } });
    const first = await collect({ output, seeds: [ORIGIN + "/test.json"], fetcher });
    const policies = JSON.parse(await readFile(path.join(first.directory, "policies.proposed.json"), "utf8"));
    assert.equal(parsePolicy(policies[0]).state, "proposed");
    const second = await collect({ output, seeds: [ORIGIN + "/test.json"], fetcher });
    assert.equal(JSON.parse(await readFile(path.join(second.directory, "changes.json"), "utf8")).changes[0].changed, false);
    version = "2";
    const third = await collect({ output, seeds: [ORIGIN + "/test.json"], fetcher });
    assert.equal(JSON.parse(await readFile(path.join(third.directory, "changes.json"), "utf8")).changes[0].changed, true);
  } finally { await rm(output, { recursive: true, force: true }); }
});

test("collector restricts origin and discovers legacy and new Swagger specifications without execution", () => {
  assert.equal(normalizeLink("https://evil.example/a.json", ORIGIN), null);
  assert.equal(normalizeLink("/api/run?token=x", ORIGIN), null);
  assert.equal(normalizeLink("/assets/main.js", ORIGIN), null);
  assert.deepEqual(discoverLinks('<iframe src="swagger.html"></iframe><script>var url = "../sefaz.json";</script>', ORIGIN + "/api/sefaz/"),
    [ORIGIN + "/api/sefaz/swagger.html", ORIGIN + "/api/sefaz.json"]);
});

test("Swagger inventory retains required authorization headers even without securityDefinitions", () => {
  const result = inventoryContract({ swagger: "2.0", paths: { "/duimp": { get: {
    parameters: [{ in: "header", name: "Authorization", required: true }], responses: { 200: {} } } } } }, ORIGIN, "hash");
  assert.equal(result.operations[0].parameters[0].required, true);
  assert.equal(result.operations[0].security, null);
  assert.equal(result.operations.length, 1);
});

test("HTTP slash redirect is upgraded without requesting HTTP; external redirects remain failures", async () => {
  const output = await mkdtemp(path.join(tmpdir(), "siscomex-redirect-"));
  try {
    const calls = [];
    const result = await collect({ output, seeds: [ORIGIN + "/page"], fetcher: async url => {
      calls.push(url);
      return url.endsWith("/page") ? new Response(null, { status: 301, headers: { Location: ORIGIN.replace("https:", "http:") + "/page/" } }) : new Response("ok");
    } });
    assert.equal(result.complete, true);
    assert.deepEqual(calls, [ORIGIN + "/page", ORIGIN + "/page/"]);
    const external = await collect({ output, seeds: [ORIGIN + "/page"], fetcher: async () =>
      new Response(null, { status: 302, headers: { Location: "https://evil.example/" } }) });
    assert.equal(external.failures, 1);
  } finally { await rm(output, { recursive: true, force: true }); }
});

test("collection records failures, bounded coverage and preserves the last complete checkpoint", async () => {
  const output = await mkdtemp(path.join(tmpdir(), "siscomex-"));
  try {
    const fetcher = async () => new Response('<a href="/other/">other</a>', { headers: { "Content-Type": "text/html" } });
    const first = await collect({ output, seeds: [ORIGIN + "/"], fetcher });
    assert.equal(first.complete, true);
    const checkpoint = await readFile(path.join(output, "latest.json"), "utf8");
    const bounded = await collect({ output, seeds: [ORIGIN + "/"], fetcher, maxPages: 1 });
    assert.equal(bounded.complete, false);
    assert.equal(bounded.pending, 1);
    let attempts = 0;
    const failed = await collect({ output, seeds: [ORIGIN + "/"], fetcher: async () => { attempts++; throw new Error("offline"); } });
    assert.equal(attempts, 3);
    assert.equal(failed.failures, 1);
    assert.equal(await readFile(path.join(output, "latest.json"), "utf8"), checkpoint);
  } finally { await rm(output, { recursive: true, force: true }); }
});
