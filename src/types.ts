export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface DatasetCase<Input extends JsonValue = JsonValue> {
  id: string;
  input: Input;
  expected?: JsonValue;
  group?: string;
}

export interface Dataset<Input extends JsonValue = JsonValue> {
  id: string;
  version: string;
  split: "development" | "evaluation";
  cases: DatasetCase<Input>[];
}

export interface Variant {
  id: string;
  version: string;
  codeVersion: string;
  instructionVersion?: string;
  policyVersion?: string;
  modelVersion?: string;
  parameters?: JsonValue;
}

export interface EvaluationContext<Input extends JsonValue, Output extends JsonValue> {
  caseId: string;
  input: Input;
  expected: JsonValue | undefined;
  output: Output;
}

export interface Assessment {
  score: number | null;
  reason: string;
}

export type Evaluator<Input extends JsonValue = JsonValue, Output extends JsonValue = JsonValue> = {
  id: string;
  version: string;
  parameters?: JsonValue;
  evaluate: (context: EvaluationContext<Input, Output>) => Assessment | Promise<Assessment>;
} & ({ kind: "gate"; threshold: number } | { kind: "score" });

export interface Experiment<Input extends JsonValue = JsonValue, Output extends JsonValue = JsonValue> {
  id: string;
  version: string;
  hypothesis: string;
  dataset: Dataset<Input>;
  variant: Variant;
  evaluators: Evaluator<Input, Output>[];
}

export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}

export interface Execution<Output extends JsonValue> {
  output: Output;
  usage?: Usage;
}

export type Executor<Input extends JsonValue, Output extends JsonValue> = (
  input: Input,
  context: { caseId: string; repetition: number },
) => Execution<Output> | Promise<Execution<Output>>;

export type Verdict = "passed" | "failed" | "inconclusive" | "error";

export type EvaluatorDefinition = {
  id: string;
  version: string;
  parameters?: JsonValue;
} & ({ kind: "gate"; threshold: number } | { kind: "score" });

export interface EvaluationResult extends Assessment {
  evaluatorId: string;
  verdict: "passed" | "failed" | "inconclusive" | "scored" | "error";
}

export interface CaseResult {
  caseId: string;
  group: string | null;
  repetition: number;
  verdict: Verdict;
  inputHash: string;
  expectedHash: string | null;
  outputHash: string | null;
  output: JsonValue | null;
  durationMs: number;
  usage: Usage;
  evaluations: EvaluationResult[];
  error: { phase: "execute" | "evaluate"; message: string } | null;
}

export interface Summary {
  verdict: Verdict;
  total: number;
  passed: number;
  failed: number;
  inconclusive: number;
  errors: number;
  passRate: number;
  durationMs: { mean: number; p95: number };
  usage: {
    inputTokens: { total: number | null; measuredRuns: number };
    outputTokens: { total: number | null; measuredRuns: number };
    costUsd: { total: number | null; measuredRuns: number };
  };
  evaluations: Record<string, { mean: number | null; scoredRuns: number; totalRuns: number }>;
}

export interface ExperimentReport {
  schemaVersion: "1";
  runId: string;
  startedAt: string;
  completedAt: string;
  experiment: { id: string; version: string; hypothesis: string };
  dataset: { id: string; version: string; split: Dataset["split"]; hash: string; caseCount: number };
  variant: Variant;
  evaluators: EvaluatorDefinition[];
  repetitions: number;
  cases: CaseResult[];
  summary: Summary;
  groups: { name: string; summary: Summary }[];
}

export type Comparison =
  | { comparable: false; reasons: string[] }
  | {
      comparable: true;
      baselineRunId: string;
      candidateRunId: string;
      passRateDelta: number;
      meanDurationMsDelta: number;
      evaluations: { id: string; meanDelta: number | null }[];
      regressions: { caseId: string; repetition: number; from: Verdict; to: Verdict }[];
    };
