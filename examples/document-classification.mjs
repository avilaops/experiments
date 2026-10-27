import { mkdir, readFile, writeFile } from "node:fs/promises";
import { compareExperiments, exactMatch, fingerprint, runExperiment } from "../dist/index.js";

const codeVersion = `sha256:${fingerprint(await readFile(new URL(import.meta.url), "utf8"))}`;

export const dataset = {
  id: "document-completeness",
  version: "1",
  split: "development",
  cases: [
    { id: "complete", group: "ordinary", input: { title: "Report", body: "Reviewed content" }, expected: "complete" },
    { id: "missing-body", group: "ordinary", input: { title: "Report", body: "" }, expected: "incomplete" },
    { id: "missing-title", group: "ordinary", input: { title: "", body: "Content" }, expected: "incomplete" },
    { id: "whitespace-title", group: "edge", input: { title: "  ", body: "Content" }, expected: "incomplete" },
    { id: "whitespace-body", group: "edge", input: { title: "Report", body: "\n\t" }, expected: "incomplete" },
    { id: "padded-content", group: "edge", input: { title: " Report ", body: " Content " }, expected: "complete" },
  ],
};

function experiment(version) {
  return {
    id: "classify-document",
    version: "1",
    hypothesis: "Trimming whitespace reduces false complete classifications in edge cases.",
    dataset,
    variant: {
      id: "deterministic-classifier",
      version,
      codeVersion,
      policyVersion: "required-title-and-body-v1",
    },
    evaluators: [exactMatch()],
  };
}

const baseline = await runExperiment(experiment("1"), ({ title, body }) => ({
  output: title && body ? "complete" : "incomplete",
}), { repetitions: 2 });

export const candidate = await runExperiment(experiment("2"), ({ title, body }) => ({
  output: title.trim() && body.trim() ? "complete" : "incomplete",
}), { repetitions: 2 });

const comparison = compareExperiments(baseline, candidate);
const reportDirectory = new URL(`../reports/classification/${candidate.runId}/`, import.meta.url);
await mkdir(reportDirectory, { recursive: true });
for (const [name, report] of Object.entries({ baseline, candidate, comparison })) {
  await writeFile(new URL(`${name}.json`, reportDirectory), `${JSON.stringify(report, null, 2)}\n`);
}
console.log(JSON.stringify({
  demonstration: "Offline deterministic fixture; no LLM was called. Development cases are not an independent holdout evaluation.",
  baseline: baseline.summary,
  candidate: candidate.summary,
  comparison,
}, null, 2));
