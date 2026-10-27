import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fingerprint, numericTolerance, pathFidelity, runExperiment } from "../dist/index.js";

const scenarios = [
  { id: "valid", expectedVerdict: "passed" },
  { id: "missing-fiscal", expectedVerdict: "failed" },
  { id: "reversed", expectedVerdict: "failed" },
  { id: "forbidden", expectedVerdict: "failed" },
  { id: "failed-margin", expectedVerdict: "failed" },
  { id: "incomplete", expectedVerdict: "inconclusive" },
];
const numeric = numericTolerance({ absoluteTolerance: 1e-9 });
const experiment = {
  id: "discount-path-policy", version: "1",
  hypothesis: "A correct discount must also follow the declared successful execution path.",
  dataset: {
    id: "simulated-discount-paths", version: "1", split: "development",
    cases: scenarios.map(({ id }) => ({ id, input: { scenario: id }, expected: 12 })),
  },
  variant: { id: "instrumented-local-simulation", version: "1", codeVersion: `sha256:${fingerprint(execute.toString())}` },
  evaluators: [
    { ...numeric, evaluate: (context) => numeric.evaluate({ ...context, output: context.output.value }) },
    pathFidelity({
      requiredNodes: ["fiscal", "margin", "discount"], forbiddenNodes: ["bypass"],
      allowedTransitions: [["fiscal", "margin"], ["margin", "discount"]],
    }),
  ],
};

// The recorder wraps actual local calls. These fixtures are not remote agents,
// an ERP integration, a sandbox, or evidence that model-generated traces are authentic.
function execute({ scenario }) {
  const steps = [];
  function call(node, tool) {
    try {
      const result = tool();
      steps.push({ node, status: "succeeded" });
      return result;
    } catch (error) {
      steps.push({ node, status: "failed" });
      throw error;
    }
  }
  const fiscal = () => call("fiscal", () => ({ rate: 0.12 }));
  const margin = () => call("margin", () => {
    if (scenario === "failed-margin") throw new Error("Margin policy rejected the discount");
    return true;
  });
  if (scenario === "incomplete") {
    fiscal();
    return { output: { value: 12, trace: { complete: false, steps } } };
  }
  if (scenario === "reversed") {
    margin();
    fiscal();
  } else {
    if (scenario !== "missing-fiscal") fiscal();
    try { margin(); } catch {
      // Deliberate bad executor: a correct number must not hide the failure.
    }
  }
  if (scenario === "forbidden") call("bypass", () => true);
  const value = call("discount", () => 100 * 0.12);
  return { output: { value, trace: { complete: true, steps } } };
}

export const report = await runExperiment(experiment, execute);
for (const scenario of scenarios) {
  const result = report.cases.find(({ caseId }) => caseId === scenario.id);
  assert.equal(result.verdict, scenario.expectedVerdict, scenario.id);
  assert.equal(result.evaluations[0].verdict, "passed", `${scenario.id}: numeric gate`);
}
const directory = new URL(`../reports/path-policy/${report.runId}/`, import.meta.url);
await mkdir(directory, { recursive: true });
await writeFile(new URL("report.json", directory), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  verification: "passed", simulation: true, expectedVerdictsVerified: scenarios.length,
  experimentVerdict: report.summary.verdict, reportDirectory: directory.pathname,
  cases: report.cases.map(({ caseId, verdict, evaluations }) => ({ caseId, verdict, evaluations })),
}, null, 2));
