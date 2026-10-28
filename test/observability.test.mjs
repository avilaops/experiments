import test from "node:test";
import assert from "node:assert/strict";
import { traceOperation, flushObservability } from "../dist/observability.js";

test("unconfigured tracing preserves nested operations and original failures exactly once", async () => {
  let calls = 0;
  const original = new Error("private adapter failure");
  await assert.rejects(traceOperation("test-operation", "span", {}, async () => {
    return traceOperation("test-tool", "tool", {}, async () => {
      calls++;
      throw original;
    });
  }), (error) => error === original);
  assert.equal(calls, 1);
  assert.equal(await traceOperation("test-result", "span", {}, async () => 42), 42);
  await flushObservability();
});
