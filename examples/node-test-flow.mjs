import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assessNodeTestEvidence, fingerprint } from "../dist/index.js";

// Engineering fixture only: file reads/writes in a new private directory.
const project = fileURLToPath(new URL("..", import.meta.url));
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const plan = { schemaVersion: "flow-plan/1", id: "node-test-engineering-fixture", version: "1", product: "synthetic",
  reference: "Synthetic filesystem checks; not an ERP/Lojas/business-flow verification",
  checks: [
    { id: "input", dimension: "request", criterion: "Read the known synthetic input without changing it", required: true, method: "runtime_assertion" },
    { id: "receipt", dimension: "effects", criterion: "Create one synthetic receipt exclusively and refuse a second creation", required: true, method: "runtime_assertion" },
  ] };
const manifest = { schemaVersion: "node-test-manifest/1", cases: [
  { id: "input-file", file: "fixture.test.mjs", name: "reads synthetic input" },
  { id: "exclusive-receipt", file: "fixture.test.mjs", name: "creates receipt exclusively" },
], bindings: [{ checkId: "input", caseIds: ["input-file"] }, { checkId: "receipt", caseIds: ["exclusive-receipt"] }] };

async function main() {
  const sourceHead = execFileSync("git", ["-C", project, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const sources = [];
  for (const file of ["src/node-test-evidence.ts", "src/node-test-reporter.ts", "src/flow-verification.ts", "src/json.ts", "examples/node-test-flow.mjs"]) {
    sources.push({ path: file, sha256: sha256(await readFile(path.join(project, file))) });
  }
  const runId = `node-test-${randomUUID()}`;
  const output = path.resolve(process.argv[2] ?? path.join(project, "reports/node-test-evidence"), runId);
  await mkdir(output, { recursive: true });
  const scenarios = [];
  for (const [name, expected, exit] of [["passed", "passed", 0], ["failed", "failed", 1], ["skipped", "inconclusive", 0], ["missing", "inconclusive", 0]]) {
    const directory = path.join(output, name);
    await mkdir(directory);
    const first = "test('reads synthetic input', () => assert.deepEqual(JSON.parse(readFileSync('input.json','utf8')), {value:42}));";
    const second = name === "missing" ? "" : name === "failed" ? "test('creates receipt exclusively', () => assert.fail('deliberate synthetic failure'));"
      : name === "skipped" ? "test('creates receipt exclusively', {skip:true}, () => {});"
      : "test('creates receipt exclusively', () => {writeFileSync('receipt.json','synthetic',{flag:'wx'}); assert.throws(()=>writeFileSync('receipt.json','duplicate',{flag:'wx'}),{code:'EEXIST'}); assert.equal(readFileSync('receipt.json','utf8'),'synthetic');});";
    const source = `import test from 'node:test'; import assert from 'node:assert/strict'; import {readFileSync,writeFileSync} from 'node:fs';\n${first}\n${second}\n`;
    const run = { runId: `${runId}-${name}`, sourceFingerprint: fingerprint({ sourceHead, sources, fixtureSha256: sha256(Buffer.from(source)) }),
      environment: "local_isolated", planHash: fingerprint(plan) };
    await writeFile(path.join(directory, "fixture.test.mjs"), source);
    await writeFile(path.join(directory, "input.json"), '{"value":42}\n');
    await writeFile(path.join(directory, "config.json"), JSON.stringify({ run, manifest }, null, 2));
    const environment = { ...process.env, EXPERIMENTS_NODE_TEST_CONFIG: path.join(directory, "config.json") };
    delete environment.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, ["--test", "--test-reporter", path.join(project, "dist/node-test-reporter.js"), "fixture.test.mjs"],
      { cwd: directory, env: environment, encoding: "utf8", timeout: 15_000, maxBuffer: 4 * 1024 * 1024 });
    assert.equal(result.status, exit, "Unexpected synthetic test process outcome");
    const bytes = Buffer.from(result.stdout), artifactSha256 = sha256(bytes);
    await writeFile(path.join(directory, "events.jsonl"), bytes);
    const report = assessNodeTestEvidence(plan, run, manifest, { artifactSha256, bytes });
    assert.equal(report.flow.verdict, expected);
    assert.throws(() => assessNodeTestEvidence(plan, run, manifest, { artifactSha256, bytes: Buffer.concat([bytes, Buffer.from(" ")]) }), /HASH_MISMATCH/);
    assert.throws(() => assessNodeTestEvidence(plan, { ...run, runId: `${run.runId}-other` }, manifest, { artifactSha256, bytes }), /RUN_MISMATCH/);
    await writeFile(path.join(directory, "assessment.json"), JSON.stringify(report, null, 2));
    scenarios.push({ name, verdict: report.flow.verdict, coverage: report.flow.coverage, artifactSha256, tamperRefused: true, otherRunRefused: true });
  }
  await writeFile(path.join(output, "summary.json"), JSON.stringify({ schemaVersion: "node-test-demo/1", synthetic: true, sourceHead, sources, scenarios }, null, 2));
  console.log(JSON.stringify({ runId, synthetic: true, scenarios: scenarios.map(({ name, verdict }) => ({ name, verdict })), recognized: scenarios.length }));
}
main().catch(() => { console.error("NODE_TEST_EVIDENCE_DEMO_FAILED"); process.exitCode = 1; });
