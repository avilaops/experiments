import SwaggerParser from "@apidevtools/swagger-parser";
import { METHODS, InventoryError, routePattern } from "./source.mjs";

function checkReferences(contract) {
  const stack = [contract];
  const seen = new Set();
  let count = 0;
  while (stack.length) {
    const value = stack.pop();
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    if (++count > 200_000) throw new InventoryError("openapi-validation", "CONTRACT_TOO_COMPLEX");
    seen.add(value);
    for (const [key, child] of Object.entries(value)) {
      if (["$ref", "$dynamicRef"].includes(key) && (typeof child !== "string" || !child.startsWith("#"))) {
        throw new InventoryError("openapi-validation", "EXTERNAL_REFERENCE_DISABLED");
      }
      if (child && typeof child === "object") stack.push(child);
    }
  }
}

export async function inventoryOpenApi(contract) {
  if (!contract || typeof contract.openapi !== "string" || !/^3\.(?:0|1)\.\d+$/.test(contract.openapi)) {
    throw new InventoryError("openapi-validation", "UNSUPPORTED_OPENAPI_VERSION");
  }
  checkReferences(contract);
  let api;
  try {
    api = await new SwaggerParser().validate(structuredClone(contract), {
      resolve: { file: false, http: false, external: false }, dereference: { circular: "ignore" },
    });
  } catch (cause) { throw new InventoryError("openapi-validation", "INVALID_OPENAPI_CONTRACT", { cause }); }
  const paths = [], operations = [], review = [];
  const ids = new Set();
  for (const [route, item] of Object.entries(api.paths ?? {}).sort(([left], [right]) => left.localeCompare(right, "en"))) {
    if (route.startsWith("x-")) continue;
    if (item.$ref) throw new InventoryError("openapi-validation", "UNRESOLVED_PATH_REFERENCE");
    const methods = METHODS.filter(method => item[method.toLowerCase()] !== undefined);
    paths.push({ path: route, pattern: routePattern(route, { openapi: true }), methods, verification: "not_run" });
    for (const method of methods) {
      const operationId = item[method.toLowerCase()].operationId ?? null;
      if (operationId !== null && ids.has(operationId)) throw new InventoryError("openapi-validation", "DUPLICATE_OPERATION_ID");
      if (operationId !== null) ids.add(operationId);
      else review.push({ path: route, method, reason: "operation_id_missing" });
      operations.push({ path: route, pattern: routePattern(route, { openapi: true }), method, operationId, verification: "not_run" });
    }
  }
  const patterns = new Map();
  for (const item of paths) {
    const paths = patterns.get(item.pattern) ?? []; paths.push(item.path); patterns.set(item.pattern, paths);
  }
  for (const [pattern, paths] of patterns) if (paths.length > 1) review.push({ pattern, paths, reason: "equivalent_api_path_patterns" });
  return { paths, operations, review, validation: { validator: "@apidevtools/swagger-parser@13.1.0",
    version: api.openapi, schema: "passed", internalReferences: "resolved_for_operation_inventory", circularSchemaReferences: "retained", externalReferences: "disabled",
    limitation: "Structural schema validation does not prove all specification semantics, formats or backend behavior." } };
}

export const apiOperations = async contract => (await inventoryOpenApi(contract)).paths;
