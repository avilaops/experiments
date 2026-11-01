export type ObjectValue = Record<string, unknown>;
export interface ApiDocument extends ObjectValue { paths: Record<string, ObjectValue> }
export interface ApiOperation { key: string; method: string; path: string; group: string; title: string; detail: ObjectValue; pathItem: ObjectValue }
export interface SchemaField { name: string; required: boolean; schema: unknown }
export type Example = { value: unknown; complete: boolean };
export const asObject = (value: unknown): ObjectValue => value !== null && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : {};
export const text = (value: unknown): string => typeof value === "string" ? value : "";
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

/** Resolve local JSON pointers only. Documentation never fetches an external reference. */
export function resolve(document: ApiDocument, input: unknown, seen = new Set<string>()): ObjectValue {
  const value = asObject(input), reference = text(value.$ref);
  if (!reference || !reference.startsWith("#/") || seen.has(reference) || seen.size >= 16) return value;
  let target: unknown = document;
  try {
    for (const part of reference.slice(2).split("/")) {
      const key = decodeURIComponent(part).replace(/~1/g, "/").replace(/~0/g, "~");
      if (!Object.hasOwn(asObject(target), key)) return value;
      target = asObject(target)[key];
    }
  } catch { return value; }
  const { $ref: _, ...siblings } = value;
  return { ...resolve(document, target, new Set([...seen, reference])), ...siblings };
}

export function fields(document: ApiDocument, input: unknown, depth = 0): SchemaField[] {
  if (depth > 8) return [];
  const schema = resolve(document, input), entries = new Map<string, SchemaField>();
  for (const part of list(schema.allOf)) for (const field of fields(document, part, depth + 1)) entries.set(field.name, field);
  const required = new Set(list(schema.required));
  for (const [name, child] of Object.entries(asObject(schema.properties))) entries.set(name, { name, schema: child, required: required.has(name) || entries.get(name)?.required === true });
  for (const [name, field] of entries) if (required.has(name)) entries.set(name, { ...field, required: true });
  return [...entries.values()];
}

export function schemaType(document: ApiDocument, input: unknown): string {
  if (input === false) return "Nunca aceito";
  if (input === true) return "Qualquer valor JSON";
  const schema = resolve(document, input);
  if (schema.$ref) return text(schema.$ref).split("/").at(-1) || "Referência";
  if (schema.const !== undefined) return JSON.stringify(schema.const);
  if (schema.oneOf || schema.anyOf) return "Alternativas de schema";
  if (schema.allOf) return "Objeto composto";
  const type = Array.isArray(schema.type) ? schema.type.join(" | ") : text(schema.type) || (schema.properties ? "object" : "JSON");
  return type + (schema.format ? ` · ${text(schema.format)}` : "");
}

