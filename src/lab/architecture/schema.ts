import { Ajv2020 } from "ajv/dist/2020.js";
import { ApiError, record } from "../contracts.js";

const text = (maxLength = 200, nullable = false) => ({ type: nullable ? ["string", "null"] : "string", minLength: 1, maxLength, pattern: "\\S" });
const id = { type: "string", pattern: "^[a-z][a-z0-9._-]{0,79}$" };
const reference = { ...text(2000), pattern: "^https://[^\\s]+$" };
const nullableReference = { ...reference, type: ["string", "null"] };
const timestamp = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$" };
const hash = (length: number, nullable = true) => ({ type: nullable ? ["string", "null"] : "string", pattern: `^[a-f0-9]{${length}}$` });
const option = (...values: string[]) => ({ type: "string", enum: values });
const nullableId = { ...id, type: ["string", "null"] };

// These fixed definitions are the only source of SQL identifiers. Request values are bound separately.
export const ENTITIES = {
  applications: { name: text(), description: text(4000), owner: text(200, true), lifecycle: option("unknown", "proposed", "active", "retired"), repository: nullableReference },
  components: { application_id: id, name: text(), kind: option("web", "api", "worker", "datastore", "integration", "library"), responsibility: text(4000) },
  interfaces: { provider_component_id: id, name: text(), protocol: option("http", "event", "file", "sql", "library"), contract_version: text(80), reference },
  dependencies: { consumer_component_id: id, interface_id: id, purpose: text(4000), criticality: option("unknown", "low", "medium", "high") },
  data_assets: { application_id: id, authority_component_id: id, name: text(), classification: option("unknown", "public", "internal", "confidential", "restricted"), description: text(4000) },
  standards: { application_id: nullableId, title: text(), category: option("architecture", "interface", "security", "data", "operations"), rule: text(10000), owner: text(200, true), status: option("proposed", "documented", "retired"), policy_reference: nullableReference },
  evidence: { application_id: id, kind: option("document", "code", "test", "deployment", "runtime"), location: reference, source_commit: hash(40), content_sha256: hash(64), observed_at: timestamp, summary: text(4000) },
  assessments: { application_id: id, standard_id: id, standard_version: { type: "integer", minimum: 1, maximum: 2147483647 }, evidence_id: nullableId, outcome: option("passed", "failed", "inconclusive"), notes: text(4000) },
  deployments: { application_id: id, component_id: id, environment: option("development", "staging", "production"), source_commit: hash(40, false), artifact_sha256: hash(64, false), evidence_id: id, observed_at: timestamp },
} as const;
export type Entity = keyof typeof ENTITIES;
export const IMMUTABLE: ReadonlySet<Entity> = new Set(["evidence", "assessments", "deployments"]);
const camel = (value: string) => value.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
export const property = camel;
export const SCHEMAS = Object.fromEntries(Object.entries(ENTITIES).map(([entity, fields]) => [entity, {
  type: "object", additionalProperties: false, required: ["id", ...Object.keys(fields).map(camel)],
  properties: { id, ...Object.fromEntries(Object.entries(fields).map(([name, schema]) => [camel(name), schema])) },
}]));
const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
const validators = Object.fromEntries(Object.entries(SCHEMAS).map(([name, schema]) => [name, ajv.compile(schema)]));

export function entityName(value: string): Entity {
  if (!Object.hasOwn(ENTITIES, value)) throw new ApiError(404, "UNKNOWN_ENTITY", "Cadastro de arquitetura não encontrado.");
  return value as Entity;
}
export function parseRecord(entity: Entity, input: unknown): Record<string, unknown> {
  const value = record(input, entity);
  if (!validators[entity]!(value)) throw new ApiError(400, "INVALID_ARCHITECTURE", `Campos inválidos em ${entity}.`);
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string" && /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(item)) throw new ApiError(400, "INVALID_ARCHITECTURE", "Caracteres de controle não são aceitos.");
    if (key === "observedAt" && (typeof item !== "string" || !Number.isFinite(Date.parse(item)) || new Date(item).toISOString() !== item || Date.parse(item) > Date.now())) {
      throw new ApiError(400, "INVALID_ARCHITECTURE", "A data de observação deve ser válida e não futura.");
    }
    if (typeof item === "string" && ["location", "repository", "reference", "policyReference"].includes(key)) {
      if (!URL.canParse(item)) throw new ApiError(400, "INVALID_ARCHITECTURE", "Referência HTTPS inválida.");
      const url = new URL(item);
      if (url.username || url.password) throw new ApiError(400, "INVALID_ARCHITECTURE", "Referências não podem conter credenciais.");
    }
  }
  return structuredClone(value);
}
export function changeNote(input: unknown): string {
  if (typeof input !== "string" || !input.trim() || input.length > 2000) throw new ApiError(400, "INVALID_ARCHITECTURE", "Informe o motivo da alteração, até 2000 caracteres.");
  return input.trim();
}
export function revisionHeader(input: string | string[] | undefined): number {
  if (input === undefined) throw new ApiError(428, "REVISION_REQUIRED", "Envie If-Match com a revisão do catálogo.");
  if (typeof input !== "string" || !/^"(?:0|[1-9][0-9]*)"$/.test(input) || Number(input.slice(1, -1)) > 2147483646) throw new ApiError(400, "INVALID_REVISION", "If-Match inválido.");
  return Number(input.slice(1, -1));
}
export function queryOptions(params: URLSearchParams) {
  for (const key of params.keys()) if (!["q", "limit", "offset"].includes(key) || params.getAll(key).length !== 1) throw new ApiError(400, "INVALID_QUERY", "Use q, limit e offset uma vez cada.");
  const q = params.get("q") ?? "", limit = params.get("limit") ?? "25", offset = params.get("offset") ?? "0";
  if (q.length > 160 || q.includes("\0") || !/^[1-9]\d*$/.test(limit) || Number(limit) > 100 || !/^(0|[1-9]\d*)$/.test(offset) || Number(offset) > 100000) throw new ApiError(400, "INVALID_QUERY", "Filtro ou paginação inválidos.");
  return { q, limit: Number(limit), offset: Number(offset) };
}
