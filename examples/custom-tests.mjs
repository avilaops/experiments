import { mkdir, readFile, writeFile } from "node:fs/promises";
import { compareExperiments, fingerprint, numberRange, numericTolerance, runExperiment } from "../dist/index.js";

export const dataset = JSON.parse(await readFile(new URL("./suites/calculation.cases.json", import.meta.url), "utf8"));
const codeVersion = `sha256:${fingerprint(await readFile(new URL(import.meta.url), "utf8"))}`;

function calculate({ operation, left, right }) {
  if (!Number.isFinite(left) || !Number.isFinite(right)) throw new TypeError("Both operands must be finite numbers");
  switch (operation) {
    case "add": return left + right;
    case "subtract": return left - right;
    case "multiply": return left * right;
    case "divide":
      if (right === 0) throw new RangeError("Division by zero");
      return left / right;
    default: throw new TypeError(`Unsupported operation: ${operation}`);
  }
}

function experiment(version) {
  return {
    id: "our-calculation-tests",
    version: "1",
    hypothesis: "Preserving fractional results satisfies the declared tolerances and output bounds.",
    dataset,
    variant: { id: "calculator", version, codeVersion },
    evaluators: [
      numericTolerance({ absoluteTolerance: 1e-9, relativeTolerance: 0 }),
      numberRange({ minimum: 0, maximum: 100 }),
      {
        id: "custom-operation-policy",
        version: "1",
        parameters: { allowedOperations: ["add", "subtract", "multiply", "divide"] },
        kind: "gate",
        threshold: 1,
        evaluate({ input }) {
          const allowed = ["add", "subtract", "multiply", "divide"].includes(input.operation);
          return { score: allowed ? 1 : 0, reason: allowed ? "Operation belongs to our declared policy" : "Operation is outside our declared policy" };
        },
      },
    ],
  };
}

export const baseline = await runExperiment(experiment("rounded"), (input) => ({ output: Math.round(calculate(input)) }));
export const candidate = await runExperiment(experiment("fractional"), (input) => ({ output: calculate(input) }));
const comparison = compareExperiments(baseline, candidate);
const reportDirectory = new URL(`../reports/custom-tests/${candidate.runId}/`, import.meta.url);
await mkdir(reportDirectory, { recursive: true });
for (const [name, report] of Object.entries({ baseline, candidate, comparison })) {
  await writeFile(new URL(`${name}.json`, reportDirectory), `${JSON.stringify(report, null, 2)}\n`);
}
console.log(JSON.stringify({
  dataset: "examples/suites/calculation.cases.json",
  reportDirectory: reportDirectory.pathname,
  baseline: { verdict: baseline.summary.verdict, passed: baseline.summary.passed, total: baseline.summary.total },
  candidate: { verdict: candidate.summary.verdict, passed: candidate.summary.passed, total: candidate.summary.total },
  cases: candidate.cases.map(({ caseId, verdict, output }) => ({ caseId, verdict, output })),
  comparison,
}, null, 2));
process.exitCode = candidate.summary.verdict === "passed" && comparison.comparable && comparison.regressions.length === 0 ? 0 : 1;
