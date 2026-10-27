import { canonicalJson } from "./json.js";
import type { Evaluator, JsonValue } from "./types.js";
import { requireText } from "./validation.js";

export function exactMatch<Input extends JsonValue = JsonValue, Output extends JsonValue = JsonValue>(): Evaluator<Input, Output> {
  return {
    id: "exact-match",
    version: "1",
    kind: "gate",
    threshold: 1,
    evaluate({ expected, output }) {
      if (expected === undefined) return { score: null, reason: "No reference output was provided" };
      const matches = canonicalJson(expected) === canonicalJson(output);
      return { score: matches ? 1 : 0, reason: matches ? "Output matches the reference" : "Output differs from the reference" };
    },
  };
}

export interface NumericToleranceOptions {
  absoluteTolerance?: number;
  relativeTolerance?: number;
}

function requireFiniteNumber(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be a finite number`);
}

export function numericTolerance<Input extends JsonValue = JsonValue, Output extends JsonValue = JsonValue>(
  options: NumericToleranceOptions = {},
): Evaluator<Input, Output> {
  const absoluteTolerance = options.absoluteTolerance === undefined ? 0 : options.absoluteTolerance;
  const relativeTolerance = options.relativeTolerance === undefined ? 0 : options.relativeTolerance;
  requireFiniteNumber(absoluteTolerance, "absoluteTolerance");
  requireFiniteNumber(relativeTolerance, "relativeTolerance");
  if (absoluteTolerance < 0 || relativeTolerance < 0) {
    throw new TypeError("Numeric tolerances must be nonnegative");
  }

  return {
    id: "numeric-tolerance",
    version: "1",
    parameters: { absoluteTolerance, relativeTolerance },
    kind: "gate",
    threshold: 1,
    evaluate({ expected, output }) {
      if (typeof expected !== "number" || !Number.isFinite(expected)) {
        return { score: null, reason: "A finite numeric reference is required" };
      }
      if (typeof output !== "number" || !Number.isFinite(output)) {
        return { score: 0, reason: "Output must be a finite number" };
      }
      const absoluteError = Math.abs(output - expected);
      // Opposite finite extremes can overflow subtraction; their ratio still
      // represents the relative error without treating Infinity <= Infinity as a pass.
      const relativeError = expected === 0
        ? (output === 0 ? 0 : Infinity)
        : (Number.isFinite(absoluteError)
            ? absoluteError / Math.abs(expected)
            : Math.abs(output / expected - 1));
      const passes = absoluteError <= absoluteTolerance || relativeError <= relativeTolerance;
      return {
        score: passes ? 1 : 0,
        reason: passes
          ? "Output is within the absolute or relative tolerance"
          : "Output exceeds both absolute and relative tolerances",
      };
    },
  };
}

export interface NumberRangeOptions {
  minimum: number;
  maximum: number;
  includeMinimum?: boolean;
  includeMaximum?: boolean;
}

export function numberRange<Input extends JsonValue = JsonValue, Output extends JsonValue = JsonValue>(
  options: NumberRangeOptions,
): Evaluator<Input, Output> {
  const { minimum, maximum } = options;
  const includeMinimum = options.includeMinimum === undefined ? true : options.includeMinimum;
  const includeMaximum = options.includeMaximum === undefined ? true : options.includeMaximum;
  requireFiniteNumber(minimum, "minimum");
  requireFiniteNumber(maximum, "maximum");
  if (typeof includeMinimum !== "boolean" || typeof includeMaximum !== "boolean") {
    throw new TypeError("Range inclusion options must be booleans");
  }
  if (minimum > maximum) throw new TypeError("minimum cannot exceed maximum");
  if (minimum === maximum && (!includeMinimum || !includeMaximum)) {
    throw new TypeError("An exclusive range with identical bounds is empty");
  }

  return {
    id: "number-range",
    version: "2",
    parameters: { minimum, maximum, includeMinimum, includeMaximum },
    kind: "gate",
    threshold: 1,
    evaluate({ output }) {
      const passes = typeof output === "number" && Number.isFinite(output)
        && (includeMinimum ? output >= minimum : output > minimum)
        && (includeMaximum ? output <= maximum : output < maximum);
      return {
        score: passes ? 1 : 0,
        reason: passes ? "Output is inside the declared numeric range" : "Output must be a finite number inside the declared numeric range",
      };
    },
  };
}

export type AgentTraceStep = { node: string; status: "succeeded" | "failed" };
export type AgentTrace = { complete: boolean; steps: AgentTraceStep[] };

export interface PathFidelityOptions {
  /** Successful milestones, in order; other steps may occur between them. */
  requiredNodes: readonly string[];
  /** Any observed attempt at these nodes fails, even if the attempt failed. */
  forbiddenNodes?: readonly string[];
  /** When supplied, every adjacent pair must be an allowed directed edge. */
  allowedTransitions?: readonly (readonly [string, string])[];
}

function nodeList(value: unknown, name: string): string[] {
  if (!Array.isArray(value)) throw new TypeError(`${name} must be an array`);
  return Array.from(value, (node: unknown) => {
    requireText(node, `${name} node`);
    return node;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Checks output.trace against a deterministic policy, not THESEUS PED/F1 metrics.
 * Trace authenticity must be established by the tool executor, outside this gate.
 */
export function pathFidelity<Input extends JsonValue = JsonValue, Output extends JsonValue = JsonValue>(
  options: PathFidelityOptions,
): Evaluator<Input, Output> {
  const requiredNodes = nodeList(options.requiredNodes, "requiredNodes");
  const forbiddenNodes = nodeList(options.forbiddenNodes === undefined ? [] : options.forbiddenNodes, "forbiddenNodes");
  if (requiredNodes.length === 0) throw new TypeError("requiredNodes must not be empty");
  if (requiredNodes.some((node) => forbiddenNodes.includes(node))) {
    throw new TypeError("A required node cannot also be forbidden");
  }
  let allowedTransitions: string[][] | undefined;
  if (options.allowedTransitions !== undefined) {
    if (!Array.isArray(options.allowedTransitions)) throw new TypeError("allowedTransitions must be an array");
    allowedTransitions = Array.from(options.allowedTransitions, (edge) => {
      const nodes = nodeList(edge, "allowedTransitions edge");
      if (nodes.length !== 2) throw new TypeError("Each transition must contain exactly two nodes");
      return nodes;
    });
  }
  // Public provenance and private policy never share caller-owned arrays.
  const parameters = {
    requiredNodes: [...requiredNodes], forbiddenNodes: [...forbiddenNodes],
    ...(allowedTransitions === undefined ? {} : { allowedTransitions: allowedTransitions.map((edge) => [...edge]) }),
  };
  Object.freeze(parameters.requiredNodes);
  Object.freeze(parameters.forbiddenNodes);
  parameters.allowedTransitions?.forEach(Object.freeze);
  if (parameters.allowedTransitions) Object.freeze(parameters.allowedTransitions);
  Object.freeze(parameters);

  return {
    id: "path-fidelity", version: "1", parameters, kind: "gate", threshold: 1,
    evaluate({ output }) {
      if (!isRecord(output) || output.trace === undefined) {
        return { score: null, reason: "No execution trace was provided" };
      }
      const trace = output.trace;
      if (!isRecord(trace) || typeof trace.complete !== "boolean" || !Array.isArray(trace.steps)) {
        return { score: 0, reason: "Malformed execution trace" };
      }
      const steps: AgentTraceStep[] = [];
      for (const step of trace.steps) {
        if (!isRecord(step) || typeof step.node !== "string" || !step.node.trim()
          || (step.status !== "succeeded" && step.status !== "failed")) {
          return { score: 0, reason: "Malformed execution step" };
        }
        steps.push({ node: step.node, status: step.status });
      }
      for (let index = 0; index < steps.length; index++) {
        const step = steps[index]!;
        if (forbiddenNodes.includes(step.node)) return { score: 0, reason: `Forbidden node attempted: ${step.node}` };
        if (step.status === "failed") return { score: 0, reason: `Execution step failed: ${step.node}` };
        const previous = steps[index - 1];
        if (previous && allowedTransitions !== undefined
          && !allowedTransitions.some(([from, to]) => from === previous.node && to === step.node)) {
          return { score: 0, reason: `Forbidden transition: ${previous.node} -> ${step.node}` };
        }
      }
      if (!trace.complete) return { score: null, reason: "Execution trace is incomplete" };
      let milestone = 0;
      for (const step of steps) {
        if (step.node === requiredNodes[milestone]) milestone++;
      }
      if (milestone !== requiredNodes.length) {
        return { score: 0, reason: `Missing or out-of-order required node: ${requiredNodes[milestone]}` };
      }
      return { score: 1, reason: "Successful execution follows the declared path policy" };
    },
  };
}
