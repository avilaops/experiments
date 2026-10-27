import assert from "node:assert/strict";
import test from "node:test";
import { compareExperiments, numberRange, numericTolerance, runExperiment } from "../dist/index.js";

function definition(evaluators, expected = 0.3) {
  return {
    id: "custom-evaluators",
    version: "1",
    hypothesis: "The calculation satisfies numeric accuracy and declared policies.",
    dataset: {
      id: "decimal-addition", version: "1", split: "development",
      cases: [{ id: "fraction", input: { left: 0.1, right: 0.2 }, expected }],
    },
    variant: { id: "arithmetic", version: "1", codeVersion: "custom-test-v1" },
    evaluators,
  };
}

async function assess(evaluator, expected, output) {
  return evaluator.evaluate({ caseId: "case", input: null, expected, output });
}

test("absolute tolerance accepts floating-point differences but rejects larger errors", async () => {
  const evaluator = numericTolerance({ absoluteTolerance: 1e-9 });
  assert.equal((await assess(evaluator, 0.3, 0.1 + 0.2)).score, 1);
  assert.equal((await assess(evaluator, 0.3, 0.31)).score, 0);
});

test("relative tolerance scales with the reference magnitude", async () => {
  const evaluator = numericTolerance({ relativeTolerance: 0.001 });
  assert.equal((await assess(evaluator, 1000, 1001)).score, 1);
  assert.equal((await assess(evaluator, 1000, 1002)).score, 0);
  assert.equal((await assess(evaluator, -1000, -1001)).score, 1);
});

test("zero references require an absolute tolerance for nonzero deviations", async () => {
  assert.equal((await assess(numericTolerance({ relativeTolerance: 10 }), 0, 1)).score, 0);
  assert.equal((await assess(numericTolerance(), 0, 0)).score, 1);
  assert.equal((await assess(numericTolerance({ absoluteTolerance: 0.01 }), 0, 0.001)).score, 1);
});

test("finite numeric extremes cannot pass through Infinity comparisons", async () => {
  const maximum = Number.MAX_VALUE;
  assert.equal((await assess(numericTolerance({ absoluteTolerance: maximum }), maximum, -maximum)).score, 0);
  assert.equal((await assess(numericTolerance({ relativeTolerance: 1 }), maximum, -maximum)).score, 0);
  assert.equal((await assess(numericTolerance({ relativeTolerance: 2 }), maximum, -maximum)).score, 1);
});

test("a missing or nonnumeric reference is explicitly inconclusive", async () => {
  for (const reference of [undefined, null, "0.3", NaN, Infinity]) {
    assert.equal((await assess(numericTolerance(), reference, 0.3)).score, null);
  }
});

test("nonnumeric outputs fail a numeric criterion", async () => {
  for (const output of ["0.3", null, false, {}, NaN, Infinity]) {
    assert.equal((await assess(numericTolerance(), 0.3, output)).score, 0);
  }
});

test("invalid tolerance parameters fail before running an experiment", () => {
  for (const tolerance of [-1, NaN, Infinity, null, "0.1"]) {
    assert.throws(() => numericTolerance({ absoluteTolerance: tolerance }), TypeError);
    assert.throws(() => numericTolerance({ relativeTolerance: tolerance }), TypeError);
  }
});

test("range boundaries are inclusive and invalid ranges are rejected", async () => {
  const evaluator = numberRange({ minimum: 0, maximum: 100 });
  for (const output of [0, 50, 100]) assert.equal((await assess(evaluator, undefined, output)).score, 1);
  for (const output of [-1, 101, "50", null, NaN, Infinity]) assert.equal((await assess(evaluator, undefined, output)).score, 0);
  assert.throws(() => numberRange({ minimum: 100, maximum: 0 }), TypeError);
  assert.throws(() => numberRange({ minimum: 0, maximum: Infinity }), TypeError);
});

test("a hard range restriction can reject a result that passes numeric tolerance", async () => {
  const report = await runExperiment(definition([
    numericTolerance({ absoluteTolerance: 2 }),
    numberRange({ minimum: 0, maximum: 100 }),
  ], 100), () => ({ output: 101 }));
  assert.equal(report.cases[0].evaluations[0].verdict, "passed");
  assert.equal(report.cases[0].evaluations[1].verdict, "failed");
  assert.equal(report.summary.verdict, "failed");
});

test("reports retain parameters and refuse comparisons after tolerance changes", async () => {
  const baseline = await runExperiment(definition([numericTolerance({ absoluteTolerance: 1e-9 })]), () => ({ output: 0.3 }));
  const candidate = await runExperiment(definition([numericTolerance({ absoluteTolerance: 0.1 })]), () => ({ output: 0.3 }));
  assert.deepEqual(baseline.evaluators[0].parameters, { absoluteTolerance: 1e-9, relativeTolerance: 0 });
  const comparison = compareExperiments(baseline, candidate);
  assert.equal(comparison.comparable, false);
  assert.ok(comparison.reasons.some((reason) => reason.includes("Evaluator definitions")));
});

test("reports refuse comparisons after a hard policy bound changes", async () => {
  const baseline = await runExperiment(definition([numberRange({ minimum: 0, maximum: 100 })]), () => ({ output: 1 }));
  const candidate = await runExperiment(definition([numberRange({ minimum: 0, maximum: 200 })]), () => ({ output: 1 }));
  assert.equal(compareExperiments(baseline, candidate).comparable, false);
});

