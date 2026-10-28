import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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

test("enabled tracing redacts errors and never retries a dispatched operation", () => {
  const result = spawnSync(process.execPath, ["--experimental-test-module-mocks",
    "test/fixtures/observability-enabled.mjs"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});
