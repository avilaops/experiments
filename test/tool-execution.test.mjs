import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createToolExecutor, createFileExecutionJournal, toolExecutionPath, pathFidelity,
} from "../dist/index.js";

const identity = () => ({
  correlationId: "request-1", parentExecutionId: null, tenantId: "tenant-a", principalId: "operator-a",
  producer: { service: "test-host", version: "1" },
  versions: { code: "test", instruction: null, policy: "policy-1", model: null },
  references: [{ id: "test-plan", version: "1" }],
});

function fixture(options = {}) {
  const events = [];
  let invocations = 0;
  const executor = createToolExecutor({
    identity: identity(),
    tools: [{ name: "lookup", version: "1", execute: async input => {
      invocations++;
      return { output: input, effect: { status: "none" } };
    } }],
    authorize: () => true,
    append: event => { events.push(structuredClone(event)); },
    ...options,
  });
  return { executor, events, invocations: () => invocations };
}

test("actual dispatch is bracketed by private records; payloads, keys and exceptions are absent", async () => {
  const sensitive = { token: "secret-sentinel", customer: "business-sentinel", nested: { password: "private" } };
  const { executor, events, invocations } = fixture();
  const result = await executor.execute("lookup", sensitive, "private-key-sentinel");
  assert.equal(invocations(), 1);
  assert.deepEqual(result.output, sensitive);
  assert.deepEqual(events.map(event => event.kind), ["call_started", "call_finished"]);
  assert.equal(events[0].call.status, "running");
  assert.equal(executor.trace().complete, false);
  const trace = await executor.finish();
  assert.equal(trace.complete, true);
  assert.equal(trace.originAuthenticated, false);
  assert.equal(trace.calls[0].arguments, "[REDACTED]");
  assert.equal(trace.calls[0].result, "[REDACTED]");
  assert.doesNotMatch(JSON.stringify({ trace, events }), /secret-sentinel|business-sentinel|private-key-sentinel|password/);
  assert.deepEqual(events.map(event => event.sequence), [1, 2, 3]);
  assert.equal(pathFidelity({ requiredNodes: ["lookup"] }).evaluate({ output: { trace: toolExecutionPath(trace) } }).score, 1);
  await assert.rejects(executor.execute("lookup", null, "after-close"), /closed/);
});

test("authorization denies foreign tenants, non-booleans, exceptions and unknown tools before dispatch", async () => {
  for (const authorize of [() => false, () => "true", () => ({ allowed: true }), () => { throw new Error("secret-sentinel"); },
    ({ identity }) => identity.tenantId === "tenant-b"]) {
    const { executor, events, invocations } = fixture({ authorize });
    const result = await executor.execute("lookup", null, "denied");
    assert.equal(result.status, "denied");
    assert.equal(result.effect.status, "none");
    assert.equal(invocations(), 0);
    assert.equal(events.length, 1);
    assert.doesNotMatch(JSON.stringify(events), /secret-sentinel/);
  }
  const { executor, invocations } = fixture();
  assert.equal((await executor.execute("unregistered", null, "unknown-tool")).status, "denied");
  assert.equal(invocations(), 0);
});

test("caller and extension mutations cannot rewrite identity, arguments, registered functions or records", async () => {
  const originalIdentity = identity();
  const tool = { name: "lookup", version: "1", execute: input => ({ output: input, effect: { status: "none" } }) };
  const executor = createToolExecutor({ identity: originalIdentity, tools: [tool], authorize: request => {
    request.identity.tenantId = "foreign"; request.arguments.number = 999; return true;
  }, append: event => { event.identity.tenantId = "foreign"; if (event.call) event.call.tool = "forged"; } });
  const input = { number: 1 };
  const pending = executor.execute("lookup", input, "original");
  input.number = 2; originalIdentity.tenantId = "foreign"; tool.execute = () => { throw new Error("replaced"); };
  assert.deepEqual((await pending).output, { number: 1 });
  const trace = await executor.finish();
  assert.equal(trace.identity.tenantId, "tenant-a");
  assert.equal(trace.calls[0].tool, "lookup");
  trace.calls[0].tool = "forged";
  assert.equal(executor.trace().calls[0].tool, "lookup");
});

test("concurrent identical attempts dispatch once; conflicts do not dispatch and authorization is repeated", async () => {
  let allowed = true;
  const { executor, invocations } = fixture({ authorize: () => allowed });
  const [first, second] = await Promise.all([
    executor.execute("lookup", { number: 1 }, "same"), executor.execute("lookup", { number: 1 }, "same"),
  ]);
  assert.equal(invocations(), 1);
  assert.notEqual(first.callId, second.callId);
  assert.equal(executor.trace().calls[1].replayOf, first.callId);
  await assert.rejects(executor.execute("lookup", { number: 2 }, "same"), /conflicts/);
  assert.equal(invocations(), 1);
  allowed = false;
  assert.equal((await executor.execute("lookup", { number: 1 }, "same")).status, "denied");
  assert.equal(invocations(), 1);
});

