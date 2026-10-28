import { TextDecoder } from "node:util";
import { assessFlow, validateFlowPlan, verifyFlowArtifact } from "./flow-verification.js";
import type { FlowPlan, FlowRun, FlowObservation } from "./flow-verification.js";
import { fingerprint, snapshot } from "./json.js";

export interface NodeTestManifest {
  schemaVersion: "node-test-manifest/1";
  cases: { id: string; file: string; name: string }[];
  bindings: { checkId: string; caseIds: string[] }[];
}
export type NodeTestCaseStatus = "passed" | "failed" | "error" | "skipped" | "todo" | "inconclusive";
export interface NodeTestCaseResult { id: string; status: NodeTestCaseStatus }
export class NodeTestEvidenceError extends Error {
  constructor(public readonly code: string) { super(code); this.name = "NodeTestEvidenceError"; }
}
const fail = (code: string): never => { throw new NodeTestEvidenceError(code); };
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const sha = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(value);
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 1_000_000;
function fields(value: unknown, names: string[], code = "EVIDENCE_MALFORMED"): asserts value is Record<string, unknown> {
  if (!record(value) || Object.keys(value).length !== names.length || names.some(name => !Object.hasOwn(value, name))) fail(code);
}
function relativeFile(value: unknown): value is string {
  return typeof value === "string" && value.length <= 1024 && !/[\\:\x00-\x1f]/.test(value)
    && value.split("/").every(part => part !== "" && part !== "." && part !== ".." && !part.startsWith(".env"));
}

export function validateNodeTestRun(input: unknown): FlowRun {
  const value: unknown = snapshot(input);
  fields(value, ["runId", "sourceFingerprint", "environment", "planHash"], "EVIDENCE_RUN_MISMATCH");
  if (!id(value.runId) || !sha(value.sourceFingerprint) || !sha(value.planHash)
    || !["local_isolated", "staging", "production"].includes(value.environment as string)) fail("EVIDENCE_RUN_MISMATCH");
  return value as unknown as FlowRun;
}

export function validateNodeTestManifest(input: unknown): NodeTestManifest {
  const value: unknown = snapshot(input);
  fields(value, ["schemaVersion", "cases", "bindings"], "MANIFEST_INVALID");
  if (value.schemaVersion !== "node-test-manifest/1" || !Array.isArray(value.cases) || !value.cases.length || value.cases.length > 10_000
    || !Array.isArray(value.bindings) || !value.bindings.length || value.bindings.length > 10_000) fail("MANIFEST_INVALID");
  const ids = new Set<string>(), selectors = new Set<string>(), bound = new Set<string>(), checks = new Set<string>();
  for (const item of value.cases) {
    fields(item, ["id", "file", "name"], "MANIFEST_INVALID");
    if (!id(item.id) || !relativeFile(item.file) || typeof item.name !== "string" || !item.name.trim()
      || item.name.length > 1000 || ids.has(item.id)) fail("MANIFEST_INVALID");
    const selector = JSON.stringify([item.file, item.name]);
    if (selectors.has(selector)) fail("MANIFEST_INVALID");
    ids.add(item.id); selectors.add(selector);
  }
  for (const binding of value.bindings) {
    fields(binding, ["checkId", "caseIds"], "MANIFEST_INVALID");
    if (!id(binding.checkId) || checks.has(binding.checkId) || !Array.isArray(binding.caseIds) || !binding.caseIds.length) fail("MANIFEST_INVALID");
    checks.add(binding.checkId);
    for (const caseId of binding.caseIds) {
      if (typeof caseId !== "string" || !ids.has(caseId) || bound.has(caseId)) fail("MANIFEST_INVALID");
      bound.add(caseId);
    }
  }
  if (bound.size !== ids.size) fail("MANIFEST_INVALID");
  return value as unknown as NodeTestManifest;
}

const statuses: readonly NodeTestCaseStatus[] = ["passed", "failed", "error", "skipped", "todo", "inconclusive"];
interface Summary {
  type: "summary"; complete: boolean; success: boolean; unboundFailures: number;
  counts: { passed: number; failed: number; cancelled: number; skipped: number; todo: number; tests: number; suites: number; topLevel: number };
}

