import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { exactMatch, fingerprint, pathFidelity, runExperiment } from "../dist/index.js";
import { planFiscalSimulation } from "../scripts/fiscal-plan.mjs";

const input = JSON.parse(await readFile(new URL("./fiscal/domestic-sale.context.json", import.meta.url), "utf8"));
const resolution = JSON.parse(await readFile(new URL("./fiscal/domestic-sale.resolution.json", import.meta.url), "utf8"));
const plan = planFiscalSimulation(input, resolution);
assert.equal(plan.status, "planned");
const policy = plan.plans[0].pathPolicy;
const scenarios = [
  { id: "declared-path", verdict: "passed" },
  { id: "missing-ncm-step", verdict: "failed" },
  { id: "reversed-own-st", verdict: "failed" },
  { id: "attempted-issuance", verdict: "failed" },
  { id: "interrupted", verdict: "inconclusive" },
];

function execute({ scenario }) {
  let nodes = [...policy.requiredNodes];
  if (scenario === "missing-ncm-step") nodes = nodes.filter(node => node !== "validate_ncm");
  if (scenario === "reversed-own-st") nodes = nodes.map(node => node === "calculate_icms_own" ? "calculate_icms_st" : node === "calculate_icms_st" ? "calculate_icms_own" : node);
  if (scenario === "attempted-issuance") nodes.push("issue_document");
  if (scenario === "interrupted") nodes = nodes.slice(0, 3);
  // Fixture recorder only: callbacks execute no fiscal checks or calculations.
  const steps = [];
  for (const node of nodes) {
    const fixtureTool = () => ({ synthetic: true, node });
    fixtureTool();
    steps.push({ node, status: "succeeded" });
  }
  return { output: { marker: "fixture-12", trace: { complete: scenario !== "interrupted", steps } } };
}

const marker = exactMatch();
const report = await runExperiment({
  id: "fiscal-conditional-path-fixtures", version: "0.1",
  hypothesis: "The same synthetic marker cannot hide violations of the declared simulation path.",
  dataset: { id: "development-fiscal-paths", version: "0.1", split: "development",
    cases: scenarios.map(scenario => ({ id: scenario.id, expected: "fixture-12", input: { scenario: scenario.id, context: input, resolution } })) },
  variant: { id: "fixture-recorder", version: "0.1", codeVersion: fingerprint(await readFile(new URL(import.meta.url), "utf8")),
    policyVersion: plan.policyVersion, parameters: { plan, plannerHash: fingerprint(await readFile(new URL("../scripts/fiscal-plan.mjs", import.meta.url), "utf8")),
      resolutionSchemaHash: fingerprint(await readFile(new URL("../schemas/fiscal-resolution.v0.1.schema.json", import.meta.url), "utf8")) } },
  evaluators: [{ ...marker, evaluate: context => marker.evaluate({ ...context, output: context.output.marker }) }, pathFidelity(policy)],
}, execute);
for (const scenario of scenarios) {
  const result = report.cases.find(item => item.caseId === scenario.id);
  assert.equal(result.verdict, scenario.verdict, scenario.id);
  assert.equal(result.evaluations[0].verdict, "passed");
}
const directory = new URL(`../reports/fiscal-paths/${report.runId}/`, import.meta.url);
await mkdir(directory, { recursive: true });
await writeFile(new URL("report.json", directory), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ verification: "passed", synthetic: true, taxCalculation: false, scenariosVerified: scenarios.length,
  directory: directory.pathname, results: report.cases.map(item => ({ id: item.caseId, verdict: item.verdict })) }, null, 2));