export function example(document: ApiDocument, input: unknown, depth = 0): Example {
  if (depth > 6 || input === false) return { value: null, complete: false };
  const schema = resolve(document, input);
  for (const key of ["example", "default", "const"]) if (Object.hasOwn(schema, key)) return { value: schema[key], complete: true };
  if (list(schema.examples).length) return { value: list(schema.examples)[0], complete: true };
  if (list(schema.enum).length) return { value: list(schema.enum)[0], complete: true };
  const alternative = list(schema.oneOf ?? schema.anyOf)[0];
  if (alternative !== undefined) return example(document, alternative, depth + 1);
  if (schema.$ref) return { value: null, complete: false };
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types.includes("null")) return { value: null, complete: true };
  const ownFields = fields(document, schema);
  if (types.includes("object") || ownFields.length) {
    const entries = ownFields.filter(field => field.required), selected = entries.length ? entries : ownFields.slice(0, 6);
    const generated = selected.slice(0, 24).map(field => [field.name, example(document, field.schema, depth + 1)] as const);
    return { value: Object.fromEntries(generated.map(([key, result]) => [key, result.value])), complete: ownFields.length > 0 && selected.length <= 24 && generated.every(([, result]) => result.complete) };
  }
  if (types.includes("array")) {
    const item = example(document, schema.items, depth + 1);
    const count = Math.min(typeof schema.minItems === "number" ? schema.minItems : 1, 3);
    return { value: Array.from({ length: count }, () => item.value), complete: item.complete && !(typeof schema.minItems === "number" && schema.minItems > 3) };
  }
  if (types.includes("boolean")) return { value: false, complete: true };
  if (types.includes("integer") || types.includes("number")) {
    const value = typeof schema.minimum === "number" ? schema.minimum : typeof schema.exclusiveMinimum === "number" ? schema.exclusiveMinimum + 1 : 0;
    return { value, complete: true };
  }
  if (types.includes("string")) {
    const formats: Record<string, string> = { date: "2026-01-01", "date-time": "2026-01-01T00:00:00.000Z", uuid: "11111111-1111-4111-8111-111111111111", email: "cliente@example.com", uri: "https://example.com" };
    const min = typeof schema.minLength === "number" ? schema.minLength : 0, max = typeof schema.maxLength === "number" ? schema.maxLength : 200;
    const candidates = [formats[text(schema.format)], "Exemplo", "EXAMPLE-001", "0.00", '"0"', '"1"', "a".repeat(64), "exemplo".repeat(Math.min(Math.ceil(min / 7), 40)), ""];
    try {
      const pattern = schema.pattern ? new RegExp(text(schema.pattern)) : undefined;
      const candidate = candidates.find(value => value !== undefined && value.length >= min && value.length <= max && (!pattern || pattern.test(value)));
      if (candidate !== undefined) return { value: candidate, complete: true };
    } catch { /* Unsupported patterns remain visible in the schema inspector. */ }
    return { value: "<preencher conforme o schema>", complete: false };
  }
  return { value: null, complete: false };
}

const groups: Record<string, string> = { "client-contracts": "Contratos com clientes", policies: "Políticas", "product-contexts": "Contextos de produtos", "route-inventories": "Inventários de rotas", suite: "Suíte de experimentos", runs: "Execuções", comparisons: "Comparações" };
const titles: Record<string, string> = { listClientContracts: "Consultar contratos", saveClientContract: "Salvar contrato", getClientContractHistory: "Consultar versões do contrato", getErpProductContext: "Consultar contexto do ERP", importErpProductContext: "Importar contexto do ERP", listRouteProducts: "Consultar produtos", getRouteInventory: "Consultar inventário", importRouteInventory: "Importar inventário", getPolicyCatalog: "Consultar políticas", savePolicy: "Salvar política", previewPolicyImport: "Conferir importação", importPolicies: "Importar políticas", getSuite: "Consultar suíte", updateSuite: "Revisar suíte", listRuns: "Consultar execuções", executeSuite: "Executar suíte", getRun: "Consultar execução", compareRuns: "Comparar resultados", health: "Consultar saúde do serviço", openapi: "Obter contrato OpenAPI" };
export function operations(document: ApiDocument): ApiOperation[] {
  const result: ApiOperation[] = [];
  for (const [path, input] of Object.entries(document.paths)) {
    const pathItem = resolve(document, input);
    for (const method of ["get", "post", "put", "patch", "delete", "options", "head", "trace"]) {
      if (!pathItem[method]) continue;
      const detail = resolve(document, pathItem[method]), id = text(detail.operationId);
      result.push({ key: method.toUpperCase() + " " + path, method: method.toUpperCase(), path, group: groups[path.split("/")[3] ?? ""] ?? "Serviço e contrato", title: text(detail.summary) || titles[id] || id || path, detail, pathItem });
    }
  }
  return result;
}
export function parameters(document: ApiDocument, operation: ApiOperation): ObjectValue[] {
  const entries = new Map<string, ObjectValue>();
  for (const input of [...list(operation.pathItem.parameters), ...list(operation.detail.parameters)]) {
    const value = resolve(document, input); entries.set(text(value.in) + ":" + text(value.name), value);
  }
  return [...entries.values()];
}
export function bodySchema(document: ApiDocument, input: unknown): unknown {
  const body = resolve(document, input);
  return asObject(asObject(body.content)["application/json"]).schema;
}
export function responses(document: ApiDocument, operation: ApiOperation): { status: string; detail: ObjectValue; schema: unknown }[] {
  return Object.entries(asObject(operation.detail.responses)).map(([status, input]) => {
    const detail = resolve(document, input); return { status, detail, schema: bodySchema(document, detail) };
  });
}