/** Validate actual bytes, then project declared runner results. Never authenticates origin or test meaning. */
export function assessNodeTestEvidence(plan: FlowPlan, context: FlowRun, mapping: NodeTestManifest,
  artifact: { artifactSha256: string; bytes: Uint8Array }) {
  const definition = validateFlowPlan(plan), run = validateNodeTestRun(context), manifest = validateNodeTestManifest(mapping);
  assessFlow(definition, run, []);
  const checks = new Map(definition.checks.map(check => [check.id, check]));
  for (const binding of manifest.bindings) if (checks.get(binding.checkId)?.method !== "runtime_assertion") fail("MANIFEST_INVALID");
  if (!(artifact.bytes instanceof Uint8Array) || !artifact.bytes.byteLength || artifact.bytes.byteLength > 4 * 1024 * 1024) fail("EVIDENCE_TOO_LARGE");
  if (!sha(artifact.artifactSha256) || !verifyFlowArtifact(artifact, artifact.bytes)) fail("EVIDENCE_HASH_MISMATCH");
  let rows: unknown[];
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(artifact.bytes);
    const lines = text.trimEnd().split("\n");
    if (lines.length > 20_000) fail("EVIDENCE_TOO_LARGE");
    rows = lines.map(line => JSON.parse(line));
  } catch (error) { if (error instanceof NodeTestEvidenceError) throw error; fail("EVIDENCE_MALFORMED"); }
  if (rows.length < 2) fail("EVIDENCE_INCOMPLETE");
  const header = rows[0];
  fields(header, ["type", "schemaVersion", "run", "manifestHash", "producer"]);
  if (header.type !== "run" || header.schemaVersion !== "node-test-evidence/1") fail("EVIDENCE_MALFORMED");
  if (fingerprint(validateNodeTestRun(header.run)) !== fingerprint(run)) fail("EVIDENCE_RUN_MISMATCH");
  const manifestHash = fingerprint(manifest);
  if (header.manifestHash !== manifestHash) fail("EVIDENCE_MANIFEST_MISMATCH");
  fields(header.producer, ["kind", "node", "recordedAt"]);
  if (header.producer.kind !== "node:test" || typeof header.producer.node !== "string" || !/^v24\.\d+\.\d+$/.test(header.producer.node)) fail("UNSUPPORTED_NODE_VERSION");
  if (typeof header.producer.recordedAt !== "string" || !Number.isFinite(Date.parse(header.producer.recordedAt))) fail("EVIDENCE_MALFORMED");
  const allowedCases = new Set(manifest.cases.map(item => item.id));
  const results = new Map<string, NodeTestCaseResult>();
  let summary: Summary | undefined;
  for (const row of rows.slice(1)) {
    if (summary !== undefined) fail("EVIDENCE_AMBIGUOUS");
    if (record(row) && row.type === "case") {
      fields(row, ["type", "id", "status"]);
      if (typeof row.id !== "string" || !allowedCases.has(row.id) || !statuses.includes(row.status as NodeTestCaseStatus)) fail("EVIDENCE_MALFORMED");
      if (results.has(row.id)) fail("EVIDENCE_AMBIGUOUS");
      results.set(row.id, { id: row.id, status: row.status as NodeTestCaseStatus });
    } else if (record(row) && row.type === "summary") {
      fields(row, ["type", "complete", "success", "unboundFailures", "counts"]);
      if (row.complete !== true) fail("EVIDENCE_INCOMPLETE");
      if (typeof row.success !== "boolean" || !integer(row.unboundFailures)) fail("EVIDENCE_MALFORMED");
      fields(row.counts, ["passed", "failed", "cancelled", "skipped", "todo", "tests", "suites", "topLevel"]);
      if (!Object.values(row.counts).every(integer)) fail("EVIDENCE_MALFORMED");
      summary = row as unknown as Summary;
    } else fail("EVIDENCE_MALFORMED");
  }
  if (!summary) fail("EVIDENCE_INCOMPLETE");
  const cases = [...results.values()];
  const count = (status: NodeTestCaseStatus) => cases.filter(item => item.status === status).length;
  if (summary.unboundFailures > 0 || (!summary.success && count("failed") + count("error") === 0)) fail("UNBOUND_TEST_FAILURE");
  if (summary.counts.tests < cases.length || count("passed") > summary.counts.passed || count("failed") > summary.counts.failed
    || count("skipped") > summary.counts.skipped || count("todo") > summary.counts.todo
    || count("error") > summary.counts.failed + summary.counts.cancelled
    || (summary.success && (summary.counts.failed > 0 || summary.counts.cancelled > 0 || count("failed") + count("error") > 0))) fail("EVIDENCE_MALFORMED");
  const observations: FlowObservation[] = [];
  for (const binding of manifest.bindings) {
    const observed = binding.caseIds.map(caseId => results.get(caseId));
    if (observed.every(item => item === undefined)) continue;
    const status = observed.some(item => item?.status === "error") ? "error"
      : observed.some(item => item?.status === "failed") ? "failed"
      : observed.every(item => item?.status === "passed") ? "passed" : "inconclusive";
    observations.push({ ...run, checkId: binding.checkId, status, method: "runtime_assertion", artifactSha256: artifact.artifactSha256 });
  }
  return { schemaVersion: "node-test-flow-assessment/1" as const,
    flow: assessFlow(definition, run, observations), artifactSha256: artifact.artifactSha256,
    manifestHash, producer: snapshot(header.producer), cases, summary: snapshot(summary),
    limitations: ["Artifact integrity does not authenticate the runner or prove what a test asserts.",
      "Only explicitly registered top-level leaf tests can supply runtime observations."] };
}
