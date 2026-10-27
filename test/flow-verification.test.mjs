import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { assessFlow, fingerprint, validateFlowPlan, verifyFlowArtifact } from "../dist/index.js";
import { createHash } from "node:crypto";
import { analyzeHandlers, apiOperations, handlerMethods, inventoryWeb, routePath } from "../scripts/inventory-erp-routes.mjs";

const plan = () => ({ schemaVersion: "flow-plan/1", id: "product", version: "1", product: "ERP", reference: "test-fixture",
  checks: ["interface", "request", "authorization", "domain", "persistence", "effects", "failure", "response"].map(dimension => ({
    id: dimension, dimension, criterion: `Assert ${dimension}`, required: true, method: "runtime_assertion",
  })) });
const context = definition => ({ runId: "local-test", sourceFingerprint: "1".repeat(64), environment: "local_isolated", planHash: fingerprint(definition) });
const evidence = (definition, run, method = "runtime_assertion") => definition.checks.map(check => ({
  ...run, checkId: check.id, method, status: "passed", artifactSha256: "2".repeat(64),
}));

test("route presence without observations leaves every required flow dimension untested", () => {
  const definition = plan();
  const report = assessFlow(definition, context(definition), []);
  assert.equal(report.verdict, "not_run");
  assert.equal(report.coverage.not_run, 8);
  assert.equal(report.coverage.passRate, 0);
  assert.equal(report.assurance, "incomplete");
});

test("matching runtime assertions can pass only the named run and environment without authenticating origin", () => {
  const definition = plan(); const run = context(definition);
  const report = assessFlow(definition, run, evidence(definition, run));
  assert.equal(report.verdict, "passed");
  assert.equal(report.coverage.passed, 8);
  assert.equal(report.assurance, "runtime_asserted");
  assert.equal(report.originAuthenticated, false);
});

test("static evidence and model suggestions cannot approve runtime checks", () => {
  const definition = plan(); const run = context(definition);
  for (const method of ["static_analysis", "model_suggestion"]) {
    const report = assessFlow(definition, run, evidence(definition, run, method));
    assert.equal(report.verdict, "inconclusive");
    assert.equal(report.coverage.inconclusive, 8);
    assert.equal(report.coverage.passed, 0);
  }
});

test("a source inventory cannot be presented as an executed business flow", () => {
  const definition = plan(); const run = { ...context(definition), environment: "source_inventory" };
  assert.equal(assessFlow(definition, run, evidence(definition, run)).verdict, "inconclusive");
});

test("missing checks, failures and execution errors remain visible in the denominator", () => {
  const definition = plan(); const run = context(definition);
  const observations = evidence(definition, run).slice(0, 2);
  assert.equal(assessFlow(definition, run, observations).coverage.not_run, 6);
  observations[0].status = "failed";
  assert.equal(assessFlow(definition, run, observations).verdict, "failed");
  observations[0].status = "error";
  assert.equal(assessFlow(definition, run, observations).verdict, "error");
});

test("evidence cannot be mixed across commits, runs, plans or environments", () => {
  const definition = plan(); const run = context(definition);
  for (const change of [value => { value.runId = "other"; }, value => { value.sourceFingerprint = "3".repeat(64); },
    value => { value.environment = "production"; }, value => { value.planHash = "3".repeat(64); }]) {
    const observations = evidence(definition, run); change(observations[0]);
    assert.throws(() => assessFlow(definition, run, observations), /different/);
  }
});

test("duplicate observations, missing artifact hashes and invalid plans are refused", () => {
  const definition = plan(); const run = context(definition);
  const observations = evidence(definition, run);
  assert.throws(() => assessFlow(definition, run, [...observations, observations[0]]), /duplicate/);
  observations[0].artifactSha256 = "";
  assert.throws(() => assessFlow(definition, run, observations), /evidence/);
  const invalid = plan(); invalid.checks.push(invalid.checks[0]);
  assert.throws(() => validateFlowPlan(invalid), /duplicate/);
});

test("unknown IDs, invalid status/hash, modified plans and contradictory verdicts are explicit", () => {
  const definition = plan(), run = context(definition);
  for (const mutate of [value => { value.checkId = "unknown"; }, value => { value.status = "approved"; },
    value => { value.artifactSha256 = "z".repeat(64); }]) {
    const observations = evidence(definition, run); mutate(observations[0]);
    assert.throws(() => assessFlow(definition, run, observations));
  }
  const modified = plan(); modified.checks[0].criterion = "changed";
  assert.throws(() => assessFlow(modified, run, []), /provenance/);
  const observations = evidence(definition, run).slice(0, 3);
  observations[0].status = "failed"; observations[1].status = "error";
  let result = assessFlow(definition, run, observations);
  assert.equal(result.verdict, "error"); assert.equal(result.coverage.not_run, 5);
  observations[1].status = "inconclusive";
  result = assessFlow(definition, run, observations);
  assert.equal(result.verdict, "failed");
});

