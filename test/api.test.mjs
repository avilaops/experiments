import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { createApiServer } from "../dist/lab/server.js";

async function close(server) {
  if (server.listening) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function start(t, options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "avila-lab-api-test-"));
  const server = await createApiServer({ dataDirectory: directory, ...options });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  t.after(async () => {
    await close(server);
    assert.equal(path.dirname(directory), tmpdir());
    assert.ok(path.basename(directory).startsWith("avila-lab-api-test-"));
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  const send = (route, method = "GET", body, headers = {}) => fetch(`${url}${route}`, {
    method,
    headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { directory, server, url, send };
}

function draft(suite) {
  return { hypothesis: suite.hypothesis, cases: suite.dataset.cases, settings: suite.settings };
}

test("API exposes health, the contract and a versioned suite", async (t) => {
  const { send } = await start(t);
  const home = await send("/");
  assert.equal(home.status, 200);
  assert.match(home.headers.get("content-type"), /text\/html/);
  assert.match(await home.text(), /href="\/api\/v1\/runs"/);
  const health = await (await send("/health")).json();
  assert.equal(health.status, "ok");
  assert.equal(health.authRequired, false);
  const response = await send("/api/v1/suite");
  assert.equal(response.headers.get("etag"), '"1"');
  assert.equal((await response.json()).dataset.cases.length, 2);
  const specification = await (await send("/openapi.json")).json();
  assert.equal(specification.openapi, "3.1.0");
  assert.equal(specification.paths["/api/v1/runs"].post.operationId, "executeSuite");
  assert.equal(specification.paths["/api/v1/suite"].put.parameters[0].name, "If-Match");
  for (const reference of JSON.stringify(specification).matchAll(/"\$ref":"#\/components\/schemas\/([^"]+)"/g)) {
    assert.ok(specification.components.schemas[reference[1]], `Missing schema: ${reference[1]}`);
  }
});

test("API executes the real kernel and persists outputs and dataset references", async (t) => {
  const { send } = await start(t);
  const response = await send("/api/v1/runs", "POST", { revision: 1 });
  assert.equal(response.status, 201);
  const run = await response.json();
  assert.equal(response.headers.get("location"), `/api/v1/runs/${run.id}`);
  assert.equal(run.mode, "deterministic-local");
  assert.equal(run.baseline.summary.verdict, "failed");
  assert.equal(run.candidate.summary.verdict, "passed");
  assert.equal(run.candidate.cases[0].output, 0.30000000000000004);
  assert.equal(run.comparison.comparable, true);
  assert.equal(run.candidate.summary.usage.costUsd.total, null);
  assert.deepEqual(await (await send(`/api/v1/runs/${run.id}`)).json(), run);
  const history = await (await send("/api/v1/runs?limit=1&offset=0")).json();
  assert.equal(history.total, 1);
  assert.equal(history.items[0].id, run.id);
});

test("suite edits require the current ETag and stale executions are refused", async (t) => {
  const { send } = await start(t);
  const suite = await (await send("/api/v1/suite")).json();
  const payload = draft(suite);
  payload.cases.push({ id: "my-case", input: { operation: "multiply", left: 3, right: 4 }, expected: 12 });
  assert.equal((await send("/api/v1/suite", "PUT", payload)).status, 428);
  const saved = await send("/api/v1/suite", "PUT", payload, { "If-Match": '"1"' });
  assert.equal(saved.status, 200);
  assert.equal(saved.headers.get("etag"), '"2"');
  assert.equal((await saved.json()).dataset.cases.length, 3);
  assert.equal((await send("/api/v1/suite", "PUT", payload, { "If-Match": '"1"' })).status, 412);
  assert.equal((await send("/api/v1/runs", "POST", { revision: 1 })).status, 409);
  assert.equal((await send("/api/v1/runs", "POST", { revision: 2 })).status, 201);
});

test("concurrent edits cannot overwrite a newer revision", async (t) => {
  const { send } = await start(t);
  const suite = await (await send("/api/v1/suite")).json();
  const statuses = await Promise.all([1, 2].map(async (index) => {
    const payload = { ...draft(suite), hypothesis: `Hypothesis ${index}` };
    return (await send("/api/v1/suite", "PUT", payload, { "If-Match": '"1"' })).status;
  }));
  assert.deepEqual(statuses.sort(), [200, 412]);
  assert.equal((await (await send("/api/v1/suite")).json()).revision, 2);
});

test("invalid suites fail before persistence", async (t) => {
  const { send } = await start(t);
  const suite = await (await send("/api/v1/suite")).json();
  const mutations = [
    (value) => { value.cases = []; },
    (value) => { value.cases.push(structuredClone(value.cases[0])); },
    (value) => { value.cases[0].input.operation = "eval"; },
    (value) => { value.cases[0].input.left = "0.1"; },
    (value) => { value.settings.absoluteTolerance = -1; },
    (value) => { value.settings.minimum = 200; },
    (value) => { value.settings.repetitions = 11; },
    (value) => { value.extra = true; },
  ];
  for (const mutate of mutations) {
    const payload = structuredClone(draft(suite));
    mutate(payload);
    const response = await send("/api/v1/suite", "PUT", payload, { "If-Match": '"1"' });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "INVALID_INPUT");
  }
  assert.equal((await (await send("/api/v1/suite")).json()).revision, 1);
});

test("historical runs keep their original suite after an edit", async (t) => {
  const { send } = await start(t);
  const first = await (await send("/api/v1/runs", "POST", { revision: 1 })).json();
  const payload = draft(first.suite);
  payload.settings.absoluteTolerance = 0.1;
  await send("/api/v1/suite", "PUT", payload, { "If-Match": '"1"' });
  const second = await (await send("/api/v1/runs", "POST", { revision: 2 })).json();
  const retained = await (await send(`/api/v1/runs/${first.id}`)).json();
  assert.equal(retained.suite.revision, 1);
  assert.equal(retained.suite.settings.absoluteTolerance, 1e-9);
  const comparison = await (await send("/api/v1/comparisons", "POST", {
    baseline: { runId: first.id, variant: "candidate" }, candidate: { runId: second.id, variant: "candidate" },
  })).json();
  assert.equal(comparison.comparable, false);
  assert.ok(comparison.reasons.length > 0);
  assert.equal((await (await send("/api/v1/runs")).json()).total, 2);
});

test("persisted runs remain available after restarting the API", async (t) => {
  const { directory, server, send } = await start(t);
  const run = await (await send("/api/v1/runs", "POST", { revision: 1 })).json();
  await close(server);
  const restarted = await createApiServer({ dataDirectory: directory });
  await new Promise((resolve) => restarted.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${restarted.address().port}/api/v1/runs/${run.id}`);
    assert.deepEqual(await response.json(), run);
  } finally {
    await close(restarted);
  }
});

test("executor errors and missing references are visible rather than HTTP success claims", async (t) => {
  const { send } = await start(t);
  const suite = await (await send("/api/v1/suite")).json();
  const payload = draft(suite);
  payload.cases = [
    { id: "divide-zero", input: { operation: "divide", left: 1, right: 0 }, expected: 0 },
    { id: "no-reference", input: { operation: "add", left: 1, right: 1 } },
  ];
  await send("/api/v1/suite", "PUT", payload, { "If-Match": '"1"' });
  const response = await send("/api/v1/runs", "POST", { revision: 2 });
  assert.equal(response.status, 201);
  const run = await response.json();
  assert.equal(run.candidate.summary.verdict, "error");
  assert.equal(run.candidate.summary.errors, 1);
  assert.equal(run.candidate.summary.inconclusive, 1);
  assert.equal(run.candidate.summary.total, 2);
});

test("a configured token protects all experiment data", async (t) => {
  const token = randomUUID();
  const { send } = await start(t, { token });
  assert.equal((await send("/health")).status, 200);
  assert.equal((await send("/openapi.json")).status, 200);
  assert.equal((await send("/api/v1/suite")).status, 401);
  assert.equal((await send("/api/v1/suite", "GET", undefined, { Authorization: "Bearer invalid" })).status, 401);
  assert.equal((await send("/api/v1/suite", "GET", undefined, { Authorization: `Bearer ${token}` })).status, 200);
});

test("CORS permits configured origins and rejects unrelated origins", async (t) => {
  const { send } = await start(t, { allowedOrigins: ["http://localhost:3400"] });
  const allowed = await send("/api/v1/suite", "GET", undefined, { Origin: "http://localhost:3400" });
  assert.equal(allowed.headers.get("access-control-allow-origin"), "http://localhost:3400");
  assert.equal((await send("/api/v1/suite", "GET", undefined, { Origin: "https://unrelated.example" })).status, 403);
  const preflight = await send("/api/v1/suite", "OPTIONS", undefined, { Origin: "http://localhost:3400" });
  assert.equal(preflight.status, 204);
  assert.ok(preflight.headers.get("access-control-allow-headers").includes("If-Match"));
});

test("invalid JSON, oversized bodies, pagination and unsafe IDs are rejected", async (t) => {
  const { send, url } = await start(t);
  assert.equal((await fetch(`${url}/api/v1/runs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" })).status, 400);
  assert.equal((await fetch(`${url}/api/v1/runs`, { method: "POST", body: "{}" })).status, 415);
  assert.equal((await fetch(`${url}/api/v1/runs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ padding: "a".repeat(1024 * 1024) }) })).status, 413);
  assert.equal((await send("/api/v1/runs?limit=101")).status, 400);
  assert.equal((await send("/api/v1/runs?offset=-1")).status, 400);
  assert.equal((await send("/api/v1/runs/not-a-uuid")).status, 400);
  assert.equal((await send(`/api/v1/runs/${randomUUID()}`)).status, 404);
});

test("the CLI refuses a non-loopback bind without a token", () => {
  const result = spawnSync(process.execPath, ["dist/lab/serve.js"], {
    cwd: process.cwd(), encoding: "utf8", timeout: 5000,
    env: { ...process.env, LAB_HOST: "0.0.0.0", LAB_API_TOKEN: "" },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /LAB_API_TOKEN is required/);
});
