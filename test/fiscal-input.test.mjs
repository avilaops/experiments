import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { inspectFiscalInput } from "../scripts/validate-fiscal-input.mjs";

const fixture = JSON.parse(await readFile(new URL("../examples/fiscal/domestic-sale.context.json", import.meta.url), "utf8"));
const copy = () => structuredClone(fixture);

test("fiscal context preserves decimal strings without mutation or a fiscal approval claim", () => {
  const input = copy();
  const before = JSON.stringify(input);
  assert.deepEqual(inspectFiscalInput(input), { status: "context_recorded", issues: [], pending: [] });
  assert.equal(JSON.stringify(input), before);
  assert.equal(input.items[0].unitPrice, "0.333333");
});

test("missing fiscal knowledge is explicit and never becomes zero or non-applicability", () => {
  const input = copy();
  input.ruleSnapshot = null;
  input.buyer.icmsContributor = "unknown";
  input.operation.finalConsumer = null;
  input.items[0].ncm = null;
  const result = inspectFiscalInput(input);
  assert.equal(result.status, "needs_context");
  assert.equal(result.pending.length, 4);
  assert.equal(input.ruleSnapshot, null);
});

for (const [name, mutate] of [
  ["numeric money", input => { input.items[0].unitPrice = 0.3; }],
  ["exponent", input => { input.items[0].quantity = "1e3"; }],
  ["excess scale", input => { input.items[0].unitPrice = "0.1234567"; }],
  ["negative money", input => { input.items[0].discount = "-1.00"; }],
  ["unknown field", input => { input.items[0].taxApproved = true; }],
  ["unknown nested field", input => { input.buyer.admin = true; }],
  ["invalid UF", input => { input.operation.shipToUf = "XX"; }],
  ["malformed NCM", input => { input.items[0].ncm = "12.34"; }],
  ["malformed CEST", input => { input.items[0].cest = "123"; }],
  ["impossible date", input => { input.operation.date = "2026-02-30"; }],
  ["zero quantity", input => { input.items[0].quantity = "0.000000"; }],
  ["duplicate line", input => { input.items.push(structuredClone(input.items[0])); }],
  ["unsupported operation", input => { input.operation.kind = "import"; }],
  ["production mode", input => { input.mode = "production"; }],
  ["unknown version", input => { input.schemaVersion = "2"; }],
  ["missing profile field", input => { delete input.buyer.taxRegime; }],
]) {
  test(`fiscal input rejects ${name}`, () => {
    const input = copy(); mutate(input);
    assert.equal(inspectFiscalInput(input).status, "invalid");
  });
}

test("3,000 order lines are validated with unique IDs and exact decimal transport", () => {
  const input = copy();
  input.items = Array.from({ length: 3000 }, (_, index) => ({ ...fixture.items[0], lineId: `line-${index}`, sku: `sku-${index}` }));
  assert.equal(inspectFiscalInput(input).status, "context_recorded");
  input.items[2999].lineId = "line-0";
  assert.equal(inspectFiscalInput(input).status, "invalid");
});