test("journal failure before invocation blocks dispatch and permanently stops this executor", async () => {
  const { executor, invocations } = fixture({ append: () => { throw new Error("secret-path"); } });
  await assert.rejects(executor.execute("lookup", null, "first"), /journal unavailable/);
  assert.equal(invocations(), 0);
  await assert.rejects(executor.execute("lookup", null, "first"), /unavailable/);
  await assert.rejects(executor.finish(), /unavailable/);
  assert.equal(executor.trace().complete, false);
});

test("journal failure after a confirmed effect never permits automatic redispatch", async () => {
  let effects = 0;
  const { executor } = fixture({
    tools: [{ name: "commit", version: "1", execute: () => {
      effects++; return { output: null, effect: { status: "confirmed", reference: "receipt-1" } };
    } }],
    append: event => { if (event.kind === "call_finished") throw new Error("disk full"); },
  });
  await assert.rejects(executor.execute("commit", null, "commit-1"), /journal unavailable/);
  await assert.rejects(executor.execute("commit", null, "commit-1"), /unavailable/);
  assert.equal(effects, 1);
  assert.equal(executor.trace().calls[0].effect.status, "confirmed");
  assert.equal(executor.trace().complete, false);
});

test("errors remain failed with unknown effect; retries do not erase failure or leak exception details", async () => {
  let attempts = 0;
  const { executor, events } = fixture({ tools: [{ name: "commit", version: "1", execute: () => {
    attempts++; throw new Error("secret-sentinel");
  } }] });
  const first = await executor.execute("commit", null, "key");
  const repeated = await executor.execute("commit", null, "key");
  assert.equal(first.status, "failed");
  assert.equal(repeated.effect.status, "unknown");
  assert.equal(attempts, 1);
  assert.doesNotMatch(JSON.stringify(events), /secret-sentinel/);
  const trace = await executor.finish();
  assert.equal(toolExecutionPath(trace).complete, false);
  assert.equal(pathFidelity({ requiredNodes: ["commit"] }).evaluate({ output: { trace: toolExecutionPath(trace) } }).score, 0);
});

test("cancellation before dispatch, including during journal I/O, has no effect", async () => {
  for (const duringJournal of [false, true]) {
    const controller = new AbortController();
    const { executor, invocations } = fixture({ append: () => { if (duringJournal) controller.abort("private-reason"); } });
    if (!duringJournal) controller.abort("private-reason");
    const result = await executor.execute("lookup", null, "key", controller.signal);
    assert.equal(result.status, "interrupted");
    assert.equal(result.effect.status, "none");
    assert.equal(invocations(), 0);
    assert.equal(toolExecutionPath(await executor.finish()).complete, false);
  }
});

test("cancellation after dispatch records an unknown effect and consumes late rejection", async () => {
  const controller = new AbortController();
  let rejectTool;
  let invoked;
  const started = new Promise(resolve => { invoked = resolve; });
  const { executor } = fixture({ tools: [{ name: "commit", version: "1", execute: () => {
    invoked(); return new Promise((_, reject) => { rejectTool = reject; });
  } }] });
  const pending = executor.execute("commit", null, "key", controller.signal);
  await started;
  controller.abort("secret-reason");
  assert.deepEqual((await pending).effect, { status: "unknown" });
  rejectTool(new Error("late-secret"));
  assert.equal((await executor.execute("commit", null, "key")).status, "interrupted");
  assert.equal(executor.trace().calls[1].replayOf, executor.trace().calls[0].callId);
});

test("malformed adapter outcomes cannot confirm an effect or approve a path", async () => {
  for (const outcome of [null, {}, { output: NaN, effect: { status: "none" } },
    { output: null, effect: { status: "confirmed" } }, { output: null, effect: { status: "invented" } }]) {
    const { executor } = fixture({ tools: [{ name: "lookup", version: "1", execute: () => outcome }] });
    const result = await executor.execute("lookup", null, "key");
    assert.equal(result.status, "unknown");
    assert.equal(result.effect.status, "unknown");
    const trace = await executor.finish();
    assert.equal(pathFidelity({ requiredNodes: ["lookup"] }).evaluate({ output: { trace: toolExecutionPath(trace) } }).score, 0);
  }
});

