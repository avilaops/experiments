import { POLICY_SCHEMAS } from "./policy-openapi.js";
const reference = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema: object) => ({ "application/json": { schema } });
const success = (name: string, description = "Sucesso") => ({ description, content: json(reference(name)) });
const errors = {
  "400": success("Error", "Entrada inválida"), "401": success("Error", "Token necessário"),
  "403": success("Error", "Origem não permitida"), "500": success("Error", "Falha interna"),
};
const body = (name: string) => ({ required: true, content: json(reference(name)) });
const runParameter = { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } };
const reportSelector = {
  type: "object", additionalProperties: false, required: ["runId", "variant"],
  properties: { runId: { type: "string", format: "uuid" }, variant: { type: "string", enum: ["baseline", "candidate"] } },
};

export const OPENAPI = {
  openapi: "3.1.0",
  info: {
    title: "Ávila Experiments API", version: "1.0.0",
    description: "Laboratório local: cálculos determinísticos, suítes versionadas e evidências persistentes. O serviço não executa código arbitrário nem aciona modelos de ML. O token é exigido quando configurado; a CLI exige token ao escutar fora do loopback.",
  },
  servers: [{ url: "/" }],
  security: [{ bearerAuth: [] }, {}],
  paths: {
    "/api/v1/policies": {
      get: { operationId: "getPolicyCatalog", description: "Cadastro privado e parcial das políticas por produto. Produtos sem fichas ainda não foram inventariados. Não executa regras nem testes.", responses: { "200": { ...success("PolicyCatalog"), headers: { ETag: { schema: { type: "string" } } } }, ...errors } },
      put: { operationId: "savePolicy", requestBody: body("PolicyUpdate"),
        description: "Cria ou revisa uma ficha, exigindo motivo e If-Match. Preserva o snapshot da versão no histórico. Produto de ficha existente não pode mudar. Situação verificada exige data, código, teste e evidência; a declaração não é atestado automático.",
        parameters: [{ name: "If-Match", in: "header", required: true, schema: { type: "string", pattern: '^"[1-9][0-9]*"$' } }],
        responses: { "200": { ...success("PolicyCatalog"), headers: { ETag: { schema: { type: "string" } } } }, "412": success("Error", "Caderno mudou"), "428": success("Error", "If-Match obrigatório"), "413": success("Error", "Corpo excede 1 MiB"), "415": success("Error", "JSON obrigatório"), ...errors },
      },
    },
    "/health": { get: { operationId: "health", security: [], responses: { "200": success("Health") } } },
    "/openapi.json": { get: { operationId: "openapi", security: [], responses: { "200": { description: "Este contrato", content: json({ type: "object" }) } } } },
    "/api/v1/suite": {
      get: { operationId: "getSuite", responses: { "200": { ...success("Suite"), headers: { ETag: { schema: { type: "string" }, description: "Revisão entre aspas, por exemplo: \"1\"" } } }, ...errors } },
      put: {
        operationId: "updateSuite", requestBody: body("SuiteDraft"),
        parameters: [{ name: "If-Match", in: "header", required: true, schema: { type: "string", pattern: '^"[1-9][0-9]*"$' } }],
        responses: { "200": success("Suite"), "412": success("Error", "Revisão desatualizada"), "428": success("Error", "If-Match obrigatório"), "413": success("Error", "Corpo excede 1 MiB"), "415": success("Error", "Content-Type deve ser application/json"), ...errors },
      },
    },
    "/api/v1/runs": {
      get: {
        operationId: "listRuns",
        parameters: [
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 25 } },
          { name: "offset", in: "query", schema: { type: "integer", minimum: 0, default: 0 } },
        ],
        responses: { "200": success("RunList"), ...errors },
      },
      post: {
        operationId: "executeSuite", requestBody: body("RunRequest"),
        description: "Executa a revisão indicada nas variantes rounded e fractional. Retorna 201 mesmo se os testes reprovarem; consulte os verdicts. Cada execução preserva a suíte e os dois relatórios. É síncrono e limitado a uma execução por processo.",
        responses: { "201": success("StoredRun"), "409": success("Error", "Revisão mudou"), "429": success("Error", "Execução em andamento"), ...errors },
      },
    },
    "/api/v1/runs/{id}": { get: { operationId: "getRun", parameters: [runParameter], responses: { "200": success("StoredRun"), "404": success("Error", "Execução não encontrada"), ...errors } } },
    "/api/v1/comparisons": {
      post: {
        operationId: "compareRuns", requestBody: body("ComparisonRequest"),
        description: "Compara relatórios selecionados do histórico. Uma comparação incompatível retorna 200 com comparable=false e reasons; isso não é aprovação.",
        responses: { "200": success("Comparison"), "404": success("Error", "Execução não encontrada"), ...errors },
      },
    },
  },
  components: {
    securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
    schemas: {
      ...POLICY_SCHEMAS,
      Health: { type: "object", required: ["status", "service"], properties: { status: { const: "ok" }, service: { const: "avila-experiments" }, authRequired: { type: "boolean" } } },
      Error: { type: "object", properties: { error: { type: "object", required: ["code", "message"], properties: { code: { type: "string" }, message: { type: "string" } } } } },
      Settings: {
        type: "object", additionalProperties: false,
        required: ["absoluteTolerance", "relativeTolerance", "minimum", "maximum", "includeMinimum", "includeMaximum", "repetitions"],
        properties: {
          absoluteTolerance: { type: "number", minimum: 0 }, relativeTolerance: { type: "number", minimum: 0 },
          minimum: { type: "number" }, maximum: { type: "number" },
          includeMinimum: { type: "boolean" }, includeMaximum: { type: "boolean" },
          repetitions: { type: "integer", minimum: 1, maximum: 10 },
        },
      },
      CalculationCase: {
        type: "object", additionalProperties: false, required: ["id", "input"],
        properties: {
          id: { type: "string", maxLength: 80, pattern: "^[a-zA-Z0-9][a-zA-Z0-9_.-]*$" },
          group: { type: "string", minLength: 1, maxLength: 80 }, expected: { type: "number" },
          input: {
            type: "object", additionalProperties: false, required: ["operation", "left", "right"],
            properties: { operation: { type: "string", enum: ["add", "subtract", "multiply", "divide"] }, left: { type: "number" }, right: { type: "number" } },
          },
        },
      },
      SuiteDraft: {
        type: "object", additionalProperties: false, required: ["hypothesis", "cases", "settings"],
        properties: { hypothesis: { type: "string", minLength: 1, maxLength: 2000 }, cases: { type: "array", minItems: 1, maxItems: 200, items: reference("CalculationCase") }, settings: reference("Settings") },
      },
      Suite: {
        type: "object", required: ["revision", "hypothesis", "dataset", "settings"],
        properties: {
          revision: { type: "integer", minimum: 1 }, hypothesis: { type: "string" }, settings: reference("Settings"),
          dataset: { type: "object", properties: { id: { type: "string" }, version: { type: "string" }, split: { const: "development" }, cases: { type: "array", items: reference("CalculationCase") } } },
        },
      },
      RunRequest: { type: "object", additionalProperties: false, required: ["revision"], properties: { revision: { type: "integer", minimum: 1 } } },
      ComparisonRequest: { type: "object", additionalProperties: false, required: ["baseline", "candidate"], properties: { baseline: reportSelector, candidate: reportSelector } },
      Comparison: {
        type: "object", required: ["comparable"],
        properties: {
          comparable: { type: "boolean" }, reasons: { type: "array", items: { type: "string" } },
          passRateDelta: { type: "number" }, meanDurationMsDelta: { type: "number" },
          baselineRunId: { type: "string" }, candidateRunId: { type: "string" },
          regressions: { type: "array", items: { type: "object" } }, evaluations: { type: "array", items: { type: "object" } },
        },
      },
      Summary: {
        type: "object",
        properties: {
          verdict: { enum: ["passed", "failed", "inconclusive", "error"] },
          total: { type: "integer" }, passed: { type: "integer" }, failed: { type: "integer" }, inconclusive: { type: "integer" }, errors: { type: "integer" },
          passRate: { type: "number", minimum: 0, maximum: 1 },
          durationMs: { type: "object", properties: { mean: { type: "number" }, p95: { type: "number" } } },
          usage: { type: "object", description: "Métricas com total (número ou null) e measuredRuns. Ausência de medição não significa custo zero." },
          evaluations: { type: "object" },
        },
      },
      ExperimentReport: {
        type: "object", required: ["runId", "cases", "summary", "dataset", "variant", "evaluators"],
        properties: {
          schemaVersion: { const: "1" }, runId: { type: "string", format: "uuid" }, startedAt: { type: "string", format: "date-time" }, completedAt: { type: "string", format: "date-time" },
          experiment: { type: "object" }, dataset: { type: "object" }, variant: { type: "object" }, evaluators: { type: "array", items: { type: "object" } },
          repetitions: { type: "integer" }, summary: reference("Summary"), groups: { type: "array", items: { type: "object" } },
          cases: { type: "array", items: { type: "object", properties: {
            caseId: { type: "string" }, repetition: { type: "integer" }, group: { type: ["string", "null"] },
            verdict: { enum: ["passed", "failed", "inconclusive", "error"] }, output: {},
            evaluations: { type: "array", items: { type: "object" } }, error: { type: ["object", "null"] }, durationMs: { type: "number" },
          } } },
        },
      },
      StoredRun: { type: "object", required: ["id", "createdAt", "suite", "baseline", "candidate", "comparison", "mode"], properties: {
        id: { type: "string", format: "uuid" }, createdAt: { type: "string", format: "date-time" }, mode: { const: "deterministic-local" },
        suite: reference("Suite"), baseline: reference("ExperimentReport"), candidate: reference("ExperimentReport"), comparison: reference("Comparison"),
      } },
      RunList: { type: "object", properties: { total: { type: "integer" }, items: { type: "array", items: { type: "object", properties: {
        id: { type: "string", format: "uuid" }, createdAt: { type: "string", format: "date-time" }, mode: { const: "deterministic-local" }, suiteRevision: { type: "integer" },
        baseline: reference("Summary"), candidate: reference("Summary"), comparison: reference("Comparison"),
      } } } } },
    },
  },
};
