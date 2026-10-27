import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJson, compareExperiments, exactMatch, fingerprint, runExperiment } from "../dist/index.js";

function experiment(cases = [{ id: "first", input: 2, expected: 4, group: "ordinary" }]) {
  return {
    id: "double",
    version: "1",
    hypothesis: "The executor doubles every input.",
    dataset: { id: "numbers", version: "1", split: "evaluation", cases },
    variant: { id: "double", version: "1", codeVersion: "test-commit" },
    evaluators: [exactMatch()],
  };
}

const double = (input) => ({ output: input * 2 });

test("reports complete evidence, repetitions and group denominators", async () => {
  const definition = experiment([
    { id: "positive", group: "ordinary", input: 2, expected: 4 },
    { id: "negative", group: "edge", input: -1, expected: -2 },
  ]);
  const report = await runExperiment(definition, double, { repetitions: 3 });
  assert.equal(report.summary.verdict, "passed");
  assert.equal(report.summary.total, 6);
  assert.equal(report.summary.passed, 6);
  assert.equal(report.summary.passRate, 1);
  assert.equal(report.dataset.split, "evaluation");
  assert.equal(report.dataset.hash, fingerprint(definition.dataset));
  assert.equal(report.groups.find((group) => group.name === "edge").summary.total, 3);
  assert.deepEqual(report.cases.map((item) => item.repetition), [1, 2, 3, 1, 2, 3]);
  assert.equal(report.cases[0].output, 4);
  assert.equal(report.cases[0].outputHash, fingerprint(4));
  assert.equal(report.summary.usage.costUsd.total, null);
  assert.ok(report.summary.durationMs.p95 >= 0);
  assert.doesNotThrow(() => canonicalJson(report));
});

test("a failed case remains in the aggregate and in its group", async () => {
  const report = await runExperiment(experiment([
    { id: "right", input: 2, expected: 4, group: "ordinary" },
    { id: "wrong", input: 3, expected: 99, group: "rare" },
  ]), double);
  assert.equal(report.summary.verdict, "failed");
  assert.equal(report.summary.passRate, 0.5);
  assert.equal(report.summary.failed, 1);
  assert.equal(report.groups.find((group) => group.name === "rare").summary.passRate, 0);
});

test("execution errors do not disappear from success denominators", async () => {
  const report = await runExperiment(experiment([
    { id: "right", input: 2, expected: 4 },
    { id: "broken", input: 3, expected: 6 },
  ]), (input) => {
    if (input === 3) throw new Error("executor unavailable");
    return double(input);
  });
  assert.equal(report.summary.verdict, "error");
  assert.equal(report.summary.total, 2);
  assert.equal(report.summary.passRate, 0.5);
  assert.equal(report.summary.errors, 1);
  assert.deepEqual(report.summary.evaluations["exact-match"], { mean: 1, scoredRuns: 1, totalRuns: 2 });
  assert.equal(report.cases[1].error.phase, "execute");
});

test("a missing reference is inconclusive rather than a false success", async () => {
  const report = await runExperiment(experiment([{ id: "unknown", input: 2 }]), double);
  assert.equal(report.summary.verdict, "inconclusive");
  assert.equal(report.summary.inconclusive, 1);
  assert.equal(report.cases[0].expectedHash, null);
});

test("observational scores cannot approve an experiment without gates", async () => {
  const definition = experiment();
  definition.evaluators = [{ id: "quality", version: "1", kind: "score", evaluate: () => ({ score: 1, reason: "Looks good" }) }];
  const report = await runExperiment(definition, double);
  assert.equal(report.summary.verdict, "inconclusive");
  assert.equal(report.cases[0].evaluations[0].verdict, "scored");
});

test("a nonblocking low score does not override a passing gate", async () => {
  const definition = experiment();
  definition.evaluators.push({ id: "style", version: "1", kind: "score", evaluate: () => ({ score: 0, reason: "Poor style" }) });
  assert.equal((await runExperiment(definition, double)).summary.verdict, "passed");
});

