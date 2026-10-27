import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { ApiError, record } from "./contracts.js";
import { ROUTE_PRODUCTS } from "./policy-contracts.js";
export { ROUTE_PRODUCTS } from "./policy-contracts.js";

export interface RouteEntry {
  layer: "page" | "bff" | "api";
  path: string;
  method: string | null;
  operationId: string | null;
  source: string | null;
  handlerStatus: "callable" | "not_callable" | "needs_review" | null;
  verification: "not_run";
}
export interface ProductInventory {
  product: string;
  revision: number;
  importedAt: string;
  runId: string;
  recordedAt: string;
  sourceHead: string;
  sourceDirty: boolean;
  sourceFingerprint: string;
  apiCaptured: boolean;
  reviewItems: number;
  entries: RouteEntry[];
}
const missing = (error: unknown) => !!error && typeof error === "object" && "code" in error && error.code === "ENOENT";
function invalid(): never { throw new ApiError(400, "INVALID_ROUTE_INVENTORY", "Inventário route-inventory/2 inválido ou excede os limites."); }
function text(value: unknown, maximum = 2000): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum || /[\x00-\x1f]/.test(value)) invalid();
  return value;
}
function rows(value: unknown): unknown[] { if (!Array.isArray(value) || value.length > 10_000) invalid(); return value; }
const methods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "TRACE"]);
function method(value: unknown): string { if (typeof value !== "string" || !methods.has(value)) invalid(); return value; }
export function routeProduct(value: string): string {
  if (!ROUTE_PRODUCTS.some(product => product.id === value)) throw new ApiError(404, "PRODUCT_NOT_FOUND", "Produto não encontrado.");
  return value;
}

/** Projects a declared inventory; never imports runtime verdicts or arbitrary report fields. */
export function parseRouteInventory(input: unknown) {
  const report = record(input, "inventory");
  if (report.schemaVersion !== "route-inventory/2") invalid();
  const runId = text(report.runId, 36);
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(runId)) invalid();
  const recordedAt = text(report.recordedAt, 40);
  if (!Number.isFinite(Date.parse(recordedAt))) invalid();
  const source = record(report.source, "source");
  const sourceHead = text(source.head, 64), sourceFingerprint = text(source.fingerprint, 64);
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(sourceHead) || !/^[a-f0-9]{64}$/.test(sourceFingerprint) || typeof source.dirty !== "boolean") invalid();
  const web = record(report.web, "web");
  const entries: RouteEntry[] = [];
  const entry = (layer: RouteEntry["layer"], item: Record<string, unknown>, verb: string | null, status: RouteEntry["handlerStatus"] = null) => {
    const route = text(item.path);
    if (!route.startsWith("/") || route.startsWith("//")) invalid();
    entries.push({ layer, path: route, method: verb,
      operationId: layer === "api" && item.operationId != null ? text(item.operationId, 200) : null,
      source: layer !== "api" ? text(item.source) : null, handlerStatus: status, verification: "not_run" });
  };
  for (const item of rows(web.pages)) entry("page", record(item, "page"), null);
  for (const value of rows(web.handlers)) {
    const item = record(value, "handler");
    const exports = rows(item.exports).map(value => record(value, "export"));
    const declared = rows(item.declaredMethods).map(method);
    if (new Set(declared).size !== declared.length) invalid();
    if (!declared.length) entry("bff", item, null, "needs_review");
    for (const verb of declared) {
      const matches = exports.filter(value => value.method === verb);
      const status = matches.length === 1 ? matches[0]!.status : "needs_review";
      if (!["callable", "not_callable", "needs_review"].includes(String(status))) invalid();
      entry("bff", item, verb, status as RouteEntry["handlerStatus"]);
    }
  }
  let apiReview = 0;
  if (report.api !== null) {
    const api = record(report.api, "api");
    for (const item of rows(api.operations)) { const operation = record(item, "operation"); entry("api", operation, method(operation.method)); }
    apiReview = rows(api.review).length;
  }
  if (entries.length > 10_000) invalid();
  return { runId, recordedAt, sourceHead, sourceDirty: source.dirty, sourceFingerprint, apiCaptured: report.api !== null,
    reviewItems: rows(web.review).length + rows(web.conflicts).length + apiReview, entries };
}

export class RouteInventoryStore {
  readonly #directory: string;
  #writes: Promise<unknown> = Promise.resolve();
  constructor(directory: string) { this.#directory = path.join(path.resolve(directory), "route-inventories"); }
  async get(product: string): Promise<{ product: string; revision: number; inventory: ProductInventory | null }> {
    routeProduct(product);
    await this.#writes;
    return this.#read(product);
  }
  async #read(product: string): Promise<{ product: string; revision: number; inventory: ProductInventory | null }> {
    try {
      const inventory = JSON.parse(await readFile(path.join(this.#directory, product + ".json"), "utf8")) as ProductInventory;
      return { product, revision: inventory.revision, inventory };
    } catch (error) { if (missing(error)) return { product, revision: 0, inventory: null }; throw error; }
  }
  save(product: string, input: unknown, revision: number) {
    routeProduct(product);
    const normalized = parseRouteInventory(input);
    const operation = this.#writes.then(async () => {
      const current = await this.#read(product);
      if (current.revision !== revision) throw new ApiError(412, "REVISION_CONFLICT", "O inventário mudou. Recarregue antes de importar novamente.");
      const inventory: ProductInventory = { ...normalized, product, revision: revision + 1, importedAt: new Date().toISOString() };
      await mkdir(this.#directory, { recursive: true, mode: 0o700 });
      const target = path.join(this.#directory, product + ".json"), temporary = target + "." + randomUUID() + ".tmp";
      try {
        await writeFile(temporary, JSON.stringify(inventory), { flag: "wx", mode: 0o600 });
        await rename(temporary, target);
      } finally { await unlink(temporary).catch(error => { if (!missing(error)) throw error; }); }
      return { product, revision: inventory.revision, inventory };
    });
    this.#writes = operation.then(() => undefined, () => undefined);
    return operation;
  }
}
