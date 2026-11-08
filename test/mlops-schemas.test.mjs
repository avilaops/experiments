import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";

const root = new URL("../schemas/mlops/", import.meta.url);
const names = [
  "evaluation-request.v1.schema.json",
  "evidence-envelope.v1.schema.json",
  "evaluation-result.v1.schema.json",
  "policy-decision.v1.schema.json",
  "deployment-gate.v1.schema.json",
];

const valid = {
  "evaluation-request.v1.schema.json": {
    schemaVersion: "evaluation-request/1", requestId: "req-1",
    project: { id: "auth", repository: "avilaops/auth.avilaops.com", product: "auth" },
    revision: { commit: "a".repeat(40), sourceFingerprint: "b".repeat(64) },
    suite: { id: "auth-contract", version: "1" }, environment: "staging",
    trigger: { kind: "pull_request", externalId: "125" }, requestedAt: "2026-11-06T12:00:00Z",
    requestedBy: { kind: "github_action", id: "github-actions" }, callback: { kind: "github_check" },
  },
  "evidence-envelope.v1.schema.json": {
    schemaVersion: "evidence-envelope/1", evidenceId: "ev-1", requestId: "req-1",
    project: { id: "auth", repository: "avilaops/auth.avilaops.com", product: "auth" },
    revision: { commit: "a".repeat(40), sourceFingerprint: "b".repeat(64) },
    run: { runId: "run-1", environment: "staging", startedAt: "2026-11-06T12:00:00Z", completedAt: "2026-11-06T12:01:00Z" },
    producer: { kind: "github_actions", name: "auth-contract", version: "1", recordedAt: "2026-11-06T12:01:00Z" },
    artifact: { sha256: "c".repeat(64), mediaType: "application/json", bytes: 10, uri: "artifact://run-1/report.json" },
    observations: [{ checkId: "contract", status: "passed", method: "runtime_assertion", artifactSha256: "c".repeat(64), observedAt: "2026-11-06T12:01:00Z" }],
    originAuthenticated: false, limitations: ["Hash does not authenticate producer."],
  },
  "evaluation-result.v1.schema.json": {
    schemaVersion: "evaluation-result/1", evaluationId: "eval-1", requestId: "req-1",
    project: { id: "auth", repository: "avilaops/auth.avilaops.com", product: "auth" },
    revision: { commit: "a".repeat(40), sourceFingerprint: "b".repeat(64) },
    suite: { id: "auth-contract", version: "1" }, runId: "run-1", status: "passed",
    startedAt: "2026-11-06T12:00:00Z", completedAt: "2026-11-06T12:01:00Z",
    summary: { requiredChecks: 1, passed: 1, failed: 0, inconclusive: 0, error: 0, notRun: 0, passRate: 1 },
    checks: [{ id: "contract", dimension: "interface", criterion: "Contract is valid", required: true, method: "runtime_assertion", status: "passed", artifactSha256: "c".repeat(64) }],
    evidenceIds: ["ev-1"], assurance: "runtime_asserted", limitations: [],
  },
  "policy-decision.v1.schema.json": {
    schemaVersion: "policy-decision/1", decisionId: "decision-1", requestId: "req-1", evaluationId: "eval-1",
    project: { id: "auth", repository: "avilaops/auth.avilaops.com", product: "auth" },
    revision: { commit: "a".repeat(40), sourceFingerprint: "b".repeat(64) },
    policy: { id: "auth-production", version: "1" }, decision: "review",
    humanApproval: { required: true, status: "pending" }, reasons: [{ code: "HUMAN_APPROVAL_REQUIRED", message: "Sensitive authentication change." }],
    decidedAt: "2026-11-06T12:02:00Z", decidedBy: { kind: "system", id: "mlops-policy" },
  },
  "deployment-gate.v1.schema.json": {
    schemaVersion: "deployment-gate/1", gateId: "gate-1", requestId: "req-1",
    project: { id: "auth", repository: "avilaops/auth.avilaops.com", product: "auth" },
    revision: { commit: "a".repeat(40), sourceFingerprint: "b".repeat(64) },
    target: { application: "auth", environment: "production" }, policyDecisionId: "decision-1",
    status: "blocked", allowed: false, createdAt: "2026-11-06T12:02:00Z",
    expiresAt: null, checks: [{ id: "human-approval", status: "inconclusive", required: true, reason: "Approval pending." }],
    postDeploy: { healthCheckRequired: true, rollbackOnFailure: true, healthCheckReference: "auth-health" },
  },
};

test("compiles and accepts the official MLOps schemas", async () => {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  for (const name of names) {
    const schema = JSON.parse(await readFile(new URL(name, root), "utf8"));
    const validate = ajv.compile(schema);
    assert.equal(validate(valid[name]), true, `${name}: ${ajv.errorsText(validate.errors)}`);
  }
});

test("rejects unknown fields in the official MLOps schemas", async () => {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  for (const name of names) {
    const schema = JSON.parse(await readFile(new URL(name, root), "utf8"));
    const validate = ajv.compile(schema);
    assert.equal(validate({ ...valid[name], unexpected: true }), false, name);
  }
});
