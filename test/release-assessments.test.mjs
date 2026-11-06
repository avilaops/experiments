import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assessRelease, currentReleaseAssessments } from "../dist/lab/release-assessments.js";

const now = new Date("2026-11-06T15:00:00Z");
const sha = "a".repeat(40);
const run = (conclusion, id = 123, sourceSha = sha, status = "completed") => ({
  id, name: "Build e deploy", sourceSha, status, conclusion,
  event: "push", updatedAt: now.toISOString(), url: "https://github.com/avilaops/ERP-Next/actions/runs/" + id,
});
const project = (latestRuns, available = true) => ({ repository: "avilaops/ERP-Next", available, latestRuns });

test("even a green CI cannot authorize publication without security and human review", () => {
  const decision = assessRelease(project([run("success")]), now.toISOString(), false, now);
  assert.equal(decision.decision, "review");
  assert.equal(decision.gates[0].verdict, "passed");
  assert.equal(decision.gates[3].id, "humanApproval");
  assert.equal(decision.gates[3].verdict, "unknown");
  assert.equal(decision.gates[5].verdict, "unknown");
  assert.equal(decision.sourceSha, sha);
});

test("failed CI rejects the selected commit; skip and stale evidence never pass", () => {
  assert.equal(assessRelease(project([run("failure")]), now.toISOString(), false, now).decision, "rejected");
  assert.equal(assessRelease(project([run("skipped")]), now.toISOString(), false, now).gates[0].verdict, "unknown");
  assert.equal(assessRelease(project([run("success")]), now.toISOString(), true, now).gates[0].verdict, "unknown");
});

test("mixed commits do not combine CI evidence from different source revisions", () => {
  const assessment = assessRelease(project([run("success", 1), run("failure", 2, "b".repeat(40))]), now.toISOString(), false, now);
  assert.equal(assessment.sourceSha, sha);
  assert.equal(assessment.workflowRuns.length, 1);
  assert.equal(assessment.decision, "review");
});

test("missing snapshot yields no approval and no invented projects", async () => {
  const dir = await mkdtemp(join(tmpdir(), "release-assessment-"));
  try {
    assert.deepEqual((await currentReleaseAssessments(dir, now)).projects, []);
    await mkdir(join(dir, "github-ci"));
    await writeFile(join(dir, "github-ci", "latest.json"), '{"schema":"invalid"}');
    await assert.rejects(currentReleaseAssessments(dir, now), /Invalid GitHub CI/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