test("a well-formed artifact hash is a declaration, not verified bytes or an ERP authorization test", () => {
  const definition = plan(), run = context(definition);
  const result = assessFlow(definition, run, evidence(definition, run));
  assert.equal(result.originAuthenticated, false);
  assert.equal(result.checks.find(check => check.dimension === "authorization").reason, "declared_evidence_matches_check");
});

test("artifact verification recomputes the digest from supplied bytes and detects altered content", () => {
  const bytes = Buffer.from("observed test output\n");
  const artifact = { artifactSha256: createHash("sha256").update(bytes).digest("hex") };
  assert.equal(verifyFlowArtifact(artifact, bytes), true);
  assert.equal(verifyFlowArtifact(artifact, Buffer.from("changed output\n")), false);
  assert.equal(verifyFlowArtifact({ artifactSha256: "2".repeat(64) }, bytes), false);
  assert.throws(() => verifyFlowArtifact({ artifactSha256: "invalid" }, bytes), /SHA-256/);
});

test("advisory checks do not erase required failures or increase the required denominator", () => {
  const definition = plan(); definition.checks.push({ id: "optional", dimension: "interface", criterion: "Optional", required: false, method: "static_analysis" });
  const run = context(definition); const observations = evidence(definition, run);
  observations[0].status = "failed";
  const report = assessFlow(definition, run, observations);
  assert.equal(report.verdict, "failed");
  assert.equal(report.coverage.requiredChecks, 8);
});

test("handler extraction reads exports through the TypeScript AST, including aliases", () => {
  const source = `// export const DELETE = fake
    const description = 'export function PATCH() {}';
    function local() { const POST = 1; }
    export const GET = () => null;
    export async function PUT() {}
    export { local as POST };
    export type { HEAD } from './types';`;
  assert.deepEqual(handlerMethods(source), ["GET", "POST", "PUT"]);
  assert.equal(analyzeHandlers("export * from './other'").review[0].reason, "wildcard_export_not_resolved");
});

test("route groups are normalized and parallel/intercepted routes require review", () => {
  assert.equal(routePath("(private)/products/[id]/page.tsx"), "/products/[id]");
  assert.equal(routePath("page.tsx"), "/");
  assert.throws(() => routePath("@slot/products/page.tsx"), /PARALLEL_OR_INTERCEPTED/);
  assert.throws(() => routePath("(.)products/page.tsx"), /PARALLEL_OR_INTERCEPTED/);
});

test("OpenAPI paths are counted as declarations and do not become functional evidence", async () => {
  const result = await apiOperations({ openapi: "3.1.0", info: { title: "Test", version: "1" }, paths: { "/products": { parameters: [], get: { responses: { 200: { description: "OK" } } }, post: { responses: { 200: { description: "OK" } } } } } });
  assert.deepEqual(result, [{ path: "/products", pattern: "/products", methods: ["GET", "POST"], verification: "not_run" }]);
  for (const paths of [{ "/bad": [] }, { "/bad": { $ref: "external" } }, { "/bad": { get: null } }]) {
    await assert.rejects(apiOperations({ openapi: "3.1.0", paths }));
  }
});

test("filesystem inventory preserves source hashes and excludes private folders", async t => {
  const root = await mkdtemp(path.join(tmpdir(), "route-inventory-"));
  t.after(async () => {
    assert.equal(path.dirname(root), tmpdir());
    assert.ok(path.basename(root).startsWith("route-inventory-"));
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(path.join(root, "api", "products"), { recursive: true });
  await mkdir(path.join(root, "_private"));
  await writeFile(path.join(root, "page.tsx"), "export default function Page() { return null }");
  await writeFile(path.join(root, "api", "products", "route.ts"), "export const GET = () => null;");
  await writeFile(path.join(root, "_private", "page.tsx"), "private");
  const inventory = await inventoryWeb(root);
  assert.equal(inventory.pages.length, 1);
  assert.deepEqual(inventory.handlers[0].methods, ["GET"]);
  assert.match(inventory.pages[0].sha256, /^[a-f0-9]{64}$/);
  assert.equal(inventory.pages[0].verification, "not_run");
});
