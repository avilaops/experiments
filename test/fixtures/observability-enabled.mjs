import { mock } from "node:test";
import assert from "node:assert/strict";

const observations = [];
let failStart = false;
let failUpdate = false;
let processorOptions;
let sdkOptions;
mock.module("@opentelemetry/sdk-node", { namedExports: {
  NodeSDK: class { constructor(options) { sdkOptions = options; } start() {} async shutdown() {} },
} });
mock.module("@langfuse/otel", { namedExports: {
  LangfuseSpanProcessor: class { constructor(options) { processorOptions = options; } async forceFlush() {} },
} });
mock.module("@langfuse/tracing", { namedExports: {
  async startActiveObservation(name, action, options) {
    if (failStart) throw new Error("exporter unavailable");
    const recorded = { name, type: options.asType, updates: [] };
    observations.push(recorded);
    return action({ update(attributes) {
      if (failUpdate) throw new Error("exporter unavailable");
      recorded.updates.push(attributes);
    } });
  },
} });
process.env.LANGFUSE_ENABLED = "true";
process.env.LANGFUSE_PUBLIC_KEY = "test-public";
process.env.LANGFUSE_SECRET_KEY = "test-secret";
process.env.LANGFUSE_BASE_URL = "https://example.invalid";
const { traceOperation } = await import("../../dist/observability.js");
const privateError = new Error("private email and adapter credential");
let calls = 0;
await assert.rejects(traceOperation("run-experiment", "span", { repetitions: 1 }, async () => {
  return traceOperation("dispatch-registered-tool", "tool", {}, async () => {
    calls++;
    throw privateError;
  });
}), (error) => error === privateError);
assert.equal(calls, 1);
assert.equal(processorOptions.mediaUploadEnabled, false);
assert.equal(processorOptions.timeout, 3);
assert.equal(sdkOptions.autoDetectResources, false);
assert.deepEqual(sdkOptions.instrumentations, []);
assert.equal(processorOptions.shouldExportSpan({ otelSpan: {
  name: "run-experiment", instrumentationScope: { name: "langfuse-sdk" },
} }), true);
assert.equal(processorOptions.shouldExportSpan({ otelSpan: {
  name: "private-unrelated-request", instrumentationScope: { name: "express" },
} }), false);
assert.deepEqual(observations.map(({ type }) => type), ["span", "tool"]);
assert.ok(observations.every(({ updates }) => updates.at(-1).level === "ERROR"));
assert.ok(!JSON.stringify(observations).includes(privateError.message));
failStart = true;
assert.equal(await traceOperation("tool", "tool", {}, async () => ++calls), 2);
failStart = false;
failUpdate = true;
assert.equal(await traceOperation("tool", "tool", {}, async () => ++calls), 3);
assert.equal(calls, 3);
