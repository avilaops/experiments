import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import Ajv from "ajv";
import { fingerprint } from "../dist/index.js";
import { inspectFiscalInput } from "./validate-fiscal-input.mjs";

const schema = JSON.parse(await readFile(new URL("../schemas/fiscal-resolution.v0.1.schema.json", import.meta.url), "utf8"));
const validateResolution = new Ajv({ strict: true, allErrors: true }).compile(schema);
const TAX_NODES = { icmsOwn: "icms_own", icmsSt: "icms_st", difal: "difal" };
const PREFIX = ["validate_context", "verify_rule_snapshot", "resolve_profiles", "validate_ncm", "validate_cest_scope", "resolve_applicability"];

/** Compiles declared assessments into a simulation-only trace policy.
 * References and fingerprints bind data; they do not authenticate its source.
 */
export function planFiscalSimulation(input, resolution) {
  const inspected = inspectFiscalInput(input);
  if (inspected.status !== "context_recorded") return {
    status: inspected.status === "invalid" ? "invalid" : "blocked", plans: [],
    issues: [...inspected.issues, ...inspected.pending],
  };
  if (!validateResolution(resolution)) return { status: "invalid", plans: [], issues: structuredClone(validateResolution.errors) };
  const issues = [];
  const add = (instancePath, message) => issues.push({ instancePath, message });
  if (resolution.inputFingerprint !== fingerprint(input)) add("/inputFingerprint", "Resolução não corresponde à entrada.");
  for (const key of ["id", "version", "sha256"]) {
    if (resolution.ruleSnapshot[key] !== input.ruleSnapshot[key]) add(`/ruleSnapshot/${key}`, "Snapshot diverge da entrada.");
  }
  const byLine = new Map();
  const inputIds = new Set(input.items.map(item => item.lineId));
  resolution.lines.forEach((line, index) => {
    if (byLine.has(line.lineId)) add(`/lines/${index}/lineId`, "Resolução duplicada.");
    if (!inputIds.has(line.lineId)) add(`/lines/${index}/lineId`, "Linha não existe na entrada.");
    byLine.set(line.lineId, line);
  });
  for (const item of input.items) if (!byLine.has(item.lineId)) add("/lines", `Resolução ausente: ${item.lineId}`);
  if (issues.length) return { status: "invalid", plans: [], issues };
  resolution.lines.forEach((line, index) => {
    if (line.classification.status !== "matched") add(`/lines/${index}/classification`, "Classificação rejeitada ou indeterminada.");
    for (const [tax, assessment] of Object.entries(line.taxes)) {
      if (assessment.applicability === "undetermined") add(`/lines/${index}/taxes/${tax}`, "Aplicabilidade não resolvida; não assumir valor zero.");
    }
  });
  // A blocked line blocks the entire proposed document; no partial execution plan.
  if (issues.length) return { status: "blocked", plans: [], issues };
  const plans = input.items.map(item => {
    const line = byLine.get(item.lineId);
    const requiredNodes = [...PREFIX];
    const forbiddenNodes = ["bypass_validation", "issue_document", "activate_rules"];
    for (const [tax, suffix] of Object.entries(TAX_NODES)) {
      const applies = line.taxes[tax].applicability === "applicable";
      const calculation = `calculate_${suffix}`;
      const notApplicable = `record_${suffix}_not_applicable`;
      requiredNodes.push(applies ? calculation : notApplicable);
      forbiddenNodes.push(applies ? notApplicable : calculation);
    }
    requiredNodes.push("record_simulation");
    return { lineId: item.lineId, pathPolicy: {
      requiredNodes, forbiddenNodes,
      allowedTransitions: requiredNodes.slice(1).map((node, index) => [requiredNodes[index], node]),
    } };
  });
  return { status: "planned", policyVersion: "fiscal-simulation-path-0.1", simulationOnly: true,
    inputFingerprint: resolution.inputFingerprint, resolutionFingerprint: fingerprint(resolution),
    ruleSnapshot: structuredClone(resolution.ruleSnapshot), plans, issues: [] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 4) throw new Error("Uso: node scripts/fiscal-plan.mjs entrada.json resolucao.json");
    const result = planFiscalSimulation(JSON.parse(await readFile(process.argv[2], "utf8")), JSON.parse(await readFile(process.argv[3], "utf8")));
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== "planned") process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
