import { CONTRACT_CYCLES, CONTRACT_PRODUCTS, CONTRACT_STATUSES } from "./client-contract-types.js";

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const response = (name: string, description = "Sucesso") => ({ description, content: { "application/json": { schema: ref(name) } } });
const etag = { ETag: { description: "Revisão global do cadastro entre aspas.", schema: { type: "string" } } };
const errors = { "400": response("Error", "Entrada inválida"), "401": response("Error", "Token do laboratório necessário"), "403": response("Error", "Origem recusada"), "500": response("Error", "Falha de armazenamento; arquivo preservado") };
const properties = {
  code: { type: "string", minLength: 1, maxLength: 60, pattern: "^[A-Za-z0-9][A-Za-z0-9./_-]*$", description: "Normalizado para maiúsculas; único no cadastro atual." },
  title: { type: "string", minLength: 1, maxLength: 200 }, clientName: { type: "string", minLength: 1, maxLength: 200 },
  clientReference: { type: "string", maxLength: 120 }, product: { type: "string", enum: CONTRACT_PRODUCTS.map(item => item.id) },
  status: { type: "string", enum: Object.keys(CONTRACT_STATUSES), description: "Situação declarada manualmente." },
  startDate: { type: "string", format: "date", description: "Data civil válida entre 0001-01-01 e 9999-12-31." },
  endDate: { anyOf: [{ type: "string", format: "date" }, { const: "" }], description: "Vazio ou data válida igual ou posterior ao início." },
  amount: { type: "string", pattern: "^(?:0|[1-9]\\d{0,9})\\.\\d{2}$", description: "Valor em BRL com duas casas decimais. Sem separador de milhar." },
  billingCycle: { type: "string", enum: Object.keys(CONTRACT_CYCLES) }, notes: { type: "string", maxLength: 4000 },
};
export const CLIENT_CONTRACT_SCHEMAS = {
  ClientContractDraft: { type: "object", additionalProperties: false, required: Object.keys(properties), properties },
  ClientContract: { type: "object", additionalProperties: false, required: [...Object.keys(properties), "id", "version", "createdAt", "updatedAt"], properties: {
    ...properties, id: { type: "string", format: "uuid" }, version: { type: "integer", minimum: 1 }, createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" },
  } },
  ClientContractCatalog: { type: "object", additionalProperties: false, required: ["revision", "contracts"], properties: { revision: { type: "integer", minimum: 0, maximum: 5000 }, contracts: { type: "array", maxItems: 500, items: ref("ClientContract") } } },
  ClientContractSave: { type: "object", additionalProperties: false, required: ["id", "contract", "changeNote"], properties: {
    id: { type: ["string", "null"], format: "uuid", description: "null cria; UUID existente atualiza. Criação nunca substitui um código duplicado." },
    contract: ref("ClientContractDraft"), changeNote: { type: "string", minLength: 1, maxLength: 500 },
  } },
  ClientContractResult: { type: "object", required: ["catalog", "contract"], properties: { catalog: ref("ClientContractCatalog"), contract: ref("ClientContract") } },
  ClientContractChange: { type: "object", required: ["revision", "changeNote", "contract"], properties: { revision: { type: "integer", minimum: 1 }, changeNote: { type: "string" }, contract: ref("ClientContract") } },
  ClientContractHistory: { type: "object", required: ["total", "limit", "offset", "items"], properties: { total: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1, maximum: 100 }, offset: { type: "integer", minimum: 0 }, items: { type: "array", items: ref("ClientContractChange") } } },
};
export const CLIENT_CONTRACT_PATHS = {
  "/api/v1/client-contracts": {
    get: { operationId: "listClientContracts", description: "Cadastro privado, inicialmente vazio. Sem parâmetros de consulta. Não inclui o histórico completo.", responses: { "200": { ...response("ClientContractCatalog"), headers: etag }, ...errors } },
    put: { operationId: "saveClientContract", description: "Cria ou atualiza um contrato e preserva um snapshot com motivo. Uma instância escreve o volume. Limites: 500 contratos e 5000 alterações; sem exclusão automática. O token restrito de contextos ERP não autoriza esta operação.",
      parameters: [{ name: "If-Match", in: "header", required: true, schema: { type: "string", pattern: '^"(?:0|[1-9][0-9]*)"$' } }],
      requestBody: { required: true, content: { "application/json": { schema: ref("ClientContractSave") } } },
      responses: { "200": { ...response("ClientContractResult"), headers: etag }, "404": response("Error", "Contrato a atualizar ausente"), "409": response("Error", "Código duplicado ou capacidade atingida"), "412": response("Error", "Revisão mudou; edição recusada"), "428": response("Error", "If-Match obrigatório"), "413": response("Error", "Corpo excede 1 MiB"), "415": response("Error", "JSON obrigatório"), ...errors },
    },
  },
  "/api/v1/client-contracts/{id}/history": {
    get: { operationId: "getClientContractHistory", description: "Snapshots do mais recente ao mais antigo. Histórico compartilhado, sem identidade individual de edição.",
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }, { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } }, { name: "offset", in: "query", schema: { type: "integer", minimum: 0, default: 0 } }],
      responses: { "200": response("ClientContractHistory"), "404": response("Error", "Contrato ausente"), ...errors },
    },
  },
};