test("invalid scores and evaluator errors remain explicit failures of execution", async () => {
  for (const score of [NaN, Infinity, -0.1, 1.1, undefined]) {
    const definition = experiment();
    definition.evaluators[0].evaluate = () => ({ score, reason: "Invalid scorer" });
    const report = await runExperiment(definition, double);
    assert.equal(report.summary.verdict, "error");
    assert.equal(report.cases[0].error.phase, "evaluate");
  }
});

test("evaluator errors do not prevent remaining evaluators from running", async () => {
  const definition = experiment();
  definition.evaluators.unshift({ id: "broken", version: "1", kind: "score", evaluate: () => { throw new Error("judge unavailable"); } });
  const report = await runExperiment(definition, double);
  assert.equal(report.summary.verdict, "error");
  assert.equal(report.cases[0].evaluations[1].verdict, "passed");
});

test("invalid experiment definitions fail before calling the executor", async () => {
  const mutations = [
    (value) => { value.dataset.cases = []; },
    (value) => { value.dataset.cases.push({ ...value.dataset.cases[0] }); },
    (value) => { value.evaluators.push(exactMatch()); },
    (value) => { value.evaluators = []; },
    (value) => { value.evaluators[0].threshold = NaN; },
    (value) => { value.evaluators[0].threshold = 2; },
    (value) => { value.variant.codeVersion = " "; },
    (value) => { value.dataset.split = "whatever"; },
    (value) => { value.dataset.cases[0].input = undefined; },
  ];
  for (const mutate of mutations) {
    const definition = experiment();
    mutate(definition);
    let executed = false;
    await assert.rejects(runExperiment(definition, () => { executed = true; return { output: 4 }; }));
    assert.equal(executed, false);
  }
});

test("repetition counts must be positive safe integers", async () => {
  for (const repetitions of [0, -1, 1.5, NaN, Infinity]) {
    await assert.rejects(runExperiment(experiment(), double, { repetitions }), /positive safe integer/);
  }
});

test("JSON fingerprints are stable across object key order", () => {
  assert.equal(fingerprint({ b: 2, a: [1, { x: true }] }), fingerprint({ a: [1, { x: true }], b: 2 }));
  assert.notEqual(fingerprint([1, 2]), fingerprint([2, 1]));
});

test("non-JSON data is rejected rather than silently changed in evidence", () => {
  const circular = {};
  circular.self = circular;
  const symbol = { [Symbol("hidden")]: true };
  for (const value of [undefined, NaN, Infinity, 1n, new Date(), new Map(), circular, symbol, new Array(2), { missing: undefined }]) {
    assert.throws(() => fingerprint(value), TypeError);
  }
  let getterRan = false;
  const getter = Object.defineProperty({}, "value", { enumerable: true, get() { getterRan = true; return 1; } });
  assert.throws(() => fingerprint(getter), /enumerable JSON/);
  assert.equal(getterRan, false);
});

test("JSON null is a real reference rather than a missing result", async () => {
  const report = await runExperiment(experiment([{ id: "null", input: null, expected: null }]), () => ({ output: null }));
  assert.equal(report.summary.verdict, "passed");
  assert.equal(report.cases[0].expectedHash, fingerprint(null));
});

test("executor mutations cannot rewrite the dataset, reference or provenance", async () => {
  const definition = experiment([{ id: "object", input: { value: 2 }, expected: { value: 4 } }]);
  const originalHash = fingerprint(definition.dataset);
  const report = await runExperiment(definition, (input) => {
    input.value = 99;
    definition.dataset.cases[0].expected.value = 99;
    definition.variant.version = "rewritten";
    definition.evaluators[0].threshold = 0;
    return { output: { value: 99 } };
  });
  assert.equal(report.summary.verdict, "failed");
  assert.equal(report.dataset.hash, originalHash);
  assert.equal(report.variant.version, "1");
  assert.equal(report.evaluators[0].threshold, 1);
});

