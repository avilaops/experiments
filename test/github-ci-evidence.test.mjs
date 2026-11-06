import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { latestGithubCiEvidence } from "../dist/lab/github-ci-evidence.js";

const repos = ["avilaops/ERP-Next","avilaops/app.avilaops.com","avilaops/auth.avilaops.com",
  "avilaops/lojas.avilaops.com","avilaops/crm.avilaops.com","avilaops/TMS","avilaops/cms.avilaops.com"];
const sha = "a".repeat(40);
const document = () => ({
  schema: "avila-github-ci-inventory/1", source: "https://api.github.com",
  collectedAt: "2026-11-06T12:00:00Z",
  projects: repos.map(repository => ({ repository, available: true, latestRuns: [{
    id: 4220, name: "CI", sourceSha: sha, status: "completed", conclusion: "success",
    url: "https://github.com/avilaops/ERP-Next/actions/runs/4220", event: "push", updatedAt: "2026-11-06T12:00:00Z",
  }] })),
});

test("CI snapshots are absent, valid, stale or rejected without trusting invented metrics", async () => {
  const directory = await mkdtemp(join(tmpdir(), "github-ci-"));
  try {
    assert.deepEqual(await latestGithubCiEvidence(directory), { available: false });
    await mkdir(join(directory, "github-ci"));
    const path = join(directory, "github-ci", "latest.json");
    await writeFile(path, JSON.stringify(document()));
    const latest = await latestGithubCiEvidence(directory, Date.parse("2026-11-06T12:10:00Z"));
    assert.equal(latest.available, true);
    assert.equal(latest.stale, false);
    assert.equal(latest.projects?.length, 7);
    assert.equal(latest.projects?.[0]?.latestRuns?.[0]?.sourceSha, sha);
    assert.equal((await latestGithubCiEvidence(directory, Date.parse("2026-11-06T15:00:00Z"))).stale, true);
    const invalid = document();
    invalid.projects[0].latestRuns[0].sourceSha = "unverified";
    await writeFile(path, JSON.stringify(invalid));
    await assert.rejects(latestGithubCiEvidence(directory), /Invalid GitHub CI/);
    const duplicate = document();
    duplicate.projects[1].repository = duplicate.projects[0].repository;
    await writeFile(path, JSON.stringify(duplicate));
    await assert.rejects(latestGithubCiEvidence(directory), /Invalid GitHub CI/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
