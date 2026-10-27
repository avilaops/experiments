import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveFiscalReference, referenceHash, referenceContextFingerprint } from "../scripts/fiscal-reference.mjs";

const inputFixture = JSON.parse(await readFile(new URL("../examples/fiscal/domestic-sale.context.json", import.meta.url), "utf8"));
const resolutionFixture = JSON.parse(await readFile(new URL("../examples/fiscal/domestic-sale.resolution.json", import.meta.url), "utf8"));
async function withFixture(run) {
  const directory = await mkdtemp(path.join(tmpdir(), "fiscal-reference-"));
  const file = path.join(directory, "reference.json");
  const input = structuredClone(inputFixture);
  const source = { schemaVersion: "0.1", purpose: "engineering_fixture", id: "synthetic-reference", version: "1",
    validFrom: "2026-01-01", validUntil: "2027-01-01", contextFingerprint: referenceContextFingerprint(input),
    lines: structuredClone(resolutionFixture.lines) };
  async function save() {
    const bytes = Buffer.from(JSON.stringify(source));
    await writeFile(file, bytes);
    input.ruleSnapshot = { id: source.id, version: source.version, sha256: referenceHash(bytes) };
  }
  await save();
  try { await run({ directory, file, input, source, save }); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

test("local source is read, hash-checked and resolved deterministically without mutating input", async () => {
  await withFixture(async ({ file, input }) => {
    const before = JSON.stringify(input);
    const first = await resolveFiscalReference(input, file);
    const second = await resolveFiscalReference(input, file);
    assert.equal(first.status, "planned");
    assert.equal(first.taxCalculation, false);
    assert.deepEqual(first, second);
    assert.equal(JSON.stringify(input), before);
    assert.equal(first.referenceTrace.steps.length, 7);
    assert.ok(first.referenceTrace.steps.every(step => step.status === "succeeded"));
  });
});

test("modified bytes are blocked before resolution and the pinned hash is never repaired", async () => {
  await withFixture(async ({ file, input }) => {
    const before = input.ruleSnapshot.sha256;
    await writeFile(file, "{} ");
    const result = await resolveFiscalReference(input, file);
    assert.equal(result.status, "blocked");
    assert.equal(result.resolution, undefined);
    assert.equal(result.referenceTrace.steps.at(-1).node, "verify_reference_integrity");
    assert.equal(result.referenceTrace.steps.at(-1).status, "failed");
    assert.equal(input.ruleSnapshot.sha256, before);
  });
});

test("reference windows reject invalid dates, empty intervals, expired and future sources", async () => {
  for (const [from, until] of [["2026-02-30", "2027-01-01"], ["2026-01-01", "2026-01-01"],
    ["2026-01-01", "2026-10-27"], ["2026-10-28", "2027-01-01"]]) {
    await withFixture(async ({ file, input, source, save }) => {
      source.validFrom = from; source.validUntil = until; await save();
      const result = await resolveFiscalReference(input, file);
      assert.equal(result.status, "blocked");
      assert.equal(result.referenceTrace.steps.at(-1).node, "check_reference_window");
    });
  }
});

test("reference start date is inclusive", async () => {
  await withFixture(async ({ file, input, source, save }) => {
    source.validFrom = input.operation.date; await save();
    assert.equal((await resolveFiscalReference(input, file)).status, "planned");
  });
});

test("changes to price, profile, jurisdiction or request invalidate context binding", async () => {
  for (const mutate of [input => { input.items[0].unitPrice = "99.00"; }, input => { input.buyer.taxRegime = "mei"; },
    input => { input.operation.shipToUf = "RJ"; }, input => { input.requestId = "other-request"; }]) {
    await withFixture(async ({ file, input }) => {
      mutate(input);
      const result = await resolveFiscalReference(input, file);
      assert.equal(result.status, "blocked");
      assert.equal(result.referenceTrace.steps.at(-1).node, "match_reference_context");
    });
  }
});

test("unknown, ambiguous or missing line decisions do not yield an executable plan", async () => {
  for (const mutate of [source => { source.lines[0].taxes.icmsSt.applicability = "undetermined"; },
    source => { source.lines.push(structuredClone(source.lines[0])); }, source => { source.lines[0].lineId = "foreign"; }]) {
    await withFixture(async ({ file, input, source, save }) => {
      mutate(source); await save();
      const result = await resolveFiscalReference(input, file);
      assert.notEqual(result.status, "planned");
      assert.deepEqual(result.plan.plans, []);
    });
  }
});

test("missing file and unknown input context stop with explicit failure records", async () => {
  await withFixture(async ({ directory, file, input }) => {
    const missing = await resolveFiscalReference(input, path.join(directory, "missing.json"));
    assert.equal(missing.status, "blocked");
    assert.equal(missing.referenceTrace.steps.at(-1).node, "load_reference_snapshot");
    input.ruleSnapshot = null;
    const pending = await resolveFiscalReference(input, file);
    assert.equal(pending.referenceTrace.steps.at(-1).node, "validate_context");
    assert.equal(pending.referenceTrace.steps.length, 1);
  });
});

test("non-fixture purpose and malformed JSON are refused even when their bytes are pinned", async () => {
  await withFixture(async ({ file, input, source, save }) => {
    source.purpose = "production"; await save();
    assert.equal((await resolveFiscalReference(input, file)).status, "blocked");
    const bytes = Buffer.from("{malformed");
    await writeFile(file, bytes); input.ruleSnapshot.sha256 = referenceHash(bytes);
    const result = await resolveFiscalReference(input, file);
    assert.equal(result.status, "blocked");
    assert.equal(result.resolution, undefined);
  });
});

test("files above the limit and mismatching source identities fail before resolution", async () => {
  await withFixture(async ({ file, input }) => {
    input.ruleSnapshot.id = "wrong-id";
    const mismatch = await resolveFiscalReference(input, file);
    assert.equal(mismatch.status, "blocked");
    assert.equal(mismatch.referenceTrace.steps.at(-1).node, "verify_reference_integrity");
    await writeFile(file, Buffer.alloc(2 * 1024 * 1024 + 1));
    const oversized = await resolveFiscalReference(input, file);
    assert.equal(oversized.status, "blocked");
    assert.equal(oversized.referenceTrace.steps.at(-1).node, "load_reference_snapshot");
  });
});
