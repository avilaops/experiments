import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFile, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createFileToolOperationStore, createToolExecutor, pathFidelity, toolExecutionPath } from "../dist/index.js";

const identity = () => ({
  correlationId: "request-1", parentExecutionId: null, tenantId: "tenant-a", principalId: "operator-a",
  producer: { service: "test-host", version: "1" },
  versions: { code: "test", instruction: null, policy: "policy-1", model: null }, references: [],
});

async function directory(t) {
  const root = await mkdtemp(path.join(tmpdir(), "tool-operations-"));
  t.after(async () => {
    assert.equal(path.dirname(root), tmpdir());
    assert.ok(path.basename(root).startsWith("tool-operations-"));
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

function executor(operationStore, options = {}) {
  return createToolExecutor({ identity: identity(), authorize: () => true, append: () => undefined, operationStore,
    tools: [{ name: "commit", version: "1", execute: () => ({ output: "private-output", effect: { status: "confirmed", reference: "receipt-1" } }) }],
    ...options,
  });
}

test("a reopened store deduplicates across executors without persisting raw data or pretending to recover output", async t => {
  const root = await directory(t);
  const key = randomBytes(32);
  let effects = 0;
  const tools = [{ name: "commit", version: "1", execute: () => {
    effects++; return { output: "private-output-sentinel", effect: { status: "confirmed", reference: "receipt-1" } };
  } }];
  const first = executor(await createFileToolOperationStore(root, key), { tools });
  const original = await first.execute("commit", { customer: "private-customer-sentinel" }, "private-idempotency-sentinel");
  assert.equal(original.outputAvailable, true);
  await first.finish();
  const second = executor(await createFileToolOperationStore(root, key), { tools });
  const recovered = await second.execute("commit", { customer: "private-customer-sentinel" }, "private-idempotency-sentinel");
  assert.equal(recovered.status, "succeeded");
  assert.equal(recovered.output, null);
  assert.equal(recovered.outputAvailable, false);
  assert.equal(effects, 1);
  assert.equal(second.trace().calls[0].replayOf, original.callId);
  const bytes = (await Promise.all((await readdir(root)).map(file => readFile(path.join(root, file), "utf8")))).join("\n");
  assert.doesNotMatch(bytes, /private-output-sentinel|private-customer-sentinel|private-idempotency-sentinel|tenant-a|operator-a/);
});

test("arguments, tool version, code, policy, instruction, model and reference changes conflict instead of redispatching", async t => {
  const root = await directory(t);
  const store = await createFileToolOperationStore(root, randomBytes(32));
  await executor(store).execute("commit", { amount: 1 }, "fixed-key");
  for (const change of [
    value => { value.versions.code = "new-code"; }, value => { value.versions.policy = "new-policy"; },
    value => { value.versions.instruction = "new-instruction"; }, value => { value.versions.model = "new-model"; },
    value => { value.references = [{ id: "reference", version: "2" }]; },
  ]) {
    const value = identity(); change(value);
    await assert.rejects(executor(store, { identity: value }).execute("commit", { amount: 1 }, "fixed-key"), /conflicts/);
  }
  await assert.rejects(executor(store).execute("commit", { amount: 2 }, "fixed-key"), /conflicts/);
  await assert.rejects(executor(store, { tools: [{ name: "commit", version: "2", execute: () => assert.fail("must not dispatch") }] })
    .execute("commit", { amount: 1 }, "fixed-key"), /conflicts/);
});

test("persistent replay is reauthorized and scope separates tenant and principal", async t => {
  const store = await createFileToolOperationStore(await directory(t), randomBytes(32));
  let effects = 0;
  const tools = [{ name: "commit", version: "1", execute: () => { effects++; return { output: null, effect: { status: "none" } }; } }];
  await executor(store, { tools }).execute("commit", null, "key");
  const denied = await executor(store, { tools, authorize: () => false }).execute("commit", null, "key");
  assert.equal(denied.status, "denied");
  assert.equal(denied.outputAvailable, false);
  for (const field of ["tenantId", "principalId"]) {
    const value = identity(); value[field] = "other";
    await executor(store, { tools, identity: value }).execute("commit", null, "key");
  }
  assert.equal(effects, 3);
});

test("independent stores competing for one command never dispatch twice", async t => {
  const root = await directory(t);
  const key = randomBytes(32);
  const one = await createFileToolOperationStore(root, key);
  const two = await createFileToolOperationStore(root, key);
  let effects = 0;
  const tools = [{ name: "commit", version: "1", execute: async () => {
    effects++; await new Promise(resolve => setImmediate(resolve));
    return { output: null, effect: { status: "confirmed", reference: "receipt-1" } };
  } }];
  const results = await Promise.allSettled([
    executor(one, { tools }).execute("commit", null, "key"), executor(two, { tools }).execute("commit", null, "key"),
  ]);
  assert.equal(effects, 1);
  assert.ok(results.some(result => result.status === "fulfilled" && result.value.status === "succeeded"));
  // An in-flight or partial exclusive claim fails closed; it is never stolen.
  assert.ok(results.every(result => result.status === "fulfilled" || /store unavailable/.test(result.reason.message)));
});

test("process exit after a real effect preserves a reservation and blocks redispatch after restart", async t => {
  const root = await directory(t);
  const operations = path.join(root, "operations");
  const effectFile = path.join(root, "effect.txt");
  await assert.rejects(promisify(execFile)(process.execPath, [
    fileURLToPath(new URL("./fixtures/tool-operation-worker.mjs", import.meta.url)), operations, effectFile,
  ], { timeout: 15_000 }), error => error.code === 23);
  const store = await createFileToolOperationStore(operations, Buffer.alloc(32, 7));
  const recovered = executor(store, { tools: [{ name: "commit", version: "1", execute: () => assert.fail("must not redispatch") }] });
  const result = await recovered.execute("commit", { amount: 1 }, "crash-key");
  assert.equal(result.status, "unknown");
  assert.equal(result.outputAvailable, false);
  assert.equal((await readFile(effectFile, "utf8")), "committed\n");
  assert.equal((await recovered.finish()).complete, false);
});

test("two separate processes racing for the same key produce one real filesystem effect", async t => {
  const root = await directory(t);
  const operations = path.join(root, "operations");
  const effectFile = path.join(root, "effect.txt");
  await createFileToolOperationStore(operations, Buffer.alloc(32, 7));
  const worker = fileURLToPath(new URL("./fixtures/tool-operation-worker.mjs", import.meta.url));
  const results = await Promise.allSettled([1, 2].map(() => promisify(execFile)(process.execPath,
    [worker, operations, effectFile, "finish"], { timeout: 15_000 })));
  assert.ok(results.some(result => result.status === "fulfilled"));
  assert.ok(results.every(result => result.status === "fulfilled" || /store unavailable/.test(result.reason.stderr)));
  assert.equal(await readFile(effectFile, "utf8"), "committed\n");
});

test("an executor refreshes an unknown reservation after another executor confirms its receipt", async t => {
  const store = await createFileToolOperationStore(await directory(t), randomBytes(32));
  const tools = [{ name: "commit", version: "1", execute: () => { throw new Error("lost response"); },
    reconcile: () => ({ output: null, effect: { status: "confirmed", reference: "confirmed-elsewhere" } }) }];
  const waiting = executor(store, { tools });
  assert.equal((await waiting.execute("commit", null, "key")).effect.status, "unknown");
  await executor(store, { tools }).reconcile("commit", null, "key");
  assert.equal((await waiting.execute("commit", null, "key")).effect.status, "confirmed");
});

test("a lost HTTP response is resolved by an authorized receipt lookup and still never redispatches", async t => {
  const store = await createFileToolOperationStore(await directory(t), randomBytes(32));
  let commits = 0;
  let lookups = 0;
  const server = createServer((request, response) => {
    assert.equal(request.headers["x-tenant-id"], "tenant-a");
    assert.equal(request.headers["idempotency-key"], "http-key");
    if (request.method === "POST") { commits++; request.resume(); response.socket.destroy(); }
    else { lookups++; response.setHeader("content-type", "application/json"); response.end(JSON.stringify({ tenantId: "tenant-a", reference: "http-receipt-1" })); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  const headers = context => ({ "x-tenant-id": context.tenantId, "idempotency-key": context.idempotencyKey,
    "x-correlation-id": context.correlationId, "x-execution-id": context.executionId });
  const tools = [{ name: "commit", version: "1", execute: async (_, context) => {
    const response = await fetch(url, { method: "POST", headers: headers(context), signal: context.signal });
    return { output: await response.json(), effect: { status: "confirmed", reference: "http-receipt-1" } };
  }, reconcile: async (_, context) => {
    const response = await fetch(url, { headers: headers(context), signal: context.signal });
    const receipt = await response.json();
    assert.equal(receipt.tenantId, context.tenantId);
    return { output: null, effect: { status: "confirmed", reference: receipt.reference } };
  } }];
  assert.equal((await executor(store, { tools }).execute("commit", null, "http-key")).effect.status, "unknown");
  const recovery = executor(store, { tools, authorize: ({ action }) => action === "reconcile" });
  const confirmation = await recovery.reconcile("commit", null, "http-key");
  assert.equal(confirmation.effect.status, "confirmed");
  assert.equal(recovery.trace().calls[0].action, "reconcile");
  const projection = toolExecutionPath(await recovery.finish());
  assert.equal(projection.steps[0].node, "commit:reconcile");
  assert.equal(pathFidelity({ requiredNodes: ["commit"] }).evaluate({ output: { trace: projection } }).score, 0);
  const replay = await executor(store, { tools }).execute("commit", null, "http-key");
  assert.equal(replay.effect.status, "confirmed");
  assert.equal(replay.outputAvailable, false);
  assert.equal(commits, 1);
  assert.equal(lookups, 1);
});

test("reconciliation is independently authorized; missing adapters, records and negative lookups do not create confirmation", async t => {
  const store = await createFileToolOperationStore(await directory(t), randomBytes(32));
  let lookups = 0;
  const tools = [{ name: "commit", version: "1", execute: () => { throw new Error("secret"); },
    reconcile: () => { lookups++; return { output: null, effect: { status: "none" } }; } }];
  await executor(store, { tools }).execute("commit", null, "key");
  const denied = executor(store, { tools, authorize: ({ action }) => action === "execute" });
  assert.equal((await denied.reconcile("commit", null, "key")).status, "denied");
  assert.equal(lookups, 0);
  const missing = executor(store, { tools });
  assert.equal((await missing.reconcile("commit", null, "missing")).status, "failed");
  assert.equal(missing.trace().calls[0].error, "operation_not_found");
  assert.equal(lookups, 0);
  assert.equal((await executor(store).reconcile("commit", null, "key")).status, "failed");
  assert.equal((await executor(store, { tools }).reconcile("commit", null, "key")).effect.status, "unknown");
  assert.equal((await executor(store, { tools }).execute("commit", null, "key")).effect.status, "unknown");
  assert.equal(lookups, 1);
});

test("key changes, incomplete marker, altered records and partial files fail closed without dispatch", async t => {
  const root = await directory(t);
  const key = randomBytes(32);
  await executor(await createFileToolOperationStore(root, key)).execute("commit", null, "key");
  await assert.rejects(createFileToolOperationStore(root, randomBytes(32)), /unavailable/);
  for (const changed of ["{", JSON.stringify({ payload: { schemaVersion: "tool-operation/1", kind: "result" }, signature: "0".repeat(64) })]) {
    const file = (await readdir(root)).find(file => file.endsWith(".result.json"));
    await writeFile(path.join(root, file), changed);
    const restarted = executor(await createFileToolOperationStore(root, key), { tools: [{ name: "commit", version: "1", execute: () => assert.fail("must not dispatch") }] });
    await assert.rejects(restarted.execute("commit", null, "key"), /store unavailable/);
    await assert.rejects(restarted.execute("commit", null, "new-key"), /unavailable/);
  }
  await rm(path.join(root, "store.json"));
  await assert.rejects(createFileToolOperationStore(root, key), /unavailable/);
});

test("a valid signed result copied from another command cannot satisfy a reservation", async t => {
  const root = await directory(t);
  const key = randomBytes(32);
  const store = await createFileToolOperationStore(root, key);
  await executor(store).execute("commit", null, "first");
  await executor(store).execute("commit", null, "second");
  const results = (await readdir(root)).filter(file => file.endsWith(".result.json"));
  await copyFile(path.join(root, results[0]), path.join(root, results[1]));
  const attempts = await Promise.allSettled([executor(store).execute("commit", null, "first"), executor(store).execute("commit", null, "second")]);
  assert.equal(attempts.filter(result => result.status === "rejected").length, 1);
});

test("a result write failure after a confirmed effect blocks this instance and any later redispatch", async t => {
  const root = await directory(t);
  const key = randomBytes(32);
  const store = await createFileToolOperationStore(root, key);
  let effects = 0;
  const tools = [{ name: "commit", version: "1", execute: () => { effects++; return { output: null, effect: { status: "confirmed", reference: "receipt" } }; } }];
  const failed = executor({ ...store, complete: async () => { throw new Error("disk full"); } }, { tools });
  await assert.rejects(failed.execute("commit", null, "key"), /store unavailable/);
  await assert.rejects(failed.execute("commit", null, "key"), /unavailable/);
  const reopened = executor(await createFileToolOperationStore(root, key), { tools });
  assert.equal((await reopened.execute("commit", null, "key")).effect.status, "unknown");
  assert.equal(effects, 1);
});
