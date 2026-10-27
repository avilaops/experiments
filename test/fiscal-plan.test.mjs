import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fingerprint, pathFidelity } from "../dist/index.js";
import { planFiscalSimulation } from "../scripts/fiscal-plan.mjs";

const fixture = JSON.parse(await readFile(new URL("../examples/fiscal/domestic-sale.context.json", import.meta.url), "utf8"));
function setup() {
  const input = structuredClone(fixture);
  const assessment = applicability => ({ applicability, ruleRef: "synthetic-rule-v1", reason: "Fixture de engenharia, sem interpretação fiscal." });
  return { input, resolution: { schemaVersion: "0.1", inputFingerprint: fingerprint(input), ruleSnapshot: structuredClone(input.ruleSnapshot),
    lines: [{ lineId: input.items[0].lineId, classification: { status: "matched", evidenceRef: "synthetic-classification-evidence" },
      taxes: { icmsOwn: assessment("applicable"), icmsSt: assessment("applicable"), difal: assessment("not_applicable") } }] } };
}
function evaluate(policy, nodes, complete = true) {
  return pathFidelity(policy).evaluate({ caseId: "synthetic", input: null, expected: null,
    output: { value: "12.00", trace: { complete, steps: nodes.map(node => ({ node, status: "succeeded" })) } } });
}

test("declared conditional plan requires classification and ICMS own before ST in the proposed pilot", async () => {
  const { input, resolution } = setup();
  const before = JSON.stringify({ input, resolution });
  const result = planFiscalSimulation(input, resolution);
  assert.equal(result.status, "planned");
  const policy = result.plans[0].pathPolicy;
  assert.ok(policy.requiredNodes.indexOf("calculate_icms_own") < policy.requiredNodes.indexOf("calculate_icms_st"));
  assert.equal((await evaluate(policy, policy.requiredNodes)).score, 1);
  assert.equal(JSON.stringify({ input, resolution }), before);
});

test("same numeric result cannot excuse skipping classification, reversing order or issuing a document", async () => {
  const { input, resolution } = setup();
  const policy = planFiscalSimulation(input, resolution).plans[0].pathPolicy;
  for (const nodes of [
    policy.requiredNodes.filter(node => node !== "validate_ncm"),
    policy.requiredNodes.map(node => node === "calculate_icms_own" ? "calculate_icms_st" : node === "calculate_icms_st" ? "calculate_icms_own" : node),
    [...policy.requiredNodes, "issue_document"],
    [...policy.requiredNodes, "activate_rules"],
  ]) assert.equal((await evaluate(policy, nodes)).score, 0);
});

test("non-applicable ST requires an explicit recorded branch and forbids its calculation", async () => {
  const { input, resolution } = setup();
  resolution.lines[0].taxes.icmsSt.applicability = "not_applicable";
  const policy = planFiscalSimulation(input, resolution).plans[0].pathPolicy;
  assert.ok(policy.requiredNodes.includes("record_icms_st_not_applicable"));
  assert.equal((await evaluate(policy, policy.requiredNodes)).score, 1);
  assert.equal((await evaluate(policy, [...policy.requiredNodes, "calculate_icms_st"])).score, 0);
});

test("all eight declared tax combinations select independent explicit branches", async () => {
  const taxes = [["icmsOwn", "icms_own"], ["icmsSt", "icms_st"], ["difal", "difal"]];
  for (let mask = 0; mask < 8; mask++) {
    const { input, resolution } = setup();
    taxes.forEach(([tax], index) => { resolution.lines[0].taxes[tax].applicability = mask & (1 << index) ? "applicable" : "not_applicable"; });
    const policy = planFiscalSimulation(input, resolution).plans[0].pathPolicy;
    taxes.forEach(([, suffix], index) => {
      const applies = Boolean(mask & (1 << index));
      assert.ok(policy.requiredNodes.includes(applies ? `calculate_${suffix}` : `record_${suffix}_not_applicable`));
      assert.ok(policy.forbiddenNodes.includes(applies ? `record_${suffix}_not_applicable` : `calculate_${suffix}`));
    });
    assert.equal((await evaluate(policy, policy.requiredNodes)).score, 1);
  }
});

test("undetermined tax, unresolved classification or pending input block all planning", () => {
  for (const mutate of [
    ({ resolution }) => { resolution.lines[0].taxes.difal.applicability = "undetermined"; },
    ({ resolution }) => { resolution.lines[0].classification.status = "rejected"; },
    ({ input }) => { input.buyer.taxRegime = "unknown"; },
  ]) {
    const context = setup(); mutate(context);
    const result = planFiscalSimulation(context.input, context.resolution);
    assert.equal(result.status, "blocked");
    assert.deepEqual(result.plans, []);
  }
});

test("stale input, different snapshot, missing, duplicate and unknown lines are invalid", () => {
  for (const mutate of [
    ({ input }) => { input.items[0].unitPrice = "7.00"; },
    ({ resolution }) => { resolution.ruleSnapshot.version = "other"; },
    ({ resolution }) => { resolution.lines = []; },
    ({ resolution }) => { resolution.lines.push(structuredClone(resolution.lines[0])); },
    ({ resolution }) => { resolution.lines[0].lineId = "foreign"; },
    ({ resolution }) => { resolution.lines[0].taxes.icmsSt.applyST = true; },
  ]) {
    const context = setup(); mutate(context);
    assert.equal(planFiscalSimulation(context.input, context.resolution).status, "invalid");
  }
});

test("an unresolved line blocks the entire document rather than generating a partial plan", () => {
  const { input, resolution } = setup();
  input.items.push({ ...input.items[0], lineId: "second-line" });
  resolution.inputFingerprint = fingerprint(input);
  const line = structuredClone(resolution.lines[0]);
  line.lineId = "second-line";
  line.taxes.icmsSt.applicability = "undetermined";
  resolution.lines.push(line);
  assert.deepEqual(planFiscalSimulation(input, resolution).plans, []);
});

test("an interrupted trace is inconclusive and an observed failed step is rejected", async () => {
  const { input, resolution } = setup();
  const policy = planFiscalSimulation(input, resolution).plans[0].pathPolicy;
  assert.equal((await evaluate(policy, policy.requiredNodes.slice(0, 3), false)).score, null);
  const result = await pathFidelity(policy).evaluate({ output: { trace: { complete: true,
    steps: policy.requiredNodes.map(node => ({ node, status: node === "verify_rule_snapshot" ? "failed" : "succeeded" })) } } });
  assert.equal(result.score, 0);
});
