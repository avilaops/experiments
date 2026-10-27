import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { fingerprint, snapshot } from "./json.js";
import { requirePositiveInteger, validateAssessment, validateExperiment, validateUsage } from "./validation.js";
import type {
  CaseResult, EvaluationResult, EvaluatorDefinition, Experiment,
  ExperimentReport, Executor, JsonValue, Summary, Verdict,
} from "./types.js";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "A non-Error value was thrown";
}

function verdictOf(evaluations: EvaluationResult[], definitions: EvaluatorDefinition[]): Verdict {
  if (evaluations.some((result) => result.verdict === "error")) return "error";
  if (evaluations.some((result) => result.verdict === "failed")) return "failed";
  const gates = definitions.filter((definition) => definition.kind === "gate");
  if (gates.length === 0 || evaluations.some((result) => result.verdict === "inconclusive" && gates.some((gate) => gate.id === result.evaluatorId))) {
    return "inconclusive";
  }
  return "passed";
}

export function summarize(cases: CaseResult[], definitions: EvaluatorDefinition[]): Summary {
  if (cases.length === 0) throw new TypeError("Cannot summarize an empty set of executions");
  const counts = { passed: 0, failed: 0, inconclusive: 0, error: 0 };
  for (const result of cases) counts[result.verdict]++;
  const verdict: Verdict = counts.error > 0 ? "error" : counts.failed > 0 ? "failed" : counts.inconclusive > 0 ? "inconclusive" : "passed";
  const durations = cases.map((result) => result.durationMs).sort((left, right) => left - right);

  function usageMetric(key: "inputTokens" | "outputTokens" | "costUsd") {
    const values = cases.flatMap((result) => result.usage[key] === undefined ? [] : [result.usage[key]!]);
    return { total: values.length ? values.reduce((sum, value) => sum + value, 0) : null, measuredRuns: values.length };
  }

  const evaluations: Summary["evaluations"] = Object.create(null);
  for (const definition of definitions) {
    const values = cases.flatMap((result) => result.evaluations.flatMap((assessment) =>
      assessment.evaluatorId === definition.id && assessment.score !== null ? [assessment.score] : [],
    ));
    evaluations[definition.id] = {
      mean: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
      scoredRuns: values.length,
      totalRuns: cases.length,
    };
  }
  return {
    verdict,
    total: cases.length,
    passed: counts.passed,
    failed: counts.failed,
    inconclusive: counts.inconclusive,
    errors: counts.error,
    passRate: counts.passed / cases.length,
    durationMs: {
      mean: durations.reduce((sum, value) => sum + value, 0) / durations.length,
      p95: durations[Math.ceil(durations.length * 0.95) - 1]!,
    },
    usage: { inputTokens: usageMetric("inputTokens"), outputTokens: usageMetric("outputTokens"), costUsd: usageMetric("costUsd") },
    evaluations,
  };
}

export async function runExperiment<Input extends JsonValue, Output extends JsonValue>(
  experiment: Experiment<Input, Output>,
  execute: Executor<Input, Output>,
  options: { repetitions?: number } = {},
): Promise<ExperimentReport> {
  const definitions = validateExperiment(experiment);
  const repetitions = options.repetitions ?? 1;
  requirePositiveInteger(repetitions, "repetitions");
  if (typeof execute !== "function") throw new TypeError("execute must be a function");
  const dataset = snapshot(experiment.dataset);
  const variant = snapshot(experiment.variant);
  const identity = { id: experiment.id, version: experiment.version, hypothesis: experiment.hypothesis };
  const evaluators = experiment.evaluators.map((evaluator, index) => ({ definition: definitions[index]!, evaluate: evaluator.evaluate }));
  const startedAt = new Date().toISOString();
  const cases: CaseResult[] = [];

  for (const item of dataset.cases) {
    for (let repetition = 1; repetition <= repetitions; repetition++) {
      const result: CaseResult = {
        caseId: item.id,
        group: item.group ?? null,
        repetition,
        verdict: "error",
        inputHash: fingerprint(item.input),
        expectedHash: item.expected === undefined ? null : fingerprint(item.expected),
        outputHash: null,
        output: null,
        durationMs: 0,
        usage: {},
        evaluations: [],
        error: null,
      };
      const started = performance.now();
      let output: Output;
      try {
        const execution = await execute(snapshot(item.input), { caseId: item.id, repetition });
        output = snapshot(execution.output);
        result.outputHash = fingerprint(output);
        result.output = output;
        const usage = snapshot(execution.usage === undefined ? {} : execution.usage);
        validateUsage(usage);
        result.usage = usage;
      } catch (error) {
        result.error = { phase: "execute", message: messageOf(error) };
        result.durationMs = performance.now() - started;
        cases.push(result);
        continue;
      }

      for (const evaluator of evaluators) {
        const definition = evaluator.definition;
        try {
          const assessment = await evaluator.evaluate({
            caseId: item.id,
            input: snapshot(item.input),
            expected: item.expected === undefined ? undefined : snapshot(item.expected),
            output: snapshot(output),
          });
          validateAssessment(assessment);
          const verdict = assessment.score === null ? "inconclusive" : definition.kind === "score" ? "scored" : assessment.score >= definition.threshold ? "passed" : "failed";
          result.evaluations.push({ evaluatorId: definition.id, score: assessment.score, reason: assessment.reason, verdict });
        } catch (error) {
          const message = messageOf(error);
          result.evaluations.push({ evaluatorId: definition.id, score: null, reason: message, verdict: "error" });
          result.error ??= { phase: "evaluate", message };
        }
      }
      result.verdict = verdictOf(result.evaluations, definitions);
      result.durationMs = performance.now() - started;
      cases.push(result);
    }
  }

  const groupNames = [...new Set(cases.flatMap((result) => result.group === null ? [] : [result.group]))].sort();
  return {
    schemaVersion: "1",
    runId: randomUUID(),
    startedAt,
    completedAt: new Date().toISOString(),
    experiment: identity,
    dataset: { id: dataset.id, version: dataset.version, split: dataset.split, hash: fingerprint(dataset), caseCount: dataset.cases.length },
    variant,
    evaluators: definitions,
    repetitions,
    cases,
    summary: summarize(cases, definitions),
    groups: groupNames.map((name) => ({ name, summary: summarize(cases.filter((result) => result.group === name), definitions) })),
  };
}