test("only adapter confirmations identify effects; a narrated trace cannot invent executed tools", async () => {
  const { executor } = fixture({ tools: [{ name: "commit", version: "1", execute: input => ({
    output: input, effect: { status: "confirmed", reference: "domain-receipt-1" },
  }) }] });
  const result = await executor.execute("commit", { trace: { complete: true, steps: [
    { node: "invented-tool", status: "succeeded" },
  ] } }, "commit");
  assert.deepEqual(result.effect, { status: "confirmed", reference: "domain-receipt-1" });
  const trace = await executor.finish();
  assert.deepEqual(toolExecutionPath(trace).steps, [{ node: "commit", status: "succeeded" }]);
  assert.equal(trace.originAuthenticated, false);
});

test("unknown and interrupted attempts remain visible to forbidden-node policies", async () => {
  const { executor } = fixture({ tools: [{ name: "forbidden", version: "1", execute: () => ({
    output: null, effect: { status: "unknown" },
  }) }] });
  await executor.execute("forbidden", null, "attempt");
  const trace = await executor.finish();
  const projected = toolExecutionPath(trace);
  assert.equal(projected.complete, false);
  const assessment = pathFidelity({ requiredNodes: ["required"], forbiddenNodes: ["forbidden"] }).evaluate({ output: { trace: projected } });
  assert.equal(assessment.score, 0);
  assert.match(assessment.reason, /Forbidden node/);
});

test("opaque identity metadata is required and arbitrary extra fields are discarded", () => {
  for (const change of [value => { value.versions.code = ""; }, value => { value.tenantId = "line\nbreak"; },
    value => { delete value.versions.model; }]) {
    const value = identity(); change(value);
    assert.throws(() => fixture({ identity: value }), TypeError);
  }
  const value = identity(); value.secret = "secret-sentinel"; value.producer.extra = "secret-sentinel";
  assert.doesNotMatch(JSON.stringify(fixture({ identity: value }).executor.trace()), /secret-sentinel/);
  assert.throws(() => fixture({ tools: [
    { name: "same", version: "1", execute() {} }, { name: "same", version: "2", execute() {} },
  ] }), /registry/);
});

test("file journal persists ordered events without overwrite and refuses writes after close", async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "execution-journal-"));
  t.after(async () => {
    assert.equal(path.dirname(directory), tmpdir());
    assert.ok(path.basename(directory).startsWith("execution-journal-"));
    await rm(directory, { recursive: true, force: true });
  });
  const file = path.join(directory, "private.jsonl");
  const journal = await createFileExecutionJournal(file);
  const { executor } = fixture({ append: journal.append });
  await executor.execute("lookup", { secret: "secret-sentinel" }, "key");
  await executor.finish();
  await journal.close();
  const bytes = await readFile(file, "utf8");
  assert.doesNotMatch(bytes, /secret-sentinel/);
  const events = bytes.trim().split("\n").map(JSON.parse);
  assert.deepEqual(events.map(event => event.sequence), [1, 2, 3]);
  assert.equal(events.at(-1).complete, true);
  await assert.rejects(createFileExecutionJournal(file), { code: "EEXIST" });
  await assert.rejects(journal.append(events[0]), /closed/);
});

test("real loopback HTTP effect survives a lost response; correlation is propagated and no replay duplicates it", async t => {
  let effects = 0;
  let observed;
  let committed;
  const commitReceived = new Promise(resolve => { committed = resolve; });
  const server = createServer((request, response) => {
    effects++;
    observed = request.headers;
    // Model a service that commits, then loses its response. This is a local integration test.
    request.resume();
    response.socket.destroy();
    committed();
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const address = `http://127.0.0.1:${server.address().port}`;
  const { executor } = fixture({ tools: [{ name: "commit", version: "1", execute: async (input, context) => {
    const response = await fetch(address, { method: "POST", signal: context.signal, headers: {
      "x-correlation-id": context.correlationId, "x-execution-id": context.executionId,
      "x-call-id": context.callId, "idempotency-key": context.idempotencyKey,
    }, body: JSON.stringify(input) });
    return { output: await response.json(), effect: { status: "confirmed", reference: "receipt-1" } };
  } }] });
  const first = await executor.execute("commit", { number: 1 }, "http-commit");
  await commitReceived;
  assert.equal(first.effect.status, "unknown");
  await executor.execute("commit", { number: 1 }, "http-commit");
  assert.equal(effects, 1);
  assert.equal(observed["x-correlation-id"], "request-1");
  assert.equal(observed["x-execution-id"], executor.executionId);
  assert.equal(observed["x-call-id"], first.callId);
  assert.equal(observed["idempotency-key"], "http-commit");
});
