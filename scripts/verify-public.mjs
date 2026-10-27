import assert from "node:assert/strict";
import { createHash } from "node:crypto";
const base = "https://ml.avilaops.com/evidencias/";
const manifest = await (await fetch(base + "manifest.json")).json();
for (const artifact of manifest.artifacts) {
  const response = await fetch(base + "data/" + artifact.file);
  assert.equal(response.status, 200);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(bytes.length, artifact.size);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), artifact.sha256);
}
for (const route of ["https://ml.avilaops.com/experiments/", "https://ml.avilaops.com/experiments/api/v1/suite", "https://ml.avilaops.com/annif/", "https://ml.avilaops.com/inferencia/"]) {
  assert.equal((await fetch(route)).status, 401);
}
console.log("Public verification passed: " + manifest.artifacts.length + " artifact hashes and private access boundaries.");
