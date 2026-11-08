import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = new URL("../", import.meta.url);
const script = new URL("../scripts/ci-mlops.mjs", import.meta.url);

function run(command, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(script), command], { cwd: fileURLToPath(root), env, stdio: "pipe" });
    let stderr = "";
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}: ${stderr}`)));
  });
}

test("CI generator produces linked request, evidence and result documents", async () => {
  const directory = await mkdtemp(join(tmpdir(), "experiments-mlops-ci-"));
  const log = join(directory, "test-output.log");
  await writeFile(log, "synthetic test output\n", "utf8");
  const env = { ...process.env, GITHUB_ACTIONS: "true", GITHUB_ACTOR: "test", GITHUB_EVENT_NAME: "pull_request", GITHUB_REPOSITORY: "avilaops/experiments", GITHUB_RUN_ID: "123", GITHUB_SHA: "a".repeat(40), GITHUB_REF_NAME: "pull/1", MLOPS_REPORT_DIR: directory, MLOPS_TEST_LOG: log, MLOPS_TEST_OUTCOME: "success" };
  await run("request", env);
  await run("result", env);
  const request = JSON.parse(await readFile(join(directory, "evaluation-request.json"), "utf8"));
  const evidence = JSON.parse(await readFile(join(directory, "evidence-envelope.json"), "utf8"));
  const result = JSON.parse(await readFile(join(directory, "evaluation-result.json"), "utf8"));
  assert.equal(request.schemaVersion, "evaluation-request/1");
  assert.equal(evidence.requestId, request.requestId);
  assert.equal(result.requestId, request.requestId);
  assert.equal(result.status, "passed");
  assert.equal(result.evidenceIds[0], evidence.evidenceId);
  assert.equal(result.checks[0].artifactSha256, evidence.artifact.sha256);
});
