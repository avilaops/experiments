import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { assessFlow, fingerprint } from "../dist/index.js";
import { InventoryError, correlateRoutes, hash, inventoryWeb, stableFile } from "./route-inventory/source.mjs";
import { inventoryOpenApi } from "./route-inventory/openapi.mjs";

export { analyzeHandlers, handlerMethods, inventoryWeb, routePath, routePattern, correlateRoutes } from "./route-inventory/source.mjs";
export { apiOperations } from "./route-inventory/openapi.mjs";

async function stage(name, code, operation) {
  try { return await operation(); }
  catch (cause) { if (cause instanceof InventoryError) throw cause; throw new InventoryError(name, code, { cause }); }
}

export function diagnostic(error) {
  const known = error instanceof InventoryError;
  const names = new Set(["Error", "TypeError", "SyntaxError", "AbortError", "TimeoutError"]);
  const systemCodes = new Set(["ENOENT", "EACCES", "EPERM", "ENOSPC", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ELOOP"]);
  let systemCode = null;
  let current = error;
  for (let depth = 0; current && depth < 5; depth++, current = current.cause) if (systemCodes.has(current.code)) systemCode = current.code;
  return { schemaVersion: "inventory-error/1", stage: known ? error.stage : "inventory", code: known ? error.code : "UNEXPECTED_FAILURE",
    retryable: known ? error.retryable : false, causeType: names.has(error?.cause?.name) ? error.cause.name : null, systemCode,
    message: "Capture failed. Review the reported stage/code; raw paths, URLs, bodies and exception messages are omitted." };
}

export function gitState(root) {
  const run = args => execFileSync("git", ["-C", root, ...args], { maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  const head = run(["rev-parse", "HEAD"]).toString("utf8").trim();
  const status = run(["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignore-submodules=none"]);
  return { head, dirty: status.length > 0, statusSha256: hash(status) };
}

export async function captureStableInventory(root, { readState = gitState, scan = inventoryWeb, captureApi = async () => null, checkpoint = async () => {} } = {}) {
  const app = path.join(root, "apps", "web", "src", "app");
  const before = await stage("git-before", "GIT_READ_FAILED", () => readState(root));
  const web = await stage("source-before", "SOURCE_READ_FAILED", () => scan(app));
  const api = await captureApi();
  await checkpoint("before-validation");
  const after = await stage("source-after", "SOURCE_READ_FAILED", () => scan(app));
  const apiAfter = api === null ? null : await captureApi();
  await checkpoint("before-final-read");
  const final = await stage("source-final", "SOURCE_READ_FAILED", () => scan(app));
  const stateAfter = await stage("git-after", "GIT_READ_FAILED", () => readState(root));
  if (fingerprint(before) !== fingerprint(stateAfter)) throw new InventoryError("consistency", "GIT_STATE_CHANGED", { retryable: true });
  if (fingerprint(web) !== fingerprint(after) || fingerprint(web) !== fingerprint(final)) {
    throw new InventoryError("consistency", "SOURCE_CHANGED", { retryable: true });
  }
  if (api?.sha256 !== apiAfter?.sha256 || api?.fileMetadata !== apiAfter?.fileMetadata) {
    throw new InventoryError("consistency", "API_CONTRACT_CHANGED", { retryable: true });
  }
  return { web, api, git: { before, after: stateAfter }, consistency: { strategy: "three_source_scans_with_per_file_metadata_and_git_state",
    atomicFilesystemSnapshot: false,
    limitation: "Observations are consistent at checked read intervals. They are not a filesystem lock or an atomic snapshot. Edits to already-dirty files outside the captured route set may not change Git status." } };
}

function options(args) {
  if (args.length !== 1 && args.length !== 3) throw new InventoryError("arguments", "INVALID_ARGUMENTS");
  const root = path.resolve(args[0]);
  if (args.length === 1) return { root, kind: null, location: null };
  if (!["--openapi-url", "--openapi-file"].includes(args[1])) throw new InventoryError("arguments", "UNKNOWN_OPTION");
  if (args[1] === "--openapi-file") return { root, kind: "file", location: path.resolve(args[2]) };
  let url;
  try { url = new URL(args[2]); } catch { throw new InventoryError("arguments", "INVALID_OPENAPI_URL"); }
  if (url.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(url.hostname)
    || url.username || url.password || url.pathname !== "/openapi.json" || url.search || url.hash) throw new InventoryError("arguments", "UNSAFE_OPENAPI_URL");
  return { root, kind: "url", location: url.href };
}

async function contractCapture(config) {
  if (!config.kind) return null;
  const captured = await stage("openapi-read", "OPENAPI_READ_FAILED", async () => {
    if (config.kind === "file") {
      const file = await stableFile(config.location);
      return { bytes: file.bytes, fileMetadata: file.metadata };
    }
    const response = await fetch(config.location, { redirect: "error", signal: AbortSignal.timeout(8000) });
    if (!response.ok || !response.headers.get("content-type")?.includes("application/json") || !response.body) {
      throw new InventoryError("openapi-read", "OPENAPI_HTTP_RESPONSE_INVALID");
    }
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4 * 1024 * 1024) { await reader.cancel(); throw new InventoryError("openapi-read", "OPENAPI_TOO_LARGE"); }
      chunks.push(value);
    }
    return { bytes: Buffer.concat(chunks), fileMetadata: null };
  });
  const contract = await stage("openapi-parse", "INVALID_OPENAPI_JSON", () => JSON.parse(captured.bytes.toString("utf8")));
  const inventory = await inventoryOpenApi(contract);
  return { ...inventory, source: config.location, sha256: hash(captured.bytes), fileMetadata: captured.fileMetadata,
    rawBytes: captured.bytes, runtimeSourceRevision: null,
    note: "This contract declares API operations; a live binary has not been bound to the source checkout." };
}

export async function main(args) {
  const config = options(args);
  const runId = randomUUID();
  const capture = await captureStableInventory(config.root, { captureApi: () => contractCapture(config) });
  const { web } = capture;
  const api = capture.api ? { ...capture.api } : null;
  if (api) delete api.rawBytes;
  const plan = await stage("flow-plan", "FLOW_PLAN_READ_FAILED", async () => JSON.parse(await readFile(new URL("../examples/flows/erp-products.json", import.meta.url), "utf8")));
  const { metadataFingerprint, ...sourceWeb } = web;
  const sourceFingerprint = fingerprint({ web: sourceWeb, apiContractHash: api?.sha256 ?? null });
  const run = { runId, sourceFingerprint, environment: "source_inventory", planHash: fingerprint(plan) };
  const flow = assessFlow(plan, run, []);
  const counts = { pages: web.pages.length, uniquePagePatterns: new Set(web.pages.map(row => row.pattern)).size,
    bffPaths: web.handlers.length, bffDeclaredMethods: web.handlers.reduce((sum, row) => sum + row.declaredMethods.length, 0),
    bffStaticallyCallableMethods: web.handlers.reduce((sum, row) => sum + row.methods.length, 0),
    apiPaths: api?.paths.length ?? null, apiMethods: api?.operations.length ?? null,
    sourceReviewItems: web.review.length, routeConflicts: web.conflicts.length, apiReviewItems: api?.review.length ?? null };
  const report = { schemaVersion: "route-inventory/2", runId, recordedAt: new Date().toISOString(),
    reference: "https://linear.app/avilaops/document/027651cb-8e29-4917-8bc6-0c442eaf8985",
    tools: { node: process.version, typescript: ts.version },
    source: { root: config.root, head: capture.git.before.head, dirty: capture.git.before.dirty,
      git: capture.git, fingerprint: sourceFingerprint, metadataFingerprint,
      scope: "Next page/route files and optional OpenAPI contract. Imported components, helpers, Rust implementation and other files are outside this content fingerprint." },
    consistency: capture.consistency, counts, web, api, relationships: correlateRoutes(web, api), flows: [flow], machineLearningModelExecuted: false,
    limitations: ["Found routes and declared operations are not runtime verification.", "Source relationships do not prove a request was executed.",
      "Handler callability is syntactic; imported bindings, factories, framework signatures and behavior require review/build/tests.",
      "Implicit Next methods, custom pageExtensions, rewrites, middleware and imported page components are not resolved."] };
  const output = new URL(`../reports/flow-verification/${runId}/`, import.meta.url);
  await stage("report-write", "REPORT_WRITE_FAILED", async () => {
    await mkdir(output, { recursive: true, mode: 0o700 });
    if (capture.api) await writeFile(new URL("openapi.json", output), capture.api.rawBytes, { flag: "wx", mode: 0o600 });
    await writeFile(new URL("inventory.json", output), JSON.stringify(report, null, 2), { flag: "wx", mode: 0o600 });
  });
  console.log(JSON.stringify({ runId, directory: fileURLToPath(output), counts, productFlowVerdict: flow.verdict, machineLearningModelExecuted: false }, null, 2));
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { console.error(JSON.stringify(diagnostic(error))); process.exitCode = 1; });
}