test("a custom evaluator can enforce a project-specific operation policy", async () => {
  const allowedOperations = ["add", "multiply"];
  const customPolicy = {
    id: "allowed-operations", version: "1", kind: "gate", threshold: 1,
    parameters: { allowedOperations },
    evaluate({ input }) {
      const allowed = allowedOperations.includes(input.operation);
      return { score: allowed ? 1 : 0, reason: allowed ? "Allowed operation" : "Forbidden operation" };
    },
  };
  const experiment = definition([customPolicy]);
  experiment.dataset.cases[0].input = { operation: "delete" };
  const report = await runExperiment(experiment, () => ({ output: 0.3 }));
  assert.equal(report.summary.verdict, "failed");
  assert.equal(report.cases[0].evaluations[0].reason, "Forbidden operation");
});

function nextUp(value) {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  view.setBigUint64(0, view.getBigUint64(0) + 1n);
  return view.getFloat64(0);
}

test("absolute tolerance includes its exact boundary and rejects the next representable value", async () => {
  const evaluator = numericTolerance({ absoluteTolerance: 0.125 });
  for (const sign of [-1, 1]) {
    assert.equal((await assess(evaluator, 0, sign * 0.125)).score, 1);
    assert.equal((await assess(evaluator, 0, sign * nextUp(0.125))).score, 0);
  }
});

test("relative tolerance includes its exact boundary for positive and negative references", async () => {
  const evaluator = numericTolerance({ relativeTolerance: 0.125 });
  for (const sign of [-1, 1]) {
    assert.equal((await assess(evaluator, sign * 8, sign * 9)).score, 1);
    assert.equal((await assess(evaluator, sign * 8, sign * nextUp(9))).score, 0);
  }
});

test("zero tolerance is exact and does not silently round repeating decimals", async () => {
  const evaluator = numericTolerance();
  assert.equal((await assess(evaluator, 1 / 3, 1 / 3)).score, 1);
  assert.equal((await assess(evaluator, 1 / 3, 0.333333)).score, 0);
  assert.equal((await assess(evaluator, 0, -0)).score, 1);
  assert.equal((await assess(evaluator, 0, Number.MIN_VALUE)).score, 0);
});

test("absolute and relative tolerances are alternatives rather than cumulative allowances", async () => {
  const evaluator = numericTolerance({ absoluteTolerance: 1, relativeTolerance: 0.01 });
  assert.equal((await assess(evaluator, 100, 101)).score, 1);
  assert.equal((await assess(evaluator, 100, 101.5)).score, 0);
});

test("exclusive endpoints reject equality but accept interior neighbors", async () => {
  const evaluator = numberRange({ minimum: 1, maximum: 2, includeMinimum: false, includeMaximum: false });
  for (const output of [1, 2, -Infinity, Infinity]) assert.equal((await assess(evaluator, undefined, output)).score, 0);
  for (const output of [nextUp(1), 2 - Number.EPSILON]) assert.equal((await assess(evaluator, undefined, output)).score, 1);
  assert.equal((await assess(numberRange({ minimum: -2, maximum: -1 }), undefined, -1.5)).score, 1);
});

test("one endpoint can be exclusive independently of the other", async () => {
  const lower = numberRange({ minimum: 1, maximum: 2, includeMinimum: false });
  const upper = numberRange({ minimum: 1, maximum: 2, includeMaximum: false });
  assert.equal((await assess(lower, undefined, 1)).score, 0);
  assert.equal((await assess(lower, undefined, 2)).score, 1);
  assert.equal((await assess(upper, undefined, 1)).score, 1);
  assert.equal((await assess(upper, undefined, 2)).score, 0);
});

test("range configuration rejects empty ranges and invalid inclusion flags", async () => {
  for (const flag of [null, 0, "false"]) {
    assert.throws(() => numberRange({ minimum: 0, maximum: 1, includeMinimum: flag }), TypeError);
    assert.throws(() => numberRange({ minimum: 0, maximum: 1, includeMaximum: flag }), TypeError);
  }
  assert.throws(() => numberRange({ minimum: 1, maximum: 1, includeMinimum: false }), /empty/);
  assert.equal((await assess(numberRange({ minimum: 1, maximum: 1 }), undefined, 1)).score, 1);
});

test("numeric tolerance cannot excuse even the smallest representable policy violation", async () => {
  const report = await runExperiment(definition([
    numericTolerance({ absoluteTolerance: 1e-9 }),
    numberRange({ minimum: 0, maximum: 100 }),
  ], 100), () => ({ output: nextUp(100) }));
  assert.equal(report.cases[0].evaluations[0].verdict, "passed");
  assert.equal(report.cases[0].evaluations[1].verdict, "failed");
  assert.equal(report.summary.verdict, "failed");
});

test("changing endpoint inclusion changes the recorded policy and prevents comparison", async () => {
  const baseline = await runExperiment(definition([numberRange({ minimum: 0, maximum: 100 })]), () => ({ output: 1 }));
  const candidate = await runExperiment(definition([numberRange({ minimum: 0, maximum: 100, includeMaximum: false })]), () => ({ output: 1 }));
  assert.equal(compareExperiments(baseline, candidate).comparable, false);
});