test("each evaluator receives an isolated copy of inputs and outputs", async () => {
  const definition = experiment([{ id: "object", input: { value: 2 }, expected: { value: 4 } }]);
  definition.evaluators.unshift({
    id: "mutator", version: "1", kind: "score",
    evaluate({ output, expected }) { output.value = 99; expected.value = 100; return { score: 0, reason: "Mutated local copies" }; },
  });
  const report = await runExperiment(definition, () => ({ output: { value: 4 } }));
  assert.equal(report.summary.verdict, "passed");
  assert.deepEqual(report.cases[0].output, { value: 4 });
});

test("usage has explicit measurement coverage and never invents missing costs", async () => {
  const definition = experiment([
    { id: "measured", input: 2, expected: 4 },
    { id: "unmeasured", input: 3, expected: 6 },
  ]);
  const report = await runExperiment(definition, (input, { caseId }) => ({
    ...double(input), ...(caseId === "measured" ? { usage: { inputTokens: 10, outputTokens: 2, costUsd: 0 } } : {}),
  }));
  assert.deepEqual(report.summary.usage.costUsd, { total: 0, measuredRuns: 1 });
  assert.deepEqual(report.summary.usage.inputTokens, { total: 10, measuredRuns: 1 });
});

test("invalid outputs and invalid usage are preserved as execution errors", async () => {
  for (const execution of [{ output: NaN }, { output: undefined }, { output: 4, usage: null }, { output: 4, usage: [] }, { output: 4, usage: { costUsd: -1 } }, { output: 4, usage: { inputTokens: 1.5 } }]) {
    const report = await runExperiment(experiment(), () => execution);
    assert.equal(report.summary.verdict, "error");
  }
});

test("comparison reports improvements and case-level regressions", async () => {
  const definition = experiment();
  const baseline = await runExperiment(definition, double);
  definition.variant.version = "2";
  const candidate = await runExperiment(definition, () => ({ output: 9 }));
  const comparison = compareExperiments(baseline, candidate);
  assert.equal(comparison.comparable, true);
  assert.equal(comparison.passRateDelta, -1);
  assert.deepEqual(comparison.regressions, [{ caseId: "first", repetition: 1, from: "passed", to: "failed" }]);
  assert.equal(compareExperiments(candidate, baseline).passRateDelta, 1);
});

test("comparison refuses changes to datasets, references, splits, evaluators and repetitions", async () => {
  const baseline = await runExperiment(experiment(), double);
  const mutations = [
    (value) => { value.version = "2"; },
    (value) => { value.hypothesis = "A different hypothesis"; },
    (value) => { value.dataset.cases[0].input = 3; },
    (value) => { value.dataset.cases[0].expected = 6; },
    (value) => { value.dataset.split = "development"; },
    (value) => { value.evaluators[0].version = "2"; },
    (value) => { value.evaluators[0].threshold = 0.5; },
  ];
  for (const mutate of mutations) {
    const definition = experiment();
    mutate(definition);
    assert.equal(compareExperiments(baseline, await runExperiment(definition, double)).comparable, false);
  }
  const repeated = await runExperiment(experiment(), double, { repetitions: 2 });
  assert.equal(compareExperiments(baseline, repeated).comparable, false);
});

test("comparison survives report serialization and keeps missing scores explicit", async () => {
  const definition = experiment([{ id: "no-reference", input: 2 }]);
  const baseline = await runExperiment(definition, double);
  const candidate = JSON.parse(JSON.stringify(await runExperiment(definition, double)));
  const comparison = compareExperiments(JSON.parse(JSON.stringify(baseline)), candidate);
  assert.equal(comparison.comparable, true);
  assert.equal(comparison.evaluations[0].meanDelta, null);
});

test("score deltas require the same evaluated cases, not merely the same count", async () => {
  const definition = experiment([
    { id: "first", input: 2, expected: 4 },
    { id: "second", input: 3, expected: 6 },
  ]);
  const baseline = await runExperiment(definition, (input, { caseId }) => {
    if (caseId === "second") throw new Error("unavailable");
    return double(input);
  });
  const candidate = await runExperiment(definition, (input, { caseId }) => {
    if (caseId === "first") throw new Error("unavailable");
    return double(input);
  });
  const comparison = compareExperiments(baseline, candidate);
  assert.equal(comparison.comparable, true);
  assert.equal(comparison.evaluations[0].meanDelta, null);
});
