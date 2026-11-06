import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const projectRoot = path.resolve(process.env.MLOPS_PROJECT_ROOT ?? packageRoot);
const outputRoot = path.resolve(process.env.MLOPS_REPORT_DIR ?? path.join(projectRoot, "reports/mlops-ci"));
const schemaRoot = pathToFileURL(path.resolve(process.env.MLOPS_SCHEMA_ROOT ?? path.join(packageRoot, "schemas/mlops")) + path.sep);
const now = () => new Date().toISOString();

const schemaFiles = {
  request: "evaluation-request.v1.schema.json",
  evidence: "evidence-envelope.v1.schema.json",
  result: "evaluation-result.v1.schema.json",
};

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sourceFingerprint() {
  const files = execFileSync("git", ["ls-files", "-z"], { cwd: projectRoot }).toString("utf8").split("\0").filter(Boolean);
  const digest = createHash("sha256");
  for (const relative of files) {
    const absolute = path.join(projectRoot, relative);
    digest.update(relative.replaceAll("\\", "/"));
    digest.update("\0");
    if (!existsSync(absolute)) {
      digest.update("<deleted>");
      digest.update("\0");
      continue;
    }
    const bytes = readFileSync(absolute);
    digest.update(bytes);
    digest.update("\0");
  }
  return digest.digest("hex");
}

function event() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) return {};
  return JSON.parse(readFileSync(eventPath, "utf8"));
}

function commit() {
  return (process.env.MLOPS_COMMIT || process.env.GITHUB_SHA || execFileSync("git", ["rev-parse", "HEAD"], { cwd: projectRoot }).toString("utf8").trim()).toLowerCase();
}

function repository() {
  return process.env.GITHUB_REPOSITORY || "avilaops/experiments";
}

function project() {
  const repo = repository();
  return { id: repo.split("/").at(-1), repository: repo, product: process.env.MLOPS_PRODUCT || "experiments" };
}

function revision() {
  const value = commit();
  if (!/^[a-f0-9]{40,64}$/.test(value)) throw new Error("GITHUB_SHA must be a hexadecimal Git commit");
  return { commit: value, sourceFingerprint: sourceFingerprint(), branch: process.env.GITHUB_REF_NAME || undefined, pullRequestNumber: event().pull_request?.number ?? null };
}

function trigger() {
  const kind = { pull_request: "pull_request", push: "push", workflow_dispatch: "workflow_dispatch" }[process.env.GITHUB_EVENT_NAME] || "manual";
  const workflowRun = process.env.GITHUB_RUN_ID;
  return { kind, ...(workflowRun ? { externalId: workflowRun } : {}) };
}

function requestDocument() {
  const requestedAt = now();
  const runId = process.env.GITHUB_RUN_ID || `local-${Date.now()}`;
  const actor = process.env.GITHUB_ACTOR || "local";
  return {
    schemaVersion: "evaluation-request/1",
    requestId: `github-${runId}`,
    project: project(),
    revision: revision(),
    suite: { id: process.env.MLOPS_SUITE_ID || "experiments-ci", version: process.env.MLOPS_SUITE_VERSION || "1" },
    environment: "local_isolated",
    trigger: trigger(),
    requestedAt,
    requestedBy: { kind: process.env.GITHUB_ACTIONS ? "github_action" : "system", id: actor },
    callback: { kind: "github_check", reference: `${repository()}#${runId}` },
  };
}

function resultStatus(outcome) {
  return { success: "passed", failure: "failed", cancelled: "cancelled", skipped: "inconclusive" }[outcome] || "error";
}

function resultDocuments(request, outcome, logBytes) {
  const completedAt = now();
  const status = resultStatus(outcome);
  const artifactSha256 = sha256(logBytes);
  const runId = process.env.GITHUB_RUN_ID || request.requestId;
  const checkStatus = status === "passed" ? "passed" : status === "failed" ? "failed" : status === "cancelled" ? "error" : "inconclusive";
  const evidenceId = `evidence-${runId}`;
  const productId = request.project.product;
  const checkId = `${productId}-test-suite`;
  const evidence = {
    schemaVersion: "evidence-envelope/1",
    evidenceId,
    requestId: request.requestId,
    project: request.project,
    revision: request.revision,
    run: { runId, environment: request.environment, startedAt: request.requestedAt, completedAt },
    producer: { kind: "github_actions", name: request.suite.id, version: request.suite.version, recordedAt: completedAt },
    artifact: { sha256: artifactSha256, mediaType: "text/plain", bytes: logBytes.byteLength, uri: `artifact://mlops-${runId}/test-output.log` },
    observations: [{ checkId, status: checkStatus, method: "runtime_assertion", artifactSha256, observedAt: completedAt }],
    originAuthenticated: false,
    limitations: ["The document records the declared workflow outcome; the hash does not authenticate the runner or prove test coverage."],
  };
  const result = {
    schemaVersion: "evaluation-result/1",
    evaluationId: `evaluation-${runId}`,
    requestId: request.requestId,
    project: request.project,
    revision: request.revision,
    suite: request.suite,
    runId,
    status,
    startedAt: request.requestedAt,
    completedAt,
    summary: { requiredChecks: 1, passed: checkStatus === "passed" ? 1 : 0, failed: checkStatus === "failed" ? 1 : 0, inconclusive: checkStatus === "inconclusive" ? 1 : 0, error: checkStatus === "error" ? 1 : 0, notRun: 0, passRate: checkStatus === "passed" ? 1 : 0 },
    checks: [{ id: checkId, dimension: "quality", criterion: `The ${productId} CI test suite completes successfully`, required: true, method: "runtime_assertion", status: checkStatus, artifactSha256, reason: `workflow outcome: ${outcome}` }],
    evidenceIds: [evidenceId],
    assurance: checkStatus === "passed" ? "runtime_asserted" : "incomplete",
    limitations: [`This result covers the ${productId} CI suite only; it does not authorize deployment or assert another product's business behavior.`],
  };
  return { evidence, result };
}

async function validate(kind, document) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const schema = JSON.parse(await readFile(new URL(schemaFiles[kind], schemaRoot), "utf8"));
  const validate = ajv.compile(schema);
  if (!validate(document)) throw new Error(`${schemaFiles[kind]}: ${ajv.errorsText(validate.errors)}`);
}

async function writeJson(name, value) {
  await mkdir(outputRoot, { recursive: true });
  await writeFile(path.join(outputRoot, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

const command = process.argv[2];
if (command === "request") {
  const document = requestDocument();
  await validate("request", document);
  await writeJson("evaluation-request.json", document);
} else if (command === "result") {
  const request = JSON.parse(await readFile(path.join(outputRoot, "evaluation-request.json"), "utf8"));
  const logPath = path.resolve(process.env.MLOPS_TEST_LOG ?? path.join(outputRoot, "test-output.log"));
  const logBytes = readFileSync(logPath);
  const { evidence, result } = resultDocuments(request, process.env.MLOPS_TEST_OUTCOME || "error", logBytes);
  await validate("evidence", evidence);
  await validate("result", result);
  await writeJson("evidence-envelope.json", evidence);
  await writeJson("evaluation-result.json", result);
} else {
  throw new Error("Usage: node scripts/ci-mlops.mjs request|result");
}
