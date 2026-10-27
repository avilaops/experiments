import { access, mkdir, writeFile } from "node:fs/promises";
const destination = new URL("../dashboard/", import.meta.url);
try {
  await access(new URL("evidence.allowlist.json", destination));
  console.log("Selection already exists; selected evidence is preserved.");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  const numeric = await import("../examples/custom-tests.mjs");
  const path = await import("../examples/path-policy.mjs");
  const classification = await import("../examples/document-classification.mjs");
  const artifacts = {
    "numeric-baseline.json": numeric.baseline,
    "numeric-candidate.json": numeric.candidate,
    "numeric-dataset.json": numeric.dataset,
    "path-policy.json": path.report,
    "classification.json": classification.candidate,
    "classification-dataset.json": classification.dataset,
  };
  await mkdir(new URL("evidence/", destination), { recursive: true });
  for (const [filename, value] of Object.entries(artifacts)) {
    await writeFile(new URL("evidence/" + filename, destination), JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
  }
  await writeFile(new URL("evidence.allowlist.json", destination), JSON.stringify(Object.keys(artifacts), null, 2) + "\n", { flag: "wx" });
}
