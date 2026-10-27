import { canonicalJson, snapshot } from "./json.js";
import type { Assessment, EvaluatorDefinition, Experiment, JsonValue, Usage } from "./types.js";

export function requireText(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${name} must be nonempty`);
}

export function requirePositiveInteger(value: unknown, name: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
}

export function validateExperiment<Input extends JsonValue, Output extends JsonValue>(
  experiment: Experiment<Input, Output>,
): EvaluatorDefinition[] {
  requireText(experiment.id, "experiment.id");
  requireText(experiment.version, "experiment.version");
  requireText(experiment.hypothesis, "experiment.hypothesis");
  requireText(experiment.variant.id, "variant.id");
  requireText(experiment.variant.version, "variant.version");
  requireText(experiment.variant.codeVersion, "variant.codeVersion");
  for (const field of ["instructionVersion", "policyVersion", "modelVersion"] as const) {
    if (experiment.variant[field] !== undefined) requireText(experiment.variant[field], `variant.${field}`);
  }
  canonicalJson(experiment.variant);
  requireText(experiment.dataset.id, "dataset.id");
  requireText(experiment.dataset.version, "dataset.version");
  if (!["development", "evaluation"].includes(experiment.dataset.split)) {
    throw new TypeError("dataset.split must be development or evaluation");
  }
  if (!Array.isArray(experiment.dataset.cases) || experiment.dataset.cases.length === 0) {
    throw new TypeError("dataset.cases must be a nonempty array");
  }
  const caseIds = new Set<string>();
  for (const item of experiment.dataset.cases) {
    requireText(item.id, "case.id");
    if (caseIds.has(item.id)) throw new TypeError(`Duplicate case ID: ${item.id}`);
    caseIds.add(item.id);
    if (item.group !== undefined) requireText(item.group, "case.group");
    canonicalJson(item);
    canonicalJson(item.input);
  }
  if (!Array.isArray(experiment.evaluators) || experiment.evaluators.length === 0) {
    throw new TypeError("evaluators must be a nonempty array");
  }
  const evaluatorIds = new Set<string>();
  return experiment.evaluators.map((evaluator) => {
    requireText(evaluator.id, "evaluator.id");
    requireText(evaluator.version, "evaluator.version");
    if (evaluatorIds.has(evaluator.id)) throw new TypeError(`Duplicate evaluator ID: ${evaluator.id}`);
    evaluatorIds.add(evaluator.id);
    if (typeof evaluator.evaluate !== "function") throw new TypeError("evaluator.evaluate must be a function");
    const metadata = {
      id: evaluator.id,
      version: evaluator.version,
      ...(evaluator.parameters === undefined ? {} : { parameters: snapshot(evaluator.parameters) }),
    };
    if (evaluator.kind === "score") {
      if ("threshold" in evaluator) throw new TypeError("Observational scores cannot have a gate threshold");
      return { ...metadata, kind: "score" };
    }
    if (evaluator.kind !== "gate" || !Number.isFinite(evaluator.threshold) || evaluator.threshold < 0 || evaluator.threshold > 1) {
      throw new TypeError("A gate requires a finite threshold between 0 and 1");
    }
    return { ...metadata, kind: "gate", threshold: evaluator.threshold };
  });
}

export function validateAssessment(assessment: Assessment): void {
  if (!assessment || (assessment.score !== null && (!Number.isFinite(assessment.score) || assessment.score < 0 || assessment.score > 1))) {
    throw new TypeError("An assessment requires a null score or a finite score between 0 and 1");
  }
  requireText(assessment.reason, "assessment.reason");
}

export function validateUsage(usage: Usage): void {
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) {
    throw new TypeError("usage must be a JSON object");
  }
  for (const key of Object.keys(usage)) {
    if (!["inputTokens", "outputTokens", "costUsd"].includes(key)) throw new TypeError(`Unknown usage metric: ${key}`);
  }
  for (const key of ["inputTokens", "outputTokens", "costUsd"] as const) {
    const value = usage[key];
    if (value !== undefined && (!Number.isFinite(value) || value < 0 || (key !== "costUsd" && !Number.isSafeInteger(value)))) {
      throw new TypeError(`usage.${key} must be a finite nonnegative ${key === "costUsd" ? "number" : "safe integer"}`);
    }
  }
}
