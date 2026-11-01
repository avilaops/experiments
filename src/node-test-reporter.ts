import { readFile } from "node:fs/promises";
import path from "node:path";
import { fingerprint } from "./json.js";
import { validateNodeTestManifest, validateNodeTestRun, NodeTestEvidenceError } from "./node-test-evidence.js";
import type { NodeTestCaseStatus } from "./node-test-evidence.js";

type Event = { type: string; data: Record<string, unknown> };
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const line = (value: unknown) => JSON.stringify(value) + "\n";
const marked = (value: unknown) => value !== undefined && value !== false;

/** IDs/status only: logs, diagnostic messages, exceptions and test payloads never leave this reporter. */
export default async function* nodeTestReporter(events: AsyncIterable<Event>) {
  let config: Record<string, unknown>;
  try {
    const file = process.env.EXPERIMENTS_NODE_TEST_CONFIG;
    if (!file) throw new Error();
    const bytes = await readFile(file);
    if (bytes.byteLength > 4 * 1024 * 1024) throw new Error();
    const value: unknown = JSON.parse(bytes.toString("utf8"));
    if (!record(value) || Object.keys(value).length !== 2 || !Object.hasOwn(value, "run") || !Object.hasOwn(value, "manifest")) throw new Error();
    config = value;
  } catch { throw new NodeTestEvidenceError("EVIDENCE_CONFIG_INVALID"); }
  const run = validateNodeTestRun(config.run), manifest = validateNodeTestManifest(config.manifest);
  yield line({ type: "run", schemaVersion: "node-test-evidence/1", run, manifestHash: fingerprint(manifest),
    producer: { kind: "node:test", node: process.version, recordedAt: new Date().toISOString() } });
  const selected = new Map(manifest.cases.map(item => [JSON.stringify([item.file, item.name]), item.id]));
  const parents = new Set<string>();
  let unboundFailures = 0, unsupportedExecution = false;
  for await (const event of events) {
    const data = event.data;
    if (event.type === "test:interrupted" || event.type.startsWith("test:watch:")) unsupportedExecution = true;
    if (event.type === "test:plan" && typeof data.nesting === "number" && data.nesting > 0 && typeof data.file === "string") parents.add(data.file);
    if (event.type === "test:pass" || event.type === "test:fail") {
      const details = record(data.details) ? data.details : {};
      if (details.attempt !== undefined || details.passed_on_attempt !== undefined) unsupportedExecution = true;
      const file = typeof data.file === "string" ? path.relative(process.cwd(), data.file).split(path.sep).join("/") : "";
      const caseId = data.nesting === 0 ? selected.get(JSON.stringify([file, data.name])) : undefined;
      const parent = details.type === "suite" || (typeof data.file === "string" && parents.has(data.file));
      const error = record(details.error) ? details.error : {};
      const cancelled = ["cancelledByParent", "testTimeoutFailure", "testAborted"].includes(error.failureType as string);
      const status: NodeTestCaseStatus = marked(data.skip) ? "skipped" : marked(data.todo) ? "todo"
        : parent ? "inconclusive" : event.type === "test:pass" ? "passed" : cancelled ? "error" : "failed";
      if (caseId) yield line({ type: "case", id: caseId, status });
      else if (status === "failed" || status === "error") unboundFailures++;
      if (data.nesting === 0 && typeof data.file === "string") parents.delete(data.file);
    }
    if (event.type === "test:summary" && data.file === undefined) {
      const counts = record(data.counts) ? data.counts : {};
      yield line({ type: "summary", complete: !unsupportedExecution, success: data.success, unboundFailures,
        counts: { passed: counts.passed, failed: counts.failed, cancelled: counts.cancelled, skipped: counts.skipped,
          todo: counts.todo, tests: counts.tests, suites: counts.suites, topLevel: counts.topLevel } });
    }
  }
}
