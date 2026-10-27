import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { referenceContextFingerprint, referenceHash, resolveFiscalReference } from "../scripts/fiscal-reference.mjs";

const context = JSON.parse(await readFile(new URL("./fiscal/domestic-sale.context.json", import.meta.url), "utf8"));
const decisions = JSON.parse(await readFile(new URL("./fiscal/domestic-sale.resolution.json", import.meta.url), "utf8"));
const runId = randomUUID();
const directory = new URL(`../reports/fiscal-reference/${runId}/`, import.meta.url);
const manifest = [];
const results = [];
const scenarios = ["matching-reference", "tampered-bytes", "different-context", "outside-window", "undetermined-tax"];

async function artifact(name, bytes) {
  await writeFile(new URL(name, directory), bytes, { flag: "wx" });
  manifest.push({ file: name, bytes: Buffer.byteLength(bytes), sha256: referenceHash(bytes) });
}

for (const scenario of scenarios) {
  await mkdir(new URL(`${scenario}/`, directory), { recursive: true });
  const input = structuredClone(context);
  const source = { schemaVersion: "0.1", purpose: "engineering_fixture", id: "synthetic-reference", version: "1",
    validFrom: "2026-01-01", validUntil: "2027-01-01", contextFingerprint: referenceContextFingerprint(input), lines: structuredClone(decisions.lines) };
  if (scenario === "outside-window") source.validUntil = input.operation.date;
  if (scenario === "undetermined-tax") source.lines[0].taxes.icmsSt.applicability = "undetermined";
  let bytes = Buffer.from(JSON.stringify(source, null, 2));
  // Only this synthetic setup assigns a pointer. The resolver never repairs it.
  input.ruleSnapshot = { id: source.id, version: source.version, sha256: referenceHash(bytes) };
  if (scenario === "tampered-bytes") bytes = Buffer.concat([bytes, Buffer.from(" ")]);
  if (scenario === "different-context") input.operation.shipToUf = "RJ";
  await artifact(`${scenario}/reference.json`, bytes);
  await artifact(`${scenario}/input.json`, JSON.stringify(input, null, 2));
  const result = await resolveFiscalReference(input, new URL(`${scenario}/reference.json`, directory));
  assert.equal(result.status, scenario === "matching-reference" ? "planned" : "blocked", scenario);
  if (scenario === "matching-reference") {
    assert.deepEqual(result, await resolveFiscalReference(input, new URL(`${scenario}/reference.json`, directory)));
  }
  await artifact(`${scenario}/result.json`, JSON.stringify(result, null, 2));
  results.push({ scenario, status: result.status, lastStep: result.referenceTrace.steps.at(-1),
    planCount: result.plan?.plans.length ?? 0 });
}

await artifact("verification.json", JSON.stringify({ runId, synthetic: true, taxCalculation: false, results }, null, 2));
await writeFile(new URL("manifest.json", directory), JSON.stringify({ runId, artifacts: manifest }, null, 2), { flag: "wx" });
console.log(JSON.stringify({ runId, verification: "passed", directory: directory.pathname, artifacts: manifest.length, results }, null, 2));
