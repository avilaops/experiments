import { PRODUCTS, POLICY_CATEGORIES, POLICY_STATES, SOURCE_KINDS } from "./policy-contracts.js";

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const string = (maxLength: number, minLength = 1) => ({ type: "string", minLength, maxLength });
const fields = {
  id: { ...string(80), pattern: "^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$" },
  product: { type: "string", enum: PRODUCTS.map(product => product.id) },
  title: string(180), category: { type: "string", enum: Object.keys(POLICY_CATEGORIES) },
  state: { type: "string", enum: Object.keys(POLICY_STATES) },
  rule: string(8000), owner: string(160), enforcement: string(4000, 0), verificationDate: { type: "string", description: "Data YYYY-MM-DD ou string vazia. Verificada exige data válida não futura, código, teste e evidência. É uma declaração manual." },
  sources: { type: "array", maxItems: 20, items: ref("PolicySource") },
};
export const POLICY_SCHEMAS = {
  PolicySource: { type: "object", additionalProperties: false, required: ["kind", "location", "note"], properties: {
    kind: { type: "string", enum: Object.keys(SOURCE_KINDS) }, location: string(2000), note: string(2000, 0),
  } },
  PolicyDraft: { type: "object", additionalProperties: false, required: Object.keys(fields), properties: fields },
  Policy: { type: "object", additionalProperties: false, required: [...Object.keys(fields), "version", "updatedAt"], properties: {
    ...fields, version: { type: "integer", minimum: 1 }, updatedAt: { type: "string", format: "date-time" },
  } },
  PolicyUpdate: { type: "object", additionalProperties: false, required: ["policy", "changeNote"], properties: { policy: ref("PolicyDraft"), changeNote: string(2000) } },
  PolicyCatalog: { type: "object", required: ["revision", "updatedAt", "products", "policies", "history"], properties: {
    revision: { type: "integer", minimum: 1 }, updatedAt: { type: "string", format: "date-time" },
    products: { type: "array", items: { type: "object", required: ["id", "name"], properties: { id: { type: "string" }, name: { type: "string" } } } },
    policies: { type: "array", maxItems: 500, items: ref("Policy") },
    history: { type: "array", items: { type: "object", required: ["revision", "at", "changeNote", "policy"], properties: {
      revision: { type: "integer" }, at: { type: "string", format: "date-time" }, changeNote: string(2000), policy: ref("Policy"),
    } } },
  } },
};
