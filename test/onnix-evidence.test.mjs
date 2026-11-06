import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { latestOnnixEvidence } from "../dist/lab/onnix-evidence.js";

test("ONNIX evidence is private read-only metadata and reports missing/stale data", async () => {
  const root = await mkdtemp(join(tmpdir(), "onnix-evidence-"));
  try {
    assert.deepEqual(await latestOnnixEvidence(root), { available: false });
    await mkdir(join(root, "onnix"));
    const doc = {
      schema: "avila-onnix-evidence/1",
      service: "avila-upscale-cpu",
      provider: "CPUExecutionProvider",
      createdAt: new Date().toISOString(),
      modelSha256: "a".repeat(64),
      modelBytes: 4866428,
      evaluation: {
        verdict: "passed", latencyMs: 891.27,
        inputPixels: [64,64], outputPixels: [256,256],
        outputFormat: "WEBP", outputBytes: 1408,
        inputSha256: "b".repeat(64), outputSha256: "c".repeat(64),
      },
      secret: "must-not-leak",
    };
    await writeFile(join(root, "onnix", "latest.json"), JSON.stringify(doc));
    const current = await latestOnnixEvidence(root);
    assert.equal(current.available, true);
    assert.equal(current.stale, false);
    assert.equal(current.evaluation?.verdict, "passed");
    assert.deepEqual(current.evaluation?.outputPixels, [256,256]);
    assert.equal(JSON.stringify(current).includes("must-not-leak"), false);
    doc.createdAt = "2020-01-01T00:00:00Z";
    await writeFile(join(root, "onnix", "latest.json"), JSON.stringify(doc));
    assert.equal((await latestOnnixEvidence(root)).stale, true);
    await writeFile(join(root, "onnix", "latest.json"), '{"schema":"bad"}');
    await assert.rejects(latestOnnixEvidence(root), /Invalid ONNIX/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
