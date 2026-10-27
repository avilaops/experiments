import assert from "node:assert/strict";
import test from "node:test";
import { compareExperiments, numericTolerance, pathFidelity, runExperiment } from "../dist/index.js";

const policy = {
  requiredNodes: ["fiscal", "margin", "discount"],
  forbiddenNodes: ["bypass"],
  allowedTransitions: [["fiscal", "margin"], ["margin", "discount"], ["fiscal", "audit"], ["audit", "margin"]],
};
const trace = (nodes, complete = true) => ({
  value: 12,
  trace: { complete, steps: nodes.map((node) => ({ node, status: "succeeded" })) },
});
const assess = (output, options = policy) => pathFidelity(options).evaluate({ caseId: "discount", input: null, expected: 12, output });

test("an ordered successful path and an explicitly allowed alternative pass", () => {
  assert.equal(assess(trace(["fiscal", "margin", "discount"])).score, 1);
  assert.equal(assess(trace(["fiscal", "audit", "margin", "discount"])).score, 1);
});

test("a correct result does not excuse missing or reversed milestones", () => {
  assert.equal(assess(trace(["margin", "discount"])).score, 0);
  assert.equal(assess(trace(["margin", "fiscal", "discount"])).score, 0);
  assert.equal(assess(trace(["margin", "fiscal", "discount"]), { requiredNodes: policy.requiredNodes }).score, 0);
  assert.equal(assess(trace([])).score, 0);
});

test("a forbidden attempt fails even if its tool execution failed", () => {
  const output = trace(["fiscal", "margin", "discount", "bypass"]);
  output.trace.steps.at(-1).status = "failed";
  assert.match(assess(output).reason, /Forbidden node/);
  assert.equal(assess(output).score, 0);
});

test("failed steps and undeclared transitions cannot approve a path", () => {
  const output = trace(["fiscal", "margin", "discount"]);
  output.trace.steps[1].status = "failed";
  assert.equal(assess(output).score, 0);
  assert.match(assess(trace(["fiscal", "unknown", "margin", "discount"])).reason, /transition/);
});

test("missing and incomplete evidence is inconclusive, but observed violations still fail", () => {
  assert.equal(assess({ value: 12 }).score, null);
  assert.equal(assess(trace(["fiscal"], false)).score, null);
  assert.equal(assess(trace(["bypass"], false)).score, 0);
});

test("malformed trace records fail instead of being silently accepted", () => {
  for (const malformed of [null, [], {}, { complete: true, steps: null },
    { complete: true, steps: [null] }, { complete: true, steps: [{ node: "", status: "succeeded" }] },
    { complete: true, steps: [{ node: "fiscal", status: "pending" }] }]) {
    assert.equal(assess({ trace: malformed }).score, 0);
  }
});

test("required repeated nodes consume distinct trace steps", () => {
  const options = { requiredNodes: ["fiscal", "fiscal"] };
  assert.equal(assess(trace(["fiscal"]), options).score, 0);
  assert.equal(assess(trace(["fiscal", "fiscal"]), options).score, 1);
});

test("invalid policies fail before execution", () => {
  for (const options of [
    { requiredNodes: [] }, { requiredNodes: new Array(1) }, { requiredNodes: null }, { requiredNodes: [""] },
    { requiredNodes: [1] }, { requiredNodes: ["fiscal"], forbiddenNodes: ["fiscal"] },
    { requiredNodes: ["fiscal"], forbiddenNodes: null },
    { requiredNodes: ["fiscal"], allowedTransitions: null },
    { requiredNodes: ["fiscal"], allowedTransitions: new Array(1) },
    { requiredNodes: ["fiscal"], allowedTransitions: [["fiscal"]] },
    { requiredNodes: ["fiscal"], allowedTransitions: [["fiscal", ""]] },
  ]) assert.throws(() => pathFidelity(options), TypeError);
});

test("caller mutations cannot change the captured policy or its public provenance", () => {
  const options = structuredClone(policy);
  const evaluator = pathFidelity(options);
  options.requiredNodes.reverse();
  options.forbiddenNodes.length = 0;
  options.allowedTransitions[0][1] = "bypass";
  assert.deepEqual(evaluator.parameters, policy);
  assert.throws(() => evaluator.parameters.requiredNodes.reverse(), TypeError);
  assert.throws(() => { evaluator.parameters.allowedTransitions[0][1] = "bypass"; }, TypeError);
  assert.equal(evaluator.evaluate({ output: trace(["fiscal", "margin", "discount"]) }).score, 1);
});

function definition(options = policy) {
  const numeric = numericTolerance({ absoluteTolerance: 1e-9 });
  return {
    id: "path-and-number", version: "1", hypothesis: "Correct numbers also require a valid execution path.",
    dataset: { id: "discount", version: "1", split: "development", cases: [{ id: "discount", input: null, expected: 12 }] },
    variant: { id: "discount", version: "1", codeVersion: "test" },
    evaluators: [
      { ...numeric, evaluate: (context) => numeric.evaluate({ ...context, output: context.output.value }) },
      pathFidelity(options),
    ],
  };
}

test("a path violation blocks an experiment even when the numeric gate passes", async () => {
  const report = await runExperiment(definition(), () => ({ output: trace(["margin", "discount"]) }));
  assert.equal(report.cases[0].evaluations[0].verdict, "passed");
  assert.equal(report.cases[0].evaluations[1].verdict, "failed");
  assert.equal(report.summary.verdict, "failed");
});

test("incomplete paths remain inconclusive in the aggregate", async () => {
  const report = await runExperiment(definition(), () => ({ output: trace(["fiscal"], false) }));
  assert.equal(report.summary.verdict, "inconclusive");
});

test("path policies survive report serialization and cannot change across comparisons", async () => {
  const baseline = await runExperiment(definition(), () => ({ output: trace(["fiscal", "margin", "discount"]) }));
  const candidate = await runExperiment(definition({ ...policy, forbiddenNodes: ["override"] }), () => ({ output: trace(["fiscal", "margin", "discount"]) }));
  assert.equal(compareExperiments(JSON.parse(JSON.stringify(baseline)), baseline).comparable, true);
  assert.equal(compareExperiments(baseline, candidate).comparable, false);
});
