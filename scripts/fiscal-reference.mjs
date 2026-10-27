import { createHash } from "node:crypto";
import { open, readFile } from "node:fs/promises";
import Ajv from "ajv";
import { fingerprint } from "../dist/index.js";
import { inspectFiscalInput } from "./validate-fiscal-input.mjs";
import { planFiscalSimulation } from "./fiscal-plan.mjs";

const ajv = new Ajv({ strict: true, allErrors: true });
ajv.addSchema(JSON.parse(await readFile(new URL("../schemas/fiscal-resolution.v0.1.schema.json", import.meta.url), "utf8")));
const validateReference = ajv.compile(JSON.parse(await readFile(new URL("../schemas/fiscal-reference.v0.1.schema.json", import.meta.url), "utf8")));
const MAX_BYTES = 2 * 1024 * 1024;

export const referenceHash = bytes => createHash("sha256").update(bytes).digest("hex");
// Exclude only the snapshot pointer to avoid a circular hash dependency.
// Everything else, including requestId, date, quantities and prices, stays bound.
export const referenceContextFingerprint = input => fingerprint({ ...input, ruleSnapshot: null });

function calendarDate(value) {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Loads a reference capsule, not executable code or a tax-law interpreter.
 * The caller supplies a local file and a pinned input; the loader never repairs
 * a mismatching hash or modifies the input to accommodate a source.
 */
export async function resolveFiscalReference(input, file) {
  const context = structuredClone(input);
  const steps = [];
  const stop = (status, message) => ({ status, simulationOnly: true, taxCalculation: false,
    issues: [{ message }], referenceTrace: { complete: true, steps } });
  const step = async (node, action) => {
    try { const value = await action(); steps.push({ node, status: "succeeded" }); return value; }
    catch (error) { steps.push({ node, status: "failed" }); throw error; }
  };
  try {
    await step("validate_context", () => {
      const result = inspectFiscalInput(context);
      if (result.status !== "context_recorded") throw new Error(`Entrada indisponível para resolução: ${result.status}`);
    });
    const bytes = await step("load_reference_snapshot", async () => {
      const handle = await open(file, "r");
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error("Referência deve ser arquivo regular de até 2 MiB.");
        // Read at most the limit plus one even if the file grows after stat.
        const buffer = Buffer.alloc(MAX_BYTES + 1);
        let count = 0;
        while (count < buffer.length) {
          const { bytesRead } = await handle.read(buffer, count, buffer.length - count, null);
          if (!bytesRead) break;
          count += bytesRead;
        }
        if (count > MAX_BYTES) throw new Error("Referência excede 2 MiB.");
        return buffer.subarray(0, count);
      } finally { await handle.close(); }
    });
    const source = await step("verify_reference_integrity", () => {
      if (referenceHash(bytes) !== context.ruleSnapshot.sha256) throw new Error("SHA-256 da referência diverge do snapshot fixado.");
      const parsed = JSON.parse(bytes.toString("utf8"));
      if (!validateReference(parsed)) throw new Error("Referência não atende ao schema de engineering_fixture.");
      if (parsed.id !== context.ruleSnapshot.id || parsed.version !== context.ruleSnapshot.version) throw new Error("Identificador ou versão da referência diverge.");
      return parsed;
    });
    await step("check_reference_window", () => {
      if (!calendarDate(source.validFrom) || !calendarDate(source.validUntil) || source.validFrom >= source.validUntil) throw new Error("Intervalo de referência inválido.");
      if (context.operation.date < source.validFrom || context.operation.date >= source.validUntil) throw new Error("Data da operação fora do intervalo de referência [início, fim).");
    });
    await step("match_reference_context", () => {
      if (referenceContextFingerprint(context) !== source.contextFingerprint) throw new Error("Referência não corresponde ao contexto integral da operação.");
    });
    const resolution = await step("build_resolution", () => ({ schemaVersion: "0.1", inputFingerprint: fingerprint(context),
      ruleSnapshot: structuredClone(context.ruleSnapshot), lines: structuredClone(source.lines) }));
    const plan = await step("plan_simulation", () => planFiscalSimulation(context, resolution));
    return { status: plan.status, simulationOnly: true, taxCalculation: false,
      source: { id: source.id, version: source.version, sha256: referenceHash(bytes), bytes: bytes.length,
        validFrom: source.validFrom, validUntil: source.validUntil, purpose: source.purpose },
      inputFingerprint: fingerprint(context), resolution, plan,
      referenceTrace: { complete: true, steps } };
  } catch (error) { return stop("blocked", error.message); }
}
