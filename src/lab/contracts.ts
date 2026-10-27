import type { DatasetCase, Dataset, Comparison, ExperimentReport } from "../types.js";

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
  }
}

export type CalculationInput = { operation: "add" | "subtract" | "multiply" | "divide"; left: number; right: number };
export interface Settings {
  absoluteTolerance: number;
  relativeTolerance: number;
  minimum: number;
  maximum: number;
  includeMinimum: boolean;
  includeMaximum: boolean;
  repetitions: number;
}
export interface SuiteDraft {
  hypothesis: string;
  cases: DatasetCase<CalculationInput>[];
  settings: Settings;
}
export interface Suite {
  revision: number;
  hypothesis: string;
  dataset: Dataset<CalculationInput>;
  settings: Settings;
}
export interface StoredRun {
  id: string;
  createdAt: string;
  mode: "deterministic-local";
  suite: Suite;
  baseline: ExperimentReport;
  candidate: ExperimentReport;
  comparison: Comparison;
}

export const DEFAULT_SETTINGS: Settings = {
  absoluteTolerance: 1e-9, relativeTolerance: 0,
  minimum: 0, maximum: 100,
  includeMinimum: true, includeMaximum: true,
  repetitions: 1,
};

export const DEFAULT_DRAFT: SuiteDraft = {
  hypothesis: "Preservar frações atende à precisão e aos limites declarados.",
  settings: DEFAULT_SETTINGS,
  cases: [
    { id: "decimal-addition", group: "decimals", input: { operation: "add", left: 0.1, right: 0.2 }, expected: 0.3 },
    { id: "upper-bound", group: "boundaries", input: { operation: "add", left: 60, right: 40 }, expected: 100 },
  ],
};

export function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, "INVALID_INPUT", `${name} deve ser um objeto.`);
  }
  return value as Record<string, unknown>;
}

function fields(value: Record<string, unknown>, allowed: string[], name: string) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new ApiError(400, "INVALID_INPUT", `${name} contém campos desconhecidos.`);
  }
}

function text(value: unknown, name: string, maximum = 120): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new ApiError(400, "INVALID_INPUT", `${name} deve conter de 1 a ${maximum} caracteres.`);
  }
  return value.trim();
}

function finite(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ApiError(400, "INVALID_INPUT", `${name} deve ser um número finito.`);
  }
  return value;
}

export function positiveInteger(value: unknown, name: string, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum) {
    throw new ApiError(400, "INVALID_INPUT", `${name} deve ser um inteiro entre 1 e ${maximum}.`);
  }
  return value as number;
}

export function parseDraft(value: unknown): SuiteDraft {
  const draft = record(value, "suite");
  fields(draft, ["hypothesis", "cases", "settings"], "suite");
  const hypothesis = text(draft.hypothesis, "hypothesis", 2000);
  if (!Array.isArray(draft.cases) || draft.cases.length === 0 || draft.cases.length > 200) {
    throw new ApiError(400, "INVALID_INPUT", "cases deve conter entre 1 e 200 casos.");
  }
  const ids = new Set<string>();
  const cases = draft.cases.map((value, index): DatasetCase<CalculationInput> => {
    const item = record(value, `cases[${index}]`);
    fields(item, ["id", "group", "input", "expected"], "case");
    const id = text(item.id, "case.id", 80);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(id) || ids.has(id)) {
      throw new ApiError(400, "INVALID_INPUT", "Cada caso precisa de um id único com letras, números, ponto, hífen ou sublinhado.");
    }
    ids.add(id);
    const input = record(item.input, "case.input");
    fields(input, ["operation", "left", "right"], "case.input");
    if (!["add", "subtract", "multiply", "divide"].includes(String(input.operation))) {
      throw new ApiError(400, "INVALID_INPUT", "Operação não suportada.");
    }
    return {
      id,
      input: {
        operation: input.operation as CalculationInput["operation"],
        left: finite(input.left, "input.left"), right: finite(input.right, "input.right"),
      },
      ...(item.group === undefined ? {} : { group: text(item.group, "case.group", 80) }),
      ...(item.expected === undefined ? {} : { expected: finite(item.expected, "case.expected") }),
    };
  });
  const settings = record(draft.settings, "settings");
  fields(settings, Object.keys(DEFAULT_SETTINGS), "settings");
  const absoluteTolerance = finite(settings.absoluteTolerance, "absoluteTolerance");
  const relativeTolerance = finite(settings.relativeTolerance, "relativeTolerance");
  const minimum = finite(settings.minimum, "minimum");
  const maximum = finite(settings.maximum, "maximum");
  if (absoluteTolerance < 0 || relativeTolerance < 0 || minimum > maximum) {
    throw new ApiError(400, "INVALID_INPUT", "Tolerâncias devem ser não negativas e minimum não pode exceder maximum.");
  }
  if (typeof settings.includeMinimum !== "boolean" || typeof settings.includeMaximum !== "boolean") {
    throw new ApiError(400, "INVALID_INPUT", "As opções de inclusão dos limites devem ser booleanas.");
  }
  if (minimum === maximum && (!settings.includeMinimum || !settings.includeMaximum)) {
    throw new ApiError(400, "INVALID_INPUT", "Os limites exclusivos não podem definir um intervalo vazio.");
  }
  return {
    hypothesis, cases,
    settings: {
      absoluteTolerance, relativeTolerance, minimum, maximum,
      includeMinimum: settings.includeMinimum, includeMaximum: settings.includeMaximum,
      repetitions: positiveInteger(settings.repetitions, "repetitions", 10),
    },
  };
}

export function calculate({ operation, left, right }: CalculationInput): number {
  switch (operation) {
    case "add": return left + right;
    case "subtract": return left - right;
    case "multiply": return left * right;
    case "divide":
      if (right === 0) throw new RangeError("Divisão por zero.");
      return left / right;
  }
}

export function runId(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new ApiError(400, "INVALID_RUN_ID", "Identificador de execução inválido.");
  }
  return value;
}
