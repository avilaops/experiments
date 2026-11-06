import { readFile } from "node:fs/promises";
import path from "node:path";

export type OnnixEvidence = {
  available: boolean;
  stale?: boolean;
  createdAt?: string;
  modelSha256?: string;
  modelBytes?: number;
  provider?: string;
  evaluation?: {
    verdict: "passed" | "failed" | "error";
    latencyMs?: number;
    inputPixels?: number[];
    outputPixels?: number[];
    outputFormat?: string;
    outputBytes?: number;
  };
};

/** Read-only, deliberately limited bridge to the existing ONNIX CPU worker.
 * The collector writes a versioned atomic report into the Experiments volume.
 * No endpoint calls the ONNIX worker or exposes its bearer token.
 */
export async function latestOnnixEvidence(dataDirectory: string): Promise<OnnixEvidence> {
  const file = path.join(dataDirectory, "onnix", "latest.json");
  let value: unknown;
  try {
    const raw = await readFile(file, "utf8");
    if (Buffer.byteLength(raw) > 16 * 1024) throw new Error("oversized evidence");
    value = JSON.parse(raw);
  } catch (error) {
    if (error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return { available: false };
    }
    throw new Error("Invalid ONNIX evidence");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid ONNIX evidence");
  const row = value as Record<string, unknown>;
  if (row.schema !== "avila-onnix-evidence/1" || row.service !== "avila-upscale-cpu" ||
      typeof row.createdAt !== "string" || !Number.isFinite(Date.parse(row.createdAt)) ||
      typeof row.modelSha256 !== "string" || !/^[a-f0-9]{64}$/.test(row.modelSha256) ||
      typeof row.modelBytes !== "number" || !Number.isFinite(row.modelBytes)) {
    throw new Error("Invalid ONNIX evidence");
  }
  const evaluation = row.evaluation;
  if (!evaluation || typeof evaluation !== "object" || Array.isArray(evaluation)) throw new Error("Invalid ONNIX evidence");
  const result = evaluation as Record<string, unknown>;
  if (!["passed", "failed", "error"].includes(String(result.verdict))) throw new Error("Invalid ONNIX verdict");
  const timestamp = Date.parse(row.createdAt);
  const output: OnnixEvidence = {
    available: true,
    stale: timestamp > Date.now() + 60_000 || Date.now() - timestamp > 36 * 60 * 60 * 1000,
    createdAt: row.createdAt,
    modelSha256: row.modelSha256,
    modelBytes: row.modelBytes,
    provider: String(row.provider ?? "unknown"),
    evaluation: { verdict: result.verdict as "passed" | "failed" | "error" },
  };
  if (typeof result.latencyMs === "number" && Number.isFinite(result.latencyMs)) output.evaluation!.latencyMs = result.latencyMs;
  if (Array.isArray(result.inputPixels) && result.inputPixels.length === 2 && result.inputPixels.every(x => Number.isSafeInteger(x) && x > 0)) output.evaluation!.inputPixels = result.inputPixels;
  if (Array.isArray(result.outputPixels) && result.outputPixels.length === 2 && result.outputPixels.every(x => Number.isSafeInteger(x) && x > 0)) output.evaluation!.outputPixels = result.outputPixels;
  if (typeof result.outputFormat === "string") output.evaluation!.outputFormat = result.outputFormat;
  if (typeof result.outputBytes === "number" && Number.isFinite(result.outputBytes)) output.evaluation!.outputBytes = result.outputBytes;
  return output;
}
