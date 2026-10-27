import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import Ajv from "ajv";

const schema = JSON.parse(await readFile(new URL("../schemas/fiscal-input.v0.1.schema.json", import.meta.url), "utf8"));
const validate = new Ajv({ strict: true, allErrors: true, coerceTypes: false, useDefaults: false, removeAdditional: false }).compile(schema);

/** Validates context only. Never returns a tax calculation or authorization. */
export function inspectFiscalInput(input) {
  if (!validate(input)) return { status: "invalid", issues: structuredClone(validate.errors), pending: [] };
  const issues = [];
  const pending = [];
  const issue = (instancePath, message) => issues.push({ instancePath, message });
  const missing = (instancePath, message) => pending.push({ instancePath, message });
  const date = new Date(`${input.operation.date}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== input.operation.date) issue("/operation/date", "Data de calendário inválida.");
  if (input.operation.finalConsumer === null) missing("/operation/finalConsumer", "Informar a finalidade declarada da operação.");
  if (input.ruleSnapshot === null) missing("/ruleSnapshot", "Selecionar um snapshot de regras; não assumir alíquota zero.");
  for (const side of ["seller", "buyer"]) {
    const party = input[side];
    for (const field of ["icmsContributor", "taxRegime"]) if (party[field] === "unknown") missing(`/${side}/${field}`, "Perfil fiscal desconhecido.");
    if (party.taxProfileSnapshotRef === null) missing(`/${side}/taxProfileSnapshotRef`, "Referenciar o cadastro fiscal versionado.");
  }
  const lineIds = new Set();
  input.items.forEach((item, index) => {
    const prefix = `/items/${index}`;
    if (lineIds.has(item.lineId)) issue(`${prefix}/lineId`, "Identificador de linha duplicado.");
    lineIds.add(item.lineId);
    // Schema has already bounded and validated the decimal string; no Number conversion.
    if (BigInt(item.quantity.replace(".", "")) === 0n) issue(`${prefix}/quantity`, "Quantidade deve ser maior que zero.");
    for (const field of ["ncm", "originCode", "classificationSnapshotRef"]) {
      if (item[field] === null) missing(`${prefix}/${field}`, "Contexto da mercadoria não informado.");
    }
    // CEST and CFOP depend on rule resolution. Null does not decide applicability.
  });
  return { status: issues.length ? "invalid" : pending.length ? "needs_context" : "context_recorded", issues, pending };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) throw new Error("Uso: node scripts/validate-fiscal-input.mjs arquivo.json");
    const result = inspectFiscalInput(JSON.parse(await readFile(process.argv[2], "utf8")));
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== "context_recorded") process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
