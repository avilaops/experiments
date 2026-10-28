import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { fingerprint } from "../dist/index.js";

const adapter = await import("../dist/node-test-evidence.js").catch(() => null);
const definition = () => ({ schemaVersion: "flow-plan/1", id: "engineering-fixture", version: "1", product: "synthetic",
  reference: "Synthetic fixture, not a product verification",
  checks: ["interface", "request", "authorization", "domain", "persistence", "effects", "failure", "response"]
    .map(dimension => ({ id: dimension, dimension, criterion: `Assert ${dimension}`, required: true, method: "runtime_assertion" })) });
const config = () => {
  const plan = definition();
  const run = { runId: "ci-synthetic", sourceFingerprint: "1".repeat(64), environment: "local_isolated", planHash: fingerprint(plan) };
  const manifest = { schemaVersion: "node-test-manifest/1",
    cases: plan.checks.map(check => ({ id: check.id, file: "fixture.test.mjs", name: `case-${check.id}` })),
    bindings: plan.checks.map(check => ({ checkId: check.id, caseIds: [check.id] })) };
  return { plan, run, manifest };
};
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
function assess(configuration, bytes, sha = digest(bytes)) {
  assert.ok(adapter, "Node test evidence adapter is not implemented");
  return adapter.assessNodeTestEvidence(configuration.plan, configuration.run, configuration.manifest, { artifactSha256: sha, bytes });
}

async function execute(configuration, source, callback) {
  assert.ok(adapter, "Node test evidence adapter is not implemented");
  const directory = await mkdtemp(path.join(tmpdir(), "experiments-node-evidence-"));
  try {
    await writeFile(path.join(directory, "fixture.test.mjs"), source);
    await writeFile(path.join(directory, "evidence-config.json"), JSON.stringify({ run: configuration.run, manifest: configuration.manifest }));
    const reporter = fileURLToPath(new URL("../dist/node-test-reporter.js", import.meta.url));
    const childEnvironment = { ...process.env, EXPERIMENTS_NODE_TEST_CONFIG: path.join(directory, "evidence-config.json") };
    // O contexto interno do executor pai desabilita o isolamento do executor
    // filho; ele precisa iniciar uma execução real, independente.
    delete childEnvironment.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, ["--test", "--test-reporter", reporter, "fixture.test.mjs"], {
      cwd: directory, encoding: "utf8", timeout: 15_000,
      env: childEnvironment,
    });
    await callback({ result, bytes: Buffer.from(result.stdout), directory });
  } finally { await rm(directory, { recursive: true, force: true }); }
}
const allPass = configuration => `import test from 'node:test'; import assert from 'node:assert/strict';\n${configuration.manifest.cases.map(item => `test(${JSON.stringify(item.name)}, () => assert.equal(2+2,4));`).join("\n")}`;

test("real node:test results bind all checks without authenticating their origin", async () => {
  const configuration = config();
  await execute(configuration, allPass(configuration), async ({ result, bytes }) => {
    assert.equal(result.status, 0, result.stderr);
    const report = assess(configuration, bytes);
    assert.equal(report.flow.verdict, "passed");
    assert.equal(report.flow.coverage.passed, 8);
    assert.equal(report.flow.originAuthenticated, false);
    assert.equal(report.artifactSha256, digest(bytes));
  });
});

test("real failures, skip and todo retain the required denominator", async () => {
  const configuration = config();
  await execute(configuration, `import test from 'node:test'; import assert from 'node:assert/strict';
    test('case-interface', () => assert.fail('not implemented'));
    test('case-request', {skip: true}, () => {});
    test('case-authorization', {todo: true}, () => {});`, async ({ result, bytes }) => {
    assert.equal(result.status, 1);
    const report = assess(configuration, bytes).flow;
    assert.equal(report.verdict, "failed");
    assert.equal(report.coverage.requiredChecks, 8);
    assert.equal(report.coverage.failed, 1);
    assert.equal(report.coverage.inconclusive, 2);
    assert.equal(report.coverage.not_run, 5);
  });
});

test("logs, diagnostics and assertion payloads do not enter the artifact", async () => {
  const configuration = config();
  const secret = "SYNTHETIC-SENTINEL-DO-NOT-EXPORT";
  await execute(configuration, `import test from 'node:test'; import assert from 'node:assert/strict';
    test('case-interface', t => {console.log('${secret}'); console.error('${secret}'); t.diagnostic('${secret}'); assert.fail('${secret}');});`, async ({ result, bytes }) => {
    assert.equal(result.status, 1);
    assert.equal(bytes.toString().includes(secret), false);
    assert.equal(assess(configuration, bytes).flow.coverage.failed, 1);
  });
});

test("byte hash, run, source, environment, plan and manifest cannot be mixed", async () => {
  const configuration = config();
  await execute(configuration, allPass(configuration), async ({ result, bytes }) => {
    assert.equal(result.status, 0, result.stderr);
    assert.throws(() => assess(configuration, Buffer.concat([bytes, Buffer.from(" ")]), digest(bytes)), /HASH_MISMATCH/);
    for (const field of ["runId", "sourceFingerprint", "environment", "planHash"]) {
      const changed = structuredClone(configuration);
      changed.run[field] = field === "environment" ? "staging" : field === "runId" ? "another-run" : "2".repeat(64);
      assert.throws(() => assess(changed, bytes));
    }
    const changed = structuredClone(configuration);
    changed.manifest.cases[0].name = "different-test";
    assert.throws(() => assess(changed, bytes), /MANIFEST_MISMATCH/);
  });
});

test("truncation and a failed test outside the manifest cannot produce approval", async () => {
  const configuration = config();
  await execute(configuration, allPass(configuration), async ({ result, bytes }) => {
    assert.equal(result.status, 0, result.stderr);
    const truncated = Buffer.from(bytes.toString().trim().split("\n").slice(0, -1).join("\n") + "\n");
    assert.throws(() => assess(configuration, truncated), /INCOMPLETE/);
  });
  await execute(configuration, allPass(configuration) + "\ntest('unmapped', () => assert.fail('hidden failure'));", async ({ result, bytes }) => {
    assert.equal(result.status, 1);
    assert.throws(() => assess(configuration, bytes), /UNBOUND_TEST_FAILURE/);
  });
});

test("duplicate test names and parent/suite results cannot silently verify a leaf", async () => {
  const configuration = config();
  await execute(configuration, "import test from 'node:test'; test('case-interface',()=>{}); test('case-interface',()=>{});", async ({ result, bytes }) => {
    assert.equal(result.status, 0, result.stderr);
    assert.throws(() => assess(configuration, bytes), /AMBIGUOUS/);
  });
  await execute(configuration, "import test from 'node:test'; test('case-interface', async t => {await t.test('nested',()=>{});});", async ({ result, bytes }) => {
    assert.equal(result.status, 0, result.stderr);
    assert.notEqual(assess(configuration, bytes).flow.verdict, "passed");
    assert.equal(assess(configuration, bytes).flow.coverage.passed, 0);
  });
});

test("a test cannot be reused for multiple checks and unknown check IDs are rejected", async () => {
  const configuration = config();
  await execute(configuration, allPass(configuration), async ({ result, bytes }) => {
    assert.equal(result.status, 0, result.stderr);
    const changed = structuredClone(configuration);
    changed.manifest.bindings[1].caseIds = ["interface"];
    assert.throws(() => assess(changed, bytes), /MANIFEST/);
    const unknown = structuredClone(configuration);
    unknown.manifest.bindings[0].checkId = "unknown";
    assert.throws(() => assess(unknown, bytes), /MANIFEST/);
  });
});
