import { fingerprint, snapshot } from "./json.js";
import { requireText } from "./validation.js";
import { createHash } from "node:crypto";

export type FlowDimension = "interface" | "request" | "authorization" | "domain" | "persistence" | "effects" | "failure" | "response";
export interface FlowPlan {
  schemaVersion: "flow-plan/1";
  id: string;
  version: string;
  product: string;
  reference: string;
  checks: { id: string; dimension: FlowDimension; criterion: string; required: boolean; method: "static_analysis" | "runtime_assertion" }[];
}
export interface FlowRun {
  runId: string;
  sourceFingerprint: string;
  environment: "source_inventory" | "local_isolated" | "staging" | "production";
  planHash: string;
}
export interface FlowObservation extends FlowRun {
  checkId: string;
  status: "passed" | "failed" | "inconclusive" | "error";
  method: "static_analysis" | "runtime_assertion" | "model_suggestion";
  artifactSha256: string;
}

const dimensions = new Set<FlowDimension>(["interface", "request", "authorization", "domain", "persistence", "effects", "failure", "response"]);
const sha256 = /^[a-f0-9]{64}$/;

/** Checks supplied bytes only; this does not authenticate their source or meaning. */
export function verifyFlowArtifact(observation: Pick<FlowObservation, "artifactSha256">, bytes: Uint8Array): boolean {
  if (!sha256.test(observation.artifactSha256)) throw new TypeError("Invalid artifact SHA-256");
  return createHash("sha256").update(bytes).digest("hex") === observation.artifactSha256;
}

export function validateFlowPlan(plan: FlowPlan): FlowPlan {
  const value = snapshot(plan);
  if (value.schemaVersion !== "flow-plan/1") throw new TypeError("Unsupported flow plan version");
  for (const name of ["id", "version", "product", "reference"] as const) requireText(value[name], `plan.${name}`);
  if (!Array.isArray(value.checks) || value.checks.length === 0 || !value.checks.some(check => check.required === true)) {
    throw new TypeError("A flow needs checks and at least one required check");
  }
  const ids = new Set<string>();
  for (const check of value.checks) {
    requireText(check.id, "check.id"); requireText(check.criterion, "check.criterion");
    if (ids.has(check.id) || !dimensions.has(check.dimension) || typeof check.required !== "boolean"
      || !["static_analysis", "runtime_assertion"].includes(check.method)) throw new TypeError("Invalid or duplicate flow check");
    ids.add(check.id);
  }
  return value;
}

/** Assesses declared observations, not their remote authenticity or the truth of an artifact. */
export function assessFlow(plan: FlowPlan, run: FlowRun, observations: readonly FlowObservation[]) {
  const definition = validateFlowPlan(plan);
  requireText(run.runId, "run.runId");
  if (!sha256.test(run.sourceFingerprint) || run.planHash !== fingerprint(definition)
    || !["source_inventory", "local_isolated", "staging", "production"].includes(run.environment)) throw new TypeError("Flow run provenance does not match its plan");
  const checks = new Map(definition.checks.map(check => [check.id, check]));
  const seen = new Set<string>();
  const evidence = new Map<string, FlowObservation>();
  for (const input of observations) {
    const observation = snapshot(input);
    if (!checks.has(observation.checkId) || seen.has(observation.checkId)) throw new TypeError("Unknown or duplicate flow observation");
    seen.add(observation.checkId);
    if (!["passed", "failed", "inconclusive", "error"].includes(observation.status)
      || !["static_analysis", "runtime_assertion", "model_suggestion"].includes(observation.method)
      || !sha256.test(observation.artifactSha256)) throw new TypeError("Invalid flow evidence");
    if (observation.runId !== run.runId || observation.sourceFingerprint !== run.sourceFingerprint
      || observation.environment !== run.environment || observation.planHash !== run.planHash) throw new TypeError("Evidence belongs to a different run, source, plan or environment");
    evidence.set(observation.checkId, observation);
  }
  const rows = definition.checks.map(check => {
    const observation = evidence.get(check.id);
    const accepted = observation !== undefined && observation.method === check.method
      && !(run.environment === "source_inventory" && observation.method === "runtime_assertion");
    return {
      ...check,
      status: observation === undefined ? "not_run" as const : accepted ? observation.status : "inconclusive" as const,
      artifactSha256: observation?.artifactSha256 ?? null,
      reason: observation === undefined ? "no_evidence" : accepted ? "declared_evidence_matches_check" : "method_cannot_verify_this_check",
    };
  });
  const required = rows.filter(check => check.required);
  const counts = { passed: 0, failed: 0, inconclusive: 0, error: 0, not_run: 0 };
  for (const check of required) counts[check.status]++;
  const verdict = counts.error ? "error" : counts.failed ? "failed" : counts.passed === required.length ? "passed"
    : counts.not_run === required.length ? "not_run" : "inconclusive";
  return {
    schemaVersion: "flow-verification/1" as const, plan: definition,
    run: { runId: run.runId, sourceFingerprint: run.sourceFingerprint, environment: run.environment, planHash: run.planHash }, verdict,
    originAuthenticated: false,
    assurance: verdict !== "passed" ? "incomplete" : required.every(check => check.method === "runtime_assertion") ? "runtime_asserted" : "includes_static_checks",
    coverage: { requiredChecks: required.length, ...counts, passRate: counts.passed / required.length },
    checks: rows,
  };
}