export function snippets(input: { method: string; path: string; headers?: Record<string, string>; headerVariables?: Record<string, string>; body?: unknown; bodyFromEnvironment?: boolean; erp?: boolean }): Record<"curl" | "typescript" | "rust", string> {
  const variable = input.erp ? "AVILA_ERP_API_URL" : "AVILA_API_URL", token = input.erp ? "AVILA_ERP_API_TOKEN" : "AVILA_API_TOKEN";
  const route = input.path.replace(/\{([^}]+)\}/g, (_, name: string) => "EXAMPLE_" + name.replace(/[^a-zA-Z0-9_]/g, "_"));
  const headers = { ...(input.body === undefined && !input.bodyFromEnvironment ? {} : { "Content-Type": "application/json" }), ...input.headers };
  const variables = Object.entries(input.headerVariables ?? {}).filter(([, value]) => /^[A-Z][A-Z0-9_]*$/.test(value));
  const json = input.body === undefined ? undefined : JSON.stringify(input.body, null, 2);
  const shell = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";
  const curl = [`curl --request ${input.method.replace(/[^A-Z]/g, "")}`, `  --url "$${variable}"${shell(route)}`, `  --header "Authorization: Bearer $${token}"`, ...Object.entries(headers).map(([key, value]) => `  --header ${shell(key + ": " + value)}`), ...variables.map(([key, value]) => `  --header ${shell(key + ": ")}"$${value}"`), ...(input.bodyFromEnvironment ? ['  --data "${AVILA_REQUEST_BODY:?Defina AVILA_REQUEST_BODY}"'] : json === undefined ? [] : [`  --data ${shell(json)}`])].join(" \\\n");
  const typescript = `${input.bodyFromEnvironment ? 'const body = JSON.parse(process.env.AVILA_REQUEST_BODY ?? "");\n' : ""}const url = new URL(${JSON.stringify(route)}, process.env.${variable});\nconst response = await fetch(url, {\n  method: ${JSON.stringify(input.method)},\n  headers: {\n    Authorization: \`Bearer \${process.env.${token}}\`,${Object.entries(headers).map(([key, value]) => `\n    ${JSON.stringify(key)}: ${JSON.stringify(value)},`).join("")}${variables.map(([key, value]) => `\n    ${JSON.stringify(key)}: process.env.${value} ?? "",`).join("")}\n  },${input.bodyFromEnvironment ? "\n  body: JSON.stringify(body)," : json === undefined ? "" : `\n  body: JSON.stringify(${json.split("\n").join("\n  ")}),`}\n});\nif (!response.ok) throw new Error(\`HTTP \${response.status}\`);\nconsole.log(await response.json());`;
  let hashes = "#";
  while (json?.includes('"' + hashes)) hashes += "#";
  const rust = `// Dependências: reqwest (json), tokio (macros, rt-multi-thread), serde_json\n#[tokio::main]\nasync fn main() -> Result<(), Box<dyn std::error::Error>> {\n    let base = std::env::var("${variable}")?;\n    let token = std::env::var("${token}")?;\n    let client = reqwest::Client::new();\n    let response = client\n        .request(reqwest::Method::from_bytes(${JSON.stringify(input.method)}.as_bytes())?, format!("{}{}", base.trim_end_matches('/'), ${JSON.stringify(route)}))\n        .bearer_auth(token)${Object.entries(headers).map(([key, value]) => `\n        .header(${JSON.stringify(key)}, ${JSON.stringify(value)})`).join("")}${variables.map(([key, value]) => `\n        .header(${JSON.stringify(key)}, std::env::var("${value}")?)`).join("")}${input.bodyFromEnvironment ? '\n        .json(&serde_json::from_str::<serde_json::Value>(&std::env::var("AVILA_REQUEST_BODY")?)?)' : json === undefined ? "" : `\n        .json(&serde_json::from_str::<serde_json::Value>(r${hashes}"${json}"${hashes})?)`}\n        .send().await?\n        .error_for_status()?;\n    println!("{}", response.json::<serde_json::Value>().await?);\n    Ok(())\n}`;
  return { curl, typescript, rust };
}
