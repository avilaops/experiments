import { SCHEMAS } from "./schema.js";

const json = (schema: object) => ({ "application/json": { schema } });
const response = { description: "Catálogo paginado ou registro salvo, com revisão global.", content: json({ type: "object" }), headers: { ETag: { schema: { type: "string" } } } };
const errors = Object.fromEntries([400, 401, 409, 412, 428, 503].map(status => [status, { description: `Erro ${status}; a resposta não confirma gravação.`, content: json({ $ref: "#/components/schemas/Error" }) }]));
const parameters = [
  { name: "q", in: "query", schema: { type: "string", maxLength: 160 } },
  { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 25 } },
  { name: "offset", in: "query", schema: { type: "integer", minimum: 0, maximum: 100000, default: 0 } },
];
export const ARCHITECTURE_PATHS = {
  ...Object.fromEntries(Object.entries(SCHEMAS).map(([entity, schema]) => [`/api/v1/architecture/${entity}`, {
    get: { operationId: `listArchitecture_${entity}`, parameters, responses: { "200": response, ...errors } },
    put: { operationId: `saveArchitecture_${entity}`, parameters: [{ name: "If-Match", in: "header", required: true, schema: { type: "string", pattern: '^"(?:0|[1-9][0-9]*)"$' } }],
      description: "Cadastro versionado com motivo obrigatório; evidências, avaliações e deployments não podem ser sobrescritos. Não executa nem comprova as fontes declaradas.",
      requestBody: { required: true, content: json({ type: "object", additionalProperties: false, required: ["record", "changeNote"], properties: { record: schema, changeNote: { type: "string", minLength: 1, maxLength: 2000 } } }) },
      responses: { "200": response, ...errors } },
  }])),
  ...Object.fromEntries(["coverage", "dependency_map"].map(name => [`/api/v1/architecture/reports/${name}`, {
    get: { operationId: `architectureReport_${name}`, parameters: parameters.slice(1), responses: { "200": response, ...errors } },
  }])),
  "/api/v1/architecture/schemas": { get: { operationId: "architectureSchemas", responses: { "200": { description: "JSON Schemas dos registros aceitos.", content: json({ type: "object" }) }, ...errors } } },
  "/api/v1/architecture/{entity}/{id}/history": { get: { operationId: "architectureHistory", parameters: [
    { name: "entity", in: "path", required: true, schema: { type: "string", enum: Object.keys(SCHEMAS) } },
    { name: "id", in: "path", required: true, schema: { type: "string" } }, ...parameters.slice(1),
  ], responses: { "200": response, ...errors } } },
};
