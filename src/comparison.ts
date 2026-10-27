import { canonicalJson } from "./json.js";
import type { Comparison, ExperimentReport } from "./types.js";

function caseIdentity(report: ExperimentReport) {
  return report.cases.map(({ caseId, repetition, inputHash, expectedHash, group }) => ({ caseId, repetition, inputHash, expectedHash, group }));
}

function scoredCases(report: ExperimentReport, evaluatorId: string) {
  return report.cases.filter((result) => result.evaluations.some((evaluation) =>
    evaluation.evaluatorId === evaluatorId && evaluation.score !== null,
  )).map(({ caseId, repetition }) => ({ caseId, repetition }));
}

export function compareExperiments(baseline: ExperimentReport, candidate: ExperimentReport): Comparison {
  const reasons: string[] = [];
  if (baseline.schemaVersion !== "1" || candidate.schemaVersion !== "1") reasons.push("Unsupported report schema version");
  if (canonicalJson(baseline.experiment) !== canonicalJson(candidate.experiment)) reasons.push("Experiment identity, version or hypothesis differs");
  if (canonicalJson(baseline.dataset) !== canonicalJson(candidate.dataset)) reasons.push("Dataset snapshots differ");
  if (baseline.repetitions !== candidate.repetitions) reasons.push("Repetition counts differ");
  if (canonicalJson(baseline.evaluators) !== canonicalJson(candidate.evaluators)) reasons.push("Evaluator definitions or gate thresholds differ");
  if (canonicalJson(caseIdentity(baseline)) !== canonicalJson(caseIdentity(candidate))) reasons.push("Executed cases or references differ");
  if (reasons.length) return { comparable: false, reasons };

  return {
    comparable: true,
    baselineRunId: baseline.runId,
    candidateRunId: candidate.runId,
    passRateDelta: candidate.summary.passRate - baseline.summary.passRate,
    meanDurationMsDelta: candidate.summary.durationMs.mean - baseline.summary.durationMs.mean,
    evaluations: baseline.evaluators.map(({ id }) => {
      const before = baseline.summary.evaluations[id]!;
      const after = candidate.summary.evaluations[id]!;
      return {
        id,
        meanDelta: before.mean === null || after.mean === null || canonicalJson(scoredCases(baseline, id)) !== canonicalJson(scoredCases(candidate, id)) ? null : after.mean - before.mean,
      };
    }),
    regressions: baseline.cases.flatMap((before, index) => {
      const after = candidate.cases[index]!;
      return before.verdict === "passed" && after.verdict !== "passed"
        ? [{ caseId: before.caseId, repetition: before.repetition, from: before.verdict, to: after.verdict }]
        : [];
    }),
  };
}
